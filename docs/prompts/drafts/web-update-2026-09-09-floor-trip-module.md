# web-update-2026-09-09-floor-trip-module

**Classification:** `web-update-*` — **DECISION RECORD.** Rewritten in place on **2026-09-10**, the day
Phase 1 shipped. The original described a design that was **tried and abandoned twice the same day**;
what it said is no longer what exists.

> 🔴 **TWO EARLIER MODELS WERE BUILT AND REMOVED. DO NOT REDISCOVER THEM AS NEW IDEAS.**
> **(a) A By-trip PIVOT** — trips as a fifth option beside Flat / By route / By group / By picker, with
> an At-desk pool and a Build-trip drawer (`04f4c97b`, `769763e3`). Removed by `bbb9628c`: a pivot makes
> the trip a *way of looking at the board*, and the trip is the thing the planner is building.
> **(b) The `loaded` WORKFLOW STAGE** — §3.2 of the original made it "the one genuinely new bill stage".
> Cancelled before any code was written. See §4 for why, and it is not a preference.

**What shipped:** `code-update-2026-09-10-trip-desk.md` — twelve commits, `aead3c32` to `7a66ac3e`.
**Schema:** `web-update-2026-09-09-trip-schema.md` §D holds the applied DDL.
**Mockups:** `docs/mockups/floor-trips/floor-trips-v3.html` (layout) and `floor-trips-v4-columns.html`
(the row). **`floor-trips-v1.html` is the abandoned pivot design — do not build from it.**

**Target canonical files (eventually):** `CLAUDE_FLOOR.md`, `CLAUDE_PICKING.md`,
`CLAUDE_TRIP_REPORT.md`, `CLAUDE_CORE.md`, `ROADMAP.md`. See §8 for the correction list.

---

## 1. The decision — unchanged

**Floor Control stops being a picker-assignment screen and becomes the trip board.**

Owner framing, 2026-09-09: *"The floor control job is to plan route and order going out and they can do
the job accurately when actual picking and planning is in sync. Currently they are creating trip from
other software but now we create trip in Orbit only."*

Two things drove it, both still true:

1. **Bulk picker assignment on `/floor` was never used as designed.** Assigning pickers is the
   supervisor's job on `/picking`. Per-bill reassign stays in the detail panel.
2. **NTS will stop building trips.** Orbit becomes the system of record. Parallel run first, then the
   puller is switched off.

---

## 2. ONE SCREEN — what the module actually is

Trips on the left rail. Bills in the middle. That is the whole shape.

- **Left rail, 298px** — "Not on a trip" pinned at the top, then one card per trip grouped under its
  slot label, cancelled trips sunk to the bottom. Selecting a card is what decides what the middle
  shows.
- **Middle, pool selected** — the bills on no trip, with a Flat / By route pivot and the Upcoming
  divider below the due half.
- **Middle, trip selected** — the trip header (number, type, slot, state, vehicle line, totals, the
  four-colour bar and the action row), then its bills grouped under numbered stop rows.
- **One bottom bar**, and which question it asks is decided by the RAIL, not by the rows: pool selected
  offers `Add to trip ▾` with `New trip…` last, a trip selected offers `Remove from trip`.
- **New trip** is the only filled control in the tab row, and it is hidden in History.

### 🔴 Gone, and gone on purpose

**No Trips tab. No By-trip pivot. No builder drawer. No At-desk pool. No decision rail.**

- The **decision rail** held bills the engine could not slot, each on a card with its own slot picker
  and a "Why no slot?" link. Those bills are ROWS on the board now — the predicate was widened to union
  them in — wearing a quiet `no slot` chip. Putting one on a trip is what gives it a slot.
- The **At-desk pool** was a block inside the old board. It is the rail's first entry now.
- The **Build trip drawer** was built around a selection and summarised the ticked bills by route.
  `trip-form.tsx` replaced it: a trip is a thing you make, and bills are added to it afterwards. The one
  case where both happen at once is `New trip…` at the foot of the Add-to-trip list.
- The **slot tabs** went because the trip carries the slot. The rail already groups trips by window; a
  tab re-cutting the board by window would be the same grouping twice.

---

## 3. 🔴 Adding a bill to a trip IS what the rail's Release used to do

This is the single most load-bearing consequence and it replaces the original §2 and §5.1.

**The trip decides the slot.** `releaseBillsToFloor` writes the trip's `tripDate` and
`dispatchWindowId` onto its bills, sets `dispatchStatus: 'dispatch'` and advances the stage. There is no
other way to give a bill a slot by hand any more.

**Manual slot-picking is gone**, and with it:

- the rail card's per-bill slot picker;
- **the August slot SUGGESTION layer** (`lib/floor/suggest.ts`) — it still runs inside `getFloorRail`
  and its output has no reader. It answered "which window should this bill go in", which is now
  answered by which trip you put it on.

⚠ **A bill's slot and a trip's departure are still two different facts**, and the original §5.1 was
right about that. The bill slot is the PROMISE — when it is due out, what orders the picking queue. The
trip is the actual departure. A bill promised 12:30 that leaves on the 16:00 trip is now a recordable
fact, which Orbit could not express before.

⚠ **Trip membership and visibility remain SEPARATE facts.** A bill can be added to a trip at ANY
`workflowStage` — membership is not gated (schema decision record §2) — while releasing it still refuses
a mid-tint bill until the shades are done (`FLOOR_RELEASABLE_STAGES`). Do not weld the two into one flag.

---

## 4. 🔴 The `loaded` STAGE IS CANCELLED

The original §3.2 called `loaded` "the one genuinely new bill stage". **It is not being built, and the
reason is not a preference.**

**Loading is a job on the TRIP, not a state of the bill.** A bill going to a `loaded` workflowStage
would **fall off the billing pending list silently and never be invoiced.** Every predicate that asks
"is this bill still open" — the picking queue, the picking marker, `floorLiveBaseWhere`, the billing
pending set, the supervisor's badge — enumerates the stages it accepts. A new stage is invisible to all
of them until each is taught about it, and the failure mode is not an error: the bill simply stops
appearing, on a screen where nobody is looking for it.

That is the same class of failure the visibility-gate build had to design around (`PICKING_OPEN_STAGES`,
three branches) and the same reason the delivery ladder is barred from `workflowStage` below.

**`orders.loadedAt` and `loadedById` EXIST as columns** (`aead3c32`) and nothing writes them. They are
there for the future loading screen, which will stamp them without moving the bill's stage.

### The ladders, corrected

| Ladder | Lives on | States |
|---|---|---|
| Depot | the **bill** (`workflowStage`) | waiting → with picker → picked → checked → dispatched |
| Vehicle | the **trip** | draft → released → loading → dispatched *(or cancelled)* |
| Delivery | the **drop** (later, driver app) | out for delivery → delivered → received / POD |

🔴 **The delivery ladder must NEVER enter `workflowStage`,** for exactly the reason `loaded` was
cancelled. Once a bill is `dispatched` the depot screens are finished with it and the delivery track
owns it.

🔴 **The `pick_checked` → `dispatched` drain is still open.** Live 2026-09-10: **2,621** bills at
`pick_checked`, **4,137** at `dispatched` of which only 241 carry a log row. Trip dispatch is the missing
writer and it is not built yet (§6). `CLAUDE_FLOOR.md §10` and `CLAUDE_PICKING.md §7` both record this
gap; nothing in Phase 1 closed it.

---

## 5. When dispatch is stamped, and by whom

**Dispatch belongs at the END OF LOADING, not at the driver's Start trip.** By the time the driver taps
anything the goods are already on the vehicle and off the depot's books; waiting for his tap would leave
a fully-loaded trip reading as still in the depot, and a driver who forgets to tap would leave it there
for good.

**The driver's two taps stamp the TRIP**, never a bill. Delivery and proof-of-delivery are a separate
ladder on the DROP row (§4) and are a later phase.

**A trip is CANCELLED, never DELETED.** The number is retained so the allocator can never reissue it —
`chk_trips_status` admits `cancelled`, and cancelling detaches the bills back to the pool rather than
destroying the row. A reissued trip number on a driver's sheet is the failure this prevents.

---

## 6. Scope — this phase stops at CONFIRM PLAN

Shipped: the trip exists, bills go on and come off it, the plan is confirmed, and confirming releases
the bills to the floor.

**Not built, and each is its own phase:** the trip sheet (Phase 2 — `trip-sheet-document.tsx` is already
prop-driven and shared by the print route and the WhatsApp path, the largest reuse win in the plan), the
loading screen, dispatch, and the driver app with delivery and POD (Phase 4).

### 🔴 Orbit trips NEVER go in `trip_report` — unchanged

`trip_report` is a mirror. `mirror_trip_report_today()` **deletes today's rows and reinserts them every
60 seconds** from the NTS puller. Anything Orbit wrote there is gone within a minute, silently. During
the parallel weeks `/trips` keeps showing the NTS photocopy, read-only; Orbit's real trips live in the
new tables; the two are **not** reconciled and nobody should build a matcher for a temporary overlap.
When NTS stops: puller off → mirror stale → `/trips` retired through `archive/RETIREMENT-PLAYBOOK.md`.

---

## 7. Two rules the trip work must not break

### 7.1 🔴 Hold bills are GENUINE working state

**Owner statement, 2026-09-10.** The 155 bills currently at `dispatchStatus='hold'` are not a backlog,
not stale, and not something to sweep. On-hold is a real thing the depot does to a real bill.

🔴 **The stale-hold cleanup SQL in `code-discovery-2026-09-10-noslot-backlog.md §C` is DEAD. It must
never be run.** That section proposed closing 42 hold bills older than 30 days to `dispatched`, on the
reasoning that an invoice plus a 35-day age meant they had shipped. The owner's ruling settles it the
other way: age is not evidence of shipping when holding is a deliberate act. The section is marked dead
in that file too.

### 7.2 🔴 The date rule — nothing in the trip work may change it

From `code-discovery-2026-09-10-dates-weight-orphans.md §A`, established by reading the code because it
had never been written down:

- **There is no forward date limit in SQL.** The `openPending` scope — the only scope any live caller
  selects — carries **no `dispatchTargetDate` term at all**. Its one date term fences
  `pick_assignments.checkedAt` to today, which answers *when was this checked*, not *when is it due*.
- **A future-dated bill therefore REACHES the supervisor's board** and renders in **Zone 2, locked**:
  visible, readable, tappable, no checkbox, and the Assign button replaced by a disabled lock
  (`picking-board-mobile.tsx:4281` / `:4304`).
- **`zone` is one expression, duplicated character-for-character** in `lib/picking/queue.ts:763` and
  `lib/floor/queries.ts:793`. They agree. A null date is `due`, never `upcoming`; an early-released bill
  is `due` for good.
- **Tomorrow does NOT behave like today.** By zone there is no difference between tomorrow and next
  Saturday — both are locked. The difference is `releasableToday`, a separate field: a supervisor may
  unlock a future bill **only on the last working day before its dispatch date**, Sunday skipped.

Traced end to end: a trip dated three days out, released, puts its bills on the supervisor's board today
as locked Zone 2 rows that cannot be assigned. **The rule is intact and must stay intact.**

---

## 8. Still open — named as open

1. 🔴 **A bill promised for a later date sitting on today's trip keeps its own date.** The floor cannot
   pick it and **nothing on screen says why**. This is the sharpest remaining gap: the planner has done
   something reasonable and the system silently declines to act on it. Needs an affordance on the trip
   header — *"3 bills promised for later dates · Move to this trip's date"* — which would write the
   trip's date onto them deliberately, with a log row, instead of the release skipping them.
2. **Reorder stops is disabled.** No route writes `trip_drops.dropSeq`; the button renders disabled with
   a title saying so rather than being omitted, so the gap is visible.
3. **Sixteen orphaned component files are still on disk.** `build-trip-drawer.tsx` **cannot be archived
   until its four option types move** — `DeliveryTypeOption`, `DispatchWindowOption`, `VehicleOption`,
   `TransporterOption` are type-imported by `floor-page.tsx`, `trip-form.tsx` and
   `trip-vehicle-editor.tsx`, all live. Full list in
   `code-discovery-2026-09-10-dates-weight-orphans.md §C`.
4. **Nine columns clip below about 1360px.** The owner chose horizontal scroll over dropping the Invoice
   column; not built.
5. **Three feeds now run with no reader** — the rail feed and its suggestion engine, and the two
   by-group SKU arrays on the board payload. Server work per load, nothing renders it.
6. **Freight.** NTS carried `tRate`, `dieselAmt`, `totDistributor`. Whether Orbit must carry the money
   side once NTS stops is still unanswered.
7. **Who marks a trip dispatched**, and whether the trip sheet prints at that moment. Phase 2/3.

---

## 9. Corrections owed to canonical files

Collected for a later consolidation pass. **None of these has been applied** — editing canon is a
separate job.

| File | Where | What is wrong now |
|---|---|---|
| `CLAUDE_FLOOR.md` | §11, the `picker-card.tsx` row | Says `/floor` **lands on By picker** (`mode` defaults to `"picker"`). Superseded twice: the landing view became `"route"` on 2026-08-27 (`8468297a`), and **there is no view pivot at all** since `bbb9628c`. By picker, By group and the pivot are gone from the screen. |
| `CLAUDE_FLOOR.md` | §3 | "**Four SELECT-only feeds**". Still four functions, but the RAIL feed now has no reader — `getFloorRail` and `suggestSlot` run on every board load and nothing renders the result. The trips feed is a fifth read the page makes, from its own route. |
| `CLAUDE_FLOOR.md` | §3, `FLOOR_SPINE` | "applied in the TWO places that sort … the server sort and the client re-sort helper (`components/floor/floor-board.tsx`)". The client helper moved to `components/floor/trip-desk.tsx`; `floor-board.tsx` no longer renders. |
| `CLAUDE_FLOOR.md` | §10, display-clock landmine | "The floor row displays `orderDateTime` while the slot was decided by `obdEmailDate` … Display gap". **Fixed** — `resolveFloorDisplayDate()` in `lib/floor/format.ts` now owns the choice and the row and the decision read the same clock. Mark resolved rather than deleting; the import-side twins in `CLAUDE_IMPORT.md` are unaffected. |
| `CLAUDE_FLOOR.md` | §10, slot-tab landmine | "slot tabs group by `windowTime` alone, ignoring `dispatchTargetDate`". **Resolved by removal** — the slot tabs are gone and the Due column puts the date on every row. Keep the entry as the REASON the Due column exists; `fmtDueDay` cites it. |
| `CLAUDE_FLOOR.md` | §10, parked data | "`Deco` (9 rows)" and "**103** Deco Retail bills at `pending_support` with `dispatchStatus` NULL". ⚠ **Both numbers are stale and neither is zero.** Live 2026-09-10: `smu='Deco'` is **22** rows (it grew, it did not shrink), and the stuck Deco Retail set is **8**, down from 103. Re-measure at consolidation rather than copying either figure. |
| `CLAUDE_FLOOR.md` | §10, `dispatched` drain | "1,051 at `dispatched` … 195 at `pick_checked`" (2026-07-24). Live 2026-09-10: **4,137** and **2,621**. The gap is still open and is now much larger. |
| `CLAUDE_FLOOR.md` | §2, the left/right split | The 344px decision rail is gone; the body is one column and the desk grows its own 298px rail of trips inside it. |
| `CLAUDE_FLOOR.md` | §11, the file index | `floor-board.tsx`, `floor-rail.tsx`, `rail-card.tsx`, `rail-empty.tsx`, `tint-strip.tsx`, `desk-pool.tsx`, `slot-band.tsx`, `group-row.tsx`, `picker-card.tsx`, `floor-tabs.tsx`, `carryover-banner.tsx`, `upcoming-strip.tsx`, `trip-band.tsx`, `assign-bar.tsx`, `assign-context-banner.tsx`, `trip-selection-bar.tsx` are all still on disk and none of them renders. Six new files are not in the index: `trip-desk.tsx`, `trip-rail.tsx`, `trip-detail-header.tsx`, `trip-form.tsx`, `floor-bottom-bar.tsx`, `lib/floor/release.ts`. |
| `CLAUDE_FLOOR.md` | §4.2 | `FLOOR_RELEASABLE_STAGES` is unchanged, but the mid-tint stages now come back as `waitingForTint` rather than as failures. Worth a line. |
| `CLAUDE_CORE.md` | schema | `trips`, `trip_drops`, `orders.tripDropId` / `loadedAt` / `loadedById`, `transporter_master.isRealTransporter` are not documented. |
| `CLAUDE_PICKING.md` | the date zones | The forward-visibility rule in §7.2 above has never been written down anywhere. It belongs here. |
| `CLAUDE_TRIP_REPORT.md` | — | Needs the parallel-run note: Orbit trips never go in `trip_report`, and the retirement path. |

---

*OrbitOMS · decision record · written 2026-09-09, rewritten in place 2026-09-10 the day Phase 1
shipped. Two earlier models — the By-trip pivot and the `loaded` stage — were tried and removed; see
the banner at the top before proposing either again.*
