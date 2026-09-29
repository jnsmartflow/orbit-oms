# Code discovery — 2026-09-29 Disk IO outage (DISCOVERY ONLY)

**Date:** 2026-09-29 · **Mode:** read-only. No code changed, dev server not run, **zero database queries** (not even SELECTs, per the brief).
**Trigger:** Supabase "Disk IO Budget" exhausted ~20:30 IST, throughput throttled to the 5 MB/s baseline. Vercel 15:01–15:05 UTC: 108× Prisma P2024 "Timed out fetching a new connection (connection limit: 1)", 4× Supavisor `ECHECKOUTTIMEOUT`, 12× Postgres 57014 on `prisma.trips.findMany` / `prisma.orders.aggregate`. Same signature as the unexplained 2026-09-07 outage.

**Canon read:** CLAUDE.md (router v1.13), CORE v113 · Schema v27.43 (§3, §4, §7.12, §13), FLOOR v1.8 (§3, §5, §10b), FLOOR_TRIPS v1.0 (§8–§11, §14), PICKING v1.18 (§10), BILLING v1.0 (§8), MAIL_ORDERS v1.14, IMPORT v1.11 (§10), TRIP_REPORT v1.3 (§2, §7), NOTIFICATIONS v1.4 (§2), ATTENDANCE v1.4 (§11). Where code and canon disagree the code is taken as right; disagreements are listed in §H.

**Method:** four parallel read-only sweeps (client polls · per-route DB cost · auth + Prisma setup · crons + depot scripts), then every load-bearing claim re-opened by hand. Items verified by hand are marked ✅. Sub-sweep claims I could not re-open are marked (sweep). One sub-sweep claim was **wrong** and is corrected in §H.

**Legend:** `O` = the per-request auth + permission overhead defined in §C (≈ 5–7 queries for a non-admin on a stale token). All numbers in §F are **ESTIMATES**.

---

## Timeline context (from `git log`, not the DB)

| When | Commit | Relevance |
|---|---|---|
| 2026-09-07 | — | First outage, same signature. At that time the trip mirror was still delete-and-refill (~13.5k inserts + ~13.4k deletes/day + a 37-col temp table ~1,390×/day, TRIP_REPORT §2.2). Fixed 2026-09-08 (`88bf9926`), so that load **was present on 09-07 and is gone now**. |
| 2026-09-27 20:13 | `3103deab` | Pick-delete routes incl. `/api/billing/pick-delete/marker` |
| 2026-09-27 20:39 | `8a54446c` | Floor + Picking markers now also aggregate `pick_delete_decisions` |
| **2026-09-28 09:16** | **`8fc1beb2`** | **Pick-delete becomes a blocking popup on EVERY Billing tab; marker cadence 10 s.** First full working day with it: 09-28. Outage: 09-29 evening. |
| 2026-09-29 16:11 | `1ccdb84b` | Floor search + the "tick does not supersede a load in flight" guard |

The 09-07 outage predates pick-delete, so pick-delete cannot be the whole story — it is best read as a **new heavy load stacked on a baseline that was already near the edge**.

---

## A. Client-side repeat callers

Swept `app/`, `components/`, `lib/`, `public/` twice (Grep tool + MSYS grep; both returned the same 17 files). **None exist:** SWR, React Query, EventSource, WebSocket, Supabase realtime, timed `router.refresh()`, self-rescheduling `setTimeout` loops, service-worker `periodicsync`. `public/sw.js` handles install/activate/push/notificationclick only. The global shell polls nothing; `SessionProvider` has `refetchOnWindowFocus={false}` and no `refetchInterval` (`components/shared/session-provider.tsx:56`).

**Shared engine ✅** `usePickingMarker` (`lib/hooks/use-picking-marker.ts`): default 15 s (`:7`); first probe on mount = baseline (`:333-336`); **pauses when hidden** — `if (… document.visibilityState === "hidden") return;` (`:257`) and `handleVisibility` clears/restarts the interval (`:324-331`); one immediate probe on becoming visible (`:326`); no overlap (`inFlightRef`). 🔴 **`paused` does NOT stop probing** — it only defers `onChange` (`:300-302`). Every "paused" state below still hits its marker on schedule.

| # | file:line | Screen · who | Endpoint(s) | Interval | Pauses when hidden? | Other pause | On change | Phone/desk |
|---|---|---|---|---|---|---|---|---|
| 1 | `components/floor/floor-page.tsx:1956-1972` ✅ | `/floor` · `floor` canView (`app/(floor)/floor/layout.tsx:25`) | `/api/floor/marker` | 15 s | Yes (hook) | `!isLive \|\| detailOpen` — defers onChange only, **still probes** | No selection: `load()` = **4 fetches** board+hold+cancelled+trips (`:510-515`). With ticks: `/api/floor/board` (reconcile, `:1889`) + `/api/floor/trips` (`:1936`) | Desk (same tree any width) |
| 2 | `lib/floor/use-floor-rail-poll.ts:6,28-56` used at `floor-page.tsx:1976-1987` ✅ | same | `load()` → same 4 endpoints | **30 s** | **Yes**: `if (… document.visibilityState === "hidden") return;` (`:30`) + `onVisibility` stops/starts interval (`:42-49`) | `!isLive \|\| detailOpen \|\| selection.size > 0` (true skip) + `if (!loadInFlightRef.current)` (`:1985`) | **BLIND full reload — no change check** | Desk |
| 3 | `components/billing/billing-marker-provider.tsx:142-153`, mounted `app/(mail-orders)/mail-orders/mail-orders-page.tsx:1553` | `/mail-orders` billing face, `billingV2 && billing_picking` canView, focus view only | `/api/billing/picking/marker` | 30 s (`:47`) | Yes (hook) | pause keys (selection/busy) — probe continues | Tab bar re-fetches **the same marker** (`billing-tab-bar.tsx:159`) ✅ + Picking tab list `/api/billing/picking/list` when open | Desk |
| 4 | same file `:224-226`, mounted `:1556` | `billing_print` | `/api/billing/print/marker` | 30 s | Yes | copy in flight | Tab bar re-fetch of same marker (`billing-tab-bar.tsx:131`) + `/api/billing/print/list` | Desk |
| 5 | same file `:280-283`, mounted `:1559` | `billing_telephonic` | `/api/billing/telephonic/marker` | 30 s | Yes | typing/busy | Tab bar re-fetch (`billing-tab-bar.tsx:110`) + `/api/billing/telephonic/list` | Desk |
| 6 | same file `:334-341` ✅, mounted `:1563` ✅ | `billing_pick_delete` canView — **on every Billing tab** | `/api/billing/pick-delete/marker` | **10 s** (`BILLING_PICK_DELETE_POLL_MS`, `:57`) ✅ | Yes | queue busy / confirm up | Popup `check()` → **same heavy marker again** (`billing-pick-delete-popup.tsx:83`) ✅ + `/api/billing/pick-delete/list` (popup open or History tab) | Desk |
| 7 | `components/billing/billing-pick-delete-popup.tsx:95-116` ✅ | same, + canEdit (`mail-orders-page.tsx:1621`) | `/api/billing/pick-delete/marker` | event: **mount, every window `focus`**, `PICK_DELETE_CHECK_EVENT`, import done | n/a — `focus` fires while visible | none | sets count; count>0 mounts queue → list | Desk |
| 8 | `app/(mail-orders)/mail-orders/mail-orders-page.tsx:391-397` ✅ (`MAIL_ORDERS_MARKER_POLL_MS = 30_000`, `:100`) | every `/mail-orders` viewer (`mail_orders` canView), both faces | `/api/mail-orders/marker` | 30 s | Yes | none | `loadOrders` → `/api/mail-orders?date=` (full list) | Desk |
| 9 | `components/picking/picking-mobile-shell.tsx:510-516` | `/picking` supervisor face (`picking` canView, primary role ≠ picker) | `/api/picking/marker` | 15 s | Yes | `detailOpen \|\| overlayBusy` (still probes) | `/api/picking/queue?scope=openPending` | Both (card board all widths) |
| 10 | `picking-mobile-shell.tsx:560-567` | same face (alive with #9) | `/api/picking/tint-workload/marker` | 15 s | Yes | same | `/api/picking/tint-workload` | Both |
| 11 | `components/picking/picker-my-picks-board.tsx:510-517` | `/picking` picker face | `/api/picking/marker?pickerId=N` | 15 s | Yes | `detailOpen \|\| marking \|\| markingAll` | `/api/picking/queue?pickerId=N` (+ `/api/picking/combined` if open) | Phone |
| 12 | `components/tint/manager/use-tint-manager-sync.ts:56-65` ✅ used `tint-manager-content.tsx:230-234` | `/tint/manager`, `/operations/tinting`, `/admin/tint-manager` | `/api/tint/manager/marker` | 15 s | Yes | panel/selection | `/api/tint/manager/orders` + `/api/tint/manager/missing-customers` | Desk |
| 13 | `use-tint-manager-sync.ts:42,72-79` ✅ | same (alive with #12) | same 2 endpoints | **60 s** | **Partly** — interval never cleared, tick no-ops: `if (… visibilityState === "hidden") return;` (`:75`) | `paused` (true skip) | **BLIND full refetch** | Desk |
| 14 | `components/mrn/mrn-shell.tsx:263-270` | `/mrn` floor_supervisor face only | `/api/mrn/marker?tab=` | 15 s | Yes | detail/overlay | `/api/mrn/board?face=supervisor` | Phone |
| 15 | `components/ci/billing-board.tsx:156-166` | `/ci` billing face only | `/api/ci/marker` | 15 s | Yes | form active | `/api/ci/board?face=billing` (+ `/api/ci/{id}`) | Desk |

**Checked, not network polls:** 1 s IST clock `universal-header.tsx:249`; `tint-table-view.tsx:336` 60 s; `tint-operator-content.tsx:855` 1 s job timer; `picking-board-mobile.tsx:1494` 30 s; attendance `status-card.tsx:122`, `live-timer.tsx:22`; `hide-settings-content.tsx:37`, `attendance-page-header.tsx:179`, `admin-header.tsx:33-35` clocks; `app/po2/po-v2-page.tsx:714-717` visibilitychange → localStorage only. `components/admin/operations-overview.tsx:51` has a 60 s `/api/operations/summary` poll but **zero importers** ✅ (dead). `/tint/operator`, `/trips`, `/attendance`, `/mrn` billing face, `/ci` supervisor face: **no data poll**.

### Answers to the specific questions

- **`useFloorRailPoll` ✅** — exists, mounted unconditionally on `/floor` (`floor-page.tsx:1976`). It **does pause when hidden** (`use-floor-rail-poll.ts:30`, `:42-49`) and when `!isLive || detailOpen || selection.size > 0`. When visible and idle it is a **blind 30 s reload of board + hold + cancelled + trips** — it never asks the marker first. The name is historical; there is no rail.
- **`/api/billing/pick-delete/marker` ✅** — `app/api/billing/pick-delete/marker/route.ts` → `getPickDeleteMarker()` (`lib/billing/pick-delete.ts:402-421`). Callers: `BillingPickDeleteMarkerProvider` (10 s) and `BillingPickDeletePopup.check()` (mount, every marker change, every window `focus`, import done). Mounted on the `/mail-orders` billing face around every tab (`mail-orders-page.tsx:1563`, `:1621`). Cost in §B.
- **Two polls for the same data:**
  - `/floor`: marker (15 s) **and** blind rail reload (30 s) drive the **same `load()`**. One change can reload the board twice; the 30 s reload makes the marker redundant while idle.
  - `/tint/manager`: marker (15 s) **and** blind 60 s refetch of the same two endpoints.
  - Billing: each provider change is followed by the tab bar (or popup) **re-fetching the same marker URL** it just probed (`billing-tab-bar.tsx:110/131/159`, popup `:83`). Mount: provider probe + tab-bar mount fetch = 2 hits per marker (4 markers → 8 at mount, 2 of them the heavy pick-delete).
  - A billing desk holding all keys runs **5 timers** (#3, #4, #5, #6, #8) = 2+2+2+6+2 = **14 marker requests/min** before any change.
  - `/picking` supervisor: #9 + #10 watch different sets — not a duplicate.
- **Burst on becoming visible — yes:**
  - `/floor`: marker probe **+ rail `tick()` = full 4-fetch `load()`**; if the marker moved while hidden its `onChange` calls `load()` again (marker path is not guarded by `loadInFlightRef`). Worst case 1 + 8 requests.
  - Billing desk: up to 5 immediate marker probes **+ the popup's `focus` check** (switching back fires both `visibilitychange` and `focus`) = **two heavy pick-delete markers at once**, then fan-outs.
  - Changing the date on `/mail-orders` sets `loading=true` (`:363`), which unmounts all billing providers (`!loading` gate, `:1532`); remount re-probes everything. (A marker-driven `loadOrders` does **not** toggle `loading` ✅ — `:343-356`.)

---

## B. What each polled endpoint costs the database

**Global facts for this section:**
- Prisma **5.22**, `previewFeatures = ["postgresqlExtensions"]` only (`prisma/schema.prisma:3` ✅) → no `relationJoins`, so **every `include` relation is its own SQL statement**, and no `nativeDistinct`, so **`distinct:` is done in memory** (every matching row is fetched).
- Every route below: `export const dynamic = "force-dynamic"`, no `maxDuration`, no `runtime`.
- `getHideExclusion()` = 1 `obd_visibility_rules.findMany` per call, AND-merged as NULL-safe OR terms (not sargable).
- Every route pays `O` (§C) on top.

### Floor (all polled by one visible `/floor` tab)

| Route | Queries / request (excl. O) | Shape | Bounded? |
|---|---|---|---|
| `GET /api/floor/marker` | **3**: hide · `orders.aggregate {_count, _max.updatedAt}` over `floorBoardWhere(today) AND hide` (`route.ts:42-46`) · `pick_delete_decisions.aggregate` (`route.ts:51` ✅) | COUNT+MAX over the whole predicate — `orders_updatedAt_idx` cannot short-circuit a filtered COUNT | Predicate only (see `floorBoardWhere`) |
| `GET /api/floor/board` | **~35–45**: hide · `orders.findMany(floorBoardWhere)` with `FLOOR_BOARD_INCLUDE` ≈ 17 statements (customer→area→route, deliveryType ×2 chains, dispatchWindow, querySnapshot, tint `take 1`, pickAssignment + 3 users) · `dispatch_slot_master` · `import_raw_summary obdNumber IN` · duplicate-SO (`orders soNumber IN` per 1k + decisions) · colour-work 0/3 · `trip_drops`/`trips id IN` · `import_raw_line_items` + `sku_master_v2` (dead `waitingSkus`/`oilSkus` payload, FLOOR §10b) · `getFloorPickers` (users + `pick_assignments.groupBy`) · `getRouteClubs` · `getLoadPlanPayload` (incl. **full `route_master`**) | Route comment: 84 statements before the rail went, 25 of them rail (sweep) | No `take`; grows with the predicate |
| `GET /api/floor/hold` | **~13–16**: hide · `orders.findMany {dispatchStatus:'hold'}` **all dates** + 2 dealer chains · billTo · `order_status_logs orderId IN` · colour-work | | No `take`, no date |
| `GET /api/floor/cancelled` | **~16–20**: hide · `ci_returns` today + users · `so_tag_matches` · **`order_status_logs where toStage='cancelled' AND createdAt in today`** (`lib/floor/queries.ts:1386` ✅) + users · `orders id IN` + dealer chains · colour-work · billTo | 🔴 `order_status_logs` has only PK + `orderId` index (`prisma/migrations/phase2_import_tables.sql:283` ✅) → **full scan of the whole status-log table every 30 s per floor tab** | Day-bounded by value, not by index |
| `GET /api/floor/trips?date=` | **~10–13**: **`trips.findMany(tripsOnDeskWhere)`** (`lib/trips/queries.ts:807`) · `trip_drops tripId IN` · `loadTripBills` ≤5 · `loadTripLabels` ≤5 (repeats a `route_master` read) | Gated `floor` **canEdit** — a view-only user gets a cheap 403 each load | See trips predicate below |
| `GET /api/floor/trips/[id]` | ~14 | Not on a timer, but **re-runs after every `load()` while a trip is selected** (effect keyed on `[railSelection, trips]`, `floor-page.tsx:739-765`, sweep) | — |
| `GET /api/floor/pick-gate` | 1 (`app_settings` by unique key) | once on mount | — |
| `/floor` page (server) | 0 data queries; **~5 `auth()` evaluations** (root layout `app/layout.tsx:84`, floor layout, page, 2× inside `checkAnyPermission`) + `getAllPermissionsForRoles` | data loads client-side | — |

**`floorBoardWhere` ✅ (`lib/floor/queries.ts:479-495`, shared by board + marker)** — a 4-arm OR:
1. `floorLiveBaseWhere`: dispatch + open stages, **or** `pick_checked AND pickAssignment.checkedAt ∈ today` → subquery over `pick_assignments` with **no index on `checked_at`**.
2. `floorUnslottedWhere`: rank<60, `dispatchStatus IS NULL`.
3. `floorCarriedPoolWhere` (`:204-211`): `pick_checked AND dispatch AND tripDropId IS NULL` — **"whatever day it was checked"**. Because **no code path writes `workflowStage='dispatched'` today** (FLOOR_TRIPS §14 ✅; the only live writer `lib/floor/dispatch.ts:178` has no caller), every checked bill not put on an Orbit trip **stays in this arm forever**. The set grows every working day.
4. `floorTripBillsWhere`: `tripDropId NOT NULL AND tripDrop.trip ∈ liveTripsOnDeskWhere(today)` → trips → drops → orders, three nested EXISTS.
Recorded warm EXPLAIN (2026-09-15, sweep citing FLOOR-TO-FLOOR-DISCOVERY.md:144-150): BitmapOr on `orders`, **seq scans on `pick_assignments`, `trip_drops`, `trips`**, 3.2–3.9 ms. That was warm; under a 5 MB/s throttle the same scans read from disk.

**The trips predicate ✅ (`lib/trips/live-trips.ts:115-123`)**: `tripDate = D OR (tripDate < D AND drops.some.orders.some(BILL_NOT_DONE))`, where `BILL_NOT_DONE` = `isRemoved=false AND workflowStage NOT IN (pick_checked, dispatched, cancelled) AND (dispatchStatus IS NULL OR <> 'hold')` (`:68-72`). **No lower bound on `tripDate`** — every past trip is tested with a correlated EXISTS through `trip_drops` → `orders`, with a `NOT IN` and a nullable OR. It runs in the trips feed (every 30 s), in board arm 4 and in the 15 s marker.

### Picking

| Route | Queries (excl. O) | Notes |
|---|---|---|
| `/api/picking/marker` | **4–7**: `app_settings` (gate) · `orders.aggregate(buildPickingWhere)` · (gate ON, no pickerId) `countHeldBackWaiting` = `orders.findMany`+`orders.count` · `pick_delete_decisions.aggregate` (`route.ts:179` ✅) | `pickerId` variant adds `pickAssignment.pickerId` filter — **`pick_assignments.picker_id` unindexed** (sweep). Gate is OFF live (FLOOR_TRIPS §11, 2026-09-18) |
| `/api/picking/tint-workload/marker` | 2: `orders.aggregate(orderType='tint', stages)` + `tint_assignments.aggregate` | `orders_orderType_idx` + `orders_workflowStage_idx` exist in committed SQL ✅ |
| `/api/picking/queue` (on change) | ~15–25 incl. `import_raw_line_items` ×2, `sku_master_v2` ×2 | not on a timer |
| `/api/picking/tint-workload` (on change) | ~14 | not on a timer |

### Billing (all on `/mail-orders` billing face)

| Route | Cadence | Queries (excl. O) | Notes |
|---|---|---|---|
| **`/api/billing/pick-delete/marker`** ✅ | **10 s + every focus** | **~6 + ⌈S/1000⌉ + k**: (1) `getOpenGroups` = `orders.findMany { isRemoved:false, workflowStage notIn [cancelled, dispatched, closed], soNumber not null }, distinct soNumber` (`pick-delete.ts:79-89`) — **no date, no take, in-memory distinct → every open row fetched**; (2) `getTwinIdsBySo` — one `orders.findMany soNumber IN (≤1000)` per chunk over **every open SO** (`duplicate-so.ts:100-122`); (3) `getActiveAllOkSets` if groups; (4) `readBills` with 4 relation selects (≈5 statements) (`:193-205`, `:233-236`); (5) **N+1: `findLiveCi` = `ci_returns.findFirst` per bill that passes the cheap checks, sequentially** (`:262-275` → `lib/ci/live-ci.ts:34-40`); (6) `pick_delete_decisions.aggregate`; (7) **`orders.aggregate where id IN (all open-group ids)`** (`:408-411`) | 🔴 The "open" set is the same ever-growing set as floor arm 3 (nothing writes `dispatched`). `lib/floor/queries.ts:184` records 2,604 `pick_checked` bills on 2026-09-10 (sweep). `duplicate-so.ts`'s own header forbids exactly this ("asks only about the SO numbers on the rows a board is already returning … never about the whole table") |
| `/api/billing/picking/marker` | 30 s | 3: hide · `orders.aggregate _count` over `pending` (partial `orders_billing_pending_idx`) · `orders.aggregate _max` over `OR[pending, invoicedInfo]` — the OR likely defeats the partial index; `invoicedInfo` filters on unindexed `pick_assignments.checked_at` | |
| `/api/billing/print/marker` | 30 s | ~4–11: `getPrintWorkTripIds` (`trips.findMany` + `$queryRaw` correlated EXISTS, `lib/billing/print.ts:293-322`) · `trips.findMany id IN` · `loadPrintTrips` 6–7 · `getPrintMarkerLatest` raw 3×MAX incl. orders→drops→trips join (`:355-368`) | `trips` ~120 rows — cheap when warm |
| `/api/billing/telephonic/marker` | 30 s | 7: `so_tags.count`, `.aggregate`, `so_tag_matches.aggregate`, `.count`, **`so_tag_matches.findMany distinct orderId` (unbounded, in-memory)**, **`orders.aggregate id IN (every matched order ever)`**, `ci_returns.aggregate` same list (`lib/billing/telephonic.ts:444-474`, sweep) | List grows forever |
| lists (`picking/list`, `print/list`, `pick-delete/list`, `telephonic/list`) | on change | `pick-delete/list` = the whole `getActionableGroups` again + lines + decisions; `picking/list` Done section filters **`orders.invoicedAt` (no index)** | |

### Mail Orders

| Route | Cadence | Queries (excl. O) | Notes |
|---|---|---|---|
| `/api/mail-orders/marker` | 30 s | 2: `mo_orders.aggregate where receivedAt ∈ IST day` · `app_tag_settings.aggregate` | **`mo_orders.receivedAt` unindexed** (schema + committed SQL) → scan of a wide text table |
| `GET /api/mail-orders` | on change | ~13–14: `mo_orders.findMany(receivedAt day)` + include tree ≈9 (lines, lineStatus, remarks, punchedBy, shipTo→area→…) · `mo_customer_keywords customerCode IN` ×2 · `delivery_point_master` · `mo_sku_lookup_v2` (5-min per-instance cache) · tag settings | **`mo_order_lines.moOrderId` unindexed** (contrast `mo_order_remarks` which has one). Only `auth()`, no `checkAnyPermission` (sweep) |
| `POST /api/mail-orders/ingest` | per email (HMAC) | ~12 + lines + remarks: dedupe · **full-table** `mo_product_keywords`, `mo_base_keywords`, `mo_sku_lookup` in a `Promise.all` · `buildTableCContext` (full `mo_order_form_index_v2` + `mo_sku_lookup_v2`, `Promise.all`) · `matchCustomer` full `mo_customer_keywords` ×1–2 · N+1 keyword `findFirst` · `mo_orders.create` · **one `mo_order_lines.create` per line**, one remark create each · `mo_orders.update` (trigger stamps `updatedAt`) | `Promise.all` inside one lambda with `connection_limit=1` serialises on one connection anyway |

### Tint

| Route | Cadence | Queries | Notes |
|---|---|---|---|
| `/api/tint/manager/marker` | 15 s | 3: hide · `users.findUnique` · `orders.aggregate(orderType='tint', OR[stages, tintAssignments.some{done today}, splits.some{done today}])` | `tint_assignments (status, completedAt)`, `order_splits (orderId, status, completedAt)` unindexed (sweep). `startOfToday` is server-local (UTC) midnight, not IST (`:77`, sweep) |
| `/api/tint/manager/orders` | **60 s blind** + on change | **~50+**: `Promise.all` of 6 deep include trees (`route.ts:119-497`) + raw summary/lines + fini map | P2024 candidate under `connection_limit=1` |

### `trips.findMany` and `orders.aggregate` — every call site (app/ + lib/)

| Call site | Reached from | Polled? |
|---|---|---|
| `lib/trips/queries.ts:807` `trips.findMany(tripsOnDeskWhere)` | `GET /api/floor/trips` | **Yes** — 30 s `load()` + marker `refreshTrips` (`floor-page.tsx:514`, `:1936`). **Prime candidate for the `trips.findMany` 57014.** |
| `lib/floor/queries.ts:904` `trips.findMany id IN` | `GET /api/floor/board` | Yes (30 s) |
| `app/api/billing/print/marker/route.ts:37`; `lib/billing/print.ts:129`, `:294` | print marker | Yes (30 s) |
| `lib/billing/print.ts:327` | print/list | on change |
| `lib/trips/number.ts:247,274`; `app/api/floor/trips/[id]/cancel/route.ts:182`; `lib/floor/load-plan-check-data.ts:102` | writes / admin | No |
| `app/api/floor/marker/route.ts:42` `orders.aggregate` | floor marker | **Yes, 15 s** (22 errors in the log — top of the list) |
| `app/api/picking/marker/route.ts:131` | picking marker | **Yes, 15 s** |
| `app/api/billing/picking/marker/route.ts:98,104` | billing picking marker | Yes, 30 s |
| `app/api/tint/manager/marker/route.ts:87` | tint manager marker | Yes, 15 s |
| `lib/picking/tint-workload.ts:524` | tint-workload marker | Yes, 15 s |
| **`lib/billing/pick-delete.ts:411`** | **pick-delete marker** | **Yes, 10 s + focus** |
| `lib/billing/telephonic.ts:456` | telephonic marker | Yes, 30 s |
| `app/api/tint/manager/assign/route.ts:214` | POST assign | No |

Which `orders.aggregate` timed out can only be answered by the DB log (§I). By predicate complexity: **floor marker** (4-arm OR with nested EXISTS, 15 s) and **picking marker** are the likeliest; the pick-delete one is PK-keyed but its `IN` list is as long as the open-group set.

### Index coverage (committed evidence only — live state NOT verified)

`orders` indexes found: PK · `obdNumber` UNIQUE · `batchId`, `customerId`, **`workflowStage`**, **`dispatchStatus`** (`prisma/migrations/phase2_import_tables.sql:279-282` ✅) · `orderType` (`phase2_schema_v11.sql:192` ✅) · `updatedAt DESC`, `invoiceNo`, `tripDropId` (schema) · `isHidden` (`sql/2026-06-12-hide-feature.sql:35`) · partial `orders_billing_pending_idx` (live per CORE, no SQL) · `idx_orders_sonumber` (live per CORE §7.12, not in schema, no SQL).

**Likely MISSING indexes** (each on a polled path; confirm with `pg_indexes` first):
1. `order_status_logs ("toStage","createdAt")` (or `"createdAt"`) — floor cancelled, every 30 s per floor tab; large append-only table.
2. `pick_assignments (checked_at)` — floor marker arm 1, picking marker, billing picking marker.
3. `mo_orders ("receivedAt")` — mail-orders marker (30 s) + list.
4. `mo_order_lines ("moOrderId")` — mail-orders list include.
5. `orders ("obdEmailDate")` — Auto-Import `day-obds` / `pending-invoices`, ~430×/day (§E).
6. `mo_orders ("soNumber")` full index (only a partial one exists) — `patch-headers` per-row lookup and ingest enrichment.
7. `tint_assignments ("status","completedAt")`, `order_splits ("orderId")` / `("status","completedAt")` — tint manager marker 15 s.
8. `pick_assignments (picker_id)` — picker marker 15 s, `getFloorPickers`.
9. `orders ("invoicedAt")` — billing picking list Done.
10. `mo_customer_keywords ("customerCode")` — mail-orders list + ingest.

Indexes will not fix the structural items (unbounded pick-delete scan, blind 30 s reload, auth re-reads).

---

## C. Login and session cost ✅ (verified by hand in `lib/auth.ts`, `lib/permissions.ts`, `node_modules/next-auth/lib/index.js`, `node_modules/@auth/core/lib/actions/session.js`)

Versions: `next-auth` 5.0.0-beta.30, `@auth/core` 0.41.1, `next` 14.2.29.

**Sign-in:** `authorize` → `users.findFirst` (phone/email) with `role` + `userRoles→role` includes (≈3–4 statements, `lib/auth.ts:200-208`) + bcrypt (CPU). jwt sign-in branch → `fetchUserAttendanceFlags` = `users.findUnique` + `attendance_settings.findFirst` (`:36-48`) + (if the attendance gate applies) `attendance_records.findFirst`. **≈ 5–7 statements per sign-in.** No events, no audit write. Not a load concern by itself.

**jwt refresh branch (`lib/auth.ts:149-181`):** skips the DB while `token.rolloutStageStaleAt > now`; otherwise `users.findUnique` + `attendance_settings.findFirst` (+ `attendance_records.findFirst` if gated and `lastCheckInDate !== today`) and sets `rolloutStageStaleAt = now + 5 min` (`STALE_MS`, `:20`).

🔴 **THE STALE WINDOW NEVER ADVANCES IN THE COOKIE — every server `auth()` after minute 5 of a session hits the DB.**
- `auth()` with no arguments (every route handler, layout, server component) is `getSession(headers).then(r => r.json())` (`next-auth/lib/index.js:89-91`) — the re-encoded token's **`Set-Cookie` is discarded**. The jwt callback runs each time (`@auth/core/lib/actions/session.js:30-34`) and its new `rolloutStageStaleAt` goes nowhere.
- Middleware (`middleware.ts:6`, matcher `/((?!_next/static|_next/image|.*\\..*).*)` — **every page and every `/api/*`**) *does* write the cookie, but it uses the Edge config whose jwt callback returns the token unchanged (`auth.config.ts:64-71`) — it re-signs the **old** `rolloutStageStaleAt` and extends the cookie's life.
- The `update()` path deliberately leaves `rolloutStageStaleAt` alone (`lib/auth.ts:96-99`); the client never calls `/api/auth/session` (no refetch interval, `refetchOnWindowFocus={false}`).
- Net: `rolloutStageStaleAt` stays at **sign-in + 5 min** for the life of the session. After that, **every Node `auth()` = 2–3 queries**.

**Per ordinary API request (e.g. any marker):** route `auth()` (#1) → `checkAnyPermission` (`lib/permissions.ts:823-849`): admin role → return true; else `sessionAccess()` = **a second `auth()`** (`:668-671`); superuser flag → true; else `getAccessSource()` (`system_config`, cached 30 s **per lambda instance**, `lib/access/source.ts:41-44`) then `user_page_access.findUnique` (user mode, `:701`) or `role_permissions.findMany`. Nothing dedupes `auth()` within a request (no React `cache()`).

| User | Session < 5 min | Session > 5 min (normal) |
|---|---|---|
| admin role | 0 | 2–3 |
| superuser, not admin role | 0 | 4–6 |
| everyone else | 1 (+≤1 system_config/30 s) | **5–7** |

This is `O`. **Yes — every polled API call also triggers session DB reads.** A page render multiplies it (root layout + group layout + page + resolver `auth()`s ≈ 4–5 × 2–3). Middleware itself does no DB work.

---

## D. Connection setup ✅

- **Client:** `lib/prisma.ts` — one `new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } }, log: prod ["error"] })`; the `globalThis` cache is applied **only when `NODE_ENV !== "production"`** — in production it is still one client per lambda instance (module scope). The "Disable prepared statements" comment has no matching option (the URL's `pgbouncer=true` does that job). No `$extends` / `$use`. Only one runtime `new PrismaClient` (others are in `scripts/` and untracked root `_*.ts`).
- **URL parameters (masked; `.env` and `.env.local`, production values live in the Vercel dashboard):** `DATABASE_URL` = Supavisor pooler host, **port 6543**, `?pgbouncer=true&connection_limit=1`. No `pool_timeout` (Prisma default **10 s**), no `connect_timeout`, no `statement_timeout` (the role-level `30s` from CORE §4 applies). `DIRECT_URL` = direct host, port 5432, no params. The Vercel log's "connection limit: 1" confirms production matches.
- **`DIRECT_URL` at runtime:** not used (schema `directUrl` for the CLI, and `scripts/*` only).
- **Other DB clients:** `lib/supabase.ts` service-role client used **for Storage only** (attendance photos, MRN photos, purge cron). No `pg` Pool.
- **Pool arithmetic (from CORE §4: Supavisor transaction mode, pool size 15):** each concurrently running lambda holds its own single connection. **The Floor `load()` alone issues 4 parallel requests per tab** — 10 floor tabs ticking near-together want ~40 server connections plus markers from every other screen, against a pool of 15. When disk throttling makes each query slow, connections are held longer → Supavisor checkout queue (`ECHECKOUTTIMEOUT`) → Prisma's 10 s pool wait (P2024) → retried by the next poll tick. This is the mechanism behind the log's error mix; it amplifies load, it does not create it.
- **`vercel.json` ✅:** 3 crons, **no `regions`, no `functions`/`maxDuration`**. `bom1` must be set in project settings (unverifiable here).
- **`maxDuration`:** only `app/api/mail-orders/backfill-enrich/route.ts:15` and `re-enrich/route.ts:17` (300, manual, no callers on a timer). Long loops without it: `cron/attendance-purge` (`while(true)` cursor pages of 100), `cron/attendance-rollover` (per user), `import/obd` (per row / per SO / per order sequential writes), `lib/import-upsert.ts` per-entry audit loops. Retry loops (CI submit, floor CI, MRN create, auto-CI, bill-only CI, sampling library) are bounded with no sleep.

---

## E. Timers and outside callers

### Vercel crons (`vercel.json` ✅)

| Path | UTC → IST | DB work |
|---|---|---|
| `/api/cron/attendance-rollover` | `35 18 * * *` → 00:05 | 3 reads + one create/update per active user (~20–45 queries) |
| `/api/cron/attendance-purge` | `30 20 * * *` → 02:00 | settings + cursor batches of 100 over photos past retention (small once caught up) |
| **`/api/cron/load-plan-snapshot`** | **`30 15 * * *` → 21:00** | one full `getFloorBoard(live, Upcountry)` + trips bills + `runLoadPlanV2` + snapshot insert (~20–60 statements). **Undocumented in CORE §4 / ATTENDANCE §11** (§H). Fires 30 min after the outage began — not a cause, but it will run into a throttled DB. |

No `pg_cron`, `pg_net`, materialized views or `CREATE TRIGGER` in any committed SQL; the one known live trigger is `trg_mo_orders_updated_at` (BEFORE UPDATE, same-row stamp — no extra writes). Live triggers unverified (§I).

### Depot scripts

| Script (repo copy) | Calls Orbit? | Cadence | Per call |
|---|---|---|---|
| **`docs/Powershell/Auto-Import-v3.ps1`** (canon: "probably" what runs, unverified) | `https://www.orbitoms.in/api/import/obd?action=` `day-obds` / `check` / `auto-json` / `patch-headers` / `pending-invoices` (`:75-79`) | Task Scheduler **every 1 min**; self-decides: busy 10:00–13:15 & 14:30–18:00 glance every minute; relax 10 min; patrol 20:00–23:59 every 30 min; deep sweeps 13:30 & 18:30; morning sweep from 06:00 | **`day-obds` on every glance with no local gate (~430/day, EST)** → `orders.findMany where obdEmailDate ∈ day` (`app/api/import/obd/route.ts:4663-4668`) — **no `obdEmailDate` index** → likely seq scan of `orders` each call. `pending-invoices` (~50/day) same column. `auto-json` only when OBDs are missing (heavy: ~30 fixed + ~10–15 per new OBD). `patch-headers` small most of the day; **3 large runs/day** (all of the day's OBDs: per row `orders.findUnique` + 3 joins + `mo_orders.findFirst({soNumber,status})` — no full `soNumber` index — + update if changed) |
| `docs/Powershell/Auto-Import-v2.ps1` (if it is the scheduled one) | same first four actions | every ~10 min, ~08:00–22:52 | **Every cycle, ungated:** `check` all today's OBDs + **`patch-headers` for all of today's OBDs** + 3-day `pending-invoices`. EST ~150 OBDs × 2–3 queries × ~72 cycles ≈ **20–30k queries/day** from patch-headers alone |
| `docs/Powershell/Auto-Import.ps1`, `docs/Parser/Auto-Import.ps1` | old `orbit-oms.vercel.app …?action=auto` | historical; zero v1 batches ever (IMPORT §10) | — |
| **`docs/Parser/Parse-MailOrders-V7.ps1`** | `ApiBaseUrl` from `config.txt` → `/api/mail-orders/ingest`; `/keywords` once at start | `while($true)` every **10 s** over local Outlook; server call only per unprocessed email | 1 POST per email (split: 2–3). 🔴 **On a failed POST it `continue`s without `Mark-AsProcessed` (`:2503-2505`) → retries every 10 s until success.** During an outage every pending email re-POSTs 6×/min, each doing ~6 full-table reads — a recovery-slowing amplifier |
| `0-FrtIngestion.ps1`, `3-PendingFetch.ps1`, `4-LogisticsEntry.ps1` | **No** (local Outlook / Breakwalls only) | 30 s loops | 0 Orbit/Supabase traffic |

### NTS trip puller → `mirror_trip_report_today` (off-repo, host unknown — TRIP_REPORT §2.3/§7)

- ~every 62 s, **24/7 ≈ 1,390–1,415 calls/day**, whole day's ~100 rows each time (no client-side gate), via PostgREST RPC with the service-role key (bypasses Vercel, bypasses the Prisma pool — but shares the database's disk budget).
- **Per call, even when nothing changed** (function body recorded in `docs/prompts/archive/2026-09/code-resume-2026-09-08-trip-mirror-rewrite.md:55-357`; not re-verified against live `pg_proc`):
  1. DELETE of rows absent from the batch, scoped to the batch's `disDate`s — a `NOT EXISTS` over `jsonb_array_elements` (~n² CPU, normally 0 rows).
  2. Parse + md5 hash + `DISTINCT ON` (CPU).
  3. `INSERT … ON CONFLICT ("deliveryNo","disDate") DO UPDATE … WHERE rowHash IS DISTINCT FROM EXCLUDED.rowHash` — ~100 unique-index probes. ⚠ **Inference to verify:** Postgres documents that with `ON CONFLICT DO UPDATE … WHERE`, rows not updated **are still locked**; a row lock sets `xmax` on the heap tuple, dirtying the page and writing WAL. If so, canon's "an unchanged row is not written at all" holds for tuples/index entries but **not for page dirtying/WAL** (~100 row locks × ~800–900 daytime cycles/day, EST).
  4. `mirror_heartbeat` UPDATE — **1 per call, 24/7 (~1,400/day)**, a new tuple version each time.
- EST ~4 statements/call ≈ 5.5k statements/day. Small in rows, but constant and write-bearing.
- ⚠ An obsolete copy that upserts straight into `/rest/v1/trip_report` with `merge-duplicates` still has working credentials on disk (TRIP_REPORT §7) — if anything ever starts it, it rewrites every row every cycle.

### Web push (`lib/push/send.ts:61-131`)

No timers; user-triggered only; no quiet-hours read. `sendToUser` = `push_subscriptions.findMany(userId, active)` + **one UPDATE per subscription on every send** (success stamps `lastSeenAt`/`failureCount`). Fan-out: assign → 1+S per bill; **done → `getPickingSupervisorUserIds()` + per supervisor (1+S)** ≈ 15–25 queries and ~6–16 row UPDATEs per pick done (EST); cancel 1; pick-delete 1; **Hand marks: orders × recipients `sendToUser` calls** (`lib/push/hand.ts:30-64`) — quadratic-ish for a bulk Hand. EST 3–6k queries/day, small indexed writes.

---

## F. Rough load model — ALL ESTIMATES

Assumptions (all estimates): non-admin users on a stale token, so **O ≈ 6** queries per API request; hide read = 1; visible tab, idle (no selection/panel); marker "changes" per hour: floor ~20, picking ~30, billing picking/print/telephonic ~5 each, mail-orders ~20, pick-delete ~10; pick-delete per call **k ≈ 20** CI look-ups and S ≈ a few thousand open SOs (**unknown — the biggest uncertainty, §I Q3**); floor `load()` ≈ board 45 + hold 15 + cancelled 18 + trips 12 = **90 + 4·O ≈ 115** statements; alt-tab `focus` on the billing desk ~60/h. **Hidden tab:** every hook stops (tint's 60 s interval ticks but no-ops) → **~0 queries/h**, then one burst on return (§A).

### Per screen, one tab

| Screen | Visible — queries/hour (EST) | Of which auth `O` | Hidden |
|---|---|---|---|
| **Floor** | marker 240×(3+6)=2,160 · **rail reload 120×115=13,800** · marker-driven reloads ~20×115=2,300 · trip detail re-runs if a trip is selected (+120×20) → **≈ 18,000 (≈ 20,000 with a trip selected)** | ≈ 4,300 (~24%) | ~0 |
| **Billing desk** (all keys) | **pick-delete 360×(~10+20+6)=13,000** · focus re-checks 60×36=2,200 · change re-checks 10×36=360 · picking/print/telephonic markers 120×(9+14+13)=4,300 · mail-orders marker 120×8=960 · lists on change ~1,000 → **≈ 21,000** | ≈ 6,500 | ~0 |
| **Picking supervisor** | 2 markers 240×(11+8)=4,600 · queue/tint refetch on change ~60×23=1,400 → **≈ 6,000** | ≈ 2,900 | ~0 |
| Picker phone | 240×11=2,600 + changes → **≈ 2,800** (phones mostly screen-off → hidden) | ≈ 1,450 | ~0 |
| Tint manager | marker 240×(3+6)=2,160 · **blind 60 s: 60×(~55+2·6)=4,000** · changes ~1,000 → **≈ 7,000** | | ~0 |
| Mail Orders (non-billing / table view) | marker 120×8=960 · list ~20×20=400 → **≈ 1,400** | ≈ 850 | ~0 |
| MRN supervisor / CI billing | 240×(~3+6) ≈ **2,200** each | | ~0 |

**Row volume matters more than statement count for Disk IO:** the pick-delete marker's in-memory `distinct` pulls every open `orders` row every 10 s; the floor board pulls the full board with ~17 relation statements every 30 s; `/api/floor/cancelled` scans all of `order_status_logs` every 30 s.

### Scenario: 10 Floor + 5 Picking + 4 Billing + 3 Mail Orders open all day (all visible)

| Screen | Tabs | Per tab/h | **Queries/h (EST)** | Rank |
|---|---|---|---|---|
| Floor | 10 | ~18,000 | **~180,000** | 1 |
| Billing | 4 | ~21,000 | **~84,000** (of which pick-delete ~62,000) | 2 |
| Picking (assume supervisor faces) | 5 | ~6,000 | **~30,000** | 3 |
| Mail Orders | 3 | ~1,400 | **~4,200** | 4 |
| **Total** | 22 | | **≈ 300,000/h ≈ 80–85 queries/s** — of which **auth overhead ≈ 75,000/h (~25%)** | |

### Scripts / background (EST, per day)

| Source | Queries/day | Character |
|---|---|---|
| Auto-Import v2 (if running) | 20–30k | per-row reads + `mo_orders.soNumber` scans |
| Auto-Import v3 (if running) | ~2–4k + auto-json bursts | ~430 likely `orders` seq scans (`obdEmailDate`) |
| NTS mirror | ~5.5k statements, 24/7 | ~1,400 heartbeat UPDATEs + possible row-lock page dirtying |
| Mail-order ingest | ~2–5k (+retry storms during outages) | full-table catalog reads, per-line inserts |
| Web push | ~3–6k | small indexed reads + UPDATE per send |
| Vercel crons | < 200 | negligible |

**Ranking by estimated DB work:** Floor tabs ≫ Billing desks (pick-delete) > Picking supervisors > Tint manager > Auto-Import (v2 ≫ v3) > Mail-order ingest ≈ NTS mirror ≈ push > Mail Orders tabs > crons.

---

## G. Top 10 suspects, ranked by estimated DB work

| # | Suspect | Evidence | Likely fix direction (one line) |
|---|---|---|---|
| 1 | **Floor blind 30 s full reload** (board + hold + cancelled + trips ≈ 90 statements + 4·O, per visible tab, whether or not anything changed; runs alongside a 15 s marker that already detects change) | `lib/floor/use-floor-rail-poll.ts:6,34`; `components/floor/floor-page.tsx:1976-1987`, `:510-515` | Drop the blind tick and let the marker drive `load()` (or slow it drastically). |
| 2 | **Pick-delete marker, 10 s + every window focus, unbounded** — in-memory `distinct` over every open `orders` row, twin lookup over every open SO, sequential `ci_returns` N+1, `orders.aggregate id IN (…)`. Shipped 2026-09-28, the day before the outage | `lib/billing/pick-delete.ts:79-89`, `:262-275`, `:402-412`; `components/billing/billing-marker-provider.tsx:57`; `billing-pick-delete-popup.tsx:83,95-105` | Bound the open set (date/stage) and make the marker a cheap aggregate; remove the focus trigger and the duplicate popup probe. |
| 3 | **Auth stale window never advances** → 2 × (2–3) `users`/`attendance_settings`(/`attendance_records`) reads + a permission read on **every** API request after minute 5 — ~25% of all app queries | `lib/auth.ts:20,150-167`; `lib/permissions.ts:668-671,823-849`; `node_modules/next-auth/lib/index.js:89-91`; `auth.config.ts:64-71` | Cache the flags per user in memory with a TTL (and/or dedupe `auth()` per request and pass the session into the resolver). |
| 4 | **`trips.findMany(tripsOnDeskWhere)` — carried arm has no lower date bound**, correlated EXISTS trips → drops → orders with `NOT IN` + nullable OR, in the 30 s trips feed, board arm 4 and the 15 s marker. Named in the 57014 log | `lib/trips/queries.ts:807`; `lib/trips/live-trips.ts:68-72,115-123`; `lib/floor/queries.ts:321-330` | Bound the carried arm (e.g. last N days) or keep a denormalised "trip has open bills" flag. |
| 5 | **`floorBoardWhere` grows forever** — arm 3 keeps every checked-but-not-on-an-Orbit-trip bill "whatever day it was checked", and nothing writes `dispatched`; arm 1 subqueries unindexed `pick_assignments.checked_at`. Feeds the 15 s floor marker (`orders.aggregate`, 22 errors) and the board | `lib/floor/queries.ts:204-211,425-437,479-495`; FLOOR_TRIPS §14 | Give arm 3 a horizon / get a `dispatched` writer; index `pick_assignments(checked_at)`. |
| 6 | **`/api/floor/cancelled` scans all of `order_status_logs`** (`toStage`+`createdAt`, no index) every 30 s per floor tab (17 errors in the log) | `lib/floor/queries.ts:1386`; `prisma/migrations/phase2_import_tables.sql:283` | Index `order_status_logs("createdAt")` / `("toStage","createdAt")`. |
| 7 | **Tint manager double poll** — 15 s marker + blind 60 s refetch of a ~50-statement, 6-way `Promise.all` endpoint | `components/tint/manager/use-tint-manager-sync.ts:42,72-79`; `app/api/tint/manager/orders/route.ts:119-497` | Drop the blind 60 s tick (marker-driven only). |
| 8 | **Pool amplifier:** `connection_limit=1` per lambda, Supavisor pool 15, 4 parallel client fetches per floor `load()`, Promise.all fan-outs server-side, no `pool_timeout` override → under slow IO every poll queues, times out at 10 s and is retried by the next tick | `.env*` `pgbouncer=true&connection_limit=1`; `floor-page.tsx:510-515`; CORE §4 pool size 15 | Cut request concurrency (fewer parallel feeds / one combined feed) rather than raising the limit. |
| 9 | **Billing desk timer stack** — 5 timers (14 marker req/min) + tab-bar/popup re-probing the same marker on every change + telephonic marker aggregating over an ever-growing id list | `billing-marker-provider.tsx:47,57`; `billing-tab-bar.tsx:110,131,159`; `lib/billing/telephonic.ts:444-474` | One combined billing marker; re-use the provider's answer instead of re-fetching. |
| 10 | **Depot callers:** Auto-Import `day-obds` ~430×/day on unindexed `orders.obdEmailDate` (v3) or ungated per-row `patch-headers` every 10 min (v2); mail parser re-POSTs a failed email every 10 s during an outage | `app/api/import/obd/route.ts:4663-4668,4314-4372`; `docs/Powershell/Auto-Import-v3.ps1:1308`; `Auto-Import-v2.ps1:1610-1617`; `docs/Parser/Parse-MailOrders-V7.ps1:2503-2505` | Index `orders("obdEmailDate")`; add backoff to the parser's failed-POST retry. |

Honourable mention (not ranked — needs live proof): NTS mirror row-locking on unchanged rows + 1,400 heartbeat UPDATEs/day, 24/7 (§E).

---

## H. Doc / code disagreements (code wins)

1. **Crons: three, not two.** `vercel.json` has `/api/cron/load-plan-snapshot` at `30 15 * * *` (21:00 IST). CORE §4 ("2 daily cron jobs … re-read 2026-09-19: unchanged"), ATTENDANCE §11 ("2 daily schedules") and FLOOR_TRIPS §10 ("vercel.json holds two attendance crons only") are stale.
2. **BILLING §8 lists two marker providers; code has four** (+ Telephonic 30 s, + Pick-delete **10 s**) **plus the popup's focus-triggered probe** (`billing-marker-provider.tsx`, `billing-pick-delete-popup.tsx`).
3. **FLOOR §5 "the 15s marker pauses while the panel is open or in History"** — it does not stop polling; `usePickingMarker` keeps probing and only defers `onChange` (`use-picking-marker.ts:300-302`). PICKING §10's hook contract states this correctly ("while `paused` keeps tracking").
4. **CORE §3 / PICKING §10: the picking marker is "`COUNT` + `MAX(orders.updatedAt)`"** — since `8a54446c` it also aggregates `pick_delete_decisions` (and `countHeldBackWaiting` when the gate is on). Same for the floor marker (FLOOR §5 describes `{count, latest}` over the orders predicate only).
5. **`lib/picking/duplicate-so.ts` header says it is "BOUNDED ON PURPOSE … never about the whole table"; `lib/billing/pick-delete.ts:73-78` says "two bounded steps, never a scan of the whole orders table".** `getOpenGroups` feeds it every open SO with no date bound, and Prisma 5 performs `distinct` in memory — the scan the header forbids.
6. **CORE §7.12's list of `orders` secondary indexes omits** `orders_workflowStage_idx`, `orders_dispatchStatus_idx`, `orders_orderType_idx`, `orders_batchId_idx`, `orders_customerId_idx` (committed in `prisma/migrations/phase2_*.sql`; live state unverified).
7. **`lib/auth.ts:15-20` describes a working 5-minute stale window; in practice it never advances** (§C). `lib/auth.ts:70` "Mirror of the middleware gate logic" is stale — the middleware attendance gate was removed (`236f9743`).
8. **CORE §4 records Supavisor pool size 15 but not the app's `connection_limit=1`** or the absent `pool_timeout` — both material to the P2024 signature.
9. **TRIP_REPORT §2.2 "an unchanged row is not written at all"** — true for tuples/index entries; possibly not for page dirtying/WAL under `ON CONFLICT … DO UPDATE … WHERE` row locking (inference, §I Q9).
10. **`lib/prisma.ts:15` comment "Disable prepared statements"** has no corresponding option (the URL flag does it).
11. **Sub-sweep error, corrected:** one sweep reported `components/admin/operations-overview.tsx` as a live 60 s poll with no visibility pause. It has **zero importers** — dead code, no load.
12. **My own interim chat remark was wrong:** I said `orders` had no index on `workflowStage`/`dispatchStatus` after checking only `schema.prisma`. Committed SQL creates both (`phase2_import_tables.sql:281-282`). Stated here so it is not quoted forward.

---

## I. Open questions only the live database can answer (SQL checks for recovery)

🔴 **Run Q1 BEFORE any Supabase restart** — a restart wipes `pg_stat_statements` and `pg_stat_user_tables` (CORE §4; that is how 2026-09-07 stayed unexplained). All read-only; run when throughput allows.

1. **Query diary:** `SELECT query, calls, total_exec_time, mean_exec_time, rows, shared_blks_read, shared_blks_hit, shared_blks_dirtied, shared_blks_written FROM pg_stat_statements ORDER BY shared_blks_read DESC LIMIT 50;` — repeat ordered by `total_exec_time` and by `calls`. Save to a file. Confirms/refutes suspects 1–7 directly.
2. **Auth overhead proof:** in the same view, `calls` for the `users` select of `attendanceTestUser, attendanceExempt, attendanceConsentVersion, isSuperuser` and for `attendance_settings … scope = 'GLOBAL'` — if either is in the top 10 by calls, §C is confirmed live.
3. **Size of the pick-delete / floor-arm-3 open set:** `SELECT "workflowStage", count(*), count(DISTINCT "soNumber") FROM orders WHERE "isRemoved" = false GROUP BY 1;` and `SELECT count(*) FROM orders WHERE "workflowStage"='pick_checked' AND "dispatchStatus"='dispatch' AND "tripDropId" IS NULL AND "isRemoved"=false;`
4. **Live indexes:** `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('orders','pick_assignments','order_status_logs','mo_orders','mo_order_lines','tint_assignments','order_splits','import_raw_summary','mo_customer_keywords','trips','trip_drops','ci_returns','so_tag_matches') ORDER BY 1,2;`
5. **Scan counters:** `SELECT relname, seq_scan, seq_tup_read, idx_scan, n_live_tup, n_tup_upd, n_tup_hot_upd, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY seq_tup_read DESC LIMIT 25;`
6. **Cache fit:** `SHOW shared_buffers;` + `SELECT sum(heap_blks_hit)/nullif(sum(heap_blks_hit+heap_blks_read),0) FROM pg_statio_user_tables;` + total DB size — plus the compute tier and its Disk IO baseline/burst figures from the Supabase dashboard (not SQL).
7. **Plans under cold cache:** `EXPLAIN (ANALYZE, BUFFERS)` of the floor marker aggregate, the trips feed `tripsOnDeskWhere`, `getOpenGroups`' DISTINCT, the `order_status_logs` cancelled query, and `day-obds`' `obdEmailDate` query.
8. **Which `orders.aggregate` / `trips.findMany` hit 57014:** the Postgres log (`log_min_duration_statement = 2000` is on, CORE §4) around 2026-09-29 14:45–15:10 UTC — statement text and duration.
9. **Mirror write cost:** `pg_stat_user_tables` `n_tup_upd` / `n_tup_hot_upd` for `trip_report` and `mirror_heartbeat`; `pg_stat_statements` `shared_blks_dirtied` for `mirror_trip_report_today`; spacing of `mirror_heartbeat."lastRunAt"` (one instance or two?).
10. **Auto-Import version:** `import_batches` gaps today (1-minute gaps ⇒ v3; fixed ~10-min ⇒ v2) and `day-obds`' call count in `pg_stat_statements`.
11. **Concurrency at peak:** `SELECT state, count(*), max(now()-query_start) FROM pg_stat_activity GROUP BY 1;` during a busy hour — how close the app runs to Supavisor's 15.
12. **Table sizes that drive scans:** row counts of `order_status_logs`, `pick_assignments`, `so_tag_matches`, `mo_orders`, `mo_order_lines`, `trips`.
13. **Live triggers:** `SELECT event_object_table, trigger_name, action_timing, event_manipulation FROM information_schema.triggers WHERE trigger_schema='public';`
14. **09-07 comparison (Vercel, not SQL):** request counts per route per hour on 09-07 vs 09-28/29, to separate the old-mirror load (present 09-07, gone now) from pick-delete (absent 09-07, present now).
