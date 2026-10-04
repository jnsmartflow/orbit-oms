# CLAUDE_FREIGHT_TRIPS.md — Freight Trips (report-only paper trips over held bills)
# v1.1 · Schema v27.55 · October 2026 · updated 2026-10-04 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md + docs/CLAUDE_FLOOR.md

Written from the code at `fa6e5c8d` and the owner's live hand-test of 2026-10-03. Discovery drafts are
history; where a draft and the code disagree, the code (and this file) win.

---

## 1. What it is, and the ownership boundary

A **freight trip** is a PAPER trip for the freight / MIS report. An operations user groups **held** bills
into a freight trip with its own vehicle, transporter and driver. Nothing physical moves and nothing on the
floor changes: the bills stay held, the floor never sees a freight trip. A future freight report will read
"if a bill is on an active freight trip, use that trip's vehicle; otherwise use its real Orbit trip" (§10).

Every freight trip has its own number: `F-261003-02` (§4).

### What this file owns

| Owned here | Where |
|---|---|
| The tables `freight_trips`, `freight_trip_bills`, `freight_trip_activity` | §3 |
| `lib/freight-trips/*` (activity, bills, format, gate, number, options, pool, queries, status, vehicle + `format.test.ts`) | §6, §9 |
| `/api/freight-trips/*` — 7 route files | §6 |
| The `/freight-trips` screen: `app/(freight)/freight-trips/*`, `components/freight-trips/*` | §7 |
| The page key `freight_trips` and where it is wired | §8 |
| Numbering `F-YYMMDD-NN` | §4 |

### What it does not own (cross-reference only)

| Behaviour | Owner |
|---|---|
| WHICH bills are held: `floorHoldWhere`, `getFloorHold` (incl. its `extraWhere`), the hide exclusion, held-since / held-from / held-by | `CLAUDE_FLOOR.md` §3, §4.5, §4.10 |
| The shared held-bills table `components/floor/hold-table.tsx` | `CLAUDE_FLOOR.md` §4.10 |
| Floor's own trips (`trips`, `trip_drops`, `trip_activity`, `/api/floor/trips/*`) | `CLAUDE_FLOOR_TRIPS.md` |
| The NTS trip mirror (`trip_report`, `/trips`) | `CLAUDE_TRIP_REPORT.md` |
| Route clubs (`getRouteClubs`, `lib/floor/route-clubs.ts`) | `CLAUDE_FLOOR.md` §2.1, CORE §7.17 |
| The freight / MIS report | **not built** — §10 |

⚠ **Three systems carry the word "trip"** and share no table: Floor trips (`trips`), the NTS mirror
(`trip_report`) and Freight trips (`freight_trips`). A freight trip is never a Floor trip and is never
linked to one (owner decision: every freight trip is fresh).

---

## 2. The rule — paper only

🔴 **Freight code NEVER writes `orders`, `trips`, `trip_drops`, `trip_activity` or `order_status_logs`.**
It writes `freight_trips`, `freight_trip_bills` and `freight_trip_activity` only. A held bill stays held,
keeps its Floor trip pointer, and gets no log row. The floor, picking and billing screens never read a
freight table.

Proof in code — the isolation grep used at every freight commit (empty, two methods):
`grep -rnE "prisma\.(orders|trips|trip_drops|trip_activity|order_status_logs)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|executeRaw" lib/freight-trips app/api/freight-trips`.
The writes that exist: `freight_trips.create/update`, `freight_trip_bills.create/updateMany`,
`freight_trip_activity.create`.

**Live proof (owner hand-test, 2026-10-03).** Two freight trips were created — `F-261003-01` (1 bill) and
`F-261003-02` (23 bills). The held pool fell 182 → 158. A read-only SQL over all 24 bills showed: every one
still `dispatchStatus = 'hold'`; `tripDropId` unchanged (0 changed); **0** `orders` rows updated after the
bill's `addedAt`; **0** `order_status_logs` rows after `addedAt`. Edit, remove and cancel were also tested
by the owner.

---

## 3. Schema (Schema v27.51 — CORE §7 chain)

Created by `sql/2026-10-02-freight-trips.sql` (run live 2026-10-02 by Smart Flow; the discovery §H DDL,
unchanged; verified 3 tables · 23 constraints · 10 indexes). Hand-mirrored in `prisma/schema.prisma`.

### 3.1 `freight_trips` (17 columns)

`id` · `tripNumber` · `tripDate` (date) · `seq` · `vehicleId?` → `vehicle_master` · `adhocVehicleNo?` ·
`transporterId?` → `transporter_master` · `driverName?` / `driverPhone?` (**snapshots**) · `note?` ·
`manualDispatchAt?` (timestamptz(6), **v27.55**) ·
`status` (default `'active'`) · `cancelledAt/ById` (SET NULL) · `createdAt/ById` · `updatedAt`.

**`manualDispatchAt`** (Schema v27.55, 2026-10-04; live: `timestamp with time zone · 6 · YES`) — the planner's
dispatch date + time, IST. Nullable in the DB (older trips stay blank, no backfill) but **required on every save**:
`POST /api/freight-trips` refuses a create without it and `PATCH /api/freight-trips/[id]` refuses a save whose
RESULTING value would be null — with or without a vehicle. Sent as `…+05:30` and parsed by `parseManualDispatchAt`
(`lib/trips/diesel-dispatch.ts`, the Floor rule). The coming **Freight Report** reads Dispatch Date / Time from it.
It is report data only: it moves no status. There is **no diesel** on a freight trip.

| Constraint / index | Text |
|---|---|
| `freight_trips_tripNumber_key` | UNIQUE (`tripNumber`) |
| `freight_trips_tripDate_seq_key` | UNIQUE (`tripDate`, seq) — FULL, so a number is never reused (§4); its index serves the date list |
| `chk_freight_trips_status` | `status IN ('active','cancelled')` |
| `chk_freight_trips_seq_positive` | `seq >= 1` |
| `chk_freight_trips_number_shape` | `"tripNumber" = 'F-' \|\| to_char(("tripDate")::timestamp with time zone, 'YYMMDD') \|\| '-' \|\| lpad(seq::text, greatest(2, length(seq::text)), '0')` |
| `chk_freight_trips_vehicle_one_of` | `NOT ("vehicleId" IS NOT NULL AND "adhocVehicleNo" IS NOT NULL)` |
| `chk_freight_trips_cancelled_complete` | `status <> 'cancelled'` OR both `cancelledAt` and `cancelledById` set |

### 3.2 `freight_trip_bills` (8 columns) — membership

`id` · `freightTripId` → `freight_trips` **RESTRICT** · `orderId` → `orders` **RESTRICT** · `addedAt/ById` ·
`removedAt/ById` (SET NULL) · `removedReason` (`removed` | `trip_cancelled`).

🔴 **`freight_trip_bills_order_active_key` — UNIQUE INDEX ("orderId") WHERE ("removedAt" IS NULL)**: one
bill on at most ONE active freight trip, enforced by the database. **Per OBD (`orderId`), not per
invoice** — `orders.invoiceNo` is nullable and not unique, so an invoice key would not hold. It is a partial
index and is **not** modelled as `@@unique` in Prisma (a comment says so). A P2002 from it reports
`meta.target = ["orderId"]`; `lib/freight-trips/bills.ts` turns it into "Already on F-… — remove it first".

Rows are **never deleted**: removing a bill stamps `removedAt/ById/Reason='removed'`; cancelling a trip
stamps every active row `'trip_cancelled'`. The index only sees active rows, so a removed or freed bill can
join another trip at once while its history stays. Also `chk_freight_trip_bills_removed_reason` and
`chk_freight_trip_bills_removed_complete`; indexes `freight_trip_bills_freightTripId_idx`,
`freight_trip_bills_orderId_idx`.

### 3.3 `freight_trip_activity` (7 columns)

`freightTripId` → `freight_trips` **RESTRICT**, `action`, `actorId` → users, `summary`, `detail jsonb?`,
`createdAt`. `chk_freight_trip_activity_action`: the six actions in §6. Indexes
`freight_trip_activity_freightTripId_createdAt_idx`, `freight_trip_activity_created_idx`.

Relations, named on both sides: `FreightTripCreatedBy`, `FreightTripCancelledBy`,
`FreightTripBillAddedBy`, `FreightTripBillRemovedBy`, `FreightTripActivityActor`, `FreightTripBillOrder`.

### 3.4 No live-feed trigger — on purpose

The three tables have **no** `live_changes` trigger (CORE §13 records the exception). The generic trip
trigger would publish freight ids as `entity='trip'` into Floor's feed, where they are a different id space.
The screen polls `GET /api/freight-trips/marker` every 30 s instead (§6).

---

## 4. Numbering — `F-YYMMDD-NN`

`lib/freight-trips/format.ts` (pure, client-safe) formats; `lib/freight-trips/number.ts` allocates.

- **YYMMDD** from the trip's `tripDate` with UTC getters (it is a `@db.Date`).
- **NN** padded to at least two digits, never truncated (seq 137 → `137`) — matches the CHECK's
  `greatest(2, length)` pad. `format.test.ts` covers 01, 100, 137 and bad dates.
- **seq = MAX(seq) + 1 over ALL freight trips of that date, cancelled included.** A number is never reused:
  a printed `F-261003-02` always means one trip. (Floor trips reuse a cancelled number; freight does not.)
- **Race:** allocate → insert → on P2002 (either unique) re-allocate and retry **once**. Never a loop,
  never `$transaction`.
- **Own allocator**, deliberately not `lib/trips/number.ts` (that one owns L/U/I/C, reuses numbers, and
  writes `trips`).
- The date comes from the New trip drawer's **Trip date** (default today IST). It cannot change afterwards.

---

## 5. The pool — which held bills can go on a freight trip

`lib/freight-trips/pool.ts` → `getFloorHold("All", …, extraWhere = { freightTripBills: { none: { removedAt: null } } })`
— Floor's own held set (`floorHoldWhere` + the hide exclusion), imported read-only, minus bills already on an
ACTIVE freight trip. Same mechanism the Tint Manager's Hold tab uses (`{ orderType: "tint" }`).

- **Held bills already on a Floor trip still appear** (nothing reads `tripDropId`).
- Each row gains `routeId` and `stopKey` (`computeDropKey`) from ONE extra batched read in `pool.ts`
  (`getFreightPoolRows`), additive — `getFloorHold` is not touched. The pool route also returns Floor's route
  clubs (`getRouteClubs`, read-only).
- **A bill released on Floor while on a freight trip STAYS on it** (owner decision). The trip view lists it
  with "Released on floor" and still counts it (`currentlyHeld = false`, `lib/freight-trips/queries.ts`).
- `isRemoved` bills are dropped at read time and never counted.
- **Adding** a bill requires it to exist, not be removed, and be held **right now** (`dispatchStatus = 'hold'`).

---

## 6. Routes and the activity log

Every route: `export const dynamic = "force-dynamic"`, gate `freightGate` (`lib/freight-trips/gate.ts`) on
page key **`freight_trips` only — never `floor`**, sequential awaits, no `$transaction`.

| Route | Method | Gate | Writes |
|---|---|---|---|
| `/api/freight-trips` | GET (no `date` = every trip, any date; `?date=` = that day) | canView | — |
| `/api/freight-trips` | POST create `{tripDate, manualDispatchAt, vehicleId? \| adhocVehicleNo?, transporterId?, driverName?, driverPhone?, note?, orderIds?}` — `manualDispatchAt` required | canEdit | `freight_trips` + bills via the add path + activity |
| `/api/freight-trips/options` | GET | canView | — (vehicles; transporters `isRealTransporter && isActive`, else all active with `transportersFallback: true`) |
| `/api/freight-trips/pool` | GET | canView | — |
| `/api/freight-trips/marker` | GET | canView | — (`{count, latest}` over freight tables + the held set) |
| `/api/freight-trips/[id]` | GET | canView | — |
| `/api/freight-trips/[id]` | PATCH vehicle / plate / transporter / driver / note / `manualDispatchAt` | canEdit | `freight_trips`; refuses a cancelled trip (409) and a save that leaves `manualDispatchAt` null (400) |
| `/api/freight-trips/[id]/bills` | POST `{action: add\|remove, orderIds}` | canEdit | `freight_trip_bills`; refuses a cancelled trip (409); returns per-bill `skipped` reasons |
| `/api/freight-trips/[id]/cancel` | POST | canEdit | activity → ONE `updateMany` (`trip_cancelled`) → trip `cancelled` + stamps; idempotent |

**Snapshots.** A master vehicle's driver is copied onto the trip; a **typed** driver name / phone wins
(also for an ad-hoc plate). A supplied transporter wins over the vehicle's. A vehicle change on PATCH
re-snapshots the driver unless driver fields are sent.

**Activity** (`lib/freight-trips/activity.ts`, one writer, one row per press, swallows its own failure):
`created`, `bills_added`, `bills_removed`, `vehicle_changed`, `details_changed`, `cancelled` —
`FREIGHT_ACTIONS` in `lib/freight-trips/status.ts`, the TypeScript twin of the CHECK.

---

## 7. The screen — `/freight-trips`

`app/(freight)/freight-trips/layout.tsx` (canView) + `page.tsx` (resolves canEdit server-side; every write
control is hidden without it). Composition root `components/freight-trips/freight-trips-page.tsx`.

- **Top bar** (`search-bar.tsx`): ONE search box, top right, **Billing's** look (copied from
  `components/universal-header.tsx`'s wide box): "Search name, OBD or invoice…", "/" hint chip, "/" focuses
  it (not while typing or with a drawer / modal open). Runs on **Enter**; ✕ clears; "{n} matches" to its
  left. Matching (`search.ts`) reuses `lib/floor/search.ts` read-only (OBD full / tail, invoice full /
  `I`-as-`1` / 5+ tail, SO, ship-to name, route; a pasted list matches any number) and adds the **bill-to
  name**. **NOT `<UniversalHeader />`** — a named exception (CLAUDE_UI §6).
- **Rail** (`freight-rail.tsx`): the title "Freight Trips" + "Report only — the floor never sees these";
  "{n} TRIPS · {m} BILLS"; the **Held bills** card; **every active freight trip, any date** (newest
  `tripDate` first), each card: number chip + trip date, main route or "Empty trip", stops · bills · L,
  vehicle, driver or "No driver yet" (warn). "Cancelled (n)" opens a read-only list. With bills ticked, a
  click on a trip card ADDS them.
- **Held pool = delivery-type cards** (`route-cards.tsx`, mockup `docs/mockups/freight-trips/held-cards.html`
  — copied from the Floor All-tab mockup `docs/mockups/floor-trips/floor-all-tab-final.html`, minus every
  status bit). One card each: Local and Upcountry always (empty → "No held bills" / "No matches"),
  IGT / Cross only with bills, an amber read-only **No route** card only when needed. Head: type dot(s),
  name, kg, stops · L, "+N Hand · kg — not counted", a neutral "{n} bills" in the ring's slot. Rows: one per
  route club with held bills ("Other routes" for the rest). Club rules **copied** from Floor's
  `components/floor/route-cards.tsx` (it is typed to board rows and draws a status bar).
- **Drill-in** (`pool-view.tsx`), the look of Floor's By route open card: a strip of **club tabs** (selected
  = brand + ✕ = back; "Esc to go back to cards"); the club's bills in **route sections** (select-all for the
  route) and, inside each, **bands by invoice date, OLDEST first** ("06 Aug 2026 · n bills · L · kg", own
  select-all), each the shared `HoldTable`; "No invoice yet" last (by OBD date). A card head opens its first
  club tab.
- **Trip view** (`trip-view.tsx`): number, route, vehicle · transporter · driver, ✎ edit, ··· → Cancel
  (in-app confirm), "+ Add bills" (an add band over the pool), bills under numbered stops.
- **Bottom bar**: the shared `FloorActionBar` shell (`components/floor/floor-action-bar.tsx`) — + New trip /
  Add to F-… / Remove from trip, with L and kg; API skips shown as a toast.
- **Drawer** (`trip-drawer.tsx`): Trip date (new only), **Manual dispatch time** (required — date defaults to today
  IST, time empty, 5-minute steps; edit pre-fills the saved value in IST; Save stays disabled with the inline error until
  both are set — the shared `components/trips/manual-dispatch-field.tsx`), vehicle from options **or** a typed plate,
  transporter (notes the all-transporters fallback), driver name / phone (prefilled, editable), note. The trip view shows
  "Dispatch 4 Oct, 6:40 pm" under the vehicle line when set; the history names it "Dispatch time".
- Ticks live in the page: they survive card ↔ drill-in ↔ tab switches and a search.
- Every network call is in `components/freight-trips/api.ts` and goes to `/api/freight-trips/*` only.

---

## 8. Access

Page key **`freight_trips`** (`lib/permissions.ts`): in the `PageKey` union and `ALL_PAGE_KEYS`;
`ACTION_PAGES.canEdit`; `PAGE_NAV_MAP` (→ `/freight-trips`, placed after `ci`); `ACCESS_SECTIONS`
"Operations"; `ICON_MAP` → `ReceiptText` (`components/shared/role-sidebar.tsx`). canView = read; canEdit =
every write. Granted per user (`user_page_access`), never seed.

Grants: the SQL is recorded in `sql/2026-10-02-freight-trips-grants.sql` (dense all-false rows for every
active user, then view + edit for users 1, 32 and 20). ⚠ Its live run status was **not stated** in the
2026-10-03 docs prompt (the access line was left as a placeholder) — confirm with the file's read-only
SELECT before relying on it. The owner's live hand-test proves nothing here: a superuser passes every gate
without a tick.

---

## 9. Landmines

1. **The orders-write ban** (§2). Any new freight path must pass the isolation grep. A freight action that
   wrote a bill would put freight on the floor.
2. **No live-feed trigger** (§3.4). Do not "complete" CORE §13's trigger list by adding freight tables.
3. **The partial unique is not in Prisma** (§3.2). Never model it as `@@unique([orderId])` — that would
   forbid re-planning a bill after removal.
4. **`<UniversalHeader />` exception** — `/freight-trips` hand-rolls its top bar (CLAUDE_UI §6). Do not
   "fix" it back.
5. **Search covers the held pool only** — not the bills inside an open trip.
6. **Hand bills** are listed but left out of L / kg (card heads, route sections and invoice-date bands),
   Floor's rule.
7. **`transportersFallback`** — no transporter is marked `isRealTransporter` until someone does; the list
   then shows every active transporter, flagged.
8. **Numbers are never reused** (§4) — unlike Floor trips. Do not copy Floor's `-C` rename here.
9. **Floor files are imported read-only, never edited**: `getFloorHold`, `floorHoldWhere`, `HoldTable`,
   `lib/floor/search.ts`, `getRouteClubs`, `computeDropKey`, `FloorActionBar`. The club and card rules are
   COPIES — if Floor's rules change, update `route-cards.tsx` by hand.

---

## 10. Open items

1. **The freight / MIS REPORT is not built.** Rule (owner): if a bill is on an ACTIVE freight trip, the
   report uses that trip's vehicle / transporter / driver; otherwise its real Floor trip. ⚠ The existing
   Trip Detail export **excludes held bills** (`lib/reports/trip-detail-data.ts`, its hold filter) — the
   freight bills are exactly those, so the report needs freight as a second source, not just an override.
2. **Phone width untested.**
3. **Held-from / held-by are not searchable** (ROADMAP).
4. The import / hold items parked during this build (enrichment overwrite, split, who-held stamps,
   `changedById = 1`, doc drift) → `docs/ROADMAP.md` → *Hold / import — parked during the Freight Trips build*.

---

*CLAUDE_FREIGHT_TRIPS.md v1.1 · Schema v27.55 · OrbitOMS · updated 2026-10-04 — **v27.55:** `freight_trips.manualDispatchAt`, required on every create and edit save (§3.1, §6, §7). Prior, v1.0 (2026-10-03) — first canonical file for
Freight Trips. Written from the code at `fa6e5c8d` (commits e1da66f0, efd397c4, 876acb50, c430208e,
e4115e78, 6e459c1d, ff5ed9d4, 0d0de6a4, 50048416, a3c050cb, 21aca46e, fa6e5c8d) and the owner's live
hand-test of 2026-10-03.*
