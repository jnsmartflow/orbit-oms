# web-update-2026-09-09-trip-schema.md
# SCHEMA PROPOSAL — nothing applied. No DDL run, `prisma/schema.prisma` untouched.
# All database access this session was read-only SELECT through the pooler.
# Session: 2026-09-09 · Depends on: `web-update-2026-09-09-floor-trip-module.md` (the decision record)
# and `code-discovery-2026-09-09-floor-trips.md` (step 1).

**Status:** proposal. The SQL in §D has been written but **not executed**, and several of its
constructs are marked UNVERIFIED in §E because the only way to verify them is to run them.

**Owner decisions carried into this document.** These are settled and are recorded here as owner
decisions, not as this session's inventions: the trip-number format and its per-day per-type
sequence (§C1), the stored status vocabulary with `ready` derived at read time (§C2), the
single-pointer `orders.tripDropId` attachment (§C3), the `loaded` stage between `pick_checked` and
`dispatched` (§C5), `dispatched` having exactly one writer from the day the module ships (§B),
`transporter_master` keeping its SAP junk rows behind a new real-transporter flag (§C6), the trip
carrying its own nullable transporter FK defaulted from the vehicle but overridable (§C1), the
separate free-text transporter docket number (§C1), and the 42-vehicle seed shape (§D8).

---

## A — Facts established

Every number below is a read-only SELECT against production, run 2026-09-09 between 19:00 and 20:10 IST.

### A1 · `transporter_master`

Eight columns. `id` serial PK, `name` text NOT NULL, `contactPerson` / `phone` / `email` text NULL,
`isActive` boolean NOT NULL DEFAULT true, `createdAt` / `updatedAt` **`timestamp without time zone`**
NOT NULL DEFAULT `CURRENT_TIMESTAMP`.

Two constraints, and only two: `transporter_master_pkey` PRIMARY KEY (id) and
`transporter_master_name_key` UNIQUE (name). No FK out, no index on `isActive`.

⚠ Those two timestamps are **not** timestamptz, unlike every table minted since v27.3. Not a problem
this proposal creates, and not one it fixes — recorded because a new column added beside them should
be timestamptz anyway, per CORE §7.1.c, and the mismatch will look like an error to a later reader.

**25 live rows**, and the table is not a transporter list. It holds SAP transporter-code values
imported verbatim:

| Real transporter names (18) | SAP status junk (7) |
|---|---|
| Nagadhiraj (id 4) · Safexpress · Diamond Logistics · Sai Logistics · Dev Shri Roadlines · Ghanshyam Roadways · Sai Dev Roadlines · Shri Lalitji Tempo Service · Sai Tempo Service · Jay Yaha Mogi Roadlines · Jahanvi Trans Logistics · OM SAI RAM RAODWAYS · TEJASHVI ROADWAYS · MUMBAI BARODA TRANSPORT · V-TRANS · Shri Sai Dev Tempo · DTDC Courier · Shiv Logistics (id 28) | DELETE · CI · CANCEL · PORTER · ewaybill · PICK DELETED · HAND |

`prisma/seed.ts:424-427` seeds three names — Sharma Logistics, Patel Transport, Singh & Sons Carriers
— **none of which is in the live table.** A wipe-and-reseed adds three more rows rather than
reproducing what is there. The live 25 came from somewhere else, most likely a CSV import of SAP
codes plus a hand-added `Shiv Logistics` for the demo vehicles.

### A2 · `vehicle_master` → `transporter_master`

**All six vehicles point at id 28, Shiv Logistics.** The other 24 transporters hold no vehicles.

The FK is `vehicle_master_transporterId_fkey`, and `pg_constraint.confdeltype = 'a'` — **NO ACTION,
not RESTRICT.** Prisma renders NO ACTION as `Restrict` in the schema file, so the model reads
stricter than the database is. In practice both refuse the delete; NO ACTION defers the check to the
end of the statement, RESTRICT does not. Nothing in this proposal depends on the difference, but a
future "delete an unused transporter" route would.

### A3 · The vehicle match — zero of 42, and normalising changes nothing

| | |
|---|---:|
| distinct `vehicleNo` in `trip_report`, last 30 days | 42 |
| rows in `vehicle_master` | 6 |
| matched on the raw string | 0 |
| matched after stripping non-alphanumerics and upper-casing | 0 |

The six master plates are `GJ-05-AB-1234`, `GJ-05-CD-5678`, `GJ-05-EF-9012`, `GJ-05-GH-3456`,
`GJ-05-IJ-7890`, `GJ-05-KL-2345`. Sequential letter pairs, sequential digits, drivers named Suresh
Kumar through Ajay Kumar, phones running `9898123456` to `9898678901`.

**`vehicle_master` is demo data.** It describes no vehicle that has ever run a trip. Step 1 left this
as possibly a formatting mismatch. It is not. `vehicle_master` is also **not seeded by
`prisma/seed.ts`** — a grep finds no `vehicle_master` block there at all — so the six rows were
created by hand or through the admin import route.

One of the 42 is not a plate: `PORTER`, 4 rows, 4 trips. See §D8 for how the seed handles it.

The real fleet, sized from the same 30 days:

| | |
|---|---:|
| vehicles seen | 42 |
| with a driver name on their latest row | 42 |
| with a driver mobile on their latest row | 41 |
| longest plate | 10 chars |
| longest driver name | 33 chars |
| longest driver mobile | 11 chars |
| `vehType` values | `Tempo` (28 vehicles) · `Three Wheeler` (14) |

### A4 · Transporters in `trip_report` — the number is an artefact, not a finding

Last 30 days: `transporter` is `Nagadhiraj` on all 3,272 rows. `tranTransporterName` is blank on
3,267 and `Sai Dev Roadlines` on 5.

🔴 **That single value proves nothing about how many transporters are in play.** The PowerShell puller
filters on `transporter == "nagadhiraj"` before pushing (`CLAUDE_TRIP_REPORT.md §2`), so the mirror
**cannot** contain a second transporter. How many actually run is unanswerable from `trip_report`;
the answer is upstream in NTS and the mirror discards it. `transporter_master`'s 18 real names are
the better estimate, and they are not evidence of current activity either.

### A5 · Volume, for sizing

| | |
|---|---:|
| trips per day per type, busiest observed (60 days) | 37 |
| trips per day, all types, busiest observed | 54 |
| drops per trip, mean | 3.7 |
| drops per trip, maximum | 12 |
| `delivery_type_master` | Local=1 · Upcountry=2 · IGT=5 · Cross=6 |
| `trip_report.deliveryType` values | `Local` · `UPC` |
| Postgres server version | **17.6** |
| `orders` CHECK constraints | **none** — only `orders_obdNumber_key` UNIQUE |

Two consequences. `orders.workflowStage` carries **no** database CHECK, so adding `loaded` is a
constants edit with zero migration, exactly as `CLAUDE_PICKING.md §2` says. And Postgres 17.6 gives us
`NULLS NOT DISTINCT` and generated columns if we want them.

⚠ **NTS's own `tripNo` is a running monthly counter, not a per-day sequence.** On 2026-09-02 the
numeric part spans 7 to 38; by 2026-09-09 it spans 55 to 202. So `L174` is not comparable to
`L-260909-01` and no mapping between them exists. That is the whole reason the transporter's docket
number is free text (§C1).

---

## B — The dispatched mystery

**Answer: a hand-run SQL sweep in the Supabase SQL Editor, run periodically by the owner, last
covering work up to 18 August. Not code, not a cron, not an app route. Nothing automated is moving
rows, and nothing has moved in three weeks.**

| | |
|---|---:|
| orders at `dispatched` | 4,137 |
| carrying an `order_status_logs` row that says so | 241 |
| **carrying no such log at all** | **3,896** |

Of the 241, **238 are Harsh's one-time bulk backfill on 2026-07-23** — the sweep `CLAUDE_FLOOR.md §7`
already records, note *"Bulk backfill: goods dispatched, never recorded in system"*, all within the
same second. The remaining three orders (six log rows) are not transitions at all:

| Date | Note | What it actually is |
|---|---|---|
| 2026-08-08 | `[line_added] / [line_removed] … via manual-sap batch BATCH-20260808-041` | the manual-SAP importer stamping `toStage` with the order's **current** stage |
| 2026-08-11 | same shape, `BATCH-20260811-007` | same |
| 2026-08-18 | same shape, `BATCH-20260818-006` | same |
| 2026-08-27 | `Manual SQL: tint_assignments 596 closed as cancelled — stale paused job on a dispatched OBD` | a hand-written note about a tint row, `fromStage` and `toStage` both `dispatched` |

**So the last genuine logged transition to `dispatched` was 2026-07-23.**

### Why the transition is invisible

`orders` has **no triggers** — `pg_trigger` returns nothing non-internal. `updatedAt` is Prisma's
application-level `@updatedAt`, so a raw `UPDATE` in the SQL Editor does **not** move it. The
`updatedAt` clusters (973 rows on 2026-08-03, 371 on 08-08, 337 on 08-18) are last *app* writes —
import patches and enrichment — not stage changes. **For 3,896 orders the moment of transition is
recorded in no column and no log.**

### What does date it

No order at `dispatched` carries a `dispatchTargetDate` later than **2026-08-18** (7 rows there, 124
on 08-17). The dispatched population stops dead at that day.

And the shape of the swept set rules out the picking ladder:

| | |
|---|---:|
| unlogged dispatched orders | 3,896 |
| that ever reached `pick_checked` (have a `checked_at`) | 709 |
| **that never had a `pick_assignments` row at all** | **2,718** |

Two thirds were swept straight from `pending_support` or `pending_picking` to `dispatched`, never
touching a picker. Their last real log is `Auto-dispatched by enrichment`, `Dispatched by support
(bulk)`, `Created via auto-import batch …` or `Placed on hold by support (bulk)`.

`admin_audit_log` holds nothing for `orders` beyond three `reorder` rows, so no admin route did it.

### Is anything still moving rows there?

**No.** Not since 2026-08-20, when 9 rows were last touched by the app, and one straggler on
2026-09-05 (order 10523, OBD 9108526441, last log 2026-07-27). There is no active process to stop.

There is a **recurring human practice** to retire, which is decision 5: from the day the trip module
ships, the trip's dispatch action is the only writer of `dispatched`, and the manual sweep stops. The
3,896 already-swept rows stay unattributable. That is recorded as history and is not reconstructible
— there is nothing left to reconstruct it from.

⚠ **One consequence to design around now, not later.** Between today and the day the module ships,
the sweep may be run again. Any backfill or verification query written for the trip module must
therefore treat `dispatched` as a stage that may contain rows with no trip, no drop and no log —
permanently. Do not write a migration that assumes every `dispatched` bill has a trip.

---

## C — Proposed tables in plain English

### C1 · `trips`

One row per load leaving the depot. Columns, with the reasoning that is not obvious:

| Column | Type | Note |
|---|---|---|
| `id` | serial PK | surrogate. Every FK points here, never at the number. |
| `tripNumber` | text NOT NULL | `L-260909-01`. Generated server-side. **UNIQUE.** |
| `tripDate` | date NOT NULL | the dispatch day. `@db.Date`, UTC-midnight anchored like `dispatchTargetDate`. |
| `typeCode` | text NOT NULL | `L` / `U` / `I`. **Denormalised on purpose** — see below. |
| `deliveryTypeId` | int NOT NULL FK → `delivery_type_master` | the classification link, so the trip speaks the same vocabulary as an area. |
| `seq` | int NOT NULL | per `(tripDate, typeCode)`, from 1. |
| `dispatchWindowId` | int NULL FK → `dispatch_slot_master` | the trip's own window. Nullable: a trip can be planned before its slot is decided. |
| `transporterId` | int NULL FK → `transporter_master` | **the trip's own**, defaulted from the vehicle at pick time but overridable (decision 7). |
| `vehicleId` | int NULL FK → `vehicle_master` | nullable — decision record §3, *"assign a vehicle if there or draft vehicle."* |
| `adhocVehicleNo` | text NULL | a plate not yet in the master. |
| `driverName` | text NULL | **SNAPSHOT at trip time.** |
| `driverPhone` | text NULL | **SNAPSHOT at trip time.** |
| `transporterTripNo` | text NULL | their docket. Free text, not validated, not unique (decision 9). |
| `note` | text NULL | the planner's reason for the grouping. |
| `status` | text NOT NULL DEFAULT `'draft'` | `draft` / `released` / `loading` / `dispatched` / `cancelled`. |
| `releasedAt` / `releasedById` | timestamptz(6) / int FK → `users` | |
| `dispatchedAt` / `dispatchedById` | timestamptz(6) / int FK → `users` | |
| `cancelledAt` / `cancelledById` | timestamptz(6) / int FK → `users` | |
| `createdAt` / `createdById` | timestamptz(6) NOT NULL / int NOT NULL FK → `users` | |
| `updatedAt` | timestamptz(6) NOT NULL DEFAULT now() | `@updatedAt` in Prisma. |

**Four FKs to `users`** — `createdBy`, `releasedBy`, `dispatchedBy`, `cancelledBy`. Every one needs an
explicitly named `@relation` on **both** sides or Prisma throws an ambiguity error at generate time
(CORE §7.3). Proposed names: `TripCreatedBy`, `TripReleasedBy`, `TripDispatchedBy`, `TripCancelledBy`,
with back-relations `tripsCreated`, `tripsReleased`, `tripsDispatched`, `tripsCancelled` on `users`.

**Why the driver is snapshotted and not read through `vehicleId`.** The master's driver changes when a
transporter swaps a man onto a van. A trip sheet printed last Tuesday must keep saying who actually
drove it. Same reasoning as `pick_findings`' denormalised `obdNumber` / `skuCodeRaw` (CORE §7.4) and
`ci_returns`' customer snapshot: a record of what a human observed must still read correctly after the
master moves. It also means a trip with an `adhocVehicleNo` and no `vehicleId` still carries a driver.

**Why `typeCode` exists beside `deliveryTypeId`.** The trip number embeds a letter, and that letter must
be stable for the life of the row. Renaming `Upcountry` in `delivery_type_master` must not make an
existing `U-260909-03` un-derivable. The FK carries the classification; `typeCode` carries the
number's own component. The CHECK in §D ties `tripNumber` to `typeCode`, `tripDate` and `seq` so the
two can never disagree.

⚠ **`Cross` has no letter.** `delivery_type_master` holds four types and the format defines three. A
Cross trip cannot be numbered today. Flagged in §E as unresolved — it is an owner call, not something
this document should invent.

#### The unique constraint — both, and here is why

The question was whether uniqueness sits on the text or on `(date, type, seq)`. **Put it on both.**

- `UNIQUE (tripNumber)` is what the application catches. The allocator races the same way
  `lib/ci/number.ts` documents: two planners building a trip in the same second read the same maximum,
  and the loser gets a P2002 instead of a duplicate number. That backstop needs a unique on the text
  the allocator wrote.
- `UNIQUE (tripDate, typeCode, seq)` is what makes the **sequence** correct. It is a different claim.
  If a formatting bug renders the date wrong, the text unique still passes while two trips silently
  hold `seq = 3` for the same day and type. Only the triple catches that.

They are not redundant because they fail differently. The cost is one extra index on a table taking
roughly 50 rows a day.

⚠ **`seq` is zero-padded to a minimum of two digits, never truncated to two.** `lpad(seq, 2, '0')`
renders 7 as `07` and 137 as `137`. The busiest observed day-and-type is **37 trips**, which is 37% of
a two-digit ceiling — close enough that an implementation slicing the last two characters would break
inside a year. The CHECK in §D uses `lpad`, so a 100th trip widens the number and stays valid.

### C2 · Status, and why `ready` is not stored

Stored vocabulary, enforced by `chk_trips_status`: `draft` · `released` · `loading` · `dispatched` ·
`cancelled`.

**`ready` is derived at read time: a trip is ready when every bill under it is at `pick_checked`.**
A stored `ready` would drift the moment a bill is added to the trip or unassigned, and nothing would
correct it. This is the same class as `CLAUDE_FLOOR.md`'s derived `zone` and `ageDays`, and the
opposite of the mistake `orders.customerMissing` makes (stamped once at import, stale ever after —
`lib/picking/queue.ts:822-827` explains why that column is not trusted).

The decision record's §3 ladder reads `draft → released → ready → dispatched`. The stored vocabulary
replaces `ready` with `loading` and derives the rest. `loading` is a real state a person puts a trip
into; `ready` is a fact about its bills.

⚠ **The trip's `loading` and the bill's `loaded` are different ladders and must not be conflated**
(decision record §3.2). A trip enters `loading` when the planner says so. A bill reaches `loaded` when
it is physically on the vehicle. One trip in `loading` can hold bills at both `pick_checked` and
`loaded`.

### C3 · `trip_drops`, and the composite key

One row per **stop**. A stop is a delivery customer, not a bill — two bills for the same shop are one
drop, which is what the existing trip sheet already does (`CLAUDE_TRIP_REPORT.md §4`: *"Drops = unique
customers, not bill rows"*).

| Column | Type | Note |
|---|---|---|
| `id` | serial PK | |
| `tripId` | int NOT NULL FK → `trips` ON DELETE CASCADE | |
| `dropSeq` | int NOT NULL | the stop order, from 1. UNIQUE with `tripId`. |
| `customerId` | int NULL FK → `delivery_point_master` | the **resolved effective** delivery customer. |
| `shipToCode` | text NOT NULL | `orders.shipToCustomerId`, SAP's own code. Never null. |
| `dropKey` | text NOT NULL | the grouping identity. See below. |
| `customerName` | text NOT NULL | snapshot, for the sheet. |
| `areaName` / `routeName` | text NULL | snapshot. |
| `note` | text NULL | |
| `createdAt` | timestamptz(6) NOT NULL DEFAULT now() | |

**The key problem, restated from step 1.** The grouping rule is
`COALESCE(shipToOverrideCustomerId, customerId)` — the expression the code already writes in six
places. But **482 live bills carry no `customerId` at all**, and **259 carry `shipToOverride = true`
with a NULL override id**. A key that is the FK alone collapses every unmatched bill into one bucket
and would put unrelated shops on one stop.

**Proposed: a single derived text `dropKey`, with the parts kept beside it.**

```
dropKey = 'c:' || customerId     when the customer FK resolves
        = 's:' || shipToCode     otherwise
```

`UNIQUE (tripId, dropKey)`, plus `chk_trip_drops_key` proving the composition, so the column cannot
drift from the two it is built from.

**Why this shape and not the alternatives:**

- **`UNIQUE (tripId, customerId)` alone** — fails outright. Postgres treats NULLs as distinct by
  default, so every unmatched bill becomes its own drop; and adding `NULLS NOT DISTINCT` (available on
  17.6) inverts it into the opposite bug, merging every unmatched bill on the trip into a single stop.
  Both answers are wrong and neither is visible on the screen.
- **`UNIQUE (tripId, customerId, shipToCode)` with `NULLS NOT DISTINCT`** — correct, and it works. It
  was rejected for legibility: the rule lives in a constraint modifier that nothing in the codebase
  reads, and a later reader has to know that one keyword to understand why two bills did or did not
  merge. `dropKey` puts the rule in a column you can `SELECT`.
- **A prefix-free key such as the raw code** — rejected because `'c:'` and `'s:'` keep the two id
  spaces apart. `customerId` 1856 and a SAP `shipToCode` of `1856` are different things, and CORE §13
  is the standing warning about exactly that class of collision.

⚠ **The 259 free-text redirects group under their ORIGINAL customer, and that is wrong for a delivery.**
`shipToOverride = true` with a NULL override id means someone typed a redirect that never resolved to
a master row. The effective-dealer expression falls through to `customerId`, so the drop lands on the
original shop. **The data supports no better answer**, and inventing one would put a van at the wrong
address with total confidence. The right fix is upstream: resolve those redirects to real customers,
or give the drop a free-text address field. Flagged in §E.

### C4 · How an order attaches — one pointer, and what the join costs

**Settled (decision 3): `orders.tripDropId` → `trip_drops.id` → `trip_drops.tripId` → `trips.id`.
No `tripId` on `orders`.** `orders` currently has no column with `trip` in its name, so the name is free.

`tripDropId` is nullable — a bill on no trip is the normal state — with `ON DELETE SET NULL`, so
removing a stop returns its bills to the pool rather than deleting them. `trips → trip_drops` is
CASCADE, so cancelling a trip by deleting it would return every bill to the pool. **Trips should be
cancelled by status, never deleted**; the CASCADE is a safety net, not a workflow.

**The read cost, and who pays it.**

| Query | Needs | Cost |
|---|---|---|
| `getFloorBoard` (`lib/floor/queries.ts`) — the By-trip view and the trip tag on every row | trip number + status per order | **two extra batched reads**: drops by `id IN (…)`, then trips by `id IN (…)` |
| `getPickingQueue` (`lib/picking/queue.ts`) — the `L-01` tag on the Assign card | trip number only | the **same two**, same shape |
| the trip board's per-trip progress bar and derived `ready` | every order under each trip | one read of orders by `tripDropId IN (…)`, grouped in memory |
| the trip sheet / print / WhatsApp capture | trip → drops → orders | **none** — it reads downward, which is the natural direction |
| `/api/floor/marker`, `/api/picking/marker` | nothing | **none, and none may be added.** The markers aggregate `count` + `MAX(updatedAt)` only. |

🔴 **Use the batched form, never a Prisma `include` chain.** `lib/picking/queue.ts:537-554` records the
measurement: an `include` tree on a 72-row board issued **18 SQL statements**, because Prisma neither
dedupes two relation chains to the same table nor skips a chain for the rows whose FK is null. Two
`findMany`s keyed on `id IN (…)` are two statements regardless of board size. That is the house
pattern and this must follow it.

**What the rejected shape would have cost.** `orders.tripId` alongside `orders.tripDropId` saves one
of those two batched reads on the two queries above. It buys one query and costs a class of bug: the
two pointers can disagree, nothing in the database would catch it, and every write path would have to
remember to move both. The `shipToOverride` boolean beside `shipToOverrideCustomerId` is the same
shape and CORE §7.3 already flags it as a thing to keep in step by hand. One is enough.

### C5 · The `loaded` stage — what it joins and what changes

`loaded` sits between `pick_checked` (90) and `dispatched` (100). **Rank 95.** The ladder is spaced by
ten for exactly this, so nothing renumbers. `orders.workflowStage` carries no database CHECK (A5), so
this is a constants edit with no migration.

**Sets in `lib/workflow-stages.ts` it joins AUTOMATICALLY, because they are rank-derived:**

| Set | Rule | Joins? | Live consumers that change behaviour |
|---|---|---|---|
| `SUPPORT_DONE_STAGE_NAMES` | rank ≥ 60 | **YES** | `app/api/admin/fix-slots/route.ts:50` · `app/api/operations/summary/route.ts:31` and `:104` · `app/api/tint/manager/missing-customers/route.ts:29`. All four use `notIn: ["cancelled", ...]`, i.e. "still pending". A `loaded` bill correctly stops counting as pending. **This is the intended change.** |
| `SUPPORT_PICKING_QUEUE_STAGE_NAMES` | rank = 60 | no | `app/api/admin/fix-challans/route.ts:18` unaffected. |
| `RAIL_STAGES` (`lib/floor/queries.ts:74`) | rank < 60 | no | the left rail is unaffected, correctly. |

**Sets it does NOT join, because they are hand-written — each is a decision:**

| Set | Contents | Recommendation |
|---|---|---|
| `PICKING_OPEN_STAGES` | `pending_picking`, `pick_assigned`, `pick_done` | **do not add.** A loaded bill is not open work. |
| `PICKING_ACTIVE_STAGES` | the above + `pick_checked` | 🔴 **decide deliberately.** Consumers: Floor's history predicate (`lib/floor/queries.ts:642`) and picking's `single` scope (`lib/picking/queue.ts:448`). Leave it out and a bill loaded on the day it was promised **disappears from that day's Floor history** — the same vanish-at-completion class as the 2026-08-02 `checkedAt` fix and Floor's own arm-2. Recommendation: **add it**, and add it at the same time as the stage, not afterwards. |
| `PICKING_CANCELLABLE_STAGES` | `pending_picking`, `pick_assigned`, `pick_done` | **do not add.** A loaded bill is on a vehicle. |

**Predicates whose behaviour changes, named:**

1. 🔴 **`lib/billing/picking-where.ts:10` — `BILLING_PENDING_STAGE = "pick_checked"`, an exact equality,
   used at `:66` (pending) and `:133` (invoiced/done). A bill that moves to `loaded` FALLS OFF THE
   BILLING PENDING LIST AND NOBODY INVOICES IT.** This is the single most dangerous consequence of the
   new stage and it is silent — no error, the row simply stops appearing. Billing's own header warns
   that a marker scoped tighter than its list stops refreshing rows that are on screen; this is worse,
   because both arms move together and the bill is gone from both. **Any prompt that adds `loaded` must
   change this file in the same commit**, to `workflowStage: { in: [PICK_CHECKED, LOADED] }` or
   equivalent. It is not optional and it is not a follow-up.
2. **`floorLiveBaseWhere` (`lib/floor/queries.ts:188`)** — arm 1 is `PICKING_OPEN_STAGES`, arm 2 is
   `pick_checked` checked-today. A `loaded` bill matches neither and drops off the live floor board.
   Whether that is right depends on whether the trip band is considered part of the board. Recommendation:
   leave the predicate alone and let the trip band carry loading bills, since the board's job is bills
   *not yet on a vehicle*. Owner call, flagged in §E.
3. **`getFloorLiveMarkerWhere`** — follows `floorLiveBaseWhere` automatically. No separate edit, and
   that is the point of the shared predicate.
4. **`buildPickingWhere` `openPending` (`lib/picking/queue.ts:349-428`)** — three OR branches, none
   admits `loaded`. A loaded bill leaves the supervisor board. Correct: loading is a different queue.
5. **`pickingRowStage()` (`lib/workflow-stages.ts`)** — maps `isAssigned`/`isDone`/`isChecked` back to a
   stage. A `loaded` row is false on all three and **falls through to `pending_picking`** — the exact
   bug the function's own header warns about, which has already bitten twice. It is safe **only**
   while no `loaded` row reaches a picking board. **If `PICKING_ACTIVE_STAGES` gains `loaded`, this
   function must gain a flag FIRST**, in the same commit, before the set is widened.
6. **`app/api/warehouse/pickers/route.ts:65`** — its comment says a `pick_done` / `pick_checked` /
   `cancelled` / `dispatched` bill "drops out on its own, because the stage moved". The predicate is
   `workflowStage: PICK_ASSIGNED`, so `loaded` drops out correctly. Only the comment needs the word.
7. **`chk_pick_assignments_status`** — the live CHECK restricting `pick_assignments.status` to
   `'assigned'` / `'picked'`. `loaded` is a **workflowStage**, not a pick_assignments status, so this
   constraint is not involved. Recorded because the temptation to add a third status value is exactly
   what `CLAUDE_PICKING.md §7` warns about.

**Nothing in this document edits `lib/workflow-stages.ts`.** The list above is what a later prompt has
to do, in one commit, with the billing fix included.

### C6 · `transporter_master.isRealTransporter`

New boolean, NOT NULL DEFAULT **false** (decision 6). The SAP junk rows stay — historical orders may
point at them, and CORE §3 forbids deleting anyway. The trip's transporter picker reads only
`isRealTransporter = true`.

Default false is the safe direction and matches `app_settings`' default-off reasoning: an unmarked row
is absent from a picker, which is recoverable, rather than silently offered. The UPDATE that marks the
18 real names is in §D7, commented out, with a SELECT above it.

⚠ This is a **display** flag, not a lifecycle flag. `isActive` already exists and means something
different — "is this transporter still trading". A row can be real and inactive. Do not conflate them;
this is the same distinction `sku_master_v2.isPrimary` vs `isActive` records in CORE §7.1.c.

### C7 · What this proposal deliberately does NOT touch

- **`orders.pickVisibleAt` / `pickVisibleById` / `app_settings`** — untouched. Trip release *stamps*
  `pickVisibleAt` through the existing `POST /api/floor/pick-visible` path; it does not change the
  column, the gate or the switch. Nothing about a trip may clear a stamp, and nothing about the gate
  may change a trip (decision record §2.1).
- **`trip_report`** — untouched, and Orbit trips never go in it. `mirror_trip_report_today()` deletes
  and reinserts the day's rows every ~62 seconds, so anything written there vanishes silently
  (decision record §5).
- **`dispatch_plans` / `dispatch_plan_orders`** — untouched. They are the archived Planning board's
  tables and are not the trip.
- **`vehicle_master` schema** — no column added. The six demo rows are left alone (decision 8).

---

## D — The SQL

🔴 **NOT RUN. Read every comment before pasting.** One block, top to bottom, single paste, Supabase SQL
Editor. No `BEGIN` / `COMMIT` (CORE §3), so **each statement commits on its own** — a failure part-way
leaves everything before it applied. The statements are ordered so that is survivable, and the two
most likely to be rejected are placed last within their group.

`"check"` is a reserved word; every constraint here is named `chk_*`. Sections **D7** and **D8** are
entirely commented out and are the only ones that touch existing rows.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- TRIP MODULE — schema proposal, 2026-09-09
-- Applies to: OrbitOMS production (Supabase, Postgres 17.6)
-- Nothing here has been executed. Read D7/D8 before running anything.
-- camelCase identifiers, quoted. No @map on the Prisma side (CORE §3).
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- D1 · trips
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id                  serial       PRIMARY KEY,
  "tripNumber"        text         NOT NULL,
  "tripDate"          date         NOT NULL,
  "typeCode"          text         NOT NULL,
  "deliveryTypeId"    integer      NOT NULL,
  "seq"               integer      NOT NULL,
  "dispatchWindowId"  integer      NULL,
  "transporterId"     integer      NULL,
  "vehicleId"         integer      NULL,
  "adhocVehicleNo"    text         NULL,
  "driverName"        text         NULL,
  "driverPhone"       text         NULL,
  "transporterTripNo" text         NULL,
  "note"              text         NULL,
  "status"            text         NOT NULL DEFAULT 'draft',
  "releasedAt"        timestamptz(6) NULL,
  "releasedById"      integer      NULL,
  "dispatchedAt"      timestamptz(6) NULL,
  "dispatchedById"    integer      NULL,
  "cancelledAt"       timestamptz(6) NULL,
  "cancelledById"     integer      NULL,
  "createdAt"         timestamptz(6) NOT NULL DEFAULT now(),
  "createdById"       integer      NOT NULL,
  "updatedAt"         timestamptz(6) NOT NULL DEFAULT now()
);

-- Foreign keys. Every one is its own statement so a single rejection does not
-- take the others with it.
ALTER TABLE trips ADD CONSTRAINT "trips_deliveryTypeId_fkey"
  FOREIGN KEY ("deliveryTypeId") REFERENCES delivery_type_master(id);
ALTER TABLE trips ADD CONSTRAINT "trips_dispatchWindowId_fkey"
  FOREIGN KEY ("dispatchWindowId") REFERENCES dispatch_slot_master(id);
ALTER TABLE trips ADD CONSTRAINT "trips_transporterId_fkey"
  FOREIGN KEY ("transporterId") REFERENCES transporter_master(id);
ALTER TABLE trips ADD CONSTRAINT "trips_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES vehicle_master(id);
ALTER TABLE trips ADD CONSTRAINT "trips_createdById_fkey"
  FOREIGN KEY ("createdById")   REFERENCES users(id);
ALTER TABLE trips ADD CONSTRAINT "trips_releasedById_fkey"
  FOREIGN KEY ("releasedById")   REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE trips ADD CONSTRAINT "trips_dispatchedById_fkey"
  FOREIGN KEY ("dispatchedById") REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE trips ADD CONSTRAINT "trips_cancelledById_fkey"
  FOREIGN KEY ("cancelledById")  REFERENCES users(id) ON DELETE SET NULL;

-- The two uniques. Both, deliberately — §C1 explains why they are not redundant.
-- `trips_tripNumber_key` is what the allocator's P2002 backstop catches.
ALTER TABLE trips ADD CONSTRAINT "trips_tripNumber_key" UNIQUE ("tripNumber");
-- `trips_date_type_seq_key` is what makes the SEQUENCE correct — it catches a
-- duplicate seq that a mis-formatted tripNumber would let through.
ALTER TABLE trips ADD CONSTRAINT "trips_date_type_seq_key"
  UNIQUE ("tripDate", "typeCode", "seq");

CREATE INDEX IF NOT EXISTS trips_date_idx     ON trips ("tripDate" DESC);
CREATE INDEX IF NOT EXISTS trips_status_idx   ON trips ("status");
CREATE INDEX IF NOT EXISTS trips_vehicle_idx  ON trips ("vehicleId");

-- Value constraints. Prisma cannot express any of these — record them by hand
-- in the schema.prisma header, the same way chk_mrn_status and
-- chk_ci_returns_status are recorded (CORE §7.4 / §7.21).
ALTER TABLE trips ADD CONSTRAINT chk_trips_status
  CHECK ("status" IN ('draft','released','loading','dispatched','cancelled'));
ALTER TABLE trips ADD CONSTRAINT chk_trips_type_code
  CHECK ("typeCode" IN ('L','U','I'));
ALTER TABLE trips ADD CONSTRAINT chk_trips_seq_positive
  CHECK ("seq" >= 1);

-- A vehicle is EITHER a master row OR an ad-hoc plate, never both at once.
-- Neither is also valid — a trip must be creatable with no vehicle at all.
ALTER TABLE trips ADD CONSTRAINT chk_trips_vehicle_one_of
  CHECK (NOT ("vehicleId" IS NOT NULL AND "adhocVehicleNo" IS NOT NULL));

-- A dispatched trip must carry its stamps. Same shape as
-- chk_ci_returns_complete_when_not_draft, which is what makes four nullable
-- columns safe on that table.
ALTER TABLE trips ADD CONSTRAINT chk_trips_dispatched_complete
  CHECK ("status" <> 'dispatched'
         OR ("dispatchedAt" IS NOT NULL AND "dispatchedById" IS NOT NULL));
ALTER TABLE trips ADD CONSTRAINT chk_trips_cancelled_complete
  CHECK ("status" <> 'cancelled'
         OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL));

-- ⚠ PLACED LAST IN THIS GROUP ON PURPOSE — the one most likely to be rejected.
-- It proves tripNumber is exactly what typeCode + tripDate + seq compose, so the
-- two uniques above can never disagree. It relies on to_char(date,text) and lpad
-- being IMMUTABLE, which they are, but this has NOT been executed against the
-- live server (§E). If it errors, DROP THIS ONE STATEMENT — everything above it
-- still stands and the design is unharmed; the guarantee just moves into the
-- allocator's own tests.
-- lpad PADS, never truncates: seq 137 renders '137' and stays valid (§C1).
ALTER TABLE trips ADD CONSTRAINT chk_trips_number_shape
  CHECK ("tripNumber" = "typeCode" || '-' || to_char("tripDate",'YYMMDD')
                        || '-' || lpad("seq"::text, 2, '0'));

COMMENT ON TABLE trips IS
  'One load leaving the depot. Number is {L|U|I}-{YYMMDD}-{NN}, per-day per-type sequence. Vehicle and transporter are both optional. driverName/driverPhone are SNAPSHOTS taken at trip time, not reads through vehicleId. transporterTripNo is the carrier''s own docket (NTS L41/L42) — free text, not ours.';


-- ───────────────────────────────────────────────────────────────────────────
-- D2 · trip_drops — ordered stops. One drop = one delivery customer.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_drops (
  id             serial         PRIMARY KEY,
  "tripId"       integer        NOT NULL,
  "dropSeq"      integer        NOT NULL,
  "customerId"   integer        NULL,
  "shipToCode"   text           NOT NULL,
  "dropKey"      text           NOT NULL,
  "customerName" text           NOT NULL,
  "areaName"     text           NULL,
  "routeName"    text           NULL,
  "note"         text           NULL,
  "createdAt"    timestamptz(6) NOT NULL DEFAULT now()
);

ALTER TABLE trip_drops ADD CONSTRAINT "trip_drops_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES trips(id) ON DELETE CASCADE;
ALTER TABLE trip_drops ADD CONSTRAINT "trip_drops_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES delivery_point_master(id);

-- The drop identity. §C3 defends the shape: 482 live bills have no customerId
-- and 259 carry a redirect flag with a null override id, so an FK-only key
-- collapses unrelated shops onto one stop.
ALTER TABLE trip_drops ADD CONSTRAINT "trip_drops_trip_key_key"
  UNIQUE ("tripId", "dropKey");
-- The stop ORDER is its own invariant, separate from identity.
ALTER TABLE trip_drops ADD CONSTRAINT "trip_drops_trip_seq_key"
  UNIQUE ("tripId", "dropSeq");

CREATE INDEX IF NOT EXISTS trip_drops_trip_idx     ON trip_drops ("tripId");
CREATE INDEX IF NOT EXISTS trip_drops_customer_idx ON trip_drops ("customerId");

ALTER TABLE trip_drops ADD CONSTRAINT chk_trip_drops_seq_positive
  CHECK ("dropSeq" >= 1);

-- dropKey is written by the application; this proves it cannot drift from the
-- two columns it is built from. || and CASE are immutable, so unlike
-- chk_trips_number_shape above there is no to_char question here.
ALTER TABLE trip_drops ADD CONSTRAINT chk_trip_drops_key
  CHECK ("dropKey" = CASE WHEN "customerId" IS NOT NULL
                          THEN 'c:' || "customerId"::text
                          ELSE 's:' || "shipToCode" END);

COMMENT ON TABLE trip_drops IS
  'Ordered stops on a trip. A drop is a CUSTOMER, not a bill — two bills for one shop are one stop (CLAUDE_TRIP_REPORT.md §4). dropKey is c:<customerId> when the FK resolves, else s:<shipToCode>, so an unmatched bill still gets its own stop instead of collapsing onto another. Built to receive delivery/POD rows from the future driver app.';


-- ───────────────────────────────────────────────────────────────────────────
-- D3 · orders.tripDropId — the ONE pointer (decision 3).
-- No tripId on orders. Two pointers can disagree and nothing would catch it.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "tripDropId" integer NULL;

-- ON DELETE SET NULL: removing a stop returns its bills to the pool. It must
-- never delete an order. trips -> trip_drops is CASCADE, so deleting a trip
-- also returns its bills — but a trip is CANCELLED by status, never deleted.
ALTER TABLE orders ADD CONSTRAINT "orders_tripDropId_fkey"
  FOREIGN KEY ("tripDropId") REFERENCES trip_drops(id) ON DELETE SET NULL;

-- Pays for "every order on this trip", which the progress bar, the derived
-- `ready` state and the trip sheet all ask. orders otherwise has only its PK,
-- obdNumber UNIQUE, orders_updatedAt_idx and orders_invoiceNo_idx (CORE §7.12).
CREATE INDEX IF NOT EXISTS "orders_tripDropId_idx" ON orders ("tripDropId");

COMMENT ON COLUMN orders."tripDropId" IS
  'The stop this bill is on. NULL = not on a trip (the normal state). The ONLY trip pointer on orders — reach the trip via trip_drops.tripId, never a second column here.';


-- ───────────────────────────────────────────────────────────────────────────
-- D4 · transporter_master.isRealTransporter (decision 6)
-- The SAP junk rows STAY — historical orders may point at them, and CORE §3
-- forbids deleting. This flag is what the trip's transporter picker reads.
-- Default FALSE is the safe direction: an unmarked row is simply absent from a
-- picker, which is recoverable.
-- ⚠ NOT the same question as isActive, which means "still trading".
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE transporter_master
  ADD COLUMN IF NOT EXISTS "isRealTransporter" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN transporter_master."isRealTransporter" IS
  'TRUE = a real carrier, offered in the trip transporter picker. FALSE = an SAP status code imported as a name (DELETE, CANCEL, HAND, PORTER, ewaybill, PICK DELETED, CI). Display flag only — isActive answers the different question of whether a real carrier still trades.';


-- ───────────────────────────────────────────────────────────────────────────
-- D5 · VERIFY — run this after the DDL above. Read-only.
-- Each arm is subquery-wrapped so a LIMIT inside a UNION ALL branch is legal.
-- ───────────────────────────────────────────────────────────────────────────
SELECT 'trips columns'            AS chk, count(*)::text AS value
  FROM information_schema.columns WHERE table_name='trips'
UNION ALL
SELECT 'trip_drops columns',      count(*)::text
  FROM information_schema.columns WHERE table_name='trip_drops'
UNION ALL
SELECT 'orders.tripDropId exists', count(*)::text
  FROM information_schema.columns
  WHERE table_name='orders' AND column_name='tripDropId'
UNION ALL
SELECT 'isRealTransporter exists', count(*)::text
  FROM information_schema.columns
  WHERE table_name='transporter_master' AND column_name='isRealTransporter'
UNION ALL
SELECT 'trips constraints',       count(*)::text
  FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
  WHERE rel.relname='trips'
UNION ALL
SELECT 'trip_drops constraints',  count(*)::text
  FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
  WHERE rel.relname='trip_drops'
UNION ALL
SELECT 'sample trip number',      (SELECT 'L-' || to_char(current_date,'YYMMDD')
                                          || '-' || lpad('1',2,'0'));


-- ───────────────────────────────────────────────────────────────────────────
-- D6 · BLAST RADIUS — read this BEFORE the commented sections below.
-- Read-only. Shows exactly what D7 and D8 would touch.
-- ───────────────────────────────────────────────────────────────────────────
SELECT 'D7 would flag as real'   AS what, count(*)::text AS rows FROM transporter_master
 WHERE name IN ('Nagadhiraj','Safexpress','Diamond Logistics','Sai Logistics',
                'Dev Shri Roadlines','Ghanshyam Roadways','Sai Dev Roadlines',
                'Shri Lalitji Tempo Service','Sai Tempo Service',
                'Jay Yaha Mogi Roadlines','Jahanvi Trans Logistics',
                'OM SAI RAM RAODWAYS','TEJASHVI ROADWAYS','MUMBAI BARODA TRANSPORT',
                'V-TRANS','Shri Sai Dev Tempo','DTDC Courier','Shiv Logistics')
UNION ALL
SELECT 'D7 would leave false',   count(*)::text FROM transporter_master
 WHERE name IN ('DELETE','CI','CANCEL','PORTER','ewaybill','PICK DELETED','HAND')
UNION ALL
SELECT 'D8 would insert (plates only)', count(*)::text FROM (
   SELECT DISTINCT "vehicleNo" FROM trip_report
    WHERE "disDate" >= current_date - 30
      AND "vehicleNo" IS NOT NULL AND btrim("vehicleNo") <> ''
      AND "vehicleNo" ~ '^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}$'
      AND upper(regexp_replace("vehicleNo",'[^A-Za-z0-9]','','g')) NOT IN
          (SELECT upper(regexp_replace("vehicleNo",'[^A-Za-z0-9]','','g')) FROM vehicle_master)
 ) x
UNION ALL
SELECT 'D8 non-plate values skipped', count(*)::text FROM (
   SELECT DISTINCT "vehicleNo" FROM trip_report
    WHERE "disDate" >= current_date - 30
      AND "vehicleNo" IS NOT NULL AND btrim("vehicleNo") <> ''
      AND "vehicleNo" !~ '^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}$'
 ) y
UNION ALL
SELECT 'vehicle_master rows now', count(*)::text FROM vehicle_master;


-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠⚠  EVERYTHING BELOW THIS LINE IS COMMENTED OUT AND MODIFIES EXISTING ROWS.
--     Run D6 first, read the numbers, then uncomment deliberately.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- D7 · Mark the real transporters. NOT DESTRUCTIVE — sets a new flag only, and
-- the flag defaults false so re-running is idempotent. No row is deleted.
-- The 18 names are taken from the live table verbatim, INCLUDING the
-- misspelling 'OM SAI RAM RAODWAYS' — it is the row's real name and matching on
-- a corrected spelling would flag nothing.
-- PREVIEW FIRST:
-- ───────────────────────────────────────────────────────────────────────────
-- SELECT id, name, "isActive",
--        CASE WHEN name IN ('Nagadhiraj','Safexpress','Diamond Logistics','Sai Logistics',
--                           'Dev Shri Roadlines','Ghanshyam Roadways','Sai Dev Roadlines',
--                           'Shri Lalitji Tempo Service','Sai Tempo Service',
--                           'Jay Yaha Mogi Roadlines','Jahanvi Trans Logistics',
--                           'OM SAI RAM RAODWAYS','TEJASHVI ROADWAYS','MUMBAI BARODA TRANSPORT',
--                           'V-TRANS','Shri Sai Dev Tempo','DTDC Courier','Shiv Logistics')
--             THEN 'WILL BE FLAGGED REAL' ELSE 'stays false' END AS verdict
--   FROM transporter_master ORDER BY verdict, name;
--
-- UPDATE transporter_master
--    SET "isRealTransporter" = true,
--        "updatedAt" = CURRENT_TIMESTAMP
--  WHERE name IN ('Nagadhiraj','Safexpress','Diamond Logistics','Sai Logistics',
--                 'Dev Shri Roadlines','Ghanshyam Roadways','Sai Dev Roadlines',
--                 'Shri Lalitji Tempo Service','Sai Tempo Service',
--                 'Jay Yaha Mogi Roadlines','Jahanvi Trans Logistics',
--                 'OM SAI RAM RAODWAYS','TEJASHVI ROADWAYS','MUMBAI BARODA TRANSPORT',
--                 'V-TRANS','Shri Sai Dev Tempo','DTDC Courier','Shiv Logistics');


-- ───────────────────────────────────────────────────────────────────────────
-- D8 · Seed the real vehicles from trip_report (decision 8).
--
-- 42 distinct vehicleNo values in the last 30 days, ZERO of which match any of
-- the six demo rows even after normalising (§A3). All 42 go under transporter
-- id 4, Nagadhiraj — which is what the mirror says, though §A4 records that the
-- puller filters on that value so it cannot say anything else.
--
-- Driver name and phone come from the MOST RECENT trip row per vehicle.
-- The six demo rows are LEFT ALONE (decision 8). Nothing is deleted.
--
-- 🔴 THREE THINGS TO READ BEFORE UNCOMMENTING:
--
-- 1. `capacityKg` is NOT NULL on vehicle_master and trip_report carries no
--    capacity at all. It is seeded as 0, meaning "not recorded". 0 is not a real
--    capacity and must not be used for load planning. Nothing reads capacityKg
--    today (dispatch_plans is the archived Planning board), but it is displayed
--    on the admin vehicles page and someone will eventually believe it.
--    Filling the real figures is a depot job, not a query.
--
-- 2. `deliveryTypeAllowed` is a single text column and a real vehicle runs both
--    Local and Upcountry. It is seeded with the vehicle's MOST FREQUENT type
--    over the window, mapping the mirror's 'UPC' to 'Upcountry'. That is a
--    summary, not a fact about what the vehicle may do.
--
-- 3. The WHERE excludes anything that is not plate-shaped, which drops the
--    pseudo-plate 'PORTER' (4 rows, 4 trips). That makes it 41 inserts, not 42.
--    PORTER is a service, not a vehicle, and seeding it creates a master row
--    nobody can put a driver in. To include it anyway, delete the two `~`
--    regex lines. D6 counts both sets so the number is visible before the run.
--
-- ON CONFLICT targets vehicle_master_vehicleNo_key, which exists live
-- (UNIQUE ("vehicleNo")) — so a re-run inserts nothing and changes nothing.
--
-- PREVIEW FIRST — this is the exact row set the INSERT would add:
-- ───────────────────────────────────────────────────────────────────────────
-- WITH latest AS (
--   SELECT "vehicleNo", "driverName", "driverMobile", "vehType",
--          row_number() OVER (PARTITION BY "vehicleNo"
--                             ORDER BY "disDate" DESC, "disTime" DESC NULLS LAST,
--                                      "sourceId" DESC) AS rn
--     FROM trip_report
--    WHERE "disDate" >= current_date - 30
--      AND "vehicleNo" IS NOT NULL AND btrim("vehicleNo") <> ''
--      AND "vehicleNo" ~ '^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}$'
-- ), toptype AS (
--   SELECT "vehicleNo",
--          CASE WHEN "deliveryType" = 'UPC' THEN 'Upcountry' ELSE "deliveryType" END AS dt,
--          row_number() OVER (PARTITION BY "vehicleNo" ORDER BY count(*) DESC) AS rn
--     FROM trip_report
--    WHERE "disDate" >= current_date - 30 AND "deliveryType" IS NOT NULL
--    GROUP BY 1,2
-- )
-- SELECT l."vehicleNo", COALESCE(l."vehType",'Unknown') AS category,
--        0 AS "capacityKg", COALESCE(t.dt,'Local') AS "deliveryTypeAllowed",
--        4 AS "transporterId", l."driverName", l."driverMobile" AS "driverPhone"
--   FROM latest l LEFT JOIN toptype t ON t."vehicleNo" = l."vehicleNo" AND t.rn = 1
--  WHERE l.rn = 1
--    AND upper(regexp_replace(l."vehicleNo",'[^A-Za-z0-9]','','g')) NOT IN
--        (SELECT upper(regexp_replace("vehicleNo",'[^A-Za-z0-9]','','g')) FROM vehicle_master)
--  ORDER BY l."vehicleNo";
--
-- THE INSERT:
--
-- WITH latest AS (
--   SELECT "vehicleNo", "driverName", "driverMobile", "vehType",
--          row_number() OVER (PARTITION BY "vehicleNo"
--                             ORDER BY "disDate" DESC, "disTime" DESC NULLS LAST,
--                                      "sourceId" DESC) AS rn
--     FROM trip_report
--    WHERE "disDate" >= current_date - 30
--      AND "vehicleNo" IS NOT NULL AND btrim("vehicleNo") <> ''
--      AND "vehicleNo" ~ '^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}$'
-- ), toptype AS (
--   SELECT "vehicleNo",
--          CASE WHEN "deliveryType" = 'UPC' THEN 'Upcountry' ELSE "deliveryType" END AS dt,
--          row_number() OVER (PARTITION BY "vehicleNo" ORDER BY count(*) DESC) AS rn
--     FROM trip_report
--    WHERE "disDate" >= current_date - 30 AND "deliveryType" IS NOT NULL
--    GROUP BY 1,2
-- )
-- INSERT INTO vehicle_master
--   ("vehicleNo", category, "capacityKg", "deliveryTypeAllowed",
--    "transporterId", "driverName", "driverPhone", "isActive", "createdAt")
-- SELECT l."vehicleNo",
--        COALESCE(l."vehType",'Unknown'),
--        0,
--        COALESCE(t.dt,'Local'),
--        4,
--        l."driverName",
--        l."driverMobile",
--        true,
--        CURRENT_TIMESTAMP
--   FROM latest l LEFT JOIN toptype t ON t."vehicleNo" = l."vehicleNo" AND t.rn = 1
--  WHERE l.rn = 1
-- ON CONFLICT ("vehicleNo") DO NOTHING;
```

---

## E — What I could not verify

1. **No SQL in §D has been executed.** It is written, reasoned and reviewed against the live schema,
   but every claim about whether it *runs* is untested. The most likely failure is
   `chk_trips_number_shape` — `to_char(date, text)` resolves through an implicit cast to
   `to_char(timestamp, text)`, which is IMMUTABLE, and the expression returns `260909` for
   `DATE '2026-09-09'` when run as a plain SELECT. Whether Postgres accepts it inside a CHECK is
   untested. It is placed last in its group so dropping it costs nothing else.
2. **`Cross` has no letter in the trip-number format.** `delivery_type_master` holds Local, Upcountry,
   IGT **and Cross**; `chk_trips_type_code` admits three. A Cross trip cannot be numbered. Cross
   deliveries are rare (`CLAUDE_TRIP_REPORT.md §4`) but the constraint would refuse one outright
   rather than degrade. Owner call: assign a fourth letter, or rule that Cross never gets a trip.
3. **Whether `loaded` joins `PICKING_ACTIVE_STAGES` is left as a recommendation, not a decision.**
   §C5 argues for adding it and names what breaks either way. I did not decide it because it changes
   Floor's history predicate, and the vanish-at-completion class it belongs to has already been fixed
   twice in this codebase under different names.
4. **Whether a `loaded` bill should stay on the live Floor board is also open** (§C5 item 2). I
   recommend leaving `floorLiveBaseWhere` alone and letting the trip band carry it. That is a judgement
   about what the board is for, not something the data settles.
5. **The billing break (§C5 item 1) is proven by reading, not by running.** `BILLING_PENDING_STAGE` is
   an exact string equality at `lib/billing/picking-where.ts:10`, used at `:66` and `:133`. I did not
   execute the billing list against a synthetic `loaded` row, because that would need a write.
6. **`capacityKg = 0` in the D8 seed is a placeholder for data that does not exist.** `trip_report`
   carries no capacity field. Nothing reads the column today, but it is displayed on the admin
   vehicles page, so 41 rows claiming 0 kg will eventually be read as fact by a person.
7. **`deliveryTypeAllowed` in the seed is a summary, not a fact.** The column holds one value; a real
   vehicle runs both Local and Upcountry. I take the most frequent type over 30 days. Whether the
   column should become multi-valued is a master-data question this proposal does not open.
8. **All 41 seeded vehicles are assigned to Nagadhiraj (id 4) because the mirror says so, and the
   mirror cannot say anything else** — the puller filters on that transporter before pushing (§A4). If
   any of those vehicles actually belongs to another carrier, this seed records it wrongly, and
   nothing in `trip_report` could reveal that.
9. **The 259 free-text ship-to redirects will group under the wrong customer** (§C3). The drop key
   falls through to `customerId` because there is no resolved override to use. This proposal does not
   fix it and cannot; the fix is upstream in how those redirects are captured.
10. **No screen was checked.** Claude Code has no login to `orbitoms.in`. Every statement about how
    the trip board would behave is derived from code and schema, not observed. That includes the read
    costs in §C4, which are reasoned from `lib/picking/queue.ts`'s recorded 18-statement measurement
    rather than measured here.
11. **`docs/mockups/floor-trips/floor-trips-v1.html` was not read.** The decision record cites it as
    the reference for every prompt in this work. It may constrain field names, the trip-band contents
    or the drawer's inputs in ways this schema does not anticipate.
12. **I did not check `archive/`.** Claims of the form "nothing writes X" mean nothing in the compiled
    tree. Archived code is excluded from `tsconfig.json` and is not deployed.
13. **Decisions I made that were not given to me**, so they are mine and should be reviewed as such:
    `typeCode` existing as a denormalised column beside `deliveryTypeId`; the `dropKey` prefix scheme
    over `NULLS NOT DISTINCT`; rank **95** for `loaded`; `ON DELETE SET NULL` on
    `orders.tripDropId` and `CASCADE` on `trip_drops.tripId`; the four CHECK constraints beyond status
    and type; `cancelledAt`/`cancelledById` existing at all (the prompt named released and dispatched
    only); the three indexes on `trips`; and the specific relation names `TripCreatedBy`,
    `TripReleasedBy`, `TripDispatchedBy`, `TripCancelledBy`.
14. **Six scratch scripts** from this session and the previous one are on disk under `scripts/`, all
    underscore-prefixed so `tsconfig.json`'s `scripts/_*` exclusion keeps them outside the
    `tsc --noEmit` gate: `_discovery_probe_20260909.ts`, `_discovery_probe2_20260909.ts`,
    `_discovery_probe3_20260909.ts`, `_trip_facts_20260909.ts`, `_dispatched_mystery_20260909.ts`,
    `_dispatched_mystery2_20260909.ts`, `_trip_seed_facts_20260909.ts`, `_trip_volume_20260909.ts`,
    `_orders_constraints_20260909.ts`. Nine, not six. All SELECT-only. Not deleted (CORE §3).

---

*Proposal only. No DDL executed, `prisma/schema.prisma` untouched, all database access read-only.
The path when this is approved is CORE §3's: Supabase SQL Editor by hand → hand-edit
`prisma/schema.prisma` → `npx prisma generate`. Never `db push`, never `db pull`.*
