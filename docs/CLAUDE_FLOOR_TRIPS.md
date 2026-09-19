# CLAUDE_FLOOR_TRIPS.md — Floor Trips (Orbit's own truck plan)
# v1.0 · Schema v27.24 · September 2026 · updated 2026-09-18 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md + docs/CLAUDE_FLOOR.md

Trip tables / new columns are live-verified 2026-09-18; their schema version numbers are assigned in the CORE pass (batch C2).

---

## 1. What it is, and the ownership boundary

A **trip** is one truck load that Orbit plans on `/floor`. The planner creates it, puts bills on it
(each customer becomes one **drop**, or stop), sets a vehicle, shows it to the floor and sends it to
billing. Every trip has its own number: `L-260918-03` (type letter, date, sequence).

This is **not** the NTS trip mirror. See §2 before touching anything named "trip".

### What this file owns

| Owned here | Where |
|---|---|
| The tables `trips`, `trip_drops` and `trip_activity`, the `app_settings` row `picking.visibilityGate`, and the trip columns on `orders` / `transporter_master` | §3 |
| `lib/trips/*`: all nine files | §16 |
| `/api/floor/trips/*` (9 route files) and `/api/floor/pick-gate` | §10 |
| Trip numbering, the cancelled `-C` rename and number reuse | §5 |
| Type choice for a mixed selection, and which trips a delivery-type tab lists | §6 |
| The drop key and stop order | §7 |
| Which trips a desk is about (`lib/trips/live-trips.ts`) | §8 |
| The activity log and its 14 actions | §9 |
| The pick visibility gate ("desk control"): the key, `/api/floor/pick-gate`, `lib/picking/visibility-gate.ts`, and Show to floor | §11 |
| Send to billing and its take-back (the trip side) | §12 |
| The rule that no trip action changes a bill's status or hold | §13 |

### What it does not own (cross-reference only)

| Behaviour | Owner |
|---|---|
| The `/floor` screen shell (`TripDesk` layout, the pool, the table, tabs, detail panel), the board predicate `floorBoardWhere` and its four arms, the bill actions (hold / cancel / release / change-slot), and Floor live sync | `CLAUDE_FLOOR.md` §2–§5 |
| The Billing **Print** tab that consumes Send to billing: `billing_print`, `/api/billing/print/*`, the copy rules, `billingCopiedAt` writes | `CLAUDE_BILLING.md` §7 |
| The NTS mirror: `trip_report`, `/trips`, `/api/trips`, the puller | `CLAUDE_TRIP_REPORT.md` |
| **Applying** the gate: `buildPickingWhere` ORs `waitingBranchWhere(gateOn)` into the Assign tab (`lib/picking/queue.ts:398`), the held-back band, the picking marker | `CLAUDE_PICKING.md` §5, §10. This file owns the gate's **definition** (the key, the predicate, the count); Picking owns where it is applied |
| The stage ladder and `lib/workflow-stages.ts` | `CLAUDE_PICKING.md` §2 |
| `checkAnyPermission`, `PageKey`, per-user access | `CLAUDE_CORE.md` §5 |
| Soft-delete reads, the `$transaction` ban, `force-dynamic`, the status-string rule | `CLAUDE_CORE.md` §3 |

The trip components under `components/floor/` (`trip-*.tsx`, `pick-gate-toggle.tsx`,
`floor-bottom-bar.tsx`) are drawn inside the Floor shell. This file records only what they do to a
trip: which route they call and which trip rule they apply.

---

## 2. The naming collision

Two separate systems carry the word "trip". The code keeps them apart on purpose.
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

### 3.1 `trips` (`prisma/schema.prisma:3245-3315`)

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
| `billingCopiedAt/ById` | timestamptz / Int? → users | Written by the Print tab (`CLAUDE_BILLING.md` §7) |
| `createdAt`, `createdById` → users, `updatedAt` | | |

Live constraints (live 2026-09-18):

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

### 3.2 `trip_drops` (`prisma/schema.prisma:3365-3396`)

One row per stop (customer) on a trip.

| Column | Notes |
|---|---|
| `tripId` → trips | **ON DELETE CASCADE** |
| `dropSeq` | Stop order. MAX+1 at creation. Gaps allowed (§7) |
| `customerId` → `delivery_point_master` | Null for an unmatched bill |
| `shipToCode` | Always SAP's own ship-to code, NOT NULL |
| `dropKey` | `c:<customerId>` or `s:<shipToCode>` (§7). No default |
| `customerName`, `areaName`, `routeName` | Snapshot taken when the stop is created |
| `note`, `createdAt` | |

Live: `chk_trip_drops_key` (`dropKey = CASE WHEN customerId NOT NULL THEN 'c:'||customerId ELSE 's:'||shipToCode END`),
`chk_trip_drops_seq_positive` (`dropSeq >= 1`), UNIQUE `trip_drops_trip_key_key` (`tripId`, `dropKey`),
UNIQUE `trip_drops_trip_seq_key` (`tripId`, `dropSeq`), indexes `trip_drops_trip_idx` and
`trip_drops_customer_idx`, `customerId` FK default rule.

### 3.3 `trip_activity` (`prisma/schema.prisma:3450` onward)

`id`, `tripId` → trips (**ON DELETE RESTRICT**), `action`, `actorId` → users (default rule), `summary`,
`detail Json?`, `createdAt`. Indexes `trip_activity_trip_idx` (`tripId`, `createdAt`) and
`trip_activity_created_idx` (`createdAt` DESC).

Live `chk_trip_activity_action` admits exactly 14 values: `created`, `bills_added`, `bills_removed`,
`vehicle_changed`, `details_changed`, `cancelled`, `released`, `dispatched`, `renamed`, `shown`,
`taken_back`, `sent_to_billing`, `taken_back_from_billing`, `invoices_copied`. The TypeScript twin is
`TRIP_ACTIONS` (`lib/trips/activity.ts:112-127`).

Because of RESTRICT, a trip with any history cannot be deleted. Trips are cancelled, never deleted.

### 3.4 `app_settings` (`prisma/schema.prisma:1220-1231`)

`id`, `settingKey` (UNIQUE), `isEnabled` (default false), `updatedById` → users, `updatedAt`. One row
per named switch. The only key in code is `picking.visibilityGate` (§11). This is not
`app_tag_settings` (per-badge, default ON). This one is per-flag and default OFF.

Live 2026-09-18: one row, `picking.visibilityGate`, `isEnabled = false`, last changed
2026-09-16 09:07 UTC by Harsh.

### 3.5 Columns on existing tables

| Column | Live (2026-09-18) | Status |
|---|---|---|
| `orders.tripDropId` | integer, nullable | **The one trip pointer.** Prisma `onDelete: SetNull` (`schema.prisma:1066-1067`), `@@index([tripDropId])` (`:1112`). There is no `orders.tripId` column, by design. Reach the trip through `trip_drops.tripId` |
| `transporter_master.isRealTransporter` | boolean, NOT NULL, default false | Filters the transporter dropdown (`app/api/floor/trips/options/route.ts:76-80`). Separate from `isActive` |
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
| `released` → `dispatched` | `POST /api/floor/trips/[id]/dispatch`, only when no bill is left outstanding (`dispatch/route.ts:152-170`) | **no** (no caller since slice 7, 3b9d1ab4) | status + `dispatchedAt/ById` together |
| `draft`/`released` → `cancelled` | `POST /api/floor/trips/[id]/cancel` | yes (`floor-page.tsx:821`) | renames to `-C…`, stamps, detaches bills (§5) |

**Reachable today:** `draft`, `released`, `cancelled`. **Unreachable:** `dispatched` (no caller).
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
- **The delivery type cannot be changed.** PATCH refuses `deliveryTypeId` with a 400, because it would
  re-number the trip (`[id]/route.ts:92-100`, `:134-143`).
- **A cancelled trip refuses every edit** with 409 (`[id]/route.ts:107-108`).
- `isReady` is derived at read time, never stored: at least one non-held bill, and every non-held bill
  checked or dispatched (`lib/trips/queries.ts:728-731`, `bucketFor` `:263-282`). A hold outranks the
  stage in the counts.

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

**The drop key** is the only stop identity, computed in one place (`lib/trips/drop-key.ts`):

- `c:<customerId>` when the **effective** customer resolves: `shipToOverrideCustomerId ?? customerId`
  (`effectiveCustomerId`, `:61-63`; `computeDropKey`, `:86-91`).
- `s:<shipToCustomerId>` otherwise: SAP's own code.
- The prefixes keep two id spaces from colliding onto one stop (`:19-24`). `chk_trip_drops_key`
  rejects a wrong value (§3.2).
- Known limit: a free-text ship-to redirect that never resolved to a master row groups under the
  **original** customer (`:79-84`).

**Adding a bill** (`app/api/floor/trips/[id]/bills/route.ts`, action `add`): find the stop by
(`tripId`, `dropKey`) or create it with `dropSeq = MAX + 1` (`:202-220`). The stop's name, area and
route are copied from the effective customer at creation. The name falls back to SAP's ship-to name,
then to `(Unmatched)` (`:255-258`). A second bill for the same stop reuses the row and does not refresh
the snapshot.

**A bill is on at most one trip.** Adding a bill already on another trip is refused ("Already on
L-… — remove it from that trip first", `:189-195`). The same stop on the same trip is a skip.

**Removing** sets `tripDropId = null`. If the stop then holds nothing, including soft-removed bills,
the stop row is deleted (`:155-167`). Gaps in `dropSeq` are left alone. Uniqueness is on
(`tripId`, `dropSeq`), not contiguity. Nothing reorders stops: no route writes `dropSeq` after creation.

**Cancelling** detaches every bill and **keeps** the drop rows as the record of the plan
(`cancel/route.ts:42-46`).

---

## 8. Which trips a desk shows

`lib/trips/live-trips.ts` is the one definition. The trips feed (`getTripsForDate`,
`lib/trips/queries.ts:780-793`) and Floor's board trip arm (`floorTripBillsWhere`,
`lib/floor/queries.ts:315`, owned by `CLAUDE_FLOOR.md`) both derive from it.

`tripsOnDeskWhere(deskDate, todayDate)` (`live-trips.ts:115-123`):

- **Today's desk:** trips dated today (empty ones included), **plus** any trip from an earlier day that
  still holds a bill that is **not done**. Not done = not removed, not at `pick_checked`, `dispatched`
  or `cancelled`, and not on hold (`:60`, `:68-72`).
- **A past day's desk:** trips dated that day only.

The status plays no part. A carried trip keeps its real `tripDate`. `liveTripsOnDeskWhere` is the same
rule minus cancelled trips, for the board arm (`:150-152`). The trips feed returns cancelled trips for
their own day, newest created first (`queries.ts:793`). The trip list drops cancelled trips at
render (`trip-rail.tsx:159`).

---

## 9. The activity log

`lib/trips/activity.ts` is the one writer. One row **per press**, never per bill. `writeActivity`
**swallows its own failure** and logs to the console, so a failed log row never turns a successful
action into a 500 (`:149-172`). The trip's own stamp columns stay; the log records what happens between
them.

| Action | Writer | Reachable today? |
|---|---|---|
| `created` | `POST /api/floor/trips` (`route.ts:298`) | yes |
| `bills_added`, `bills_removed` | `POST …/[id]/bills` (`bills/route.ts:285`). One row per press, only the bills that actually moved | yes |
| `vehicle_changed` | `PATCH …/[id]` (`[id]/route.ts:394`). Before → after plate, plus the transporter the vehicle brought | yes |
| `details_changed` | `PATCH …/[id]` (`[id]/route.ts:405`). Slot, transporter, note, docket | yes |
| `cancelled` | `POST …/[id]/cancel` (`cancel/route.ts:199`). Written **before** the detach loop, with every OBD on the trip | yes |
| `renamed` | SQL only: `sql/2026-09-15-trip-number-reuse.sql:147-150` | no (one-off) |
| `shown` | `lib/trips/show.ts:89` (button) and `:159` (desk control turned on) | yes, but the show route refuses while the gate is OFF (live OFF) |
| `taken_back` | `lib/trips/show.ts:97` | same as `shown` |
| `sent_to_billing`, `taken_back_from_billing` | `lib/trips/billing.ts:94`, `:102` | yes |
| `invoices_copied` | `lib/billing/print.ts:434` (Print tab copy; `CLAUDE_BILLING.md` §7). `detail.invoiceNos` is the only record of which numbers billing has taken. Never rewrite these rows | yes |
| `released` | `POST …/[id]/confirm` (`confirm/route.ts:124`); `sql/2026-09-15-slice6-settle-drafts.sql:64-67` | **no** (no caller). A vehicle-driven release logs `confirmed: true` inside its `created` / `vehicle_changed` row instead |
| `dispatched` | `POST …/[id]/dispatch` (`dispatch/route.ts:180`) | **no** (no caller) |

Every action stays in the list and in the CHECK even when its writer goes. Old rows outlive their
writers (`activity.ts:103-106`). `getTripActivity` (`:656`) reads one trip's history oldest first. It
runs only when one trip is opened, never on the board feed.

---

## 10. API routes

Page key is `"floor"` (member of the `PageKey` union, `lib/permissions.ts:205-209`); actions are from
the `ActionKey` union (`:322-327`). Every route calls `checkAnyPermission(roles, "floor", …)`, exports
`dynamic = "force-dynamic"`, and uses sequential awaits.

| Route | Method | Gate | Client caller |
|---|---|---|---|
| `/api/floor/trips?date=` | GET | `floor` canEdit (`route.ts:68`) | `components/floor/floor-page.tsx:351` |
| `/api/floor/trips` | POST | `floor` canEdit (`:134`) | `components/floor/trip-form.tsx:102`; `floor-page.tsx:1500` |
| `/api/floor/trips/options` | GET | `floor` canEdit (`options/route.ts:46`) | `floor-page.tsx:470`, `:851`, `:1483` |
| `/api/floor/trips/[id]` | GET | `floor` **canView** (`[id]/route.ts:37`) | `floor-page.tsx:524`, `:572`, `:707` |
| `/api/floor/trips/[id]` | PATCH | `floor` canEdit (`:122`) | `components/floor/trip-vehicle-editor.tsx:105` |
| `/api/floor/trips/[id]/bills` | POST | `floor` canEdit (`bills/route.ts:57`) | `floor-page.tsx:586`, `:678`, `:777`, `:1520`; `trip-form.tsx:131` |
| `/api/floor/trips/[id]/cancel` | POST | `floor` canEdit (`cancel/route.ts:73`) | `floor-page.tsx:821` |
| `/api/floor/trips/[id]/show` | POST | `floor` canEdit (`show/route.ts:44`) | `floor-page.tsx:917` |
| `/api/floor/trips/[id]/billing` | POST | `floor` canEdit (`billing/route.ts:33`) | `floor-page.tsx:959` |
| `/api/floor/trips/[id]/confirm` | POST | `floor` canEdit (`confirm/route.ts:61`) | **NO CALLER — kept on purpose.** `confirm/route.ts:34-39`: *"NO CALLER ON THE FLOOR SCREEN SINCE SLICE 6 … This route is kept as the plain API for the same move."* |
| `/api/floor/trips/[id]/dispatch` | POST | `floor` canEdit (`dispatch/route.ts:73`) | **NO CALLER — kept on purpose.** `dispatch/route.ts:14-19`: *"NO CALLER SINCE SLICE 7 (2026-09-15), AND KEPT ON PURPOSE … The supervisor's future loading screen … will call THIS route when loading ends … Do not delete it as dead code."* |
| `/api/floor/pick-gate` | GET | `floor` canEdit (`pick-gate/route.ts:54`) | `floor-page.tsx:430` |
| `/api/floor/pick-gate` | POST | `floor` canEdit (`:75`) | `components/floor/pick-gate-toggle.tsx:59` |

No caller was found by grep over `components/` and `app/` for either kept route, and neither is in
`vercel.json` (which holds two attendance crons only).

⚠ **The trips list is gated canEdit while the Floor board is canView** (`app/api/floor/board/route.ts:36`).
The client swallows the failure (`floor-page.tsx:351` `.catch(() => null)`), so a view-only floor user
would see a desk with no trips. `GET /api/floor/trips/[id]` is canView, the list is canEdit. Latent:
live 2026-09-18 has 0 users with floor canView but not canEdit (Q07c); 6 users hold floor canEdit.

`/api/floor/trips/options` returns delivery types, active windows, active vehicles, and transporters
with `isRealTransporter = true AND isActive = true`. The route's own comment says that list is empty
until someone runs the marking UPDATE (`options/route.ts:72-75`). Not verified live.

---

## 11. The pick visibility gate ("desk control")

**What it does.** With the switch ON, a bill **waiting** for a picker appears on the supervisor's
Assign tab only when it is on **no trip**, or on a trip that has been **shown**. OFF, every waiting bill
appears. The planner can bucket bills into trucks and release one truck at a time.

| Part | Where |
|---|---|
| The key | `app_settings.settingKey = 'picking.visibilityGate'`, exported as `PICK_VISIBILITY_GATE_KEY` (`lib/picking/visibility-gate.ts:40`). Never retype it |
| The read | `isPickGateOn()` (`:56-66`). **Default OFF, and fails closed to OFF** on a missing row, `isEnabled` false, a null read, or a thrown query |
| "Waiting" | `WAITING_FOR_PICKER` = not removed, `dispatchStatus = 'dispatch'`, `workflowStage = SUPPORT_DONE_OUTPUT` (`:77-81`) |
| The predicate | `waitingBranchWhere(gateOn)` (`:93-99`). OFF: the bare stage clause. ON: adds `tripDropId IS NULL OR tripDrop.trip.shownAt IS NOT NULL`. **Waiting branch only.** A bill with a picker, picked or checked is never gated |
| The count | `countHeldBackWaiting(boardWhere, gateOn)` (`:136-152`) returns `{ bills, trucks }`, zero with no query when OFF. It must be passed the **ungated** where |
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

Membership moves visibility with no write: adding a waiting bill to an unshown trip hides it at once
(gate ON); removing it or cancelling the trip brings it back (`bills/route.ts:28-34`,
`cancel/route.ts:57-61`).

Live 2026-09-18: the switch is **OFF** (last changed 2026-09-16 09:07 UTC by Harsh), so today nothing
is hidden and every Show press is refused.

---

## 12. Send to billing (the trip side)

`POST /api/floor/trips/[id]/billing`, `{ sent: boolean }` (strict boolean), calls
`setTripSentToBilling` (`lib/trips/billing.ts:39-113`):

- **Send** stamps `trips.sentToBillingAt/ById` and writes `sent_to_billing`. The trip then appears on
  the Billing Print tab. **Refused** (409) on a trip with no bills (`:74-76`). A trip whose every bill is
  held is allowed.
- **Take back** clears both columns and writes `taken_back_from_billing`. **Refused** (409) once
  `trips.billingCopiedAt` is set: "Billing has already copied …'s invoice numbers — it cannot be taken
  back" (`:77-83`).
- Refused on a cancelled or dispatched trip. Idempotent: a repeat press writes nothing.
- The eligible and invoiced counts it returns come from the Print tab's own loader, `loadPrintTrips`
  (`lib/billing/print.ts:121`), so both screens use one definition.
- Writes the trip only, never an order row (`billing/route.ts:16-17`).

Everything after the handoff (the copy, `billingCopiedAt`, new-since-copy, which trips are listed) is
`CLAUDE_BILLING.md` §7.

---

## 13. The invariant: no trip action changes a bill's status or hold

`app/api/floor/trips/[id]/confirm/route.ts:13-26` (8eaa4663): *"IT TOUCHES NO ORDER ROW. NOT ONE COLUMN,
NOT ONE LOG ROW. … NO TRIP ACTION MAY CHANGE A BILL'S STATUS OR ITS HOLD. … Do not put a call to
lib/floor/release.ts or lib/picking/visibility-gate.ts back in this file."*

Was a full floor release over the trip's bills (`POST /api/floor/trips/[id]/release`) until 2026-09-14; now trips-only (8eaa4663). Do not revert.

| Trip action | Writes to `orders` |
|---|---|
| Create, PATCH, confirm, show, send to billing | none |
| Add / remove bill | exactly **one** `orders.update` per bill, `tripDropId` only (`bills/route.ts:148-151`, `:265-268`) |
| Cancel | one `orders.update` per bill, `tripDropId: null` (`cancel/route.ts:223-226`). No `isRemoved` filter, so no pointer outlives the trip (`:212-216`) |
| Dispatch (no caller) | the one exception: `markBillsDispatched` moves `pick_checked`, non-held bills to `dispatched` with a log row (§14) |

- **No `order_status_logs` row** for attach, detach or cancel (`bills/route.ts:40-45`,
  `cancel/route.ts:52-55`). Membership is not a stage event. The trip's activity row is the record.
- **Membership is not gated by stage.** A bill can join a trip at any `workflowStage`
  (`bills/route.ts:21-26`). Do not add a stage guard.
- **Why one write per bill:** the live-sync markers key on `MAX(orders.updatedAt)`; a second write
  fires a false "changed" on every board (`CLAUDE_PICKING.md` §10). A skip writes nothing.
- A trip-only write (show, send, PATCH, copy) does not move `orders.updatedAt`, so the Floor marker
  (`app/api/floor/marker/route.ts:40-43`) does not see it (§17).

---

## 14. OPEN — who writes `workflowStage = 'dispatched'`

Investigation only. Nothing was fixed.

**Counts.** Live 2026-09-18: **7,330** orders at `workflowStage = 'dispatched'`, all not removed (Q09).
Code comments claim **4,137** (`lib/workflow-stages.ts:98`, and `lib/floor/queries.ts:95`) and
**7,067** (`lib/floor/dispatch.ts:6`). Both are dated claims, not current facts.

**Every writer found** (sweeps over `app/`, `lib/`, `components/`, `scripts/`, `sql/`, `db/`,
`docs/Powershell/`, `docs/Parser/`, `archive/`: Prisma `workflowStage: DISPATCHED` / `"dispatched"`,
raw `SET "workflowStage" = 'dispatched'`, `updateMany`, `$executeRaw`, importers of `DISPATCHED`):

| # | Writer | Called? | Evidence |
|---|---|---|---|
| 1 | `markBillsDispatched`, `lib/floor/dispatch.ts:175-179` (`orders.update` + one `order_status_logs` row, note "Dispatched with trip …") | **Not reachable today.** Only importer is `app/api/floor/trips/[id]/dispatch/route.ts:5,139`, which has no client caller and no cron. Reachable only from 3945e6d5 (2026-09-13 20:36 IST, via confirm) through a501650f (2026-09-14, its own button) to 3b9d1ab4 (2026-09-15 13:54 IST, button removed) | grep of `components/`, `app/`; `floor-page.tsx:809-813`; `vercel.json` |
| 2 | `archive/2026-07-planning-board/app/api/planning/plans/[id]/loading-complete/route.ts:77` | **No.** Archived, outside `app/`, excluded in `tsconfig.json:25` | archive README |
| 3 | Other `workflowStage` literal writes in `app/`, `lib/` | None write `dispatched`. The only literal values written are `cancelled`, `pending_support`, `pending_tint_assignment`, `tint_assigned`, `tinting_in_progress`. `app/api/operations/summary/route.ts:37` is a `count` (read) | grep `workflowStage\s*:\s*"…"` |
| 4 | Import (`app/api/import/obd/route.ts`, `lib/import-upsert.ts`) | No. Writes `pending_support`, `pending_tint_assignment` or `SUPPORT_DONE_OUTPUT` only (`obd/route.ts:452`, `:477`, `:569`, `:647`; `import-upsert.ts:157`) | |
| 5 | `updateMany` on `orders` in `app/` | No. None sets `workflowStage` (customer backfill, billing actions, import match, invoicedAt mark/undo). No `$executeRaw` in `app/` or `lib/` | |
| 6 | `scripts/` | No writer. Every `dispatched` hit is a read. `backfill-nts-trips-2026-09-11.ts:36` states it writes no stage | |
| 7 | `sql/`, `db/`, `docs/Powershell/`, `docs/Parser/` | No `SET "workflowStage" = 'dispatched'` anywhere. `git log -S"dispatched"` over `sql`, `db` and the PowerShell folders finds only trip-activity and trip-status DDL. `4-LogisticsEntry.ps1:597` is an NTS form field | |
| 8 | Drafts | `docs/prompts/drafts/code-discovery-2026-09-10-noslot-backlog.md:411`, a commented UPDATE that its own record marks DEAD, never to run | |

**Hand-run sweeps recorded in code comments** (claims): a hand-run UPDATE on 2026-09-13 12:58:49 UTC
moved 136 bills with no log rows (`lib/floor/dispatch.ts:5-11`). "A cutover on 2026-09-11 closed 2,624
historical bills to `dispatched`" (`scripts/backfill-nts-trips-2026-09-11.ts:9`). No SQL for either is
in the repo.

**Conclusion.** No path in the repo can write `dispatched` today. The one in-repo writer (row 1) was
reachable only between 2026-09-13 20:36 and 2026-09-15 13:54 IST. The only other writer at HEAD, in the
archive (row 2), left the live app on 2026-07-28 (`CLAUDE.md` §3 Retired table). So any row that reached `dispatched` after 2026-09-15
13:54 IST, and every row since 2026-07-28 with no "Dispatched with trip" log row, came from a
**writer outside the repo (hand SQL or external script)**. Whether any rows arrived after 2026-09-15 is
a live question (§17, Smart Flow).

Consequences in code: the cancel route refuses a trip holding any dispatched bill (`cancel/route.ts:144-161`);
a trip never closes (`dispatch` unreachable); `isReady` and the carry rule treat `dispatched` as done
(`queries.ts:272-282`, `live-trips.ts:60`).

---

## 15. Landmines

1. **Two "trip" systems.** Never mount Orbit trip code under `/api/trips` or `/trips`, and never write
   to `trip_report` (§2).
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
7. **One `orders.update` per bill, no `order_status_logs` row** on every trip path (§13).
8. **The remove path does not check the trip in the URL.** `bills/route.ts:137-151` clears whatever
   stop a bill is on. Callers group by trip first (`floor-page.tsx:761-777`) and Undo re-reads the trip
   first. Never call remove with ids you have not checked.
9. **Driver fields are a snapshot.** Never replace them with a read through `vehicleId`.
10. **The gate fails OFF.** Every uncertain answer shows the supervisor his work. Do not change the
    default direction. `countHeldBackWaiting` must get the **ungated** where, or it returns 0.
11. **Two kept routes look dead and are not.** `confirm` and `dispatch` have no caller by design (§10).
12. **Three different "dispatch" words.** `trips.status = 'dispatched'` (trip closed),
    `orders.dispatchStatus = 'dispatch'` (a decision, not an event), `orders.workflowStage =
    'dispatched'` (goods gone).
13. **Do not read meaning into `orders.pickVisibleAt/ById` or `loadedAt/ById`** (§3.5).
14. **Do not delete trips or drop rows.** `trip_activity` is RESTRICT; cancelled trips and their drops
    are the record of what was planned.

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
| `lib/trips/activity.ts` | The 14 actions, one writer per action, `getTripActivity` |
| `lib/trips/show.ts` | `setTripShown`, `showTripsHoldingWaitingBills` (no-cliff) |
| `lib/trips/billing.ts` | `setTripSentToBilling` |
| `lib/picking/visibility-gate.ts` | Gate key, `isPickGateOn`, `WAITING_FOR_PICKER`, `waitingBranchWhere`, `countHeldBackWaiting` |
| `lib/floor/scope.ts` | `tripInScope`, `tripMixLabel` (the trip rules only; the rest is Floor's) |
| `lib/floor/dispatch.ts` | `markBillsDispatched`, the only in-repo `dispatched` writer (unreachable) |
| `app/api/floor/trips/route.ts` | GET list / POST create |
| `app/api/floor/trips/options/route.ts` | Dropdown lists |
| `app/api/floor/trips/[id]/route.ts` | GET one / PATCH |
| `app/api/floor/trips/[id]/{bills,cancel,show,billing,confirm,dispatch}/route.ts` | The trip actions |
| `app/api/floor/pick-gate/route.ts` | Read and flip desk control |
| `components/floor/trip-rail.tsx` | The trip list: tab scope, mix chip, cancelled hidden |
| `components/floor/trip-detail-header.tsx` | Send to billing, Show to floor, take-backs, Cancel |
| `components/floor/trip-form.tsx`, `trip-vehicle-editor.tsx`, `trip-options.ts` | New trip form, vehicle/details PATCH, option types |
| `components/floor/floor-bottom-bar.tsx` | "+ New trip" / add to target / Remove from trip |
| `components/floor/pick-gate-toggle.tsx` | The desk-control switch |
| `components/floor/trip-desk.tsx`, `trip-add-band.tsx`, `trip-bar.tsx`, `trip-history.tsx` | Drawn in the Floor shell (`CLAUDE_FLOOR.md`) |
| `components/floor/trip-selection-bar.tsx` | On disk, **no importer** |
| `scripts/backfill-nts-trips-2026-09-11.ts` | One-time NTS → Orbit trip backfill (run) |
| `sql/2026-09-15-trip-number-reuse.sql`, `-slice6-settle-drafts.sql`, `-slice8-show-per-trip.sql`, `-slice9-print-tab.sql`; `db/slice-2-trip-activity.sql` | Hand-run DDL/data for the slices |
| `FLOOR-TO-FLOOR-DISCOVERY.md` (repo root) | History of slices 1-10. Not canon |

---

## 17. Open items and live state

### Live state (2026-09-18)

- Desk control OFF, last changed 2026-09-16 09:07 UTC by Harsh.
- 7,330 orders at `workflowStage = 'dispatched'` (§14).
- 6 users hold floor canEdit; 0 hold floor canView without canEdit.

### Open items

1. **Who writes `dispatched`** (§14). No reachable in-repo writer since 2026-09-15. Any row added
   since then came from outside the repo; whether any were added is a Smart Flow read (below).
2. **No trip closes.** `POST …/dispatch` has no caller until the loading screen exists
   (`dispatch/route.ts:14-23`), so `trips.status = 'dispatched'` is unreachable.
3. **The add route enforces no delivery type.** An Upcountry bill can go on a Local trip.
   (`FLOOR-TO-FLOOR-DISCOVERY.md:42-45`.) The type-choice rule (§6) now assumes mixed trips are
   normal; the owner has not closed the question.
4. **The remove route clears any stop** without checking the trip in the URL. The guard belongs in
   the route (`FLOOR-TO-FLOOR-DISCOVERY.md:46-49`; §15 item 8).
5. **Moving a bill between trips** is not built (`FLOOR-TO-FLOOR-DISCOVERY.md:50-53`).
6. **Held bills on trips**: whether a held bill may be added at all, decided together with Clear hold
   (`FLOOR-TO-FLOOR-DISCOVERY.md:40-41`).
7. **Orphan `trip_drops`**: cancel keeps empty stops. Whether to delete them is an owner decision
   (`FLOOR-TO-FLOOR-DISCOVERY.md:54-55`, `:1356-1391`).
8. **Reordering stops** is not built: no route writes `dropSeq` after creation
   (`FLOOR-TO-FLOOR-DISCOVERY.md:754-763`).
9. **A stop's customer snapshot never refreshes** (`FLOOR-TO-FLOOR-DISCOVERY.md:780-788`). Undocumented
   whether that is intended.
10. **Trip-only writes are invisible to the Floor marker.** Another planner's show, take-back or
    billing copy does not refresh this desk until something else reloads it
    (`FLOOR-TO-FLOOR-DISCOVERY.md:85-87`, `:111-114`).
11. **GET list canEdit vs board canView** (§10). Latent while no view-only floor user exists.
12. **Vehicle type on a trip** is not built (`FLOOR-TO-FLOOR-DISCOVERY.md:58-60`).
13. **Response-shape defect (found by reading, not reproduced).** `GET /api/floor/trips/[id]` returns
    `{ trip }` (`[id]/route.ts:48`), but `floor-page.tsx:572-573` (`undoAdd`) and `:707-708`
    (`addSelectionToTrip`, toast branch) cast the body itself as `TripDetail`. `undoAdd` then reads
    `detail.drops.flatMap` on `undefined`, which throws into its catch ("Could not undo — check your
    connection."). The toast branch reads `after.counts.total` on `undefined`, which throws after the add
    has already succeeded. The quiet band path (`:2070`) does not use that branch. The third caller
    (`:524`) reads `body.trip` correctly.
14. **Transporter dropdown may be empty** until `isRealTransporter` is marked (§10).
15. **Floor rows for later-dated bills on today's trip** get no explanation on screen
    (`docs/prompts/archive/2026-09/web-update-2026-09-09-floor-trip-module.md:210-214`). Not re-verified.

### Questions for Smart Flow (need a DB read)

- `SELECT count(*), min("createdAt"), max("createdAt") FROM order_status_logs WHERE "toStage"='dispatched' AND note LIKE 'Dispatched with trip %';` (the app path's total), and orders at `dispatched` with no `toStage='dispatched'` log row. Tells whether anything outside the repo moved rows after 2026-09-15.
- `SELECT status, count(*) FROM trips GROUP BY 1;`: did any trip ever close?
- `SELECT count(*) FROM transporter_master WHERE "isRealTransporter";`
- The live `orders_tripDropId_fkey` delete rule and the `app_settings` constraints (not in the 2026-09-18 results).
- Current count of `trip_drops` rows holding no bills.

---

*CLAUDE_FLOOR_TRIPS.md v1.0 · Schema v27.24 · OrbitOMS · updated 2026-09-18 — first canonical file for Orbit's own trips (trips / trip_drops / trip_activity, lib/trips, /api/floor/trips, the pick visibility gate, Send to billing). Written from the code at ec6343ba and the live results of 2026-09-18; drafts are history.*
