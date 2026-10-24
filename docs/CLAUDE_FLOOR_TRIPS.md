# CLAUDE_FLOOR_TRIPS.md — Floor Trips (Orbit's own truck plan)
# v1.4 · Schema v27.74 · October 2026 · updated 2026-10-24 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md + docs/CLAUDE_FLOOR.md

Trip tables / new columns were live-verified 2026-09-18; columns added since are CORE §7.16 and the §7 chain (v27.41, v27.53, v27.54, v27.56, v27.66, v27.69, v27.71, v27.73, v27.74). Reconciled against CORE v150 (Schema v27.74) on 2026-10-24. **Since v27.66 a bill's trip membership lives on its INVOICE ROWS** (`order_invoices."tripDropId"`) — `CLAUDE_ORDER_INVOICES.md`; an unsplit bill behaves exactly as before.

---

## 1. What it is, and the ownership boundary

A **trip** is one truck load that Orbit plans on `/floor`. The planner creates it, puts bills on it
(each customer becomes one **drop**, or stop), sets a vehicle, shows it to the floor and sends it to
billing. Every trip has its own number: `L-260918-03` (type letter, date, sequence).

This is **not** the NTS trip mirror. See §2 before touching anything named "trip".

### What this file owns

| Owned here | Where |
|---|---|
| The tables `trips`, `trip_drops`, `trip_activity` and `trip_redeliveries`, the `app_settings` row `picking.visibilityGate`, and the trip columns on `orders` / `transporter_master` | §3 |
| `lib/trips/*`: all 21 files (the load-plan engines inside it are `CLAUDE_FLOOR.md §2.2`'s) | §16 |
| `/api/floor/trips/*` (11 route files) and `/api/floor/pick-gate` | §10 |
| Trip numbering, the cancelled `-C` rename and number reuse | §5 |
| Type choice for a mixed selection, and which trips a delivery-type tab lists | §6 |
| The drop key and stop order; add / remove / **move** bills — HOW the trip routes use the one trip writer (`setRowsTrip`) | §7, §7.1 |
| Which trips a desk is about (`lib/trips/live-trips.ts`) | §8 |
| The activity log and its 18 actions | §9 |
| **Re-deliveries** (`trip_redeliveries`, `lib/trips/redelivery.ts`, `/api/floor/trips/[id]/redeliveries`) | §12b |
| Hand trips, vehicle size, diesel and the manual dispatch time (the trip side) | §3.1, §4 |
| The pick visibility gate ("desk control"): the key, `/api/floor/pick-gate`, `lib/picking/visibility-gate.ts`, and Show to floor | §11 |
| Send to billing and its take-back (the trip side) | §12 |
| The rule that no trip action changes a bill's status or hold | §13 |

### What it does not own (cross-reference only)

| Behaviour | Owner |
|---|---|
| The `/floor` screen shell (`TripDesk` layout, the pool, the table, tabs, detail panel), the board predicate `floorBoardWhere` and its four arms, the bill actions (hold / cancel / release / change-slot), and Floor live sync | `CLAUDE_FLOOR.md` §2–§5 |
| The Billing **Print** tab that consumes Send to billing: `billing_print`, `/api/billing/print/*`, the copy rules (per invoice row since v27.74 — `trip_bill_copies`), `billingCopiedAt` / `billingDoneAt` writes | `CLAUDE_BILLING.md` §7 |
| **Invoice rows**: `order_invoices` (the dispatch unit), the derived OBD columns (`orders.tripDropId`, `partlyOnTrip`, the done rule), the single writers (`setRowsTrip` — its contract; hold; dispatched), the per-invoice plan modules | `CLAUDE_ORDER_INVOICES.md` (§3, §4) |
| Trip Sheets and their per-group WhatsApp share (`lib/trip-sheet/*`, `trip_share_log` v27.71) — read trips, never write one | schema CORE §7.16; screen: see §16 |
| The NTS mirror: `trip_report`, `/trips`, `/api/trips`, the puller | `CLAUDE_TRIP_REPORT.md` |
| The reports that READ `trips` (Trip Detail, Freight Report, Old Format, and **NTS Trips** — one row per Nagadhiraj (`transporterId = 4`) trip, by `createdAt`, also printing `dieselAmount` and `note`, 2026-10-09; `lib/reports/nts-trips-data.ts`). Read-only; no report writes a trip | `CLAUDE_CORE.md` §12 Reports |
| **Applying** the gate: `buildPickingWhere` ORs `waitingBranchWhere(gateOn)` into the Assign tab (`lib/picking/queue.ts:398`), the held-back band, the picking marker | `CLAUDE_PICKING.md` §5, §10. This file owns the gate's **definition** (the key, the predicate, the count); Picking owns where it is applied |
| The stage ladder and `lib/workflow-stages.ts` | `CLAUDE_PICKING.md` §2 |
| `checkAnyPermission`, `PageKey`, per-user access | `CLAUDE_CORE.md` §5 |
| Soft-delete reads, the `$transaction` ban, `force-dynamic`, the status-string rule | `CLAUDE_CORE.md` §3 |

The trip components under `components/floor/` (`trip-*.tsx`, `pick-gate-toggle.tsx`,
`floor-bottom-bar.tsx`) are drawn inside the Floor shell. This file records only what they do to a
trip: which route they call and which trip rule they apply.

---

## 2. The naming collision

THREE separate systems carry the word "trip" and share no table. The code keeps them apart on purpose.
*(This said "two" until 2026-10-03.)* The third, **Freight trips** (`freight_trips` / `freight_trip_bills` /
`freight_trip_activity`, `/api/freight-trips/*`, page key `freight_trips`), is a report-only PAPER trip over
held bills: it never writes `trips`, `trip_drops`, `trip_activity` or any bill, and is never linked to an
Orbit trip — owned by `CLAUDE_FREIGHT_TRIPS.md`. The table below covers the first two.
`app/api/floor/trips/route.ts:15-23`: *"WHY THIS IS NOT `/api/trips`. That address is TAKEN, and by
something live … the read-only NTS Trip Report mirror … nothing reconciles them."*

| Name | What it is | Owner |
|---|---|---|
| `trips` table (+ `trip_drops`, `trip_activity`) | Orbit's own truck plan | this file |
| `/api/floor/trips/*` | API for the `trips` table (page key `floor`) | this file |
| `lib/trips/*` | Orbit trip logic | this file |
| `TripReport` model / `trip_report` table | NTS mirror, fed by the puller | `CLAUDE_TRIP_REPORT.md` |
| `/trips` page, `/trips/[tripNo]/sheet` | NTS mirror UI (page key `trip_report`) | `CLAUDE_TRIP_REPORT.md` |
| `/api/trips`, `/api/trips/[tripNo]` | NTS mirror API | `CLAUDE_TRIP_REPORT.md` |
| `lib/trip-report/*`, `components/trip-report/*` | NTS mirror code | `CLAUDE_TRIP_REPORT.md` |

Traps:
- `trips.tripNumber` (Orbit, `L-260918-03`) and `trip_report.tripNo` (NTS) are different id spaces.
  `GET /api/floor/trips/[id]` is keyed on Orbit's integer id; `/api/trips/[tripNo]` on the NTS number
  (`app/api/floor/trips/[id]/route.ts:24-27`).
- `trips.transporterTripNo` is **free text**: the carrier's own docket. It is not unique, not
  validated, and not a key into `trip_report` (`prisma/schema.prisma:3240-3244`).
- `lib/trips/drop-key.ts:3-5` borrows `CLAUDE_TRIP_REPORT.md` §4's rule "Drops = unique customers" as
  Orbit's stop identity. A change to that rule there does not change the code here.
- `scripts/backfill-nts-trips-2026-09-11.ts` (bf14cb51) **read** `trip_report` once to create Orbit
  trips for bills that had shipped on NTS trucks. It is the only data bridge, and it was a one-time run.
  It writes trips, drops and `orders.tripDropId` only, and no stage (`:30-37`).

---

## 3. Schema

Hand-applied in the Supabase SQL Editor and hand-mirrored in `prisma/schema.prisma`. Constraints and
indexes below are copied from `pg_constraint` / `pg_indexes` (live 2026-09-18). The CHECKs and the
partial unique index are invisible in Prisma.

### 3.1 `trips` (`prisma/schema.prisma`, model `trips`)

| Column | Type | Notes |
|---|---|---|
| `id` | Int PK | |
| `tripNumber` | String, UNIQUE | `{T}-{YYMMDD}-{NN}`, `-C…` when cancelled (§5) |
| `tripDate` | `@db.Date` | UTC-midnight shape. Read with UTC getters (`lib/trips/number.ts:116-131`) |
| `typeCode` | String | L / U / I / C |
| `deliveryTypeId` | Int → `delivery_type_master` | The type the trip was **numbered** under. Cannot be changed (§4) |
| `seq` | Int | The numeric half |
| `dispatchWindowId` | Int? → `dispatch_slot_master` | Display only |
| `transporterId` | Int? → `transporter_master` | The trip's own; defaults from the vehicle, a supplied value wins |
| `vehicleId` | Int? → `vehicle_master` | |
| `adhocVehicleNo` | String? | A typed plate. Never together with `vehicleId` |
| `driverName`, `driverPhone` | String? | **Snapshot** copied from the vehicle, never read back through the FK (`app/api/floor/trips/route.ts:118-122`) |
| `transporterTripNo` | String? | Free text (§2) |
| `note` | String? | |
| `status` | String, default `draft` | §4 |
| `releasedAt/ById` | timestamptz / Int? → users | |
| `dispatchedAt/ById` | timestamptz / Int? → users | |
| `cancelledAt/ById` | timestamptz / Int? → users | |
| `shownAt/ById` | timestamptz / Int? → users | Show to floor (§11) |
| `sentToBillingAt/ById` | timestamptz / Int? → users | Send to billing (§12) |
| `billingCopiedAt/ById` | timestamptz / Int? → users | Written by the Print tab (`CLAUDE_BILLING.md` §7). Since v27.56 it means only "the latest copy press" |
| `billingDoneAt/ById` | timestamptz / Int? → users | v27.56. Billing Print v2's manual "Done" (`CLAUDE_BILLING.md` §7). FK stored lowercase, `trips_billingdonebyid_fkey` |
| `isHand` | Boolean, default false | v27.41. A **Hand trip**: the dealer collects. No vehicle or plate, ever; set at create and never changed; stays `draft` for life (that blocks nothing — show, the gate, Send to billing and Print ignore status). Only Hand bills join it, and no re-delivery goes on it (§7.1, §12b) |
| `vehicleSize` | String? | `gc` / `ace` / `big` (`chk_trips_vehicle_size`, `lib/trips/vehicle-size.ts`). Ran live 2026-09-21 (`sql/2026-09-21-trips-vehicle-size.sql`) but **not yet minted** in CORE's chain (its known gap). Written at create and by PATCH |
| `dieselAmount` | Decimal(10,2)? | v27.54. Rupees, `chk_trips_diesel_amount_nonneg`. PATCH only (`lib/trips/diesel-dispatch.ts`) |
| `manualDispatchAt` | timestamptz? | v27.54. The planner's own dispatch time, **REPORTS ONLY** — never `dispatchedAt`, never status. Required on every Edit-drawer save (§4) |
| `createdAt`, `createdById` → users, `updatedAt` | | |

Live constraints (live 2026-09-18; `chk_trips_diesel_amount_nonneg` v27.54 and the vehicle-size CHECK are in CORE §7.16):

| Name | Definition |
|---|---|
| `chk_trips_status` | `status IN ('draft','released','dispatched','cancelled')`. There is **no `loading`** |
| `chk_trips_type_code` | `typeCode IN ('L','U','I','C')` |
| `chk_trips_seq_positive` | `seq >= 1` |
| `chk_trips_number_shape` | Live trip: `tripNumber = typeCode-YYMMDD(tripDate)-lpad(seq, greatest(2, length(seq)), '0')`. Cancelled trip: that base followed by `-C([2-9]\|[1-9][0-9]+)?$`, which admits `-C`, `-C2`, `-C3` … and never `-C1` |
| `chk_trips_cancelled_complete` | `status <> 'cancelled' OR (cancelledAt AND cancelledById NOT NULL)` |
| `chk_trips_dispatched_complete` | `status <> 'dispatched' OR (dispatchedAt AND dispatchedById NOT NULL)` |
| `chk_trips_vehicle_one_of` | `NOT (vehicleId NOT NULL AND adhocVehicleNo NOT NULL)` |
| `trips_tripNumber_key` | UNIQUE (`tripNumber`), every row |
| `trips_date_type_seq_live_key` | UNIQUE INDEX (`tripDate`, `typeCode`, `seq`) **WHERE status <> 'cancelled'** (partial) |
| Indexes | `trips_date_idx` (`tripDate` DESC), `trips_status_idx`, `trips_vehicle_idx` |
| FKs, ON DELETE SET NULL | `releasedById`, `dispatchedById`, `cancelledById`, `shownById`, `sentToBillingById`, `billingCopiedById` |
| FKs, default (no action) | `createdById`, `deliveryTypeId`, `dispatchWindowId`, `transporterId`, `vehicleId` |

There is no `released` completeness CHECK. Every code path writes `releasedAt/ById` with the status
(§4).

### 3.2 `trip_drops` (`prisma/schema.prisma`, model `trip_drops`)

One row per stop (customer) on a trip.

| Column | Notes |
|---|---|
| `tripId` → trips | **ON DELETE CASCADE** |
| `dropSeq` | Stop order. MAX+1 at creation. Gaps allowed (§7) |
| `customerId` → `delivery_point_master` | Null for an unmatched bill |
| `shipToCode` | Always SAP's own ship-to code, NOT NULL |
| `shipToText` | v27.73 (2026-10-19). A typed ship-to's stop text; NULL = a `c:`/`s:` stop. **Written by the app since 2026-10-20** (ship-to free text step 7A, `5eb7b17e`): `findOrCreateTripDrop` stores it, with the typed name and the picked area / route. Live 2026-10-24: 6 `t:` stops |
| `dropKey` | `t:<shipToText>`, `c:<customerId>` or `s:<shipToCode>` (§7). No default |
| `customerName`, `areaName`, `routeName` | Snapshot taken when the stop is created |
| `note`, `createdAt` | |

Live: `chk_trip_drops_key` (rewritten v27.73, 2026-10-19: `dropKey = CASE WHEN shipToText NOT NULL THEN 't:'||shipToText
WHEN customerId NOT NULL THEN 'c:'||customerId ELSE 's:'||shipToCode END` — the app writes `t:` keys since 2026-10-20), `chk_trip_drops_ship_to_text` (`shipToText` NULL or non-blank),
`chk_trip_drops_seq_positive` (`dropSeq >= 1`), UNIQUE `trip_drops_trip_key_key` (`tripId`, `dropKey`),
UNIQUE `trip_drops_trip_seq_key` (`tripId`, `dropSeq`), indexes `trip_drops_trip_idx` and
`trip_drops_customer_idx`, `customerId` FK default rule.

### 3.3 `trip_activity` (`prisma/schema.prisma`, model `trip_activity`)

`id`, `tripId` → trips (**ON DELETE RESTRICT**), `action`, `actorId` → users (default rule), `summary`,
`detail Json?`, `createdAt`. Indexes `trip_activity_trip_idx` (`tripId`, `createdAt`) and
`trip_activity_created_idx` (`createdAt` DESC).

Live `chk_trip_activity_action` admits exactly **18** values: `created`, `bills_added`, `bills_removed`,
`vehicle_changed`, `details_changed`, `cancelled`, `released`, `dispatched`, `renamed`, `shown`,
`taken_back`, `sent_to_billing`, `taken_back_from_billing`, `invoices_copied`, plus `redelivery_added` /
`redelivery_removed` (v27.53) and `bills_copied` / `billing_done` (v27.56). The TypeScript twin is
`TRIP_ACTIONS` (`lib/trips/activity.ts`). *(This said 14 until 2026-10-24.)*

Because of RESTRICT, a trip with any history cannot be deleted. Trips are cancelled, never deleted.

### 3.4 `app_settings` (`prisma/schema.prisma`, model `app_settings`)

`id`, `settingKey` (UNIQUE), `isEnabled` (default false), `updatedById` → users, `updatedAt`. One row
per named switch. This file owns `picking.visibilityGate` (§11); the live-feed switches `live.feed`,
`live.feed.billing`, `.picking`, `.tint` (`lib/live/cursor.ts`, CORE §13) live in the same table and are
not trip keys. *(This said "the only key in code is `picking.visibilityGate`" until 2026-10-24.)* This is
not `app_tag_settings` (per-badge, default ON). This one is per-flag and default OFF.

Live 2026-10-24: `picking.visibilityGate` `isEnabled = false`, last changed 2026-10-14 13:01 UTC (it read
2026-09-16 09:07 UTC on 2026-09-18, so it was flipped and flipped back in between). All four `live.feed*`
rows ON.

### 3.5 Columns on existing tables

| Column | Live (2026-09-18) | Status |
|---|---|---|
| `order_invoices.tripDropId` | integer, nullable (v27.66) | **THE trip pointer since v27.66** — per INVOICE ROW, ON DELETE SET NULL. An unsplit bill has one row (seq 1); a split OBD's rows may sit on different stops / trips. Written ONLY by `setRowsTrip` (§7.1; contract → `CLAUDE_ORDER_INVOICES.md §4.3`) |
| `orders.tripDropId` | integer, nullable | **DERIVED since v27.66** — the stop of the OBD's LOWEST-seq row that has one, NULL when no row is on a trip (`deriveObdTripDropId`, `lib/order-invoices/trip-read.ts`), dual-written by `setRowsTrip` in its one `orders.update`. Prisma `onDelete: SetNull`, `@@index([tripDropId])`; there is no `orders.tripId`, by design. Right for "on ANY trip" and for labels, **WRONG for "is this bill on THIS trip"** once a split OBD's rows sit on different trips — read through the rows (`onStopsWhere` / `placeOnTrips`, §8b). *(Was "the one trip pointer" until v27.66.)* |
| `orders.partlyOnTrip` | boolean NOT NULL default false (v27.69) | TRUE ⇔ ≥ 1 row on a stop AND ≥ 1 row on none — only a split OBD can be. Written by `setRowsTrip` in the same update; exists ONLY for the Floor query plan (`CLAUDE_ORDER_INVOICES.md §8`) |
| `transporter_master.isRealTransporter` | boolean, NOT NULL, default false | **No longer read by the trip picker** (owner 2026-10-24, `cc59d00a`): `/api/floor/trips/options` lists every ACTIVE transporter ("Do not re-add."). Live 2026-10-24: 19 active, 20 marked real |
| `orders.pickVisibleAt`, `orders.pickVisibleById` | timestamptz / integer, nullable | **Present, deliberately unused** |
| `orders.loadedAt`, `orders.loadedById` | timestamptz / integer, nullable | **Present, deliberately unused** |

Proof of "unused", checked two ways (Bash `grep -rn` and the Grep tool over `app/`, `lib/`,
`components/`): every hit for `pickVisible` and `loadedAt|loadedById` is a comment. No code reads or
writes the fields. Outside the app, `pickVisibleAt` appears only in hand-run probe scripts
(`scripts/_bench-picking-branch-split.ts`, `scripts/_discovery_probe_20260909.ts`) and in the one-off
clear in `sql/2026-09-15-slice8-show-per-trip.sql:100-103`. A `findMany` with no `select` still
returns the columns; nothing reads them.

⚠ Two schema comments say otherwise and are wrong or out of date: `prisma/schema.prisma:1211`
(`app_settings` "NOTHING CONSUMES THIS YET"; `lib/picking/visibility-gate.ts:58` and
`app/api/floor/pick-gate/route.ts:108` consume it), and `:1028` (the `pickVisible` block, which
happens to be true again since slice 8).

---

## 4. Lifecycle

```
            POST /api/floor/trips (no vehicle)             POST /api/floor/trips (with vehicle)
                      │                                              │
                      ▼                                              ▼
                   draft ──PATCH sets vehicle / plate──▶ released ◀──┘
                      │   ──POST …/confirm (no caller)──▶    │
                      │                                      │ POST …/dispatch (no caller)
                      │                                      ▼
                      │                                  dispatched
                      └──────── POST …/cancel ────▶ cancelled ◀── POST …/cancel
```

| Move | Route | Reachable from the UI? | What it writes |
|---|---|---|---|
| → `draft` | `POST /api/floor/trips` with no vehicle or plate (`route.ts:243`, `:268-270`) | yes | `trips` row |
| → `released` at birth | `POST /api/floor/trips` with a vehicle or plate | yes | status + `releasedAt/ById` |
| `draft` → `released` | `PATCH /api/floor/trips/[id]` when the press sets a vehicle or plate (`[id]/route.ts:277-290`) | yes | same `trips.update` as the vehicle; stamps only the first time. **One way:** clearing the vehicle never returns a trip to `draft` |
| `draft` → `released` | `POST /api/floor/trips/[id]/confirm` | **no** (no caller since slice 6, `floor-page.tsx:803-807`) | `trips` only |
| `released` → `dispatched` | `POST /api/floor/trips/[id]/dispatch` — marks the trip's bills / invoices dispatched (§14), and closes the trip only when nothing non-held is left un-dispatched | **no** (no caller since slice 7, 3b9d1ab4 — kept for the future loading screen) | the bills first, then status + `dispatchedAt/ById` together |
| `draft`/`released` → `cancelled` | `POST /api/floor/trips/[id]/cancel` | yes (`floor-page.tsx:821`) | renames to `-C…`, stamps, detaches bills (§5) |

**Reachable from the app today:** `draft`, `released`, `cancelled`. **Unreachable from the app:** `dispatched` (no caller). ⚠ **Live 2026-10-24: 45 trips ARE `dispatched`** (of 1,265: 939 released · 120 draft · 161 cancelled) against only 5 `dispatched` activity rows — so at least 40 were set outside the app (hand SQL), the same pattern as §14. Hand trips (52 live) stay `draft` by design.
Nothing moves a trip back to `draft`. `sql/2026-09-15-slice6-settle-drafts.sql` moved three drafts to
`released` by hand.

The status still decides only these things: cancelled/dispatched trips refuse edits, bill changes,
show and send (`[id]/route.ts:167-169`, `bills/route.ts:99-104`, `lib/trips/show.ts:66-68`,
`lib/trips/billing.ts:49-55`); the dispatch close; and the no-cliff query's `not cancelled` filter.
Which trips appear on a desk does **not** read status (§8). The floor screen shows no Draft / Confirmed
words (`components/floor/trip-rail.tsx:35-37`).

**Other rules:**
- **An empty trip is valid.** Create, confirm and PATCH never count bills
  (`app/api/floor/trips/route.ts:241-242`, `confirm/route.ts:43-46`).
- **Vehicle and transporter are both optional** (`route.ts:108-111`).
- **The manual dispatch time is required on every Edit-drawer save** (2026-10-04, Schema v27.54 column): `PATCH
  /api/floor/trips/[id]` refuses with 400 any save whose RESULTING `manualDispatchAt` would be null ("Manual dispatch time
  is required — set the date and time"); a press that leaves an existing value alone passes. Create stays one-click and asks
  for no time; older trips stay blank until their next save. Report data only — never `dispatchedAt`, never status.
- **The delivery type cannot be changed.** PATCH refuses `deliveryTypeId` with a 400, because it would
  re-number the trip (`[id]/route.ts:92-100`, `:134-143`).
- **A cancelled trip refuses every edit** with 409 (`[id]/route.ts:107-108`).
- `isReady` is derived at read time, never stored: at least one non-held bill, and every non-held bill
  checked or dispatched (`lib/trips/queries.ts`, `isReady` and `bucketFor` — "DISPATCHED COUNTS AS CHECKED"). A hold outranks the
  stage in the counts. **Counts and buckets stay PER OBD** (owner 2026-10-13): a split OBD on the trip is one bill, bucketed by the OBD's own `workflowStage` / `dispatchStatus` — a dispatched or CI'd single invoice does not change its bucket. Re-deliveries are NOT in the counts or buckets (§12b), so they never affect `isReady`.
- **Vehicle size, diesel, manual dispatch time** (§3.1): `vehicleSize` is set at create and by PATCH; `dieselAmount` and `manualDispatchAt` by PATCH only. PATCH accepts `vehicleId`, `adhocVehicleNo`, `transporterId`, `dispatchWindowId`, `note`, `transporterTripNo`, `vehicleSize`, `dieselAmount`, `manualDispatchAt`; refuses `deliveryTypeId` and `isHand`; refuses only a CANCELLED trip (a dispatched trip may still be edited).

---

## 5. Trip numbering

Format `{T}-{YYMMDD}-{NN}`, for example `L-260918-03` (`lib/trips/number.ts:3-4`).

- **T** comes from an explicit map: Local → L, Upcountry → U, IGT → I, Cross → C
  (`number.ts:80-85`). An unmapped type **throws**, and the create route returns a 400
  (`app/api/floor/trips/route.ts:192-200`). A fifth type needs the map **and** an ALTER of
  `chk_trips_type_code`.
- **YYMMDD** is read with UTC getters from the `@db.Date` value (`number.ts:126-131`).
- **NN** is zero-padded to at least two digits and never truncated: seq 137 renders `137`
  (`number.ts:150-152`). The DB CHECK pads to `greatest(2, length(seq))` for the same reason. Postgres
  `lpad` truncates, so a bare width of 2 would refuse the 100th trip of a day (`number.ts:52-55`).
- **Seq is the lowest free number** among the day's non-cancelled trips of that type, not MAX+1
  (`number.ts:246-264`). A reused number can be lower than one created earlier the same day.
- **Race handling:** allocate, insert, and on a P2002 from either unique re-allocate and retry
  **once** (`allocateTripNumberWithRetry`, `number.ts:298-313`; `isTripNumberCollision` `:204-221`).
  Never `$transaction`.

### A cancelled trip gives its number back (62ea5f1b, slice 5)

Cancelling `L-260914-03` renames it `L-260914-03-C` (then `-C2`, `-C3` for later cancels of the same
number; `cancelledTripNumber`, `number.ts:166-174`). The partial unique index frees the seq, and the
rename frees the text, because `trips_tripNumber_key` still covers every row
(`app/api/floor/trips/[id]/cancel/route.ts:31-35`). Status, stamps and the new name go in **one**
`trips.update` (`cancel/route.ts:255-258`), because both CHECKs require them together.

The next trip built that day and type takes `03` again. Its `created` activity row says "number
reused, previously held by L-260914-03-C" (`findPreviousHolders`, `number.ts:273-280`;
`app/api/floor/trips/route.ts:292-307`). That is the trace for two printed sheets with one number.

The pre-slice-5 cancelled trips were renamed by hand in `sql/2026-09-15-trip-number-reuse.sql`, which
also wrote the `renamed` activity rows (`:147-150`).

---

## 6. Delivery type: choosing the letter, and which tab lists a trip

### Choosing the letter for a mixed selection (b95b6eeb)

A trip may carry bills of more than one delivery type. "+ New trip" with bills ticked numbers the trip
by `chooseTripTypeName` (`lib/trips/type-choice.ts:34-53`, called at `floor-page.tsx:1459`):

1. Bills with no delivery type are ignored. If none is typed, the answer is null and nothing is
   created.
2. The type with the most bills wins.
3. A tie goes to the active tab, when a typed tab is open and it is one of the tied types.
4. Otherwise the tie goes to the type of the first bill ticked.

The letter is an identifier. It does not describe everything the trip holds.

### Which delivery-type tab lists a trip

`tripInScope` (`lib/floor/scope.ts:64-66`) matches the trip's **stored** type (`deliveryTypeName`, the
letter it was numbered under) and nothing else. An L- trip shows under All and Local; a C- trip under
All only, because there is no Cross tab. Called once, at `components/floor/trip-rail.tsx:159`.

Was listed on every tab of its bills' delivery types (41c5dab8; stored type unioned with the bills' types from 1b1005c6) until 2026-09-18; now stored type only (ec6343ba). Do not revert.

What the trip holds is shown by the **mix chip** instead: `tripMixLabel` (`lib/floor/scope.ts:77-79`)
renders "Local + Upcountry" when `deliveryTypes` has more than one entry. `deliveryTypes` is the stored
type unioned with the bills' own types (effective dealer → area → delivery type), in
`delivery_type_master` id order, with the stored type first when no bill carries it
(`lib/trips/queries.ts:110-117`, `:686-695`). The chip is read at `trip-rail.tsx:293` and
`trip-detail-header.tsx:143`. An opened trip shows every bill on it whatever tab is selected
(`lib/floor/scope.ts:60-62`).

---

## 7. Drops (stops)

**The drop key** is the only stop identity, computed in one place (`lib/trips/drop-key.ts`, `computeDropKey`), in the same order as the live `chk_trip_drops_key`:

- `t:<typed text>` — a TYPED ship-to (free-text site or "As per challan", with its area), checked FIRST (v27.73; the app writes it since 2026-10-20, free-text step 7A `5eb7b17e`). Its own stop, never the dealer's `c:` stop, and two areas never share one (`typedDropText`, `lib/ship-to/effective.ts`). `dropShipToText` gives the `shipToText` to store, from the SAME function, so the CHECK always holds.
- `c:<customerId>` when the **effective** customer resolves: `shipToOverrideCustomerId ?? customerId` (`effectiveCustomerId`).
- `s:<shipToCustomerId>` otherwise: SAP's own code.
- The prefixes keep the id spaces from colliding onto one stop. `chk_trip_drops_key` rejects a wrong value (§3.2). ⚠ The file's header still quotes the pre-v27.73 two-branch CHECK — the code and §3.2 are right.
- Known limit: an untyped redirect that never resolved to a master row groups under the **original** customer (the `computeDropKey` comment). The fix is upstream.

**Finding or creating the stop** — `findOrCreateTripDrop` (`lib/trips/drop.ts`, shared by add, move and re-deliveries): find by (`tripId`, `dropKey`) or create with `dropSeq = MAX + 1`. The name, area and route are copied at creation from the effective customer (a typed stop: the typed name and the picked area's area / route); the name falls back to SAP's ship-to name, then `(Unmatched)`. A second bill for the same stop reuses the row and does not refresh the snapshot.

**A stop that empties is deleted, and the rest close up** — `deleteTripDropIfEmpty` (`lib/trips/drop.ts`) counts the stop's bills, its invoice rows AND its re-deliveries; only when all are zero does it delete the stop, then `compactTripDropSeq` rewrites the trip's `dropSeq` to 1..N. Called after a remove, after a move (on the source) and after a re-delivery is removed. 🔴 *History, 2026-10-17: until then gaps in `dropSeq` were left alone and no route rewrote it; the owner reversed that — stops close up on remove. Do not revert.*

**Cancelling** detaches every bill — every invoice row of it ON THAT TRIP, through `setRowsTrip(…, "all", null, { onlyFromTripId })`, one `orders.update` per bill — and **keeps** the drop rows as the record of the plan ("🔴 THE DROP ROWS STAY"). Re-delivery rows are kept and listed in the cancel log. Refused when the trip is dispatched, or when any bill on it is already `dispatched` (per OBD, `orders.workflowStage`): "This trip cannot be cancelled — {n} bill(s) on it … already marked dispatched. …". 422 "Could not detach any bill — the trip was not cancelled." when nothing detached.

### 7.1 Add · remove · move — the trip routes' side of the one trip writer

`POST /api/floor/trips/[id]/bills`, `{ action: "add" | "remove" | "move", orderIds, invoiceRowIds?: { [orderId]: rowIds[] }, fromTripId? }`. **Every membership write goes through `setRowsTrip`** (`lib/order-invoices/trip-link.ts`) — invoice rows first, then ONE `orders.update` with the derived `tripDropId` and `partlyOnTrip`; a retry converges. The contract, the write order and the half-failure rule → **`CLAUDE_ORDER_INVOICES.md §4.3`** (not repeated here). Which rows a press moves is the pure `planAddRows` / `planRemoveRows` (`lib/order-invoices/trip-bills.ts`). An unsplit bill sends `orderIds` only and behaves exactly as before; a split OBD may send chosen `invoiceRowIds`. A press that finds the rows already where it asked but `orders` disagreeing (`needsDerivedRepair`) still calls `setRowsTrip` — a silent repair, not a refusal. Refused for every action: a cancelled or dispatched trip ("Cannot change the bills on a {status} trip."), "Order not found", "Invoice row … is not an invoice of {obd}".

- **Add.** Refused, per bill (the rest of the press goes on): a challan-billed bill ("{obd} is billed against a challan order — its goods already went out on the challan. It never goes on a trip.") · Hand rules (below) · already on another trip — unsplit: "Already on {trip} — remove it from that trip first."; split: "{invoice} is already on {trip} — remove it from that trip first", **for that invoice only** · a split OBD's held invoice: "{invoice} is on hold — release it first" (6.3) · a split OBD's CI'd invoice: "{invoice} is returned on {CI} — it does not go out" · "Already attached to a different stop on this trip." Every attached row of one OBD lands on the OBD's ONE stop of the trip. Then `findOrCreateTripDrop` + `setRowsTrip(orderId, rows, dropId)`. Returns `{ attached, skipped, failed }`.
- **Remove.** Strips ONLY THIS TRIP's rows — `setRowsTrip(…, null, { onlyFromTripId: tripId })`; a row on another trip is never touched ("Not on this trip" / "{invoice} is not on this trip"). Then `deleteTripDropIfEmpty` per emptied stop. Returns `{ detached, skipped, failed }`. No Undo on its toast.
- **Move** (`c460367a`, 2026-10-17). `fromTripId` is required ("fromTripId is required for a move"; the same trip: "Those bills are already on this trip."); the source must exist and be live ("Cannot move bills off a {status} trip ({trip})."). Per bill: challan check · the ticked rows must be on the source ("{invoice} is not on {source}" / "Not on {source}") · Hand rules · one target stop ("Already attached to a different stop on {target}.") · `findOrCreateTripDrop` on the target · ONE `setRowsTrip(orderId, rows, targetDropId, { onlyFromTripId: source })` — stop to stop, the bill is never on no trip and still gets one `orders.update` · `deleteTripDropIfEmpty` on the source. One `bills_removed` row on the source ("{n} bills moved to {target}") and one `bills_added` on the target ("… moved in from {source}"), with `movedTo` / `movedFrom` in the detail — no new action. Returns `{ moved, skipped, failed, trips: { source, target }, sourceEmpty }`. It touches no stage, no checked status, no shown / sent stamps and no `trip_bill_copies` row: **a copied bill moves freely and reads "not copied" on the target** (owner 2026-10-17; billing redesign → ROADMAP). Half-failure: bills already moved stay moved; an empty stop can be left on the target (died after creating it) or on the source (died before its delete) — harmless. 🔴 *History, 2026-10-17: before this, moving needed Remove (to To plan) then Add. Do not split the move back into a client-side remove + add — that is two `orders.update` per bill and a limbo in which the gate hides waiting bills.*
- **The confirm and Undo are client-side** (`AddToTripConfirm`, `components/floor/trip-rail.tsx`; add `34b7c6ab`, move `c460367a`): a rail card click or "+" in add / move mode asks "Add {N bills} to {trip}?" / "Move {N bills} from {src} to {target}?" first — screen spec in `CLAUDE_FLOOR.md §4.6`. Undo on a move is the same `move` pointed back after re-reading the trip (`undoMove`); Undo on an add is a remove (`undoAdd`). No server reverse path exists.
- **Hand trips** (`trips.isHand`, v27.41). Create refuses a vehicle or plate ("A Hand trip has no vehicle — the dealer collects. Leave the vehicle and plate empty."); PATCH refuses changing it ("Whether a trip is a Hand trip is set when it is built and cannot be changed.") or giving it a vehicle. Add / move: a Hand bill onto a truck trip — "The dealer collects this bill (Hand) — put it on a Hand trip, not a truck."; a truck bill onto a Hand trip — "This is a Hand trip (dealer collects) — only Hand bills can join it." A Hand trip has no Trip sheet ("Hand trip — no trip sheet") and takes no re-delivery (§12b).
- **No server rule about past days.** Nothing in the trip routes refuses an earlier day's trip; History is read-only on the client only.

**A bill — an UNSPLIT bill — is on at most one trip.** A SPLIT OBD's invoices may sit on different trips (one invoice per trip at most); "on this trip" is then a question for its rows, never `orders.tripDropId` (§3.5). *(This said "A bill is on at most one trip" without the qualifier until 2026-10-24.)*

---

## 8. Which trips a desk shows

`lib/trips/live-trips.ts` is the one definition. The trips feed (`getTripsForDate`,
`lib/trips/queries.ts`) and Floor's board trip arm (`floorTripBillsWhere`, `lib/floor/queries.ts`,
owned by `CLAUDE_FLOOR.md`) both derive from it.

`tripsOnDeskWhere(deskDate, todayDate)`:

- **Today's desk:** trips dated today (empty ones included), **plus** any trip from an earlier day that
  still holds a bill that is **not done** (`BILL_NOT_DONE`: not removed, not at `pick_checked`,
  `dispatched` or `cancelled`, and not on hold). "Holds" is read two ways (P5-2): a bill whose own stop
  is there, OR a `seq > 1` invoice row on that stop whose OBD is not done — the second branch is shaped
  for query speed, never simplify it (`CLAUDE_FLOOR.md §3`, `CLAUDE_ORDER_INVOICES.md §8`).
- **A past day's desk:** trips dated that day only.

The status plays no part. A carried trip keeps its real `tripDate`. `liveTripsOnDeskWhere` is the same
rule minus cancelled trips, for the board arm. The trips feed returns cancelled trips for their own day,
newest created first. The trip list drops cancelled trips at render (`trip-rail.tsx`). ⚠ The
`live-trips.ts` comment "REVISIT WHEN THE LOADING SCREEN SHIPS … Until then nothing writes `dispatched`"
is half stale: the dispatch route writes it when called (§14), and nothing calls it yet.

### 8b. Reading a trip's bills — through the invoice rows (readers A / B / C, 2026-10-12 → 13)

Since v27.66 every trip reader finds a trip's bills through `order_invoices`, not `orders.tripDropId`
(`lib/order-invoices/trip-read.ts`; which reader for which question → `CLAUDE_ORDER_INVOICES.md §3`):
`onStopsWhere` ("bills with any row on these stops" — queries, show, cancel / confirm / dispatch, trip
sheet, reports, Print), `onTripsWhere` / `onTripIdsWhere` (board, billing / picking sync, load-plan
snapshot), `placeOnTrips` (one entry per (OBD, trip), placed on its lowest-seq row's stop there —
queries, trip sheet, reports, Print), `obdStopIds` (re-deliveries, freight report), `ON_SHOWN_TRIP_WHERE`
(the pick gate, §11), `ON_ANY_TRIP_WHERE` (find-bill). Readers A = trip screens / sheet / reports / lookup
(`7203d9f3`); B = Floor, picking gate + sync, Print, billing sync, load plan, live trips, show
(`912f17ec`); C = trip actions + guards, pick-delete, refusals, challan board, off-floor, tint base feed
(`a4fcbc72`).

- **Counts per OBD, load per invoice** (owner 2026-10-13; P5-1 `668089fc`). A split OBD is ONE bill in a
  trip's "N bills", stops and buckets; its litres / kg on a stop or trip are ONLY its invoices there
  (`loadSplitInvoiceRows` → `placeLoad`, `lib/floor/invoice-rows.ts`). `TripBillRow.invoiceCount` carries
  the "n invoices" a screen may show (no trip component reads `TripDropSummary.invoiceCounts` yet). An
  unsplit bill is byte-for-byte unchanged.
- **The trip card** (`trip-rail.tsx`): "N stops · N bills · X L · +N re-del" (or "Re-deliveries only · +N
  re-del · X L", or "No bills yet") — no kg, no invoice count; badges Dispatched / Picking / Held / Ready
  / Shown. **The trip header** (`trip-detail-header.tsx`): [Trip sheet] [Send to billing] [Show to floor]
  [···: Take back from floor · Take back from billing · Cancel trip], the pencil (vehicle, transporter,
  slot, note — diesel and dispatch time in the drawer) and the history clock; the stops bar "N stops · N
  bills · N re-del · L · kg" with [+ Add bills] and [Re-delivery].
- ⚠ Stale "TOTALS STAY PER OBD … Phase 5 makes them per row" comments survive above code that is
  already per invoice (`lib/trips/queries.ts`, `trip-read.ts`, `lib/billing/print.ts`,
  `lib/floor/load-plan-check-data.ts`) — canon plan step 4c (batch B6).

---

## 9. The activity log

`lib/trips/activity.ts` is the one writer. One row **per press**, never per bill. `writeActivity`
**swallows its own failure** and logs to the console, so a failed log row never turns a successful
action into a 500. The trip's own stamp columns stay; the log records what happens between them.
Live counts 2026-10-24 in brackets.

| Action | Writer | Reachable today? |
|---|---|---|
| `created` | `POST /api/floor/trips` | yes (1,162) |
| `bills_added`, `bills_removed` | `POST …/[id]/bills` (`logTripBills`). One row per press, only the bills that actually moved. A **move** writes one of each — `bills_removed` on the source "… moved to {target}", `bills_added` on the target "… moved in from {source}", `detail.movedTo` / `movedFrom` (§7.1) | yes (2,005 / 479) |
| `vehicle_changed` | `PATCH …/[id]`. Before → after plate, plus the transporter the vehicle brought | yes (923) |
| `details_changed` | `PATCH …/[id]`. Slot, transporter, note, docket; diesel and the manual dispatch time (v27.54 — no new action) | yes (1,008) |
| `cancelled` | `POST …/[id]/cancel`. Written **before** the detach loop, with every OBD on the trip | yes (112) |
| `renamed` | SQL only: `sql/2026-09-15-trip-number-reuse.sql` | no (one-off; 51) |
| `shown` | `lib/trips/show.ts` (button, and desk control turned on) | yes, but the show route refuses while the gate is OFF (live OFF; 111) |
| `taken_back` | `lib/trips/show.ts` | same as `shown` (10) |
| `sent_to_billing`, `taken_back_from_billing` | `lib/trips/billing.ts` | yes (124 / 3) |
| `redelivery_added`, `redelivery_removed` | `lib/trips/redelivery.ts` (v27.53) — one row per press, "{n} re-deliveries added — {obd}[ · {invoice}] (attempt N, {reason}) …" (§12b) | yes (85 / 7) |
| `bills_copied`, `billing_done` | `lib/billing/print.ts` (v27.56 Print v2 — `CLAUDE_BILLING.md` §7) | yes (243 / 113) |
| `invoices_copied` | **HISTORICAL** — nothing writes it since Billing Print v2 (2026-10-05; `logTripInvoicesCopied` has no caller). `detail.invoiceNos` on the old rows is their only record. Never rewrite these rows | no (7) |
| `released` | `POST …/[id]/confirm`; `sql/2026-09-15-slice6-settle-drafts.sql` | **no** (no caller; 7). A vehicle-driven release logs `confirmed: true` inside its `created` / `vehicle_changed` row instead |
| `dispatched` | `POST …/[id]/dispatch` | **no** (no caller; 5) |

Every action stays in the list and in the CHECK even when its writer goes. Old rows outlive their
writers. `getTripActivity` reads one trip's history oldest first. It runs only when one trip is opened,
never on the board feed.

---

## 10. API routes

Page key is `"floor"` (member of the `PageKey` union, `lib/permissions.ts`). Every route calls
`checkAnyPermission(roles, "floor", …)`, exports `dynamic = "force-dynamic"`, and uses sequential awaits.
11 route files under `app/api/floor/trips/`.

| Route | Method | Gate | Client caller |
|---|---|---|---|
| `/api/floor/trips?date=` | GET | `floor` canEdit | `components/floor/floor-page.tsx` |
| `/api/floor/trips` | POST | `floor` canEdit | `components/floor/trip-form.tsx`; `floor-page.tsx` |
| `/api/floor/trips/options` | GET | `floor` canEdit | `floor-page.tsx` |
| `/api/floor/trips/lookup` | GET | `floor` canView | **no UI caller since 2026-10-06** — Floor's search uses `/api/floor/search` (`CLAUDE_FLOOR.md §4.9`) |
| `/api/floor/trips/[id]` | GET | `floor` **canView** | `floor-page.tsx` |
| `/api/floor/trips/[id]` | PATCH | `floor` canEdit | `components/floor/trip-vehicle-editor.tsx` |
| `/api/floor/trips/[id]/bills` | POST add / remove / move | `floor` canEdit | `floor-page.tsx`, `trip-form.tsx` (§7.1) |
| `/api/floor/trips/[id]/cancel` | POST | `floor` canEdit | `floor-page.tsx` |
| `/api/floor/trips/[id]/show` | POST `{ shown }` | `floor` canEdit | `floor-page.tsx` |
| `/api/floor/trips/[id]/billing` | POST `{ sent }` | `floor` canEdit | `floor-page.tsx` |
| `/api/floor/trips/[id]/redeliveries` | GET `?q=` · POST add / remove | `floor` canView · canEdit | `components/floor/trip-redelivery-dialog.tsx`, `floor-page.tsx` (§12b) |
| `/api/floor/trips/[id]/confirm` | POST | `floor` canEdit | **NO CALLER — kept on purpose.** Its header: *"NO CALLER ON THE FLOOR SCREEN SINCE SLICE 6 … This route is kept as the plain API for the same move."* |
| `/api/floor/trips/[id]/dispatch` | POST | `floor` canEdit | **NO CALLER — kept on purpose.** Its header: *"NO CALLER SINCE SLICE 7 (2026-09-15), AND KEPT ON PURPOSE … The supervisor's future loading screen … will call THIS route when loading ends … Do not delete it as dead code."* (§14) |
| `/api/floor/pick-gate` | GET | `floor` canEdit | `floor-page.tsx` |
| `/api/floor/pick-gate` | POST | `floor` canEdit | `components/floor/pick-gate-toggle.tsx` |

No caller was found by grep over `components/` and `app/` for either kept route, and neither is a cron
(`vercel.json` holds four: attendance rollover, attendance purge, load-plan snapshot, live-prune).
⚠ The `[id]` route's header says "Gate: `floor` canEdit" for both methods; its GET checks canView (the
code is right).

⚠ **The trips list is gated canEdit while the Floor board is canView** (`app/api/floor/board/route.ts`).
The client swallows the failure (`.catch(() => null)` in `floor-page.tsx`), so a view-only floor user
would see a desk with no trips. Latent: live 2026-09-18 had 0 users with floor canView but not canEdit;
8 users hold floor canEdit on 2026-10-24.

`/api/floor/trips/options` returns delivery types, active windows, active vehicles, and **every ACTIVE
transporter** — "no other filter (owner, 2026-10-24). Until 2026-10-24 this also required
isRealTransporter = true; removed by owner decision — every active transporter shows. Do not re-add."
(`cc59d00a`). *(This section said the list was `isRealTransporter = true AND isActive = true` and maybe
empty until 2026-10-24.)*

---

## 11. The pick visibility gate ("desk control")

**What it does.** With the switch ON, a bill **waiting** for a picker appears on the supervisor's
Assign tab only when it is on a trip that has been **shown** (any invoice row of it). *(Until 2026-09-21,
`08d3c413`, a bill on no trip showed too; the owner hid "To plan" bills — only shown trips reach the floor.)*
OFF, every waiting bill appears. The planner can bucket bills into trucks and release one truck at a time.

| Part | Where |
|---|---|
| The key | `app_settings.settingKey = 'picking.visibilityGate'`, exported as `PICK_VISIBILITY_GATE_KEY` (`lib/picking/visibility-gate.ts:40`). Never retype it |
| The read | `isPickGateOn()` (`:56-66`). **Default OFF, and fails closed to OFF** on a missing row, `isEnabled` false, a null read, or a thrown query |
| "Waiting" | `WAITING_FOR_PICKER` = not removed, `dispatchStatus = 'dispatch'`, `workflowStage = SUPPORT_DONE_OUTPUT` (`:77-81`) |
| The predicate | `waitingBranchWhere(gateOn)`. OFF: the bare stage clause. ON: the bill shows ONLY when **any invoice row of it is on a SHOWN trip**; a bill on NO trip ("To plan") is hidden too (owner, 2026-09-21, `08d3c413`) — `ON_SHOWN_TRIP_WHERE` (`lib/order-invoices/trip-read.ts`, readers B `912f17ec`; `orders.tripDropId` stays only as an index term). **Waiting branch only.** A bill with a picker, picked or checked is never gated. Picking itself stays per OBD (`CLAUDE_PICKING.md`) |
| The count | `countHeldBackWaiting(boardWhere, gateOn)` returns `{ bills, trucks, unplanned }` — waiting bills on unshown trucks, those trucks, and (since 2026-09-21, not in `bills`) waiting bills on no trip; zero with no query when OFF. It must be passed the **ungated** where. 🔴 Mirrored, not shared, in four places — `waitingBranchWhere`, this count, `lib/trips/show.ts`'s per-trip counts and Floor's `isAwaitingShow`: change all four or none |
| Where it is applied | Owned by `CLAUDE_PICKING.md`: `lib/picking/queue.ts:398` and `:532`, `:1039-1051`; the marker `app/api/picking/marker/route.ts:112`, `:164-177` returns `heldBack` and `heldBackTrucks`; the band renders at `components/picking/picking-board-mobile.tsx:3197-3198` ("2 trucks with the planner · 17 bills") |
| On the floor rows | `isAwaitingShow` (`lib/floor/queries.ts:1095`), paired with the switch in `status-pill.tsx`. Owned by `CLAUDE_FLOOR.md` |

Was per bill (`orders.pickVisibleAt`, `POST /api/floor/pick-visible`) until 2026-09-15; now per trip, `trips.shownAt` (791a2cd6). Do not revert.

**Flipping the switch** (`POST /api/floor/pick-gate`):
- **OFF → ON writes first (the no-cliff rule).** `showTripsHoldingWaitingBills` marks every
  non-cancelled, not-yet-shown trip that holds a waiting bill as shown, one `trips.update` and one
  `shown` row (`via: desk_control_on`) each, **then** the switch is upserted
  (`pick-gate/route.ts:99-112`; `lib/trips/show.ts:139-169`). Turning the gate on must never remove a
  bill from the supervisor's screen. An off → on cycle therefore re-shows a trip the planner had taken
  back. That is by design (`show.ts:126-129`).
- **ON → OFF writes nothing but the switch.** Every trip's shown record survives (`pick-gate/route.ts:32-36`).
- `floor_supervisor` must not hold floor canEdit, because he is the person the gate applies to
  (`pick-gate/route.ts:38-45`).

**Per trip** (`POST /api/floor/trips/[id]/show`, `{ shown: boolean }`, strict boolean): writes
`trips.shownAt/ById` and one activity row, never an order row (`lib/trips/show.ts:56-113`).
**Refused with 409 in both directions while the switch is OFF** (`show/route.ts:65-70`). Idempotent: a
repeat press writes nothing. Take-back hides only still-waiting bills. Anything with a picker stays.
The header shows "Show to floor" greyed with "Desk control is off" while the switch is off
(`trip-detail-header.tsx:188-201`).

Membership moves visibility with no write (gate ON): adding a waiting bill to an unshown trip hides it at
once; moving it to a shown trip shows it; removing it, or cancelling its trip, sends it to To plan, which
is hidden too since 2026-09-21. The move confirm warns "{n} waiting bills will be hidden from the floor"
when the source is shown and the target is not (`CLAUDE_FLOOR.md §4.6`).

Live 2026-10-24: the switch is **OFF** (last changed 2026-10-14 13:01 UTC), so today nothing is hidden
and every Show press is refused.

---

## 12. Send to billing (the trip side)

`POST /api/floor/trips/[id]/billing`, `{ sent: boolean }` (strict boolean), calls
`setTripSentToBilling` (`lib/trips/billing.ts`):

- **Send** stamps `trips.sentToBillingAt/ById` and writes `sent_to_billing`. The trip then appears on
  the Billing Print tab. **Refused** (409): "{trip} has no bills to send to billing."; "Only challan
  orders on this trip — nothing to bill." A trip whose every bill is held is allowed. A
  re-delivery-only trip has no bills, so the header greys Send with "Re-deliveries only — nothing to
  bill".
- **Take back** clears both columns and writes `taken_back_from_billing`. **Always allowed on a sent,
  live trip — whatever billing has copied or marked done.** 🔴 *History, 2026-10-05 (`63668248`, Billing
  Print v2): take-back used to be refused once `trips.billingCopiedAt` was set ("Billing has already
  copied …'s invoice numbers — it cannot be taken back"); the lock was removed on purpose — do not
  restore.*
- Refused on a cancelled or dispatched trip ("A {status} trip cannot be sent to / taken back from
  billing."). Idempotent: a repeat press writes nothing. It does not read `billingDoneAt`.
- The eligible and invoiced counts it returns come from the Print tab's own loader, `loadPrintTrips`
  (`lib/billing/print.ts`), so both screens use one definition.
- Writes the trip only, never an order row.
- The header shows "Sent to billing · {time}", or "Billing done · {time}" once billing marked the trip
  Done (`trips.billingDoneAt`, written by `markTripBillingDone`, `lib/billing/print.ts`, through
  `app/api/billing/print/trip/[id]/done`).

**Copies are Billing's.** What billing copied, per INVOICE ROW per trip (`trip_bill_copies`, one row per
(trip, invoice row) since v27.74; a whole-OBD copy older than a split covers every invoice; a moved bill
reads uncopied on its new trip), Copy inv, Done and reopen → **`CLAUDE_BILLING.md` §7** (the rule:
`CLAUDE_ORDER_INVOICES.md §4.7`).

## 12b. Re-deliveries [LIVE 2026-10-03 · per invoice 2026-10-23]

A **re-delivery** is a bill that already went out on a truck and came back undelivered, put on a LATER
Orbit trip as attempt 2, 3 … (v27.53, `10674e7a` / `02da7e0f`; per invoice P5-4 `68f10b94` + P5-5
`a05769b7`). `lib/trips/redelivery.ts` + the pure `lib/order-invoices/redelivery-plan.ts`; route
`/api/floor/trips/[id]/redeliveries`. The per-invoice rule → `CLAUDE_ORDER_INVOICES.md §4.8`.

- **It never writes `orders`** (no `order_status_logs` row either) and never moves the bill's own trip
  pointer: the bill — every invoice row of it — keeps its FIRST trip's `tripDropId`. It writes only
  `trip_redeliveries`, `trip_drops` (`findOrCreateTripDrop`, the stop is shared with ordinary bills of
  that customer) and `trip_activity`. Cancelled trips are ignored in every history / attempt sum.
- **One row per INVOICE ROW per trip** (UNIQUE `trip_redeliveries_trip_invoice_key`, v27.74). An
  unsplit bill = one row on its seq-1 row (`orderIds`). A SPLIT OBD = one row per TICKED invoice
  (`invoiceRowIds`); a split OBD sent whole is refused: "This bill has several invoices — tick the ones
  going back out." Two invoices of one OBD share one stop. 🔴 *History: until v27.74 (2026-10-23) one
  row per (trip, OBD) — UNIQUE `trip_redeliveries_trip_order_key`, dropped by PART 7. Do not bring the
  per-OBD row back.*
- **Attempts are per invoice.** History = the invoice's own stop trip + every re-delivery naming it
  (unsplit: the OBD's stops + its re-deliveries, one per trip). `attemptNo = max(2, 1 + history)`,
  `prevTripId` = the last entry's trip.
- **Add**, `POST { action: "add", orderIds? | invoiceRowIds?, reason, note?, confirmedReturn? }` (≤ 200
  ids; note ≤ 500 chars; reason `site_closed` "Shop / site closed" or `wrong_dispatch` "Wrong dispatch",
  `lib/trips/redelivery-reasons.ts`). Refusals word for word: "Not gone out yet — add it to a trip
  normally." (not at `pick_checked` / `dispatched`, or an invoice that never went on a truck) · "On hold —
  release it before it goes out again." (a held invoice) · "Already on this trip" · "This bill was
  removed — it cannot be re-delivered." · "This trip is cancelled — re-deliveries cannot be added." ·
  "This trip has been dispatched — re-deliveries cannot be added." · "This is a Hand trip (dealer
  collects) — re-deliveries go on a truck trip." · "This bill has no invoice row — it cannot be
  re-delivered. Tell the office." When the latest attempt is dated today or later: "Already on {trip}
  today. Add only if that truck came back." — then the **"Truck came back"** tick (`confirmedReturn`,
  stored) is required, else "Tick Truck came back". One `redelivery_added` row per press.
- **Remove**, `POST { action: "remove", redeliveryIds }` — the row is DELETED, then
  `deleteTripDropIfEmpty`; "Not on this trip"; "Cannot change the re-deliveries on a {status} trip."
  (409). One `redelivery_removed` row. From the board: tick the RE-DEL row (`rd:<id>`) → Remove from
  trip.
- **Search**, `GET ?q=` — one full OBD, SO or invoice number ("q must be one full OBD, SO or invoice
  number"); a split OBD returns one candidate per invoice (k/n); removed bills are not returned.
- **The dialog** (`components/floor/trip-redelivery-dialog.tsx`, opened by **Re-delivery** in the trip's
  stops bar; not on a Hand trip): "Re-delivery onto {trip}", one number + Enter, the candidate with its
  "Earlier trips" (date, trip, vehicle, driver, Original / Re-del) and "This will be attempt N"; several
  candidates → "This bill has N invoices. Tick the ones going back out." (or "This number covers N
  bills."); reason pills, an optional note, "Add re-delivery" / "Add N re-deliveries". On the trip the
  bill draws as a **RE-DEL** row (`CLAUDE_FLOOR.md §4.9`) whose button opens the read-only history
  (`trip-redelivery-info.tsx`: attempt, reason, note, "Truck came back ✓", who added it, earlier trips
  with vehicle and driver).
- **Counting.** The trip card's "+N re-del" counts OBDs (`redeliveryCountsByTrip`); re-deliveries are
  **NOT in "N bills", the buckets or `isReady`**, but their stop counts in "N stops", and their LOAD is in
  the trip's litres / kg — only the named invoices' (`loadRedeliveryLoads` → `invoicesLoad`). ⚠ The
  stops bar's "{n} re-del" counts ROWS, so one split OBD re-delivered as two invoices reads "2 re-del" on
  the stop and "+1 re-del" on the card. Recorded, not fixed.
- **Live example — order 18648 (OBD 9109951956) on trip 668, L-261007-20:** re-delivery **28** → row
  36798 (I536230713) and **86** → row 36800 (I536230715), both attempt 2, `prevTripId` 605
  (L-261006-05); the card counts ONE re-delivery and the load is those two invoices', 460 L. The story
  → `CLAUDE_ORDER_INVOICES.md §7`.
- **Other readers:** the trip sheet lists re-delivered bills (`redel: true`, only the named invoices;
  held or removed skipped); the picking trips view counts a re-delivery stop as having bills; cancel
  keeps the rows and lists them in its log; `deleteTripDropIfEmpty` refuses while one remains; Add
  invoices refuses a plan that would delete an invoice row a re-delivery names
  (`CLAUDE_ORDER_INVOICES.md §5`).

---

## 13. The invariant: no trip action changes a bill's status or hold

`app/api/floor/trips/[id]/confirm/route.ts` (8eaa4663): *"IT TOUCHES NO ORDER ROW. NOT ONE COLUMN,
NOT ONE LOG ROW. … NO TRIP ACTION MAY CHANGE A BILL'S STATUS OR ITS HOLD. … Do not put a call to
lib/floor/release.ts or lib/picking/visibility-gate.ts back in this file."*

Was a full floor release over the trip's bills (`POST /api/floor/trips/[id]/release`) until 2026-09-14; now trips-only (8eaa4663). Do not revert.

| Trip action | Writes to `orders` (and invoice rows) |
|---|---|
| Create, PATCH, confirm, show, send to billing, re-delivery add / remove | none |
| Add / remove / move a bill | through **`setRowsTrip`** only: the bill's invoice rows on this trip first (one `order_invoices.updateMany`), then exactly **one** `orders.update` per bill — the derived `tripDropId` and `partlyOnTrip`, nothing else. A retry converges. Contract → `CLAUDE_ORDER_INVOICES.md §4.3` |
| Cancel | the same, per bill, `setRowsTrip(…, "all", null, { onlyFromTripId })` — every row on THIS trip off, one `orders.update`. No `isRemoved` filter, so no pointer outlives the trip |
| Dispatch (no caller) | the one exception: marks bills / invoices **dispatched** with a log row (§14) |

- **No `order_status_logs` row** for attach, detach, move or cancel. Membership is not a stage event.
  The trip's activity row is the record.
- **Membership is not gated by stage.** A bill can join a trip at any `workflowStage`. Do not add a
  stage guard. (A HELD or CI'd INVOICE of a split OBD is refused — that is a per-invoice state, not a
  stage, §7.1.)
- **Why one write per bill:** the live-sync markers key on `MAX(orders.updatedAt)`; a second write
  fires a false "changed" on every board (`CLAUDE_PICKING.md` §10). A skip writes nothing. The invoice-row
  write fires its own `live_changes` lines (v27.65 / v27.66), so the live feed sees a row move even when
  the OBD's derived columns do not change.
- A trip-only write (show, send, PATCH, copy, re-delivery) does not move `orders.updatedAt`, so the Floor
  MARKER does not see it (§17 item 10); the live feed does, through the `trips` / `trip_drops` /
  `trip_activity` / `trip_redeliveries` / `trip_bill_copies` triggers (`CLAUDE_FLOOR.md §5`).

---

## 14. Who writes `workflowStage = 'dispatched'` — now per invoice

**Counts.** Live 2026-10-24: **7,361** orders at `workflowStage = 'dispatched'` (7,330 on 2026-09-18).
**263** "Dispatched with trip …" log rows, the latest **2026-09-18 04:27 UTC**. Live trips at
`status = 'dispatched'`: **45**, with only **5** `dispatched` activity rows. Code comments still claim
4,137 (`lib/workflow-stages.ts`, `lib/floor/queries.ts`) and 7,067 (`lib/floor/dispatch.ts`) — dated
claims.

**The writers in the repo today:**

| # | Writer | Called? |
|---|---|---|
| 1 | `POST /api/floor/trips/[id]/dispatch` → `markBillsDispatched` (`lib/floor/dispatch.ts`). Bills found through `onStopsWhere`. **Unsplit bill:** only `pick_checked`, not held, moves to `dispatched` — one `orders.update` + one log ("Dispatched with trip …"), then `mirrorObdDispatchedSafe` copies it onto the seq-1 row. **Split OBD** (6.4, `4c97fd2f`): `markRowsDispatched` (`lib/order-invoices/dispatch.ts`) marks only ITS invoices on this trip `isDispatched` (never a held one — "… is on hold — it does not go"); the OBD itself goes to `dispatched` only when the **done rule** holds (`CLAUDE_ORDER_INVOICES.md §3`, §4.5). The trip closes (status + `dispatchedAt/ById`) when no non-held bill is left un-dispatched, a split OBD with nothing left on this trip counting as settled; otherwise the response lists `notDispatched` / `held`. 409 "This trip was cancelled — its bills are back at the desk."; 422 "This trip has no bills to dispatch."; already closed → `alreadyClosed: true` | **No client caller** (since slice 7, 3b9d1ab4) — kept for the supervisor's future **loading screen** (ROADMAP) |
| 2 | `settleObdDone` (`lib/order-invoices/dispatch.ts`) from Floor's per-invoice Raise CI (`lib/floor/raise-ci.ts`): when the last open invoice is returned and at least one really shipped, the OBD goes to `dispatched` — "Dispatched — last open invoice returned on {CI}" | yes, but only on a split OBD (live: 1 split OBD, 0 CIs on it) |
| 3 | The archived planning board (`archive/2026-07-planning-board/…/loading-complete`) | No — archived, outside `app/`, excluded by `tsconfig.json` |

No import, `updateMany`, script or SQL file in the repo writes `dispatched` (the 2026-09-18 sweep of
`app/`, `lib/`, `scripts/`, `sql/`, `db/`, `docs/Powershell/`, `docs/Parser/`, drafts and `archive/`
stands; re-checked 2026-10-24 for the two new writers above only). Hand-run sweeps recorded in code
comments (claims): 136 bills on 2026-09-13 12:58:49 UTC with no log rows (`lib/floor/dispatch.ts`); "A
cutover on 2026-09-11 closed 2,624 historical bills to `dispatched`" (`scripts/backfill-nts-trips-2026-09-11.ts`).

**Conclusion.** The app writes `dispatched` only through route 1 (no caller) and, for a split OBD, the
CI-finishes-it path. So the net +31 orders at `dispatched` since 2026-09-18 (no "Dispatched with trip" log is
later than that date), and ≥ 40 of the 45 dispatched TRIPS, came from **outside the
app (hand SQL)**. 🔴 **After any such SQL sweep of `dispatched` / hold, run the unsplit invoice-row mirror
(`sql/2026-10-19-part3b-hold-mirror-rerun.sql`, PART 1 → 1b → 2 → 3 → 4) and never hand-sweep a split
OBD** — `CLAUDE_ORDER_INVOICES.md §6`.

Consequences in code: the cancel route refuses a trip holding any dispatched bill; a trip closes only
through route 1; `isReady` and the carry rule treat `dispatched` as done (`bucketFor`, `BILL_NOT_DONE`).

---

## 15. Landmines

1. **Three "trip" systems** (§2). Never mount Orbit trip code under `/api/trips` or `/trips`, never write
   to `trip_report`, and never let Floor-trip code read or write the freight tables (or the reverse) —
   `CLAUDE_FREIGHT_TRIPS.md`.
2. **A new trip status or type letter needs an ALTER first.** `status` and `typeCode` are plain
   Strings; the CHECKs are the backstop (`schema.prisma:3187-3192`). A fifth delivery type also needs
   `TYPE_CODE_BY_DELIVERY_TYPE`.
3. **Change the number format in both places.** `formatTripNumber` / `cancelledTripNumber` and
   `chk_trips_number_shape` must agree. Do not shorten the pad to a bare `lpad(…, 2)` (§5).
4. **Keep both uniques.** The partial index frees the seq; the text unique plus the `-C` rename frees
   the name. Do not model the partial index as `@@unique`.
5. **Retry once, never loop, never `$transaction`** (`number.ts:283-297`).
6. **Compute `dropKey` only through `lib/trips/drop-key.ts`.** Never inline
   `shipToOverrideCustomerId ?? customerId`.
7. **Trip membership is written ONLY by `setRowsTrip`** — invoice rows first, then ONE `orders.update`
   per bill (derived `tripDropId` + `partlyOnTrip`), no `order_status_logs` row, on every trip path
   (§13; contract `CLAUDE_ORDER_INVOICES.md §4.3`). A new trip writer goes through it too; never write
   `orders.tripDropId` or `order_invoices.tripDropId` directly (the one-off
   `scripts/backfill-nts-trips-2026-09-11.ts` predates invoice rows).
8. **Remove and move strip only the named trip's rows** (`onlyFromTripId`). *(Until 2026-10-03 this
   landmine read "the remove path does not check the trip in the URL — it clears whatever stop a bill
   is on"; the URL trip is checked since then, and the per-row check since P5-2.)* Callers still group by
   trip first, and Undo re-reads the trip first.
9. **Driver fields are a snapshot.** Never replace them with a read through `vehicleId`.
10. **The gate fails OFF.** Every uncertain answer shows the supervisor his work. Do not change the
    default direction. `countHeldBackWaiting` must get the **ungated** where, or it returns 0.
11. **Two kept routes look dead and are not.** `confirm` and `dispatch` have no caller by design (§10).
12. **Three different "dispatch" words.** `trips.status = 'dispatched'` (trip closed),
    `orders.dispatchStatus = 'dispatch'` (a decision, not an event), `orders.workflowStage =
    'dispatched'` (goods gone) — and a fourth since 6.4: `order_invoices."isDispatched"` (one INVOICE
    gone; the OBD follows only under the done rule).
13. **Do not read meaning into `orders.pickVisibleAt/ById` or `loadedAt/ById`** (§3.5).
14. **Do not delete trips; delete a drop row only through `deleteTripDropIfEmpty`.** `trip_activity` is
    RESTRICT; cancelled trips and their drops are the record of what was planned (cancel keeps every
    stop). A LIVE trip's stop that empties on remove / move / re-delivery removal is deleted and the
    rest renumbered 1..N (§7). *(Until 2026-10-17 this read "Do not delete trips or drop rows" — replaced
    by the owner's close-up rule.)*
15. **"On THIS trip" is a question for the invoice rows**, never `orders.tripDropId` (§3.5, §8b). A split
    OBD can be on two trips at once.
16. **Counts per OBD, litres / kg per invoice** (owner 2026-10-13) — in "N bills", "+n re-del", stops and
    buckets an OBD is one; its load is only its invoices there (§8b).
17. **A held invoice can't join a trip; an invoice on a trip can't be held** (6.3) — both refused per
    invoice. Re-deliveries refuse a held invoice too.
18. **Never hand-sweep a split OBD's trip / hold / dispatched columns; run the unsplit mirror after any SQL
    sweep** — `CLAUDE_ORDER_INVOICES.md §6`.

### Stale code comments (claims, for a later code-comment pass)

- `app/api/floor/trips/[id]/confirm/route.ts:38-39`: "Mark dispatched renders on every open trip."
  Removed in 3b9d1ab4.
- `lib/trips/queries.ts:151`: "Confirming a trip marks its checked bills dispatched." Not since a501650f.
- `lib/floor/dispatch.ts:18`, `:23-35`: says confirming a trip marks dispatch. The one importer is the
  dispatch route, which has no caller.
- `lib/trips/activity.ts:604` and `app/api/floor/trips/[id]/dispatch/route.ts:173`: "Slice 4 deletes Mark
  dispatched". Slice 4 was dropped; the button left in slice 7 and the route stays.
- `app/api/floor/trips/[id]/dispatch/route.ts:59-60`: "held live by admin, operations and floor_access".
  Access is per user (`CLAUDE_CORE.md` §5).
- `app/api/floor/pick-gate/route.ts:40-41`: "last flipped on 2026-09-14". Live: 2026-09-16.
- `scripts/backfill-nts-trips-2026-09-11.ts:47-50`: lists `loading` in `chk_trips_status`. Live has no
  `loading`.
- `prisma/schema.prisma:1211` (§3.5). `lib/workflow-stages.ts:98` ("NOTHING IN THE APP WRITES IT, 4,137").
- ⚠ The line numbers above are as read on 2026-09-18 and have drifted; find each by its quoted words.
- **Added 2026-10-24** (code at `bb510310`; Add invoices ones are in the canon plan step 4c, batch B6):
  `lib/trips/redelivery.ts` ("not the (tripId, orderId) unique, which PART 7 drops" — dropped);
  `lib/trips/queries.ts`, `lib/order-invoices/trip-read.ts` ("TOTALS STAY PER OBD … Phase 5 makes them
  per row" — already per invoice); `lib/trips/drop.ts` ("from Phase 5 a row can sit on a stop its OBD
  does not point at" — it can, now); `lib/trips/live-trips.ts` ("Until then nothing writes
  `dispatched`"); `lib/trips/drop-key.ts` header (quotes the pre-v27.73 two-branch CHECK); the bills
  route header ("Response:" omits move; "THIS route is the only runtime writer of tripDropId" — cancel
  writes it too, both through `setRowsTrip`); `components/floor/trip-redelivery-dialog.tsx` header ("one
  `trip_redeliveries` row per bill"; "one full OBD or invoice number" — SO too); the `[id]` route header
  ("Gate: floor canEdit" for GET).

---

## 16. Key files index

| File | Role |
|---|---|
| `lib/trips/number.ts` | Type letter, number format, lowest-free allocator, retry, `-C` rename, previous holders |
| `lib/trips/type-choice.ts` | `chooseTripTypeName`: the letter for a mixed selection (client-safe) |
| `lib/trips/drop-key.ts` | `computeDropKey`, `effectiveCustomerId`, `dropShipToCode` (pure) |
| `lib/trips/live-trips.ts` | `tripsOnDeskWhere`, `liveTripsOnDeskWhere`: which trips a desk shows (pure) |
| `lib/trips/queries.ts` | `getTripsForDate`, `getTripDetail`, counts, `isReady`, `deliveryTypes`, route/area labels, `parseTripDate` |
| `lib/trips/route-label.ts` | `rankRouteName`, `PLACEHOLDER_ROUTE_IDS` (20, 25): the "Adajan +2" label (client-safe) |
| `lib/trips/activity.ts` | The 18 actions, one writer per action (`logTripBills` words a move), `getTripActivity` |
| `lib/trips/show.ts` | `setTripShown`, `showTripsHoldingWaitingBills` (no-cliff) |
| `lib/trips/billing.ts` | `setTripSentToBilling` |
| `lib/trips/drop.ts` | `findOrCreateTripDrop`, `deleteTripDropIfEmpty` + `compactTripDropSeq` (§7) |
| `lib/trips/find-bill.ts` | Find a bill by one full OBD / SO / invoice number (search, re-delivery lookup) |
| `lib/trips/redelivery.ts`, `redelivery-reasons.ts` | Re-deliveries: add / remove / histories / attempt no., the reason list (§12b) |
| `lib/trips/diesel-dispatch.ts`, `vehicle-size.ts` | Diesel + manual dispatch time parse / IST format; vehicle size gc / ace / big |
| `lib/trips/load-plan.ts`, `load-plan-v2.ts`, `load-plan-check.ts` (+ 3 tests) | The load-plan engines and the plan-vs-trips check — owned by `CLAUDE_FLOOR.md §2.2` |
| `lib/order-invoices/trip-link.ts`, `trip-bills.ts`, `trip-read.ts`, `invoice-load.ts`, `redelivery-plan.ts`, `dispatch.ts`, `links.ts` | The invoice-row trip writer, its pure plans, the readers, per-invoice load, re-delivery and dispatched rules, which row a record names — **owned by `CLAUDE_ORDER_INVOICES.md`** (§9 there); the trip routes call them |
| `lib/trip-sheet/*`, `app/trip-sheets/**`, `app/api/trip-sheets/**` | Trip Sheets (page key `trip_sheet` or `floor`) and the per-group share log (`trip_share_log`, v27.71) — read trips, write only the share log. No domain file owns them yet (CORE §7.16 has the table) |
| `lib/picking/visibility-gate.ts` | Gate key, `isPickGateOn`, `WAITING_FOR_PICKER`, `waitingBranchWhere`, `countHeldBackWaiting` |
| `lib/floor/scope.ts` | `tripInScope`, `tripMixLabel` (the trip rules only; the rest is Floor's) |
| `lib/floor/dispatch.ts` | `markBillsDispatched` — unsplit bills + the split-OBD hand-off to `markRowsDispatched` (§14; unreachable from the UI) |
| `app/api/floor/trips/route.ts` | GET list / POST create |
| `app/api/floor/trips/options/route.ts` | Dropdown lists (every active transporter) |
| `app/api/floor/trips/lookup/route.ts` | Which trip a bill is on (no UI caller since 2026-10-06) |
| `app/api/floor/trips/[id]/route.ts` | GET one / PATCH |
| `app/api/floor/trips/[id]/{bills,cancel,show,billing,confirm,dispatch,redeliveries}/route.ts` | The trip actions |
| `components/floor/trip-redelivery-dialog.tsx`, `trip-redelivery-info.tsx` | Re-delivery dialog + the RE-DEL history modal (§12b) |
| `components/floor/trip-fields.tsx` | The create / edit drawer's field groups (timing, vehicle, diesel) |
| `app/api/floor/pick-gate/route.ts` | Read and flip desk control |
| `components/floor/trip-rail.tsx` | The trip list: tab scope, mix chip, cancelled hidden; add / move mode and the `AddToTripConfirm` dialog (§7.1) |
| `components/floor/trip-detail-header.tsx` | Trip sheet, Send to billing, Show to floor, take-backs, Cancel; the stops bar with + Add bills and Re-delivery (§8b) |
| `components/floor/trip-form.tsx`, `trip-vehicle-editor.tsx`, `trip-options.ts` | New trip form, vehicle/details PATCH, option types |
| `components/floor/floor-bottom-bar.tsx` | "+ New trip" / add to target / Remove from trip (a RE-DEL tick → remove the re-delivery) |
| `components/floor/pick-gate-toggle.tsx` | The desk-control switch |
| `components/floor/trip-desk.tsx`, `trip-add-band.tsx`, `trip-bar.tsx`, `trip-history.tsx` | Drawn in the Floor shell (`CLAUDE_FLOOR.md`) |
| `components/floor/trip-selection-bar.tsx` | On disk, **no importer** |
| `scripts/backfill-nts-trips-2026-09-11.ts` | One-time NTS → Orbit trip backfill (run) |
| `sql/2026-09-15-trip-number-reuse.sql`, `-slice6-settle-drafts.sql`, `-slice8-show-per-trip.sql`, `-slice9-print-tab.sql`; `db/slice-2-trip-activity.sql` | Hand-run DDL/data for the slices |
| `FLOOR-TO-FLOOR-DISCOVERY.md` (repo root) | History of slices 1-10. Not canon |

---

## 17. Open items and live state

### Live state (read-only SELECTs, 2026-10-24)

- Trips **1,265**: released 939 · draft 120 (52 are Hand trips, draft for life) · cancelled 161 ·
  **dispatched 45** (only 5 `dispatched` activity rows — §14). Vehicle size set on 203 (gc 41 · ace 78 ·
  big 84). 119 trips billing-Done.
- Stops by key: `c:` 4,887 · `s:` 53 · `t:` 6. **456 stops hold no invoice row and no re-delivery**
  (cancelled trips keep theirs; the rest are pre-close-up leftovers or half-failed moves).
- Re-deliveries 74; `trip_share_log` 326 rows.
- Desk control OFF, last changed 2026-10-14 13:01 UTC.
- 7,361 orders at `workflowStage = 'dispatched'` (§14).
- 8 users hold floor canEdit (6 on 2026-09-18). Transporters: 19 active, 20 marked real.

### Open items

1. **Who writes `dispatched`** (§14). The app's only trip path has no caller; the CI path is split-OBD
   only. The net +31 since 2026-09-18 and ≥ 40 of the 45 dispatched trips came from outside the app.
2. **No trip closes from the app.** `POST …/dispatch` has no caller until the supervisor's loading
   screen exists (ROADMAP, "loading screen dispatch").
3. **The add route enforces no delivery type.** An Upcountry bill can go on a Local trip.
   (`FLOOR-TO-FLOOR-DISCOVERY.md`.) The type-choice rule (§6) now assumes mixed trips are normal; the
   owner has not closed the question.
4. ~~**The remove route clears any stop**~~ — **CLOSED**: remove (and move) strip only the named trip's
   rows (`onlyFromTripId`, since 2026-10-03; per row since P5-2). §7.1, §15 item 8.
5. ~~**Moving a bill between trips** is not built~~ — **CLOSED 2026-10-17** (`c460367a`): `action:
   "move"` with a confirm (§7.1).
6. ~~**Held bills on trips**~~ — **CLOSED 2026-10-19** (6.3): a held INVOICE of a split OBD cannot join a
   trip ("… is on hold — release it first"), an invoice of a split OBD on a trip cannot be held; a held
   unsplit bill is never in the pool. Clearing a hold is Floor's (`CLAUDE_FLOOR.md §4.2`).
7. **Orphan `trip_drops`**: cancel keeps empty stops on purpose; a live trip's stops now close up on
   remove / move (§7), but 456 empty stops exist live (above) and a half-failed move can leave one. A
   light cleanup on the next trip read → ROADMAP. Whether to touch cancelled trips' stops stays an owner
   decision.
8. **Reordering stops** is not built: `compactTripDropSeq` only closes gaps after a delete; no route
   lets a planner reorder.
9. **A stop's customer snapshot never refreshes**. Undocumented whether that is intended.
10. **Trip-only writes are invisible to the Floor MARKER** (another planner's show, take-back or billing
    copy). With the live feed ON (the live path, `CLAUDE_FLOOR.md §5`) the trip triggers reach the desk;
    the gap remains only on the old marker path.
11. **GET list canEdit vs board canView** (§10). Latent while no view-only floor user exists.
12. ~~**Vehicle type on a trip** is not built~~ — built: `trips.vehicleSize` gc / ace / big
    (2026-09-21, `7aa24160`; its SQL ran live but is not yet minted in CORE's chain).
13. **Response-shape defect — found by reading, UNVERIFIED.** `GET /api/floor/trips/[id]` returns
    `{ trip }`, but `floor-page.tsx`'s `undoAdd` and the add receipt in `addSelectionToTrip` (toast
    branch) still cast the body itself as `TripDetail` (re-read 2026-10-24). `undoAdd` would then read
    `detail.drops.flatMap` on `undefined` and fall into its catch ("Could not undo — check your
    connection."); the toast branch would read `after.counts.total` on `undefined` and throw after the add has already succeeded. The move path
    (`undoMove`) reads `.trip` correctly. **Not tested by hand:** the owner's 2026-10-17 test list did
    NOT include Undo after an add (correction 2026-10-24 — an earlier canon line, B2, wrongly called it
    tested and working). Reproduce before fixing; do not fix blind.
14. ~~**Transporter dropdown may be empty** until `isRealTransporter` is marked~~ — **CLOSED 2026-10-24**
    (`cc59d00a`): the picker lists every active transporter.
15. **Floor rows for later-dated bills on today's trip** get no explanation on screen. Not re-verified.
16. **Copied bills move freely** (owner 2026-10-17): the `trip_bill_copies` row stays on the source trip,
    so a moved bill reads "not copied" on the target — billing could copy it twice. Deferred to the
    billing-workflow redesign (ROADMAP).
17. **Re-delivery count mismatch:** the stops bar counts re-delivery ROWS, the card counts OBDs (§12b).
18. **Move popup's waiting count** over-counts tint-room bills (the board row carries no stage); the
    source's "After" stop count uses the open trip's detail when loaded. Accuracy → ROADMAP.

### Data quality (live reads)

- **2026-10-09:** typed plates "HAND" (10 trips) and "CI" (1) seen in `adhocVehicleNo` on transporter 4 (Nagadhiraj) trips with `isHand = false` — staff should use the **Hand trip** switch instead. The NTS Trips report includes them, printed as typed, by owner decision.

### Questions for Smart Flow (need a DB read)

*Answered by the read-only SELECTs of 2026-10-24 (see Live state):* "Dispatched with trip" logs (263, the
latest 2026-09-18 04:27 UTC) · trips by status (45 dispatched) · `isRealTransporter` (20; no longer read)
· `trip_drops` holding no bills (456).

Still open:
- Who set the 45 dispatched trips and the orders that reached `dispatched` after 2026-09-18 — which hand
  SQL, and was the invoice-row mirror run after it (`CLAUDE_ORDER_INVOICES.md §6`)?
- The live `orders_tripDropId_fkey` delete rule and the `app_settings` constraints (not in the 2026-09-18
  results).

---

## Change log — v1.4 (2026-10-24, canon batch B3: Add invoices on the trip side, and a reconciliation to Schema v27.74)

Evidence: the code at `bb510310` (Add invoices `e0d2989f` writer, readers A / B / C `7203d9f3` · `912f17ec` · `a4fcbc72`, P5-1 – P5-5, 6.3, 6.4; the rail add confirm `34b7c6ab` and move `c460367a`; the other sessions' trip commits since 2026-09-18 — re-deliveries, Hand trips, vehicle size, diesel + manual dispatch time, Print v2, the gate hiding To plan, typed drop keys, the transporter picker), three read-only code sweeps re-checked at the claims below, the trip-move draft's trip-side part, and read-only SELECTs on 2026-10-24. Plan: `docs/prompts/drafts/code-discovery-2026-10-24-canon-add-invoices.md` (step 4a, FLOOR_TRIPS rows). The invoice-row rules are not restated — they are `CLAUDE_ORDER_INVOICES.md`'s.

- §1: owns re-deliveries, Hand trips / vehicle size / diesel / manual dispatch time, add / remove / move; 21 `lib/trips` files, 11 routes, 18 actions; cross-refs to ORDER_INVOICES (the writer contract, the model), BILLING §7 (copies per invoice row), CORE §7.16 (trip sheets / share log).
- §3: **corrected** §3.5 — the trip pointer is `order_invoices.tripDropId`; `orders.tripDropId` is DERIVED (lowest-seq row); `partlyOnTrip`; `isRealTransporter` no longer read. §3.1 gains `billingDoneAt/ById`, `isHand`, `vehicleSize`, `dieselAmount`, `manualDispatchAt`. §3.2: the app writes `t:` keys since 2026-10-20 (was "writes no t: key yet"). §3.3: **18** actions, not 14. §3.4: the live-feed keys share `app_settings`; gate live state 2026-10-24. Line-number headings replaced by model names.
- §4: the dispatch row; 45 dispatched trips live; `isReady` counts per OBD, re-deliveries out of it; PATCH fields.
- §7: **rewritten** — typed key first; `findOrCreateTripDrop`; empty stops are deleted and renumbered (with the 2026-10-17 do-not-revert line, replacing "gaps left alone"); cancel per row, drops kept. **New §7.1** add / remove / move through `setRowsTrip` (contract → ORDER_INVOICES §4.3), every refusal, move with its half-failure, the do-not-split-the-move line, the client-side confirm and Undo, Hand rules, no past-day server rule; **corrected** "a bill is on at most one trip" (unsplit only).
- §8: `BILL_NOT_DONE` + the `seq > 1` branch. **New §8b** — readers A / B / C through invoice rows; counts per OBD, load per invoice; what the trip card and header show.
- §9: the 18-action table with live counts; `invoices_copied` historical; a move's two rows.
- §10: the route table re-read (lookup, redeliveries; gates; no line numbers); four crons; every active transporter (`cc59d00a`).
- §11: **corrected** — gate ON hides To plan bills too (2026-09-21, `08d3c413`); the predicate reads `ON_SHOWN_TRIP_WHERE`; `countHeldBackWaiting` returns `unplanned`; the four mirrored sites.
- §12: **corrected** — take-back is always allowed (lock removed 2026-10-05, do-not-restore line); the new refusals; Billing done label; copies → BILLING §7. **New §12b Re-deliveries** (per invoice row, attempts per invoice, every refusal, the dialog, counting, trip 668 / order 18648, readers; per-OBD row history line).
- §13: membership writes through `setRowsTrip`; move and cancel rows; the live feed sees trip-only writes.
- §14: **rewritten** — the dispatch route per invoice + the done rule, `settleObdDone` from per-invoice CI, live counts (7,361 · 263 logs, the latest 2026-09-18 · 45 dispatched trips vs 5 activity rows), the mirror rule after a SQL sweep.
- §15: landmines 7 (only `setRowsTrip`), 8 (**corrected** — remove checks the trip), 12 (`isDispatched`), 14 (**corrected** — drop rows are deleted through `deleteTripDropIfEmpty`), new 15–18; stale comments added.
- §16: 14 files / groups added, incl. `lib/order-invoices/*` (owned by ORDER_INVOICES) and trip sheets.
- §17: live state 2026-10-24; items 4, 5, 6, 12, 14 **closed**; item 13 recorded as **UNVERIFIED** (owner correction 2026-10-24: Undo after add was not hand-tested on 2026-10-17); new items 16–18; questions answered.
- Schema stamp **v27.24 → v27.74**: reconciled in this pass against CORE v150's chain for every version that touches a trip table (v27.41, v27.53, v27.54, v27.56, v27.61, v27.66, v27.69, v27.71, v27.73, v27.74; the unminted vehicle-size file noted).

---

*CLAUDE_FLOOR_TRIPS.md v1.4 · Schema v27.74 · OrbitOMS · updated 2026-10-24 — Add invoices on the trip side (membership on invoice rows through `setRowsTrip`, readers through rows, counts per OBD / load per invoice, dispatched per invoice, re-deliveries per invoice — new §12b), move between trips + the rail confirm (§7.1), and a reconciliation to v27.74 (18 actions, Hand trips, diesel / dispatch time, take-back lock gone, the gate hides To plan, typed drop keys). Rules → `CLAUDE_ORDER_INVOICES.md`. Prior, v1.3 (2026-10-19) — §3.2 and §7: `trip_drops."shipToText"` and the `t:` branch of `chk_trip_drops_key` (CORE v27.73). Prior, v1.2 (2026-10-09) — §1 notes the reports that read `trips` (NTS Trips added); §17 data-quality note on typed "HAND"/"CI" plates. Prior, v1.1 (2026-10-03) — §2 and landmine 1: THREE trip systems (Freight trips added). Prior, v1.0 (2026-09-18) — first canonical file for Orbit's own trips. Written from the code at ec6343ba and the live results of 2026-09-18; drafts are history.*
