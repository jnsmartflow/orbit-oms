# Code update — 2026-09-30 — live feed steps 2–3: prune cron + `GET /api/live/changes`

**Commit:** the single commit on `main` titled *"live feed steps 2-3: prune cron + GET /api/live/changes (behind live.feed, default off)"* (`git log --grep "live feed steps 2-3"`).
**Design of record:** `docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md` (§C.4, §F.1, §H, §M steps 2–3).
**Builds on:** step 1 (`live_changes` + `orders` triggers, commit `7c985f57`, applied live 2026-09-30 ~01:00 IST, TEST OK) and step 0 (the access notebook, `ACCESS_CACHE='on'`).
**No SQL, no DDL, no client code, no new triggers in this step.** The switch `app_settings 'live.feed'` has no row yet → the API answers `{ enabled: false }` and reads nothing else.

## What shipped
| File | What |
|---|---|
| `app/api/cron/live-prune/route.ts` (new) | Daily prune: rows older than 3 days, in ≤ 10 batches of 5,000 within a 20 s budget; watermark and delete in ONE statement per batch |
| `vercel.json` | `{ "path": "/api/cron/live-prune", "schedule": "30 21 * * *" }` — 21:30 UTC = **03:00 IST** |
| `app/api/live/changes/route.ts` (new) | The catch-up API |
| `lib/live/feed.ts` (new) | Server reads: the cached switch, the horizon/watermark/lag statement, the one `live_changes` query (`$queryRaw`, bound params, `::text` transport) |
| `lib/live/cursor.ts` (new) | Pure: cursor encode/decode/compare, next-cursor rule, pruned-past rule, grouping + de-dupe, topics/limit parsing, switch parsing |
| `lib/live/live.test.ts` (new) + `npm run test:live` | 13 tests, all pass |
| `docs/CLAUDE_CORE.md` | v27.45 → APPLIED TO LIVE 2026-09-30 ~01:00 IST, verification + TEST OK |
| `docs/prompts/drafts/code-update-2026-09-30-live-changes-step1.md` | Same, marked applied |

## The prune cron
- **When:** `30 21 * * *` UTC = 03:00 IST daily (Hobby fires within the hour). The other crons: 15:30 UTC (21:00 IST) load-plan-snapshot, 18:35 UTC (00:05 IST) attendance-rollover, 20:30 UTC (02:00 IST) attendance-purge.
- **What:** deletes `live_changes` rows with `"createdAt"` older than 3 days and moves `live_feed_meta."prunedThroughTxId"` forward (`GREATEST`) to the highest `"txId"` it deleted, stamping `"prunedAt"` / `"updatedAt"`.
- **Why one statement per batch:** the watermark and the delete commit together, so rows are never gone without the watermark covering them. A missing meta row → the batch deletes nothing.
- **Bounded:** 10 × 5,000 rows max, stops starting batches after 20 s; each statement is far under the 30 s role timeout. Expected ≤ ~10k rows/day = 1–2 batches. Idempotent.
- **First real deletes:** the table began 2026-09-30 ~01:00 IST, so the first run that deletes anything is 2026-10-03 03:00 IST; until then it returns `deleted: 0`.

## The API
`GET /api/live/changes?after=<cursor>&topics=order,trip,config&limit=500`
1. **Auth:** session (401), then `canView` on `floor` via `checkAnyPermission` (403) — the access notebook applies, so it costs nothing extra on a warm instance.
2. **Switch:** `app_settings."settingKey" = 'live.feed'`; ON only when the row exists with `isEnabled = true`; absent / false / read error → **OFF** → `200 { enabled: false }` and no other read. Cached 30 s per server instance.
3. **Cursor:** opaque `"v1.<txId>.<seq>"` (decimal strings). No `after` → `{ enabled: true, cursor: <head>, changes: [], reset: true }` — take it BEFORE the first full load. A bad cursor → 400.
4. **Horizon:** rows with `"txId" < pg_snapshot_xmin(pg_current_snapshot())` and `("txId", seq) > cursor`, ordered by `("txId", seq)`, `LIMIT limit+1` → `more`. Page full → cursor = last row returned; otherwise cursor = (horizon, 0), never backwards. Cursor `txId` ≤ `prunedThroughTxId` → `reset: true` + head cursor.
5. **Response:** `{ enabled, cursor, changes: [{ entity, ids }], more, reset, lagSeconds, serverNow }` — ids de-duplicated per entity (order/trip ids as numbers, config as table names); `lagSeconds` = age of the oldest open transaction holding the horizon; `Cache-Control: no-store`. Never business data.

**Queries per call (switch ON):** ≤ 1 cached switch read per instance per 30 s + one small statement (horizon, watermark, lag — no `live_changes` read) + at most one `live_changes` read — an index range scan on `live_changes_tx_seq_idx ("txId", seq)`. Exact SQL in comments in `lib/live/feed.ts`.

## Hand tests (Smart Flow)
**Now, switch OFF (no `live.feed` row):**
1. Signed in as a user who can open `/floor`, open `https://www.orbitoms.in/api/live/changes` → `{"enabled":false}`.
2. Signed in as a user without the `floor` tick → `{"error":"Forbidden"}` (403).
3. Signed out → middleware sends you to `/login` (the page is behind the session like every `/api` route).

**Later, when the owner decides to turn it on** (do not turn it on as part of this step):
```sql
-- ON
INSERT INTO app_settings ("settingKey", "isEnabled", "updatedAt") VALUES ('live.feed', true, now())
  ON CONFLICT ("settingKey") DO UPDATE SET "isEnabled" = true, "updatedAt" = now();
-- OFF
UPDATE app_settings SET "isEnabled" = false, "updatedAt" = now() WHERE "settingKey" = 'live.feed';
```
With it ON (within ~30 s):
4. `/api/live/changes` → `enabled: true`, `reset: true`, a `cursor` like `v1.1234567.0`, `changes: []`.
5. `/api/live/changes?after=<that cursor>` → `reset: false`, `changes: []` or a few order ids; do any Floor action (e.g. mark a bill urgent) and call again with the returned cursor within a few seconds → that order id appears under `entity: "order"`.
6. `?after=garbage` → 400; `?topics=nonsense` → 400; `?limit=5000` → capped at 1000.

**Cron (any time, safe):** `curl -H "Authorization: Bearer <CRON_SECRET>" https://www.orbitoms.in/api/cron/live-prune` → `{"ok":true,"deleted":0,"batches":1,…}` until 2026-10-03; afterwards `deleted` > 0 and `watermark` is a number. Check with `SELECT id, "prunedThroughTxId"::text, "prunedAt" FROM live_feed_meta;` (read-only).

## Rollback
- The API: turn `live.feed` OFF (or leave it absent) — nothing calls the route yet anyway.
- The cron: remove the `vercel.json` entry and deploy, or `git revert` the commit. Pruning is also harmless to stop: the table simply grows ~1–2 MB/day.
- No database object was added in this step.

## Where this differs from the design / the brief
- **`serverNow`** added to the response (design §F.1 has it; the brief's shape did not) — the client needs server time to schedule the IST-midnight reload (design §G.5).
- **Two small statements, not one,** per call when ON: the horizon/watermark/lag read and the `live_changes` read. Still only ONE `live_changes` query; the `live_changes` read returns the horizon of its OWN snapshot, which is the one the next cursor may jump to.
- **Reset is inclusive** (`cursor txId ≤ prunedThroughTxId`): a batch can stop part-way through a transaction's rows. A needless reset costs one full load; a missed one costs a stale screen.
- **Switch read cached 30 s per instance** (design §F.1), failing OFF on a read error.

## Next (design §M step 4)
Remaining triggers per §B.4: `pick_assignments`, `tint_assignments`, `order_splits`, `import_obd_query_summary`, `ci_returns`, `so_tag_matches`, `pick_delete_decisions`, `trips`, `trip_drops`, `trip_activity`, and the config tables — then step 5, the shared client module.
