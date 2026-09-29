# Code update — 2026-09-30 — live feed step 1: the change book + the `orders` trigger

**Commit:** the single commit on `main` titled *"live feed step 1: live_changes table + orders trigger (nothing reads it yet)"* (`git log --grep "live feed step 1"`).
**Design of record:** `docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md` — owner approved all 12 decisions as recommended; this is §M step 1 only.
**Schema:** v27.45 (CORE §7). **SQL committed; APPLIED TO LIVE: pending.**
**Prerequisite (step 0) is live:** the access notebook, commit `ddfcb43d`, SQL applied 2026-09-30 ~00:30 IST, `ACCESS_CACHE='on'` ~00:35 IST.

## What shipped
| File | What |
|---|---|
| `sql/2026-09-30-live-changes.sql` | Commented read-only pre-check · `live_changes` · `live_feed_meta` (+ its one row) · REVOKE from `anon`/`authenticated` (tables + identity sequence) · three trigger functions · three statement-level triggers on `orders` · one UNION ALL verification · commented kill switch and full rollback |
| `sql/2026-09-30-live-changes-TEST.sql` | One `DO` block that proves the trigger on real orders and rolls everything back; its final `ERROR: TEST OK — rolled back (…)` is the success signal |
| `prisma/schema.prisma` | `live_changes`, `live_feed_meta` hand-mirrored with header comments; `txId` / `prunedThroughTxId` are `Unsupported("xid8")` (reads will be `$queryRaw`); `npx prisma generate` run |
| `docs/CLAUDE_CORE.md` | v27.45 chain entry; v27.44 marked applied live; §13 landmine line; change log; header/footer → v115 · Schema v27.45 |
| `docs/prompts/drafts/code-update-2026-09-30-access-notebook.md` | Marked applied live |

**Nothing reads `live_changes` yet.** No API route, no client code, no cron in this step.

## The table, in five lines
1. `live_changes`: `seq` (bigint identity PK) · `"txId"` (xid8, `pg_current_xact_id()`) · `entity` (`order`|`trip`|`config`) · `"entityId"` (text) · `op` (`I`|`U`|`D`) · `"sourceTable"` · `"createdAt"`; one extra index `("txId", seq)`.
2. **Cursor** = `("txId", seq)` read below `pg_snapshot_xmin(pg_current_snapshot())` — a late-committing transaction can never be skipped (design §C.4).
3. **A change** = a row whose jsonb, minus `"updatedAt"`, differs before vs after (UPDATE), or any inserted / deleted row.
4. **Skipped**: no-op updates and `"updatedAt"`-only updates write nothing; `order_status_logs` and every other table are not triggered in this step.
5. An order on a trip (before or after the change) also writes one `trip` line for that trip, via `trip_drops."tripId"`.

## Failure direction (read before touching either trigger family)
The three `live_changes_orders_*` functions **swallow** their own failure (`EXCEPTION WHEN OTHERS → RAISE WARNING → RETURN NULL`): the order write always succeeds. The v27.44 `bump_access_version()` deliberately does the **opposite** (a failed bump fails the access write). Both are correct for their job; do not harmonise them.

## Estimated trigger cost per day (ESTIMATE — design §C volumes)
- **Lines written:** ~250–400 bills/day × ~8–15 recorded changes each ≈ **4,000–8,000 `order` lines**, plus **~300–600 `trip` lines** (≈ 105 bills/day ride Orbit trips, each changing a few times after it is put on one) → **≈ 4,500–9,000 rows/day**.
- **Trigger calls:** one per `orders` statement, including statements that record nothing (no-ops): ≈ 3,000–6,000/day. Each costs one subtransaction and, for the UPDATE trigger, a jsonb comparison per changed row.
- **Bytes:** ~60–100 bytes per row + one entry in each of two indexes + WAL ≈ **1–2 MB/day**, ≈ 3–6 MB standing once the 3-day prune (step 2) runs. Until step 2 ships the table simply grows at that rate — harmless for weeks.
- **Context:** the disk-IO report estimates ~300,000 app statements per busy hour from polling today. This trigger adds a few thousand small inserts per day.
- Measure after it runs: `SELECT count(*), min("createdAt"), max("createdAt") FROM live_changes;` next day, and `pg_stat_user_tables.n_tup_ins` for `live_changes`.

## Smart Flow — order of running
1. **Read-only pre-check** — the commented block at the top of `sql/2026-09-30-live-changes.sql` (un-comment, run, re-comment). Expect PG ≥ 13, an xid8 btree operator class, the five columns, no existing tables, no triggers on `orders`.
2. **Main SQL** — the whole file once, after hours, database healthy. The last result must show 2 tables · 11 columns · 3 indexes · 2 CHECKs · 3 triggers `enabled = O` · the meta row · `anon can read live_changes = false`.
3. **TEST** — `sql/2026-09-30-live-changes-TEST.sql`. Success = `ERROR: TEST OK — rolled back (e: write ok + 0 lines · a: 0 · b: 0 · c: 1 · d: 3 · trip lines: N)`. One `WARNING: live_changes: orders UPDATE not recorded …` above it is expected (that is test e working). Anything else — stop and report.
4. **If anything looks wrong** — kill switch (instant; order writes carry on):
   ```sql
   ALTER TABLE orders DISABLE TRIGGER trg_live_changes_orders_ins;
   ALTER TABLE orders DISABLE TRIGGER trg_live_changes_orders_upd;
   ALTER TABLE orders DISABLE TRIGGER trg_live_changes_orders_del;
   ```
   Full rollback (drop triggers, functions, tables) is at the top of the SQL file.

## Where this differs from the design, and why
- **Three trigger functions, one per event** (design: one function). Each event has its own transition tables; a function per event never references a transition table its trigger does not have.
- **`op` is `text` + CHECK** (design: `char(1)`) — plain String in Prisma, same guarantee.
- **`seq` is `GENERATED ALWAYS AS IDENTITY`** — the app can never write it.
- **`live_feed_meta` gains `"updatedAt"`** so the future raw-SQL prune leaves a timestamp.
- **REVOKE ALL from `anon`/`authenticated`** on both tables and the identity sequence (Supabase default privileges would otherwise grant them); no RLS policies.
- **The `trip` fan-out lives in the `orders` trigger** (design §B.4 listed it there) — so trip cards will refresh when a bill on them changes stage, which today's marker cannot see.

## Next step (design §M step 2)
The prune cron `/api/cron/live-prune` (daily, `CRON_SECRET`): delete lines older than 3 days, set `live_feed_meta."prunedThroughTxId"` / `"prunedAt"` / `"updatedAt"`; add to `vercel.json`. Then step 3, `GET /api/live/changes` (read-only, `$queryRaw`, the horizon rule above, `enabled` from `app_settings` `live.feed`, absent = OFF).
