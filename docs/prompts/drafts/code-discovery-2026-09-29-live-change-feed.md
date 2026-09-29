# Code discovery + design — 2026-09-29 — one central live change feed ("the change book")

**Mode:** DISCOVERY + DESIGN ONLY. No code changed, dev server not run, **no database queries** (everything that needs the live DB is in §K for Smart Flow). No commit.
**Inputs read:** `docs/prompts/drafts/code-discovery-2026-09-29-disk-io.md` (whole); CORE v113 · Schema v27.43 (§3, §4, §5, §7.3, §7.16, §13); FLOOR v1.8 (whole); FLOOR_TRIPS v1.0 (whole); PICKING v1.18 §10; BILLING v1.0 §5, §8; IMPORT v1.11; TINT v2.2 and MAIL_ORDERS v1.14 skimmed for writers. Code: `components/floor/**`, `lib/floor/*`, `lib/trips/*`, `app/api/floor/**`, `lib/hooks/use-picking-marker.ts`, `lib/floor/use-floor-rail-poll.ts`, `lib/supabase.ts`, `lib/auth.ts`, `auth.config.ts`, `middleware.ts`, `lib/prisma.ts`, `package.json`, all committed SQL, plus the installed `node_modules/@supabase/*` source.
**Method:** seven read-only sweeps (Floor reads · two writer inventories · Realtime source · Floor client internals), load-bearing claims re-opened by hand (✅). `rg` silently treats at least one SQL file as binary (`sql/2026-09-21-load-plan-v2.sql`) — every SQL sweep was re-run with `rg -a` and the Grep tool and reconciled.
**Labels:** **VERIFIED-SRC** = read in installed source with file:line. **UNVERIFIED** = from memory; check against Supabase / Postgres docs before build. **EST** = estimate.

---

## A. What Floor shows — tables and columns read

Full per-surface detail is long; this is the table-level result that decides which tables need triggers. Row-set predicate `floorBoardWhere` (4 arms) and the trip rule `tripsOnDeskWhere` are described in `CLAUDE_FLOOR.md §3` / `CLAUDE_FLOOR_TRIPS.md §8`.

| Surface | Route → builder | Tables read (key columns) |
|---|---|---|
| **Board rows** (Floor tab: Flat, By route, route cards/clubs, load plan v1, IGT/Cross; **Tinting tab is a client view of the same rows**) | `GET /api/floor/board` → `getFloorBoard` `lib/floor/queries.ts:706-1186` | `orders` (all scalars; used: stage, dispatchStatus, tripDropId, handAt, materialType, smu, soNumber, invoiceNo/Date, dates, priorityLevel, orderType, customer ids, isHidden/isRemoved via predicate) · `delivery_point_master` ×2 chains → `area_master` → `route_master`, `delivery_type_master` · `dispatch_slot_master` · `import_obd_query_summary` (articleTag, totalVolume, totalWeight) · `users` (early-release, picker, checker, assigner names) · `tint_assignments` (completedAt) · `pick_assignments` (pickerId, assigned/picked/checkedAt) · `trip_drops` + `trips` (tripNumber, status, **shownAt**) · `import_raw_summary` (billToCustomerName) · `orders` twins by soNumber + `pick_delete_decisions` (duplicate-SO flag) · colour-work: `users` (base operator), `tint_assignments`, `order_splits` · `obd_visibility_rules` (hide) · dead payload: `import_raw_line_items`, `sku_master_v2` (`waitingSkus`/`oilSkus` — no Floor reader) |
| Board siblings | same response | `users`+`role_master`+`pick_assignments` groupBy (pickers, only the panel dropdown reads it) · `route_clubs`, `route_club_members`, `route_master`, `area_master` · `load_plan_config`, `route_master` |
| **On hold** | `GET /api/floor/hold` → `getFloorHold` `:1190-1289` | `orders` (`dispatchStatus='hold'`, all dates) + dealer chain + `import_obd_query_summary` + `import_raw_summary` + `order_status_logs` (hold-note logs → heldSince) + colour-work |
| **Cancelled (Cancel & CI)** | `GET /api/floor/cancelled` → `getFloorCancelled` `:1327-1492` | `ci_returns` (today, non-draft, non-void) + `users` · `so_tag_matches`+`so_tags` · `order_status_logs` (`toStage='cancelled'`, today) + `users` · `orders` by id + dealer chain + summaries |
| **Trip rail** | `GET /api/floor/trips?date=` → `getTripsForDate` `lib/trips/queries.ts:806-867` | `trips` (TRIP_SELECT) · `trip_drops` · `orders` on those drops (no hide filter) · `delivery_point_master`, `area_master`, `delivery_type_master` · `import_obd_query_summary` · `dispatch_slot_master` · `transporter_master` · `vehicle_master` · `route_master`. **Counts/kg/litres are computed over ALL bills on the trip**, not board rows. |
| **Trip detail** | `GET /api/floor/trips/[id]` → `getTripDetail` `:881-953` | the rail's tables for one trip + `trip_drops` (snapshots) + `trip_activity` + `users` |
| Counts / bands / badges / pills | client (`status-pill.tsx`, `floor-table.tsx`, `lib/floor/scope.ts:144-155`) | none of their own — derived from rows. Server `total`/`windows[].count` are overwritten client-side; only the **windows list** is used |
| **Detail panel** | `GET /api/floor/order/[orderId]` | `orders` + dealer chain + `dispatch_slot_master` + `pick_assignments`/`users` + `order_status_logs` + `import_raw_summary` + `import_raw_line_items` + `sku_master_v2` + `tint_assignments` + `order_splits` + colour-work. Fetched once per open; refetched only after its own actions |
| Tint operators (Tinting tab) | `GET /api/floor/tint-operators` | `tint_assignments` + `users` (only while that tab is open) |
| Load plan v2 (Upcountry live) | `POST /api/floor/load-plan` | `load_plan_config`, `load_plan_area_rate`, `load_plan_area_pair` (raw SQL), `area_master`, `route_master`, `orders` by id, `import_obd_query_summary`, dealer chain. Re-POSTs when the pool id set changes |
| Pick gate | `GET /api/floor/pick-gate` | `app_settings` — **read once on mount, never re-read** (a flip from another tab is invisible until reload) |
| Lookup / options / ship-to / CI reasons | on demand | `orders`, `trip_drops`, `trips` · masters · `delivery_point_master` · `ci_reason_master` |

**Time-driven values (change with the clock, not a write)** — server: checked-today arm (arm 1), trips-carried rule (arm 4 + rail), board `zone`/`ageDays`/`releasableToday`, Cancelled = today only, hide rule `daysOld` cutoff, load-plan v2 age; client: elapsed pills (`trip-desk.tsx:385` `nowMs`), header clock (`floor-page.tsx:1999-2003`), hold age bands, History clamp. ✅ **Nothing ticks on its own today** — the clock and elapsed pills only advance because a poll re-renders the page (`floor-page.tsx` has no clock interval; `trip-desk.tsx:385` reads `Date.now()` at render). **There is no day-rollover handling on Floor**; it rolls over by accident via the 30 s full reload.

**What today's marker sees ✅** — `COUNT` + `MAX(orders.updatedAt)` over the board predicate + `MAX(pick_delete_decisions.updatedAt)` (`app/api/floor/marker/route.ts:41-55`). It **misses**: every trip-only write (create, vehicle PATCH, show, send-to-billing, billing copy), `trip_drops`, `pick_assignments`-only / `tint_assignments`-only changes, `import_obd_query_summary`, master-data renames, CI status changes, hide-rule and gate flips, and any raw-SQL `orders` write (Prisma stamps `updatedAt` client-side; there is no trigger on `orders`).

---

## B. EVERY writer

Full rows (file:line per write) are in the two sweep reports summarised here; every writer below was traced to a real caller, and "NO CALLER" means both rg and Grep found no fetch of the route in ts/tsx/ps1. **"Bumps"** = the same request also does a Prisma write of `orders` (which stamps `@updatedAt`, `prisma/schema.prisma:1078` ✅).

### B.1 `orders` — 57 Prisma write sites in 43 files (+ 1 SQL file, 1 SQL runbook, 1 script)

| Area | Writers (file:line) | Triggered by | Rows |
|---|---|---|---|
| **Import — xlsx** | `app/api/import/obd/route.ts:1479` createMany (+`import_obd_query_summary` :1616, logs :1638) | Import modal / `/import` Confirm (`import_obd` canImport) | bulk (tens) |
| **Import — auto-json** | `route.ts:3940` createMany (+raw summary :3644, lines :3696, summary :4075, logs :4097) | PowerShell `Auto-Import-v3/v2.ps1` → `?action=auto-json` (HMAC) | bulk, new OBDs |
| **Import — patch-headers** | `route.ts:4492` (only changed OBDs; **no log row**) | PS `?action=patch-headers` | many/run |
| **Import — manual SAP / paste** | `lib/import-upsert.ts:165` create; `lib/import-upsert/header.ts:158` patch (+ lines `lib/import-upsert/lines.ts:187,208,215`, audit logs `audit.ts:40`) | Import modal `manual-sap-confirm`, `sap-paste-confirm` | 1 per OBD |
| **Import — enrichment** `applyMailOrderEnrichment` | `route.ts:369` updateMany by SO, `:379` ship-to fill, `:411` CI safety hold, `:494` slot, `:517` heldAt, `:554` auto-advance (+ `order_splits` :539) | every create path | per SO |
| **Import — auto-release** `applyNoMailOrderFallback` | `route.ts:722` (+log :734) | every create path | per non-tint bill |
| **Import — SO-tag holds** `applySoTagHolds` | `lib/billing/telephonic-apply.ts:236` hold, `:422` CI cancel (+`pick_assignments` delete :429, `so_tag_matches` :348, `ci_returns` via `lib/ci/bill-only.ts:179`) | import create paths; late telephonic add; mo-ci-tag | per matched bill |
| **Floor actions** | `app/api/floor/actions/route.ts:318` (mark-urgent/change-slot/hold/unhold/cancel/restore/hand/unhand; cancel also `pick_assignments.deleteMany` :330) | Floor row ⚡, bulk Hold, Restore, detail panel, off-floor dialog (`floor` canEdit) | batch |
| **Floor release** | `lib/floor/release.ts:150` | Hold-tab Release, panel Release | per bill |
| **Floor CI** | `app/api/floor/ci/route.ts:277` ci_returns, `:322` orders cancel | off-floor dialog "Raise CI" | 1 |
| **Floor ship-to** | `app/api/floor/ship-to/route.ts:97` | panel ship-to | 1 |
| **Trips → orders** | `app/api/floor/trips/[id]/bills/route.ts:155` (remove), `:292` (add) ✅; `cancel/route.ts:226` ✅ | Floor add/remove/undo/cancel trip; trip form; Make trip | per bill, **no log row** |
| Trips dispatch | `lib/floor/dispatch.ts:176` | **NO CALLER** (slice 7) | — |
| **Picking** | `assign/route.ts:135`, `unassign:58`, `done:128`, `approve:73`, `release:196`, `cancel:198` (each with `pick_assignments` + log) | supervisor board (`picking` canEdit), picker My Picks (`picking` canView), Floor panel Reassign/Unassign | per bill |
| **Billing** | `app/api/billing/mail-order/actions/route.ts:402` (hold/urgent/slot/shipTo/hand); `billing/picking/mark-done/route.ts:106` updateMany `invoicedAt` ✅ and `undo:85` (**no log rows**); `lib/billing/pick-delete.ts:584` delete, `:693` undo | billing bottom bar, ship-to pencil, Picking tab, Pick-delete popup/History | per SO / batch |
| **Tint manager** | `assign:184`, `base-bypass:222` (+undo :163), `cancel-assignment:60` (**$transaction**), `splits/cancel:81` (**tx**), `reorder:112-113`, `manual-entry:231` (+revert), `orders/[id]/remove:102` | `tint-manager-content.tsx` (`tint_manager` canEdit) | 1–2 |
| **Tint operator** | `start:102`, `done:214`, `skip:196`, `split/done:145,205` (**tx**) | `tint-operator-content.tsx` | 1 |
| **Admin** | hide `admin/hide/orders/[id]/hide:58`, unhide `:44`; removed-orders restore `:74`; **customer save backfills `orders.customerId` by updateMany** `admin/customers/route.ts:215`, `[id]/route.ts:238` (no log) | superuser; `customers` canEdit | 1 / bulk |
| NO CALLER | `tint/manager/orders/[id]/status` PATCH, `admin/fix-slots`, `floor/trips/[id]/dispatch` | — | — |
| **Outside Next.js** | `sql/2026-09-15-slice8-show-per-trip.sql:100` (51 rows, **no updatedAt**) · `docs/sql-runbook/force-remove-stuck-obd.sql:126,138,166` (sets updatedAt by hand) · `scripts/backfill-nts-trips-2026-09-11.ts:399` (Prisma) · md-only sweep SQL (`code-discovery-2026-09-10-noslot-backlog.md:411`, `…-09-11-pending-support.md:382`, deliberately leave updatedAt) · the undocumented 2026-09-11 "2,624 bills → dispatched" cutover (no SQL in repo) | SQL Editor / tsx | bulk |

### B.2 Child and sibling tables Floor reads

| Table | Writers | Paired with an `orders` write? |
|---|---|---|
| `pick_assignments` | 10 sites (assign/unassign/done/approve/cancel, floor cancel, floor CI, pick-delete, telephonic CI) | **Always** (rollback deletes follow only a failed orders write) |
| `tint_assignments` | 12 sites | **No** for `pause:237` ✅, `resume:126`, `tinter-issue:250`, `tinter-issue-b:237`; SQL runbook |
| `order_splits` (+`split_status_logs`) | 11 sites (4 in `$transaction`) | **No** for `splits/reassign:73`, `reorder:156-157` (split swap), `split/start:98`, TI submits |
| `order_status_logs` | 39 sites | Yes except operator pause/resume (paired with `tint_assignments`) |
| `import_obd_query_summary` | 5 sites | **No** for `rebuildQuerySummaryForOrder` (`route.ts:849`) on a lines-only patch |
| `import_raw_summary` / `import_raw_line_items` | 4 / 8 sites | Lines patch without header change: **no** |
| `ci_returns` / `ci_return_lines` | 10 / 7+3 nested | **No** for all of `/api/ci/*` (draft/lines/submit ✅/details/close) and all of auto-CI `lib/ci/auto.ts`; yes for floor CI and bill-only |
| `so_tags` / `so_tag_matches` | 7 / 2 | **No** for telephonic remove, record-only claims, mo-ci-tag unmark |
| `pick_delete_decisions` | 4 | **No** for All OK (`pick-delete.ts:467`) and undo of All OK (`:670`) |
| `trips` | runtime 8 (create `trips/route.ts:276-301`; PATCH `[id]/route.ts:324`; show `lib/trips/show.ts:86`; send-to-billing `lib/trips/billing.ts:85`; **billing copy `lib/billing/print.ts:426`** from the Billing Print tab; cancel `cancel/route.ts:256`; confirm/dispatch NO CALLER) + script + 4 SQL | **No** except cancel (detaches bills) |
| `trip_drops` | `bills/route.ts:260` insert, `:171` delete; script | via the bill's `tripDropId` write |
| `trip_activity` | one physical insert `lib/trips/activity.ts:158` behind 11 call sites; 2 SQL | no |
| `app_settings` | `app/api/floor/pick-gate/route.ts:91` | no |
| `obd_visibility_rules` / `app_tag_settings` | admin hide rules (3) / tag settings (5), superuser | **no** — hide rules change the board at READ time |
| Masters: `delivery_point_master` (4 + runbook SQL), `area_master` (3, one in `$transaction`), `route_master` (3), `sub_area_master` (3), `vehicle_master` (3), `transporter_master` (3), `users` (5 app + script + seed) | admin routes | customer save also backfills `orders.customerId` (bumps) |
| SQL-only config: `load_plan_config`, `load_plan_area_rate`, `load_plan_area_pair`, `route_clubs`, `route_club_members`; `user_roles`; seed-only `delivery_type_master`; **no writer at all** `dispatch_slot_master`, `sku_master_v2` | SQL Editor | no |
| `load_plan_snapshot` | cron 21:00 IST + Replan press (`floor` canView) | not displayed on /floor |

### B.3 Writers that bypass Next.js
1. **SQL Editor** (Smart Flow): every SQL file above — including `UPDATE orders` without `updatedAt` (slice8), trips renames/settles, config tables, grants. Invisible to today's marker.
2. **One-off scripts** via Prisma (`scripts/backfill-nts-trips-2026-09-11.ts`, `fix-admin-password.ts`, `prisma/seed.ts`).
3. **NTS mirror** — `mirror_trip_report_today` via PostgREST RPC from the off-repo puller. ✅ **Writes only `trip_report` and `mirror_heartbeat`; touches no Floor table** (plan-of-record body `docs/prompts/archive/2026-09/code-resume-2026-09-08-trip-mirror-rewrite.md:123-356`; live body unverifiable without a DB read → §K Q7). App code only reads `trip_report`.
4. **PowerShell** — none write directly: Auto-Import and the mail parser POST to Orbit routes (through Next.js); `0-FrtIngestion`, `3-PendingFetch`, `4-LogisticsEntry` never touch Orbit.

### B.4 Tables that need triggers (conclusion)

| Trigger on | Emits entity | Why |
|---|---|---|
| `orders` | `order:<id>`, plus `trip:<tripId>` for OLD/NEW `tripDropId` | the row set and every pill; trip counts depend on member bills |
| `pick_assignments` | `order:<order_id>` | picker/checker/times + checked-today arm (always paired today, but cheap insurance) |
| `tint_assignments`, `order_splits` | `order:<orderId>` | pause/resume/TI/split writes do not touch `orders` |
| `import_obd_query_summary` | `order:<orderId>` | kg/L/articles; lines-only patches don't touch `orders` |
| `ci_returns` | `order:<orderId>` | Cancelled tab; all `/api/ci/*` + auto-CI skip `orders` |
| `so_tag_matches` | `order:<orderId>` | Cancelled tab source label |
| `pick_delete_decisions` | `order:<id>` for each of `orderIds` (and `keptOrderIds`) | duplicate-SO flag moves with no order write |
| `trips` | `trip:<id>` | rail/header, `isAwaitingShow`, board arm 4 |
| `trip_drops` | `trip:<tripId>` | stops |
| `trip_activity` | `trip:<tripId>` | detail history |
| Config/master tables: `delivery_point_master`, `area_master`, `route_master`, `delivery_type_master`, `dispatch_slot_master`, `vehicle_master`, `transporter_master`, `users`, `route_clubs`, `route_club_members`, `load_plan_config`, `app_settings`, `obd_visibility_rules`, `app_tag_settings` | `config:<tableName>` (one row per statement, no ids) | rare; consumer does one full reload |
| **Not triggered:** `order_status_logs` (every Floor-relevant log is paired with an `orders`/`tint_assignments` write; highest-volume insert-only table), `split_status_logs`, `import_raw_summary`/`import_raw_line_items` (Floor shows them only in the detail panel; add later for Picking lines), `trip_report`, `mirror_heartbeat`, `load_plan_snapshot`, `admin_audit_log` | | |

### B.5 Doc / code disagreements found (code wins)
1. **FLOOR_TRIPS §11 "OFF → ON writes first (the no-cliff rule)… `showTripsHoldingWaitingBills`…"** and **§9's `shown` row "(desk control turned on) `show.ts:159`"** — since 2026-09-21 (`55c0cd6e`) the gate POST writes **only the switch** (`app/api/floor/pick-gate/route.ts:20-30`, `lib/trips/show.ts:12-17`). Stale comment also at `lib/trips/activity.ts:70-71`.
2. **`app/api/floor/trips/[id]/bills/route.ts:206-208`** says it is the only writer of `orders.tripDropId`; `cancel/route.ts:226` also writes it ✅.
3. **FLOOR §5** "the 15 s marker pauses while the panel is open or in History" — it keeps probing; only `onChange` is deferred (`use-picking-marker.ts:300-302`) (also in the disk-io report §H).
4. **FLOOR §2 / §3** imply the desk reflects trip changes live; the marker cannot see trip-only writes (FLOOR_TRIPS §17 item 10 records it; FLOOR §5 does not).
5. **The pick gate is read once on mount** (`floor-page.tsx:649-664`) — no canon file says so; FLOOR_TRIPS §11 implies the header reflects the switch.
6. **CORE §3 "Never `prisma.$transaction`"** — still used on these tables at `tint/manager/cancel-assignment:28`, `splits/cancel:43`, `splits/create:150` (no caller), `splits/reassign:50`, `tint/operator/split/done:56` (already listed in CORE §13; restated because a trigger fires inside them).

---

## C. The change book

### C.1 Table (proposed — `live_changes`; camelCase columns per CORE §3)

| Column | Type | Notes |
|---|---|---|
| `seq` | `bigint GENERATED ALWAYS AS IDENTITY` PK | monotonic, **not** commit-ordered (see C.4) |
| `txId` | `xid8 NOT NULL DEFAULT pg_current_xact_id()` | the writing transaction — the commit-safe cursor (PG ≥ 13; §K Q1) |
| `entity` | `text NOT NULL` | `'order' \| 'trip' \| 'config'` (CHECK) |
| `entityId` | `text NOT NULL` | numeric id as text, or the table name for `config` |
| `op` | `char(1)` | `I`/`U`/`D` |
| `sourceTable` | `text NOT NULL` | which table's trigger wrote it (diagnostics) |
| `createdAt` | `timestamptz NOT NULL DEFAULT now()` | transaction start time — for pruning and lag display only, never for ordering |

Indexes: PK (`seq`); `live_changes_tx_seq_idx (txId, seq)` — the catch-up read; nothing else. Companion one-row table **`live_feed_meta`** (`id text PK`, `prunedThroughTxId xid8`, `prunedAt timestamptz`) — the "too old" watermark.
No RLS needed for the app (Prisma connects as the owner), but **RLS must be enabled with no policies** if the anon key is ever published (§E).
Prisma: a read-only model hand-mirrored into `schema.prisma` (`xid8` is `Unsupported("xid8")` in Prisma 5 — the catch-up read will be `$queryRaw`); version chain entry **v27.44** recorded on the day (CORE §7 — the chain has been missed three times; §M step 1 makes it a checklist item).

**Rows/day (EST).** ~250–400 bills/day; each bill sees ~8–15 row-changes across its life (create, enrichment, release, assign, done, check, invoice, trip add, patch-headers, summary rebuild) → **~4–8k `order` rows/day**; trips ~300–600; config ~0–20. Call it **≤ 10k rows/day, ≤ 30k retained at 3 days**: a few MB with its index. §K Q9 replaces this with the real `n_tup_*` numbers.

**Retention/prune.** Keep 3 days. Vercel Hobby cron = at most daily (CORE §4) — **daily is enough** for a 3-day window: `DELETE FROM live_changes WHERE "createdAt" < now() - interval '3 days'` then set `live_feed_meta.prunedThroughTxId` to the max `txId` deleted. One new route `/api/cron/live-prune` (bearer `CRON_SECRET`), one `vercel.json` entry. If the cron ever misses a day the table just holds 4 days — harmless.

### C.2 Triggers — statement-level with transition tables

- **AFTER … FOR EACH STATEMENT** with `REFERENCING NEW TABLE AS n` / `OLD TABLE AS o`: a Prisma `createMany` of 80 orders is ONE statement → ONE trigger call → one `INSERT … SELECT` writing 80 narrow rows (per-entity rows make catch-up dedupe and filtering trivial; 80 rows × ~60 bytes is nothing). A single-bill `update` → one call, one row.
- **Three triggers per table** (INSERT / UPDATE / DELETE), because transition-table triggers with multiple events have version-specific restrictions — **UNVERIFIED which apply on Supabase's PG version; three single-event triggers are safe either way.**
- **No-op skip on UPDATE:** `JOIN o USING (id) WHERE (to_jsonb(n) - 'updatedAt') IS DISTINCT FROM (to_jsonb(o) - 'updatedAt')`. Needed because Prisma stamps `updatedAt` on every update, so `OLD IS DISTINCT FROM NEW` is always true. (`patch-headers` already skips unchanged rows at `route.ts:4484-4487`; the enrichment `updateMany`s do not.)
- **Parent mapping:** `pick_assignments.order_id` (⚠ snake_case columns on this table), `tint_assignments/order_splits/import_obd_query_summary/ci_returns/so_tag_matches."orderId"` → `order`; `trip_drops/trip_activity."tripId"` → `trip`; `pick_delete_decisions` → `unnest("orderIds" || coalesce("keptOrderIds", '{}'))` → `order`; `orders` also emits `trip` for `tripDropId` OLD∪NEW via one join to `trip_drops`.
- **Config tables:** one `config:<table>` row per statement, no transition tables needed.
- 🔴 **A bell failure must never fail the business write.** The function body is wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING 'live_changes: %', SQLERRM; END;` and always `RETURN NULL`. PL/pgSQL resolves table names at run time, so even a missing `live_changes` is caught. Cost: one subtransaction per business *statement* (not per row) — acceptable at these volumes. What it cannot protect against: disk full / out-of-XID (the business write fails anyway).
- **Kill switch (DB side, no deploy):** `ALTER TABLE orders DISABLE TRIGGER live_changes_orders_upd;` (etc.) in the SQL Editor — instant, reversible. Note that `SET session_replication_role = replica` in any session also silently skips these triggers (§H).
- **DB cost per change (EST):** one extra narrow INSERT + two index entries + WAL ≈ **~1 KB per business statement** → ≤ 10 MB/day. Today one Floor tab alone runs ~18,000 statements/hour (disk-io report §F). The trigger cost is noise.

### C.3 Interaction with CORE §3
- Triggers run inside the writer's own statement/transaction — **no `$transaction` is introduced**; the five existing `$transaction` sites simply commit their log rows atomically with their writes.
- Schema change goes through the **SQL Editor + hand-edited `schema.prisma` + `npx prisma generate`**; never `db push`.
- The "**never add a second `orders.update`**" rule is untouched: triggers write only `live_changes`. The old markers keep working unchanged in parallel (that is the rollback).
- `mo_orders` keeps its own `BEFORE UPDATE` trigger; no interaction (not in scope for Floor).

### C.4 Transaction ordering — the uncommitted-seq skip, and the fix

**The problem is real:** `seq` is drawn at INSERT time. Transaction A draws 101, B draws 102, B commits first; a reader sees 102, stores cursor 102, then A commits 101 — **skipped forever**.

**Fix: a commit-safe horizon, using the transaction id.** The catch-up read is:
```sql
SELECT seq, "txId", entity, "entityId"
FROM live_changes
WHERE ("txId", seq) > ($cursorTx, $cursorSeq)
  AND "txId" < pg_snapshot_xmin(pg_current_snapshot())
ORDER BY "txId", seq
LIMIT $limit;
```
`pg_snapshot_xmin(pg_current_snapshot())` is the oldest transaction still running; **every transaction with a smaller id has finished**, so no new row with `txId` below it can ever appear. The cursor is `(txId, seq)`; when a page comes back short, the cursor advances to `(xmin, 0)`. Cost: one index range scan on `(txId, seq)`. Nothing is skipped, and nothing is waited for longer than the oldest open transaction.
**Why not the simpler "re-read an overlap window"?** It is only as safe as the assumption that no transaction lives longer than the window. Here statement_timeout is 30 s for `postgres` (CORE §4), but the SQL Editor, `service_role`/PostgREST and any future `BEGIN` block are not bound by it. The xid horizon needs no assumption. **Its one weakness:** a long-open transaction anywhere (an idle-in-transaction SQL Editor tab) holds the horizon back → the feed **pauses** (never loses). Mitigation in §H.

---

## D. The announcement (Supabase Realtime)

**Installed ✅ VERIFIED-SRC:** `@supabase/supabase-js` **2.105.3** (`package.json:24`), transitive `@supabase/realtime-js` 2.105.3 on `@supabase/phoenix` 0.4.1. **No browser Supabase client exists**; `lib/supabase.ts` is a server-only service-role client used for Storage. **No `NEXT_PUBLIC_SUPABASE_*` env names exist** — the only `NEXT_PUBLIC_*` is `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. No CSP (`next.config.mjs` headers) — a `wss://*.supabase.co` socket would not be blocked. No committed SQL mentions realtime, publications, `pg_notify` or triggers.

**Client facts ✅ VERIFIED-SRC** (`node_modules/@supabase/…`): heartbeat 25 s (`realtime-js/src/RealtimeClient.ts:45-46`); socket reconnect 1/2/5/10 s then 10 s (`:51-52`); join timeout 10 s; channel states `SUBSCRIBED/TIMED_OUT/CLOSED/CHANNEL_ERROR` (`RealtimeChannel.ts:144-149`), `SUBSCRIBED` fires again after every reconnect; **no ack/sequence, nothing re-delivered on reconnect**; `broadcast.replay` exists but **throws on a public channel** (`RealtimeChannel.ts:265-270` ✅); 🔴 **a hidden page does not reconnect** — `phoenix/assets/js/phoenix/socket.js:164-167` ✅ ("Not reconnecting as page is hidden!"), reconnects on `visibilitychange` → visible (`:108-117` ✅); any anon-key holder can `send()` on a public channel (`RealtimeChannel.ts:840-910`); REST broadcast `POST /realtime/v1/api/broadcast` (202) via `httpSend` (`:746-796`) — usable from a Vercel route with no socket; `private: true` needs an `access_token` (`setAuth` / `accessToken` option) and supabase-js falls back to the API key when there is no Supabase Auth session (`SupabaseClient.ts:536-544`) — Orbit has none.

**UNVERIFIED (memory — check Supabase docs/dashboard):** Pro includes ~500 concurrent Realtime connections and ~5M messages/month (then ~$2.50/M); ~500 msg/s tenant limit; broadcast payload ~256 KB–3 MB; `realtime.send(payload, event, topic, private default true)` and `realtime.broadcast_changes(...)` insert into the daily-partitioned `realtime.messages` (~3-day retention) and are delivered by the Realtime server; Realtime Authorization = RLS on `realtime.messages`; "allow public access" can be switched off; Postgres Changes needs the `supabase_realtime` publication + a logical replication slot, processes changes single-threaded and authorises each change per subscriber on RLS tables.

**Options compared**

| | DB cost | Latency | Reliability | Coverage | Verdict |
|---|---|---|---|---|---|
| **1. Broadcast from Database** (`realtime.send` in the trigger) | one `realtime.messages` insert per business statement (+ whatever the server uses to read it — UNVERIFIED whether that is a replication slot) | ~1 s | good; server-side replay for private channels | every writer, incl. SQL Editor | good coverage, but `private` defaults true → needs Orbit-minted JWTs, and adds a write inside the business transaction |
| **2. Postgres Changes on `live_changes`** | a **logical replication slot**: WAL is decoded continuously and **retained on disk if Realtime lags** — on a disk-IO-throttled database this is the riskiest option | ~1 s | per-subscriber authorisation work | every writer | **rejected** |
| **3. App-side HTTP broadcast** (a Vercel route calls `/realtime/v1/api/broadcast` with the service key after its write) | **zero DB cost** | ~1 s | fire-and-forget; Vercel freezes after the response, so it must be awaited with a short timeout | every Prisma writer if done centrally (a `prisma.$extends` query hook on watched models, throttled to ≤ 1 ring/s per lambda, never throws); **misses raw SQL / SQL Editor** — the safety-net poll catches those | **recommended *if* Realtime is added** |
| **4. No push at all — catch-up poll only** | 1 indexed read per tab per poll (after the auth fix, §F) | = poll interval (10–15 s) | nothing extra to fail | everything | **recommended for Phase 1** |

**Recommendation: build Phase 1 with option 4, and add option 3 later only if 10–15 s is too slow.** The key arithmetic (§I): the doorbell does **not** reduce database work — it *adds* fetches, because every ring triggers a catch-up plus a row fetch sooner, where a 15 s poll naturally coalesces a burst of changes into one fetch. Realtime buys latency (~1 s vs ~7 s average), not load reduction. It also costs a new security surface (§E) and a new vendor dependency. Everything in the target architecture that *does* reduce load — the change book, the catch-up API, fetch-only-changed-rows — works without it.

---

## E. Security with NextAuth

Orbit does not use Supabase Auth; the browser holds a NextAuth cookie and no Supabase credential.

🔴 **The real risk is not the channel — it is the key.** Any browser Realtime client needs the project's **anon key in the page bundle** (`NEXT_PUBLIC_…`). The anon key is also a PostgREST credential: **any `public` table without RLS is readable and writable through `https://<project>.supabase.co/rest/v1/<table>` by anyone who copies it from the page.** Canon records at least `trip_report` and `mirror_heartbeat` with no RLS; the state of the other ~100 tables is unknown (§K Q5). Publishing the key before RLS is enabled everywhere would hand the database to the internet. Enabling RLS with **no policies** is safe for Orbit itself: Prisma connects as the table owner and `service_role` (the NTS puller, Storage) bypasses RLS — **UNVERIFIED that no current path uses the anon role; §K Q5 checks grants and RLS.**

| Option | What an outsider with the anon key can do | Harm from a forged message | Cost |
|---|---|---|---|
| **(a) Public channel, no ids** (payload = `{topic:"orders"}` only), all data through Orbit's permission-checked routes | listen: learns "something changed now" (activity rate); send: forge pings | every open tab does one catch-up call (rate-limited to 1 per 3 s per tab) → bounded, harmless; a forged ping can never inject data because the client never trusts the payload | RLS lockdown prerequisite; zero new server code for auth |
| **(b) Private channel + short-lived JWT minted by an Orbit route** from the NextAuth session (signed with the project JWT secret / signing key; RLS policy on `realtime.messages`) | nothing without a valid Orbit session | none from outsiders | needs the JWT secret in Vercel env (new secret), a mint route, token refresh, RLS policies — still needs the anon key + RLS lockdown for the socket's `apikey` |
| (c) Server-sent events from Orbit itself | nothing new | none | impossible on Vercel serverless (no long-lived connections) |
| (d) No push (Phase 1) | nothing new | none | none |

**Recommendation:** Phase 1 = **(d)**. If Realtime is added: **(a) with ids removed from the payload**, and only after the RLS lockdown is verified. The ids would add nothing the client needs (the catch-up call returns them) and remove the only information leak. (b) is justified only if the owner considers the activity-rate signal sensitive.

---

## F. Catch-up API + shared client module

### F.1 `GET /api/live/changes?after=<cursor>&topics=order,trip,config[&limit=500]`
- **Response:** `{ enabled: boolean, cursor: "<txId>.<seq>", changes: { order: number[], trip: number[], config: string[] }, more: boolean, reset: boolean, lagSeconds: number, serverNow: iso }`. Ids are deduped server-side; order is irrelevant (every consumer re-reads current state).
- `after` absent → returns only the current horizon cursor (`reset:false`, no changes) — **the client takes this BEFORE its full load**, so a change landing during the load is re-delivered (a duplicate re-read is harmless; a skip is not).
- `reset:true` when `after.txId < live_feed_meta.prunedThroughTxId` (the log no longer covers the gap) → the client does one full load.
- `more:true` when the page was full → the client calls again immediately; a consumer may decide "> N ids → full load is cheaper" (Floor: N = 300).
- `enabled` = the app kill switch (`app_settings` key `live.feed`, absent row = OFF, cached 30 s per lambda like `getAccessSource`). OFF → every client keeps (or returns to) its old marker/poll.
- **Permission:** a session, plus canView on at least one page that consumes the topic (`floor`, `picking`, `billing_*`, `tint_manager`, `mail_orders`, `mrn`, `ci`). It returns ids only; row data always comes from each screen's own permission-checked route.
- **Cost per call:** 1 range scan on `(txId, seq)` returning 0–few rows + (after the auth fix) ~0–1 auth queries. **Prerequisite:** the auth stale-window fix from the disk-io report (§C there) — without it this "near-free" call carries 5–7 hidden queries.
- `export const dynamic = "force-dynamic"`, `Cache-Control: no-store`.

### F.2 Client layout
```
lib/live/
  cursor.ts        pure: parse/compare "<txId>.<seq>" cursors
  feed-client.ts   ONE LiveFeed per browser tab (module singleton): cursor, poll loop,
                   backoff, visibility, topic subscribers, (later) Realtime doorbell
  use-live-feed.ts React hook: subscribe(topics, onChanges, { paused }) → { status, resync }
  types.ts
```
- **One per tab:** a module-level singleton shared by every consumer on the page (Floor's board, trip rail, detail panel). Optional later: `BroadcastChannel` leader election so several tabs of the same browser share one poll.
- **Hook API (replaces `usePickingMarker` for converted screens):** `useLiveFeed({ topics: ["order","trip","config"], onChanges: ({order, trip, config}) => …, paused, onReset })` → `{ status: "live"|"polling"|"offline"|"disabled", lastOkAt, resync }`. `status` drives the Floor connection chip (today `onProbe`).
- **Dedupe + batching:** changes accumulate in per-topic `Set`s; subscribers are called at most once per flush; a flush happens after a poll or (Phase 2) 1 s after the first ring of a burst, with a **minimum 3 s between flushes**.
- **Paused:** changes keep accumulating while `paused`; one flush on unpause (same contract as today's marker).
- **Backoff:** failed catch-up → 5 s, 10 s, 20 s, 40 s, cap 60 s, ± 30 % jitter; `status:"offline"` after two failures.
- **Hidden tab:** stop the poll entirely (no fetches); on visible → one catch-up after 0–2 s jitter; if hidden > 3 days the server answers `reset`. With Realtime: stay subscribed (a hidden tab costs the DB nothing), but Phoenix will not reconnect while hidden ✅ — so the visible-again catch-up is mandatory either way.
- **Safety net:** the poll *is* the mechanism in Phase 1 (15 s); in Phase 2 it drops to 60 s and also runs on every `SUBSCRIBED` (initial and after each reconnect).
- **Disabled:** `enabled:false` → the hook reports `status:"disabled"` and the screen mounts its old marker/poll path (see §M kill switch).

---

## G. Floor as the first consumer

### G.1 `POST /api/floor/rows` `{ ids: number[] (≤ 300) }` — "fetch these rows"
- **Reuse, not copy.** Refactor `getFloorBoard`'s inline row loop (`lib/floor/queries.ts:917-1124`) into `toFloorBoardRow(order, ctx)` and give the three builders an `onlyIds` option that ANDs `{ id: { in: ids } }` into the SAME where they already build (`floorBoardWhere` + hide for board; hold predicate + hide; for Cancelled, `orderId IN` on BOTH the CI read and the cancel-log read, plus the orders read). A full load and a patch then run one code path — **a patched row cannot differ from a full load.**
- **Response:** `{ anchorIso, rows: [{ orderId, place: "board"|"hold"|"cancelled"|"gone", row }], soFlags: { [soNumber]: boolean }, tripIds: number[] }`.
  - `place` answers "which tab now / left Floor" (absent from all three = `gone`).
  - `soFlags`: the duplicate-SO answer for every SO on the returned rows (`getDuplicateSoNumbers` already queries twins globally) — the client updates `hasDuplicateSo` on **every** row sharing that SO, because a twin's change alters rows that did not change themselves.
  - `tripIds`: trips of the rows (old and new `tripDropId` are already in the feed as `trip` changes, this is belt-and-braces).
  - Skips the dead `waitingSkus`/`oilSkus` reads and the whole-set `windows[].count`/`total` (client overwrites them anyway).
  - `anchorIso` must equal the client's anchor day; if it differs (midnight passed) the client does a full load instead of merging.
- **Cost (EST):** the same ~20 statements as the board's include tree, but each touches only the requested rows via the PK — instead of evaluating the 4-arm predicate over the whole table and the ever-growing pick_checked pool.

### G.2 Trips — `GET /api/floor/trips?date=&ids=`
Same `getTripsForDate` with `AND id IN ids`, plus `onDesk` per id (evaluate `tripsOnDeskWhere` restricted to those ids) → the client replaces/inserts/removes rail cards. If the open trip is among them, the existing `tripDetail` effect refetches it (it already keys on `trips` identity — the patch must replace the array to trigger it, and must **not** replace it when no trip changed, or the detail refetches for nothing).

### G.3 Counts, bands, badges, pickers, config
- **Counts / bands / badges / route cards / load plan v1:** already derived client-side from rows → free after a patch.
- **Pickers (`onHand`):** only the detail panel's Assign dropdown reads it → fetch it **when the panel opens** (small query), drop it from the patch path.
- **`config:*` changes** (masters, route clubs, load plan config, hide rules, tag settings, app_settings incl. the pick gate): one debounced full load (5 s). Rare. This also fixes today's "gate flip invisible until reload".
- **Load plan v2** keeps its own POST on pool-id-set change; a patch that changes the set triggers it exactly as a reload does today.

### G.4 Never move the ground under a hand
- **Apply immediately** (rows keyed by `orderId`; `FLOOR_SPINE` is a total order ending in unique `obdNumber`, so a patched row only moves if its own sort inputs changed — urgent, slot, ship-to): idle desk, and **while ticks are up** — with today's rule: a ticked bill that left the set is unticked with the existing toast; ticks never move otherwise. Keep `data.floor.rows` in spine order (re-sort after merge) because Prev/Next, `selectionRouteRank` and `tripHitsFor` read array order.
- **Queue, apply once on release** (`paused`): detail panel open · History · trip form / vehicle editor / off-floor dialog open · a targeted add in progress (`addingToTripId`) · Hold-tab or Cancelled-tab local ticks or their ··· menus · the slot popover open. (Today several of these are not protected at all — see the client report: vehicle editor vanishes if its trip leaves the list; Hold/Cancelled ticks are never pruned.)
- **Detail panel:** if the open order is in a queued change, show a thin "This bill changed — Reload" bar in the panel; never auto-swap its body (`CORE §3`'s router-refresh lesson: use `fetch`+`setState`, never `router.refresh()`).
- Typing (search draft lives in `SearchBox`) and scroll: untouched by patches; row insertions above the viewport can still shift content — acceptable (same as today), revisit only if the floor complains.

### G.5 Day rollover and clock-driven values
| Value | Handling |
|---|---|
| Checked-today arm, Cancelled "today", trips-carried rule, `zone`/`ageDays`/`releasableToday`, hide `daysOld` | **one scheduled full load at the next IST midnight + 0–120 s jitter**, computed from `serverNow` (not the client clock); also on becoming visible when the IST day changed |
| Elapsed pills, header clock, hold age bands | a **30 s render tick** (`setNow`) — no fetch |
| A board row whose `anchorIso` ≠ client anchor | full load instead of merge |

### G.6 Floor timers — removed and kept
| Timer | After |
|---|---|
| 15 s marker (`usePickingMarker` → `/api/floor/marker`) | **removed** when the feed is enabled (kept, mounted, when disabled — the kill switch) |
| 30 s blind full reload (`useFloorRailPoll`) | **removed** (same switch) |
| `reconcileSelection`'s full `/api/floor/board` fetch | **removed** — ids already known |
| Live-feed catch-up poll | **new**, 15 s (Phase 1) / 60 s safety net (Phase 2), paused when hidden |
| Render tick | **new**, 30 s, no network |
| IST-midnight reload | **new**, once a day |
| Esc listener, undo timer, debounces, matchMedia | unchanged |

---

## H. Loopholes (adversarial)

| Loophole | Defence |
|---|---|
| Missed message (Realtime) | the ring carries nothing; the catch-up by cursor is authoritative; poll runs regardless |
| Reconnect storm after an outage | catch-up jitter 0–5 s after `SUBSCRIBED`/visible; backoff with ± 30 % jitter; the server call is one index read |
| Duplicates | idempotent: every change means "re-read id X"; Sets dedupe |
| Out-of-order delivery | irrelevant: patches re-read current state; ordering only matters for the cursor, which is server-side |
| **Uncommitted-seq skip** | xid horizon (§C.4) |
| **Horizon stall** (an idle-in-transaction session holds `xmin`) | feed pauses, never skips; `lagSeconds` in the response; client shows "delayed" and, if lag > 120 s, falls back to a full load every 2 min until it recovers; §K Q10 checks `idle_in_transaction_session_timeout` |
| Log pruned while a laptop slept | `reset:true` → one full load |
| Realtime outage | poll (Phase 1 is poll-only anyway) |
| **Trigger failure blocking a business write** | `EXCEPTION WHEN OTHERS` in every trigger function; `RETURN NULL`; DISABLE TRIGGER kill switch; tested in §M step 2 by renaming `live_changes` on a test copy and confirming writes still succeed |
| Bulk import flood (80–300 OBDs) | statement-level trigger = one call; catch-up returns ids; Floor does a full load above 300 ids |
| Clock skew | no client clock used for ordering; midnight scheduled from `serverNow` |
| Admin SQL edits | captured by triggers (the marker never saw them) — **unless** the session sets `session_replication_role = replica` or disables triggers; a `config`-style "reload everything" row can be inserted by hand after a big manual fix (runbook line) |
| Soft deletes / hard deletes | orders are soft-deleted (`isRemoved`) → `U` change → rows endpoint returns `gone`; a hard delete emits `D` → `gone` |
| Permission change mid-session | every row/trip fetch re-checks; feed ids alone reveal nothing |
| Hide rule / tag change | `config` → full reload |
| Deploy skew (old tab, new API) | `/api/live/changes` is additive; old tabs keep polling the old marker until reloaded |
| Many tabs of one user | fine per tab; optional BroadcastChannel sharing later |
| Midnight reload storm | 0–120 s jitter; low traffic at midnight |
| Vercel Hobby invocation quota | today one Floor tab makes ~12 function calls/min (marker 4 + 4 feeds ×2); Phase 1 makes ~4/min + patches — fewer than today. **UNVERIFIED** Hobby monthly limits; §L item 9 |
| A new write path added later without a trigger table | only if it writes a NEW table Floor reads; the B.4 list goes into `CLAUDE_FLOOR.md` as a landmine: "a table Floor reads needs a live_changes trigger" |
| `pick_assignments` snake_case columns | trigger reads `order_id`, not `orderId` (Prisma `@map`) |
| `xid8` in Prisma | model the column as `Unsupported`; the read is `$queryRaw` — the only raw SQL in the path |

---

## I. Load before vs after (ESTIMATES)

Assumptions carried from the disk-io report §F (non-admin users, stale token → `O ≈ 6` queries/request today; Floor `load()` ≈ 115 statements; marker 9). **After** assumes the auth fix is in (auth + permission ≈ 1 query per request, cached), Floor on the feed at a 15 s poll, and a busy hour of ~400 order changes (≈ 1 per 9 s, so most polls carry a change).

**One visible Floor tab, per hour**
| | Arithmetic | Statements/h |
|---|---|---|
| **Before** | marker 240 × 9 = 2,160 · blind reload 120 × 115 = 13,800 · marker-driven reloads ~20 × 115 = 2,300 | **≈ 18,000** (each board statement evaluates the whole 4-arm predicate / full board) |
| **After — busy hour** | catch-up 240 × 2 = 480 · row patches ~200 × (20 + 1) = 4,200 · trip patches ~100 × (12 + 1) = 1,300 · config reloads ~0 | **≈ 6,000** — and each patch statement touches a handful of rows by primary key |
| **After — quiet hour** | catch-up 240 × 2 = 480 · a few patches | **≈ 600–1,000** |
| Hidden tab | before ~0 · after ~0 (+ one catch-up on return) | ~0 |

Statements fall ~3× at peak and ~20× off-peak; **rows read** (what actually costs disk IO) fall far more, because nothing evaluates the full board predicate on a timer any more.

**22-tab scenario** (10 Floor + 5 Picking + 4 Billing + 3 Mail Orders, all visible, busy hour)
| Screen | Before | After Floor-only conversion + auth fix | After all screens converted (EST) |
|---|---|---|---|
| Floor ×10 | 180,000 | **60,000** | 60,000 |
| Billing ×4 | 84,000 | ~63,000 (auth share removed; pick-delete marker still unbounded — fix separately) | ~12,000 |
| Picking ×5 | 30,000 | ~15,000 | ~8,000 |
| Mail Orders ×3 | 4,200 | ~1,500 | ~1,500 |
| **Total/h** | **≈ 300,000** | **≈ 140,000** | **≈ 80,000** |

Two honest notes: (1) ~10 Floor tabs each re-fetch the **same** changed rows — the dominant after-cost; a later step can share them (BroadcastChannel across tabs of one browser, or a 2 s per-lambda cache keyed by cursor). (2) Adding Realtime (Phase 2) would *raise* the busy-hour figure unless flushes are rate-limited (§F.2 3 s minimum) — it buys latency, not load.

---

## J. Recommended design (one page, plain English)

**What happens:** every write to a table a screen shows leaves a one-line note in a small "change book" table — written by the database itself, so it catches the app, the SAP import, mail ingest, scripts and hand-run SQL alike. Each open screen asks Orbit every 15 seconds "anything new since note N?" — one tiny indexed lookup. If yes, it fetches only those bills or trips through the same permission-checked code that builds the full screen, and slots them in place. Nothing re-downloads the whole board on a timer any more. At IST midnight each screen reloads once. A switch turns the whole thing off and puts the old polling back without a deploy.

```
 writers (routes, import, mail ingest, scripts, SQL editor)
        │  INSERT / UPDATE / DELETE on orders, trips, children, config
        ▼
 ┌──────────────────────────── Postgres ────────────────────────────┐
 │ business tables ──AFTER STATEMENT triggers (never fail a write)──▶ live_changes │
 │                                               (txId, seq, entity, entityId) │
 └───────────────────────────────────────────────────────────────────┘
        ▲ one indexed read, commit-safe horizon                 ▲ daily prune (cron)
        │                                                        │
 GET /api/live/changes?after=cursor  (session + page check, ids only)
        ▲ every 15 s while visible (+ on visible / reconnect)
        │
 lib/live feed-client (one per tab) ──▶ Floor: POST /api/floor/rows {ids}
                                          GET  /api/floor/trips?ids=
                                          config change → one full load
 (Phase 2, optional) route → HTTP broadcast "orders changed" ──▶ tab polls now
```

**Where I disagree with the target architecture, and why**
1. **Realtime is not needed to fix the outage — make it Phase 2, optional.** The load reduction comes from the change book + fetch-only-changed-rows. A doorbell adds fetches (it trades coalescing for latency), requires publishing the anon key, and would need RLS locked down on every table first. Start with a 15 s catch-up poll; add the doorbell only if the floor finds 15 s too slow.
2. **If a doorbell is added, don't ring it from the trigger** (`realtime.send` defaults to private channels → Orbit-minted JWTs, and puts a Realtime write inside every business transaction), and **never use Postgres Changes** (a logical replication slot retains WAL on disk if it lags — dangerous on a disk-throttled database). Ring from the app via HTTP broadcast, centrally, and let the poll cover SQL-Editor writes.
3. **The broadcast should carry no ids at all** — just "topic changed". The catch-up call already returns the ids; the payload only leaks activity and invites trust in forged data.
4. **The cursor must be commit-safe.** A plain `seq > lastSeq` cursor loses changes whose transaction commits late; use the transaction-id horizon (§C.4).
5. **The auth fix is a hard prerequisite.** Today every "near-free" API call carries 5–7 hidden session/permission queries (disk-io report §C). Without fixing that first, the catch-up call is not cheap.
6. **Don't trigger `order_status_logs`** (highest-volume, always paired with an `orders` write for anything Floor shows); **do** trigger `tint_assignments`, `order_splits`, `ci_returns`, `pick_delete_decisions`, `import_obd_query_summary` and `trips` — they change the screen with no `orders` write.
7. **Floor needs two things polling hid:** a 30 s render tick (the clock and elapsed pills only move because polls re-render) and an explicit IST-midnight reload (Floor has no rollover handling at all today).

---

## K. Read-only SQL for Smart Flow (numbered)

Run only when the database has recovered. All SELECT / SHOW.

1. `SELECT version(); SHOW server_version_num;` — confirm PG ≥ 13 for `xid8` / `pg_current_xact_id()` / `pg_snapshot_xmin`.
2. `SELECT extname, extversion FROM pg_extension ORDER BY 1;` — is `pg_cron` / `pg_net` / `supabase_realtime`-related present?
3. `SELECT nspname FROM pg_namespace WHERE nspname IN ('realtime','supabase_realtime');` and `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'realtime' ORDER BY 1;` — do `realtime.send` / `broadcast_changes` exist?
4. `SELECT pubname, puballtables FROM pg_publication;` · `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';` · `SELECT slot_name, plugin, slot_type, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained FROM pg_replication_slots;` — any replication slot already retaining WAL?
5. **RLS and anon exposure (prerequisite for any browser key):** `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY 1;` and `SELECT table_name, string_agg(privilege_type, ',') FROM information_schema.role_table_grants WHERE grantee IN ('anon','authenticated') AND table_schema = 'public' GROUP BY 1 ORDER BY 1;`
6. **Existing triggers:** `SELECT event_object_table, trigger_name, action_timing, event_manipulation, action_orientation FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY 1, 2;` and `SELECT tgrelid::regclass, tgname, tgenabled FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1;`
7. **Mirror body (confirm it touches no Floor table):** `SELECT pg_get_functiondef('public.mirror_trip_report_today(jsonb)'::regprocedure);`
8. **Column names the triggers need:** `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('orders','pick_assignments','tint_assignments','order_splits','import_obd_query_summary','ci_returns','so_tag_matches','pick_delete_decisions','trips','trip_drops','trip_activity') AND column_name ILIKE ANY (ARRAY['id','%orderid%','order_id','%tripid%','tripDropId','orderIds','keptOrderIds','updatedAt']) ORDER BY 1, 2;`
9. **Write volumes of trigger tables:** `SELECT relname, n_tup_ins, n_tup_upd, n_tup_hot_upd, n_tup_del, n_live_tup FROM pg_stat_user_tables WHERE relname IN ('orders','pick_assignments','tint_assignments','order_splits','import_obd_query_summary','ci_returns','so_tag_matches','pick_delete_decisions','trips','trip_drops','trip_activity','order_status_logs') ORDER BY 1;` + `SELECT stats_reset FROM pg_stat_database WHERE datname = current_database();` (to turn totals into per-day).
10. **Daily volumes (7 days):** `SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Kolkata') d, count(*) FROM order_status_logs WHERE "createdAt" > now() - interval '7 days' GROUP BY 1 ORDER BY 1;` and the same for `trip_activity` and `orders` (`"updatedAt"`, as a lower bound).
11. **Horizon-stall risk:** `SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('postgres','authenticator','anon','authenticated','service_role');` · `SHOW idle_in_transaction_session_timeout;` · `SELECT pid, usename, application_name, state, now() - xact_start AS age FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY xact_start LIMIT 10;`
12. **Horizon sanity (read-only, assigns no xid):** `SELECT pg_current_snapshot(), pg_snapshot_xmin(pg_current_snapshot());`
13. **Row counts that size the full-load fallback:** `SELECT (SELECT count(*) FROM orders WHERE "isRemoved" = false AND "workflowStage" NOT IN ('dispatched','closed','cancelled')) AS open_orders, (SELECT count(*) FROM trips) AS trips, (SELECT count(*) FROM trip_drops) AS drops;`
14. **Dashboard, not SQL:** Realtime plan quotas (connections, messages/month), "allow public access" setting, JWT signing keys type; Vercel Hobby function-invocation quota and current usage.

---

## L. Open decisions for the owner

1. **Phase 1 without Realtime (15 s catch-up poll on the change book)?** — *Recommend yes.* It delivers the load reduction with no new security surface.
2. **Fix the auth per-request DB reads first (separate small change)?** — *Recommend yes, first.* It is ~25 % of all app queries today and a prerequisite for a cheap catch-up call.
3. **Catch-up poll interval** — *Recommend 15 s* (today's Floor marker cadence); 10 s if the floor asks.
4. **Which tables get triggers** (§B.4, order_status_logs excluded, config tables → full reload) — *Recommend the list as written.*
5. **Cursor design: transaction-id horizon vs overlap window** — *Recommend the xid horizon.*
6. **Retention 3 days, daily Vercel cron prune** — *Recommend yes.*
7. **Detail panel when its bill changes: "changed — Reload" bar vs auto-refresh** — *Recommend the bar.*
8. **If Realtime later: public no-id doorbell rung by the app (after an RLS lockdown) vs private channels with Orbit-minted JWTs** — *Recommend public no-id, and only after §K Q5 shows RLS on every table.*
9. **Vercel plan:** confirm Hobby invocation quotas cover the new pattern (it is fewer calls than today, but verify) — *Recommend checking the dashboard before Phase 1 ships.*
10. **Order of later consumers** — *Recommend Billing next* (its pick-delete marker is the second-largest load), then Picking supervisor, Tint Manager, Mail Orders, MRN, CI.
11. **Master-data renames on existing trip stops** stay snapshots (FLOOR_TRIPS §17 item 9) — the feed will not change that; *recommend leaving as is.*
12. **Kill-switch key name and default:** `app_settings` `live.feed` (absent = OFF → old polling) — *Recommend exactly that*, so a missing row can never switch the new path on.

---

## M. Build order — small, separately testable, reversible

Each step ships on its own, is verified, and can be undone without touching the next.

| # | Step | Test | Undo |
|---|---|---|---|
| 0 | **Auth fix** (cache flags per user in memory with TTL / dedupe `auth()` per request / pass the session into `checkAnyPermission`) | `pg_stat_statements` calls for the `users` flags select and `attendance_settings` drop ~to zero | revert commit |
| 1 | **SQL: `live_changes` + `live_feed_meta` + trigger function + triggers on `orders` only.** Hand-mirror `schema.prisma`, `npx prisma generate`, **record v27.44 in CORE §7 the same day** | a Floor action writes one row; a `createMany` import writes N rows in one call; an updatedAt-only update writes none; renaming `live_changes` on a scratch copy does NOT fail an orders write | `DISABLE TRIGGER` (instant) / `DROP TRIGGER` |
| 2 | **Prune cron** `/api/cron/live-prune` + `vercel.json` | row count stays ≤ 3 days; watermark advances | remove cron entry |
| 3 | **`GET /api/live/changes`** (read-only; `enabled` from `app_settings` `live.feed`, absent = OFF) | curl with/without cursor; a late-committing transaction in two SQL Editor tabs is still delivered (horizon test); `reset` after forcing an old cursor | revert route |
| 4 | **Remaining triggers** (children, trips, config) | each B.4 writer produces the expected entity; pause/resume/TI/All OK/billing copy now appear | disable per table |
| 5 | **`lib/live/*` + `useLiveFeed`** (poll mode), no screen using it yet | unit tests for cursor, batching, backoff, hidden/visible | revert |
| 6 | **`POST /api/floor/rows` + `trips?ids=`** via the refactored builders; a **read-only parity script** that compares a full board load against `rows` for every id | 0 diffs across board/hold/cancelled on live data | revert |
| 7 | **Floor consumer behind the switch:** `live.feed` ON → feed + patch + render tick + midnight reload, marker and 30 s reload unmounted; OFF → today's code path, byte-identical | two browsers: an action in one appears in the other within 15 s; trip show/vehicle/billing copy now appear; ticks and open panel respected; midnight reload fires | **flip `live.feed` OFF in the SQL Editor — old polling returns within ~30 s, no deploy** |
| 8 | **Observe one working week**: `pg_stat_statements`, Disk IO graph, Vercel invocations | before/after numbers written into CLAUDE_FLOOR.md | switch OFF |
| 9 | Canon: `CLAUDE_FLOOR.md §5` rewritten, CORE §7/§13 (landmine: "every table a screen reads needs a live_changes trigger"; "never `session_replication_role=replica` in a data fix"), new `CLAUDE_LIVE_FEED.md` if it grows | — | — |
| 10 | *(Optional Phase 2)* RLS lockdown (§K Q5), anon key env, app-side HTTP doorbell via a guarded Prisma extension; poll → 60 s | forged-ping test; outage test (block Realtime → poll carries on) | remove the env key / switch |
| 11 | Other screens, one per step, each behind its own `live.feed.<screen>` key | per screen | per-screen switch |
