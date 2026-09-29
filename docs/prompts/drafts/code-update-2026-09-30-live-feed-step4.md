# Code update — 2026-09-30 — live feed step 4: triggers on the remaining screen tables + the cancelled-feed index

**Commit:** the single commit on `main` titled *"live feed step 4: triggers on remaining screen tables + cancelled-feed index"* (`git log --grep "live feed step 4"`).
**Design of record:** `docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md` §B.4 (which tables), §C.2 (trigger design), §H, §M step 4.
**Schema:** v27.46 (CORE §7). **APPLIED TO LIVE 2026-09-30 ~01:38 IST (Smart Flow): 69 triggers on 23 tables enabled (`O`), 7 functions; `order_status_logs_cancelled_created_idx` created (16 kB); step-4 TEST "TEST OK — rolled back (23 tables checked, 0 skipped, 0 failed)".**
**Live before this:** step 0 access notebook (`ddfcb43d`, `ACCESS_CACHE` on) · step 1 `live_changes` + `orders` triggers (`7c985f57`, applied, TEST OK) · steps 2–3 prune cron + `GET /api/live/changes` (`126abf2a`, `live.feed` absent = OFF).

## What shipped
| File | What |
|---|---|
| `sql/2026-09-30-live-changes-step4.sql` | Pre-check (commented) · helper `live_changes_keys` · six generic trigger functions · 69 triggers on 23 tables · kill switch (one-shot `DO` block + one line per trigger, commented) · full rollback (commented) · verification |
| `sql/2026-09-30-order-status-logs-cancelled-idx.sql` | The partial index, its own file (it locks `order_status_logs` against writes while it builds) |
| `sql/2026-09-30-live-changes-step4-TEST.sql` | One `DO` block: per table a no-op (expect 0 lines) and a real change (expect ≥ 1 line with the right entity and id); ends with `ERROR: TEST OK — rolled back (…)` |
| `prisma/schema.prisma` | Comment on `order_status_logs` recording the partial index (Prisma cannot model it) — no model change |
| `docs/CLAUDE_CORE.md` | v27.46 chain entry, change log, stamps → v116 · Schema v27.46 |

## Tables and entity mapping (23 tables × INSERT/UPDATE/DELETE = 69 triggers)
| Table | Entity written | Id | Notes |
|---|---|---|---|
| `pick_assignments` | order | `order_id` | snake_case column |
| `tint_assignments` | order | `"orderId"` | catches pause / resume / TI writes that never touch `orders` |
| `order_splits` | order | `"orderId"` | split start / reassign / reorder swaps |
| `import_obd_query_summary` | order | `"orderId"` | NULL `orderId` rows skipped; lines-only import rebuilds now visible |
| `ci_returns` | order | `"orderId"` | every `/api/ci/*` write and auto-CI now visible |
| `so_tag_matches` | order | `"orderId"` | Cancelled-tab source label |
| `pick_delete_decisions` | order | `"orderIds"` ∪ `"keptOrderIds"` ∪ `"deletedOrderId"` | arrays expanded one line per id; NULLs skipped — All OK / its undo now visible |
| `trips` | trip | `id` | op = the row's own I/U/D; show, send-to-billing, billing copy, vehicle PATCH now visible |
| `trip_drops` | trip | `"tripId"` | |
| `trip_activity` | trip | `"tripId"` | |
| `delivery_point_master`, `area_master`, `route_master`, `delivery_type_master`, `dispatch_slot_master`, `vehicle_master`, `transporter_master`, `route_clubs`, `route_club_members`, `load_plan_config`, `app_settings`, `obd_visibility_rules`, `app_tag_settings` | config | the table name | one line per changing statement → a screen does one full reload; `app_settings` includes the pick gate and the `live.feed` switch itself |

**From §B.4, NOT triggered:** `users` — it is one of the access tables (it carries the v27.44 `trg_access_version_*` bumps) and the brief excludes access tables; a renamed picker or operator therefore reaches a screen only at its next full reload (midnight, a `config` change, or a page load). `order_status_logs` — excluded by decision. Also untouched: `system_config`, `live_changes`, `live_feed_meta`, `user_page_access`, `role_permissions`, `user_roles`, `attendance_settings`.

## How a change is detected
- INSERT / DELETE: every row.
- UPDATE: `(new EXCEPT old) ∪ (old EXCEPT new)` over `to_jsonb(row) - 'updatedAt'` — key-free, so it works for `load_plan_config` (keyed on `"deliveryTypeId"`), ignores Prisma's `updatedAt` stamp, writes nothing for a no-op, and records BOTH the old and the new parent if a row's parent key moved.
- One `INSERT … SELECT DISTINCT` per statement.
- 🔴 Every function swallows its own failure (`RAISE WARNING`, `RETURN NULL`) — same as step 1, opposite of the access-version bump. A broken change book never fails a business write.

## The index
`CREATE INDEX IF NOT EXISTS order_status_logs_cancelled_created_idx ON order_status_logs ("createdAt") WHERE "toStage" = 'cancelled';`
- **Serves** `lib/floor/queries.ts` `getFloorCancelled` step b: `WHERE "toStage" = 'cancelled' AND "createdAt" in today (IST) ORDER BY "createdAt" DESC` — equality matches the partial predicate, the range is the index condition, the ORDER BY is a backward scan. Swept 2026-09-30: this is the only reader in `app/`/`lib/` that filters on `toStage`.
- **Why partial, not `("toStage","createdAt")`:** `order_status_logs` is the busiest insert-only table (39 write sites). A full index would add an entry to every log insert; the partial one only to the few cancel logs a day, and it stays a few KB.
- **Lock / time:** plain `CREATE INDEX` (CONCURRENTLY cannot run in the SQL Editor's multi-statement run) → SHARE lock: reads continue, every log INSERT (most bill actions) waits for the build — EST a few seconds (one table scan). After hours.
- **Effect:** the Cancelled feed stops scanning the whole log table on every Floor load (every 30 s per Floor tab under today's poll) — an index probe returning today's handful of rows.

## Estimated extra rows per day (ESTIMATE)
| Source | Rows/day |
|---|---|
| `pick_assignments` (~300 bills × assign/done/approve/unassign) | 1,000–1,500 |
| `tint_assignments` (~50–100 tint bills × ~5 writes) | 300–600 |
| `import_obd_query_summary` (creates + rebuilds) | 300–600 |
| `order_splits`, `ci_returns`, `so_tag_matches`, `pick_delete_decisions` | 100–300 |
| `trips`, `trip_drops`, `trip_activity` | 250–550 |
| config tables | 0–20 |
| **Total** | **≈ 2,000–3,500 rows/day** (~0.5–1 MB/day incl. index + WAL), on top of step 1's ~4,500–9,000; pruned after 3 days by the step-2 cron |

Many of these name an order the `orders` trigger also names in the same action; they are separate statements so both lines are written, and the catch-up API de-duplicates ids per response.

## Smart Flow — order of running (after hours)
1. **Pre-check** — top of `sql/2026-09-30-live-changes-step4.sql` (un-comment, run, re-comment): 23 `table` rows · 12 `key column` rows · 1 `live_changes present` · **no** `existing trigger` rows.
2. **Triggers** — the whole step-4 file: 23 `triggers` rows each `del=O ins=O upd=O` · `total` = 69 · 7 `function` rows.
3. **Index** — `sql/2026-09-30-order-status-logs-cancelled-idx.sql`: its own pre-check first (row estimate + existing indexes), then the file → one `index` row with the partial definition + its `size`. Optional `EXPLAIN` in the file → "Index Scan Backward using order_status_logs_cancelled_created_idx".
4. **TEST** — `sql/2026-09-30-live-changes-step4-TEST.sql` → `ERROR: TEST OK — rolled back (N tables checked, M skipped with no rows, 0 failed)`; the NOTICE lines list each table. Anything else → stop and report.
5. **If anything looks wrong** — the one-shot `DO` kill switch at the top of the step-4 file disables every step-4 trigger at once (step-1 `orders` triggers untouched); or per trigger: `ALTER TABLE <table> DISABLE TRIGGER trg_live_changes_<table>_<ins|upd|del>;`.

## Rollback
Triggers: the commented rollback block in the step-4 file (69 `DROP TRIGGER` lines + 7 `DROP FUNCTION`). Index: `DROP INDEX IF EXISTS order_status_logs_cancelled_created_idx;`. Nothing reads `live_changes` except the switched-off API, so removing them breaks nothing.

## Next (design §M step 5)
The shared client module `lib/live/*` + `useLiveFeed` (poll mode, 15 s), no screen using it yet; then step 6 (`POST /api/floor/rows` + `trips?ids=` with a parity script) and step 7 (Floor behind `live.feed`).
