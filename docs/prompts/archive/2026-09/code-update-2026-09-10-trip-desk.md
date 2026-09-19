# code-update-2026-09-10-trip-desk

**Classification:** `code-update-*` — **SHIPPED.** Every commit named below was confirmed against
`git log aead3c32^..7a66ac3e` before this file called it shipped. Twelve floor/trip commits; none
could not be confirmed. The po-v2 commits interleaved in that range are a different module and are
not covered here.

**Target canonical files (a later consolidation pass, not this one):** `CLAUDE_FLOOR.md`,
`CLAUDE_CORE.md` (the two new tables), `CLAUDE_PICKING.md` (the date rule, §A of the dates discovery),
`CLAUDE_TRIP_REPORT.md` (the parallel-run note), `ROADMAP.md`.

**Design record:** `web-update-2026-09-09-floor-trip-module.md`, rewritten the same day this shipped —
read that file for what the module IS. This one records what was BUILT and what it cost.

**Schema record:** `web-update-2026-09-09-trip-schema.md` §D holds the applied DDL.

**Mockups:** `docs/mockups/floor-trips/floor-trips-v3.html` (the layout) and `floor-trips-v4-columns.html`
(the row).

---

## 1. The twelve commits

| # | Commit | What shipped |
|---|---|---|
| 1 | `aead3c32` | Schema mirror — `trips`, `trip_drops`, the `orders` columns, `transporter_master.isRealTransporter` |
| 2 | `cd6be71a` | Server side — the allocator, the drop key, the read module, four routes |
| 3 | `04f4c97b` | First UI — the By-trip pivot view, desk pool, trip bands, Build trip drawer |
| 4 | `769763e3` | Pool renders its bills; By trip gated to admin |
| 5 | `1102ad1d` | Trip PATCH + cancel, band actions, three display fixes |
| 6 | `8a44cd10` | `releaseBillsToFloor` — one writer, two routes |
| 7 | `bbb9628c` | The v3 layout, and the board predicate widening |
| 8 | `e656ad80` | The Due and KG columns; the Upcoming divider |
| 9 | `828b59ca` | Nine columns that fit; "No bills yet" on an empty trip |
| 10 | `53c3729a` | The Route cell regression |
| 11 | `a5bafb40` | Selection ungated from picking status; the Ready-to-load chip |
| 12 | `7a66ac3e` | The Ready-to-load chip removed |

---

## 2. Schema — `aead3c32`

The DDL was applied by hand in the Supabase SQL Editor (CORE §3 — never `prisma db push`) and this
commit **mirrored** it into `prisma/schema.prisma`: 308 insertions, zero deletions.

- **`trips`** — 24 columns, 7 CHECK constraints, 2 unique indexes, 3 mapped indexes. The number is
  `{TYPE}-{YYMMDD}-{NN}`, shaped by `chk_trips_number_shape`; `chk_trips_status` admits
  `draft · released · loading · dispatched · cancelled` and deliberately has **no `ready`** value.
- **`trip_drops`** — 11 columns, 2 CHECKs, 2 uniques. Uniqueness is on `(tripId, dropSeq)` and
  `(tripId, dropKey)`.
- **`orders.tripDropId`** — the ONE pointer from a bill to its trip. There is deliberately **no
  `orders.tripId`**: two pointers can disagree and nothing would catch it. The trip is reached through
  `trip_drops.tripId`.
- **`orders.loadedAt` / `loadedById`** — columns only. Nothing writes them. See the design record on
  why the matching STAGE was cancelled.
- **`transporter_master.isRealTransporter`** — 18 of the 25 rows are true.

⚠ **CHECK constraints are invisible to Prisma** and are recorded by hand in the model header comments.
`prisma db pull` fails here (P1001), so the mirror is the only copy the repo has.

**Seed, confirmed live 2026-09-10:** `vehicle_master` holds **47** rows — the 6 pre-existing demo
vehicles plus the **41 seeded** from the trip-report mirror's last 30 days — and all 47 carry a
`transporterId`. `transporter_master` holds 25 rows of which **18** are flagged
`isRealTransporter`; the other 7 are ship-to codes that were never carriers.

---

## 3. Server side — `cd6be71a`, `1102ad1d`, `8a44cd10`

### The three lib modules

- **`lib/trips/number.ts`** — the allocator. `TYPE_CODE_BY_DELIVERY_TYPE` is an explicit map (L/U/I/C)
  that THROWS on an unknown type rather than guessing a letter. `formatTripNumber` uses
  `padStart(2,"0")`, which pads and never truncates — the busiest day-type on record is 37 trips, and a
  truncating format would collide silently at 100. `allocateTripNumberWithRetry` retries once on P2002.
- **`lib/trips/drop-key.ts`** — `computeDropKey` returns `'c:'+customerId` or `'s:'+shipToCode`.
  🔴 **The prefix is load-bearing.** 482 live bills carry no `customerId` at all, and 259 carry
  `shipToOverride = true` with a NULL override id, so a bare id would collide across two id spaces.
- **`lib/trips/queries.ts`** — SELECT-only. Every lookup is its own batched `findMany` keyed on
  `id IN (…)`, never an include chain: `lib/picking/queue.ts:537-554` records the measurement that
  settled it, an include tree issuing **18 SQL statements** for a 72-row board.

### The routes

| Route | Verb | Shipped in |
|---|---|---|
| `/api/floor/trips` | POST create, GET list by date | `cd6be71a` |
| `/api/floor/trips/[id]` | GET detail | `cd6be71a` |
| `/api/floor/trips/[id]` | PATCH vehicle / transporter / slot / note | `1102ad1d` |
| `/api/floor/trips/[id]/bills` | POST add / remove | `cd6be71a` |
| `/api/floor/trips/[id]/release` | POST | `cd6be71a`, rewritten `8a44cd10` |
| `/api/floor/trips/[id]/cancel` | POST | `1102ad1d` |
| `/api/floor/trips/options` | GET the four master lists | `04f4c97b` |

### 🔴 `releaseBillsToFloor` — ONE OWNER, TWO ROUTES (`8a44cd10`)

The bug this closed is worth keeping. The trip release called `stampPickVisibility` and **nothing
else**. That function refuses any bill not already at `pending_picking`, so a bill at `pending_support`
put on a trip and released stayed at `pending_support`, kept `dispatchStatus` NULL, never reached the
picking board — and came back in a bucket the route had labelled "already with a picker", which was
false on screen. Diagnosed in `code-discovery-2026-09-10-noslot-backlog.md §B5`.

`lib/floor/release.ts` is now the one definition of what releasing means, and both
`POST /api/floor/release` (the Hold tab) and `POST /api/floor/trips/[id]/release` call it. In ONE
`orders.update` per bill it writes `dispatchTargetDate`, `dispatchWindowId`,
`dispatchStatus: 'dispatch'`, `workflowStage: SUPPORT_DONE_OUTPUT` and `dispatchSlotSource: 'manual'`,
plus ONE `order_status_logs` row carrying the bill's REAL prior stage.

- **Exactly one `orders.update` per bill** — the live-sync markers key on `MAX(orders.updatedAt)`, so a
  second write fires a false "changed" on every board in the depot.
- **`TINT_IN_PROGRESS_STAGES`** (`pending_tint_assignment · tint_assigned · tinting_in_progress`) come
  back as `waitingForTint`, not `failed`. A mid-tint bill on a trip is a bill waiting its turn; the
  caller re-runs the release later to catch it up.
- **`skipAlreadyReleased`** is `true` from the trip caller and `false` from the rail/Hold caller. That
  difference is why a trip's bills do not all share the trip's date — see §5.

---

## 4. 🔴 The board predicate WIDENING — `bbb9628c`

**This is a landmine, not a footnote.** Retiring the decision rail meant its bills had to appear on the
board. The rail held bills at a released stage with `dispatchStatus` NULL. The obvious one-line change
is to drop the `dispatchStatus: 'dispatch'` term from `floorLiveBaseWhere`.

**Do not.** Measured against live data, twice, on 2026-09-10:

| approach | rows on the board |
|---|---:|
| the deliberate two-arm union that shipped | **44** |
| dropping the `dispatchStatus` term instead | **2,604** |

The status term is not only about un-slotted bills. Dropping it also admits every finished bill in the
depot's history, because `pick_checked` rows keep `dispatchStatus` set and the live arm's checked
branch is what fences them to today. A 40-row board would have become a 2,604-row one.

What shipped instead, in `lib/floor/queries.ts`:

```ts
export function floorUnslottedWhere(): Prisma.ordersWhereInput {
  return { workflowStage: { in: RAIL_STAGES }, dispatchStatus: null, isRemoved: false };
}
export function floorBoardWhere(todayRange: { start: Date; end: Date }): Prisma.ordersWhereInput {
  return { OR: [floorLiveBaseWhere(todayRange), floorUnslottedWhere()] };
}
```

Two arms, each with its own reason to exist, unioned. Overlap measured at **zero**. `getFloorRail`,
`getFloorBoard` and `getFloorLiveMarkerWhere` all repoint to it together, so the board and the marker
stay on one predicate (FLOOR §3/§5).

**The rule to carry forward: widen a predicate by UNION, never by removing a term.** A term you remove
was doing more than one job; a term you add is scoped to the job you added it for.

---

## 5. The v3 layout — `bbb9628c`

One screen. `components/floor/trip-desk.tsx` owns the split: a 298px rail of trips grouped by slot
label on the left, and in the middle either the bills on no trip or the selected trip's bills grouped
under numbered stop rows.

**What stopped rendering** (no file was deleted — archiving is its own step):

| File | Why |
|---|---|
| `floor-rail.tsx` | the decision rail. Its bills are ROWS now, via the widened predicate. |
| `floor-board.tsx` | the slot tabs, By picker, By group, the At-desk pool, the pivot |
| `assign-bar.tsx` + `trip-selection-bar.tsx` | one bar, `floor-bottom-bar.tsx` |
| `build-trip-drawer.tsx` | replaced by `trip-form.tsx` |
| `assign-context-banner.tsx` | unreachable once By picker went |

The slot tabs went because the trip carries the slot: the rail already groups trips by window, so a tab
re-cutting the board by window would be the same grouping twice. Assigning a picker is the supervisor's
job on `/picking` and was never done here in practice.

**One bar, two readings, decided by the RAIL and not by the rows.** Pool selected offers `Add to trip ▾`
with `New trip…` last; a trip selected offers `Remove from trip`. Rows cannot express that question —
an empty selection has no rows, and a bill can sit under a trip's stop while the planner looks at the
pool.

---

## 6. The row — `e656ad80`, `828b59ca`, `53c3729a`

### The Due column

🔴 **It reads the BILL's `dispatchTargetDate` and `windowTime`, never the trip's `tripDate`.**
`releaseBillsToFloor` is called with `skipAlreadyReleased: true` from the trip route, so a bill already
on the floor keeps the slot somebody already promised rather than being silently moved to the trip's
day. A trip's bills therefore genuinely carry different dates, and reading the trip here would show the
operator a date the bill does not have. Recorded in
`code-discovery-2026-09-10-dates-weight-orphans.md §A5.2`.

**Due IS the old `showSlot` column promoted, not a tenth beside a ninth.** That column was built on
2026-08-31 for the By-group view alone, for exactly this reason: grouping spanned slots, so there was no
slot TAB to carry the time and the row had to say it itself. When the tabs went from every view, every
view got the column. The `showSlot` flag was renamed `showInvoice`, which is all it still decided.

Four states, and a bare time means the anchor day and nothing else:

```
10:30                 due on the day the board is anchored on
Sat 12 · 12:30        promised ahead — blue
Mon 8 · 12:30  [2d]   overdue — red, with the age chip moved in from the OBD cell
no slot               no dispatchTargetDate at all
```

⚠ **The bare time is NOT the FLOOR §10 landmine and looks exactly like it.** The old bug was that the
date appeared NOWHERE — not on the tab, not on the row, not in the header — so two days' 10:30 sat in
one pile. The date is printed the moment it is not the anchor day, so its absence IS the statement.
`fmtDueDay`'s header says this at length because a future reader will otherwise "fix" it back.

The day label carries its MONTH when the month differs from the anchor. "Mon 8" is right a few days
either side of today and wrong for a bill dated 8 August on a September board.

### The KG column

`weightKg` had ridden the payload since **2026-08-11** (`lib/floor/queries.ts:860`, added in commit
`2853198c`) and was rendered by nothing. No query changed to put it on screen — it is one more scalar on
a `querySnapshot` select that was already fetching `articleTag` and `totalVolume`. Measured on the board
that day: 64 of 64 rows carried a weight above zero, totalling 25,891.6 kg.

🔴 **ZERO IS NOT A WEIGHT AND PRINTS AN EM DASH.** The importer writes
`totalWeight: summary?.grossWeight ?? 0` at four sites in `app/api/import/obd/route.ts` (`:600`, `:611`,
`:1339`, `:3292`), so a bill whose SAP gross weight never arrived is stored as 0 and is
**indistinguishable from a bill that genuinely weighs nothing**. 81 live orders sit at 0. A printed "0"
would let a planner load a van against `vehicle_master.capacityKg` and be short by whatever that bill
really weighs. `formatWeightKg` returns null for it and `sumWeightKg` returns the total it could read
PLUS how many it could not, so the selection bar prints "67+ kg" rather than under-counting silently.
Nothing estimates a missing weight.

### The Upcoming divider

Bills promised for a later date never left the payload — the open arm of the picking predicate has no
forward date fence and never had one — but `upcoming-strip.tsx` was the only thing rendering them and it
stopped with the old board in `bbb9628c`. They are back in the same table, below a divider carrying its
own totals, **selectable and addable to a trip**, which the old locked strip made impossible. The
divider is a row inside the fixed table whose `colSpan` reads `widths.length`, the same array the
colgroup maps, so the two cannot drift.

Three places assumed upcoming bills were off screen and each would have fought it: the live-sync
reconcile unticked them every fifteen seconds, the detail pager could not reach them, and a pasted OBD
would not find one.

### The column count, twice

`e656ad80` took the four width arms from 8/8/7/7 to 10/9/9/8. Ten did not fit — Due rendered
"Today · 10:…" and Status "Needs check 16…" on the live screen — so `828b59ca` dropped the word "Today"
(53 of 66 rows are due today) and stacked Vol over KG into one position, giving 9/8/8/7. Widths were
sized from live content measured that day: ship-to max 33 characters, route max 11 (`IGT / CROSS`),
article tag max 19 displayed, litres max "3,507 L", kilos max "4,551 kg".

**Still clipping, reported and not hidden:** Ship to ellipsises by design at any width. Below about
1360px six columns clip and the Status cell loses its hover actions. The owner chose horizontal scroll
over dropping the Invoice column; not built.

---

## 7. Selection ungated — `a5bafb40`

A bill at Done, Needs check or With picker rendered **no checkbox**, so the most loadable thing on the
board was the one thing that could not be put on a trip. The rule dates from when a tick meant "hand
this to a picker". Trip membership was never stage-gated — schema decision record §2, *"a bill can join
a trip at ANY workflowStage"*.

The floor path now reads `toggleAllIds` / `isAllIdsSelected`, the pair already written for Hold and
Cancelled, which have no off-the-shelf cutoff either. `lib/floor/selection.ts`'s stage-gated four are
unchanged and now uncalled; the file header names the two families and says which surface uses which.
`toggleAll` and `toggleAllIds` share one contract, unchanged: **per group, select-all on a partial
selection.**

---

## 8. Two things added and removed the same day

Both are recorded so a later session does not rediscover either as a new idea.

**The admin-only pivot gate** (`769763e3` → `bbb9628c`). While By trip was one option in a five-way
pivot being tested on live data, it was hidden from everyone but an admin — read off the session, with
no page key, no `role_permissions` row and no `app_settings` flag, precisely so there would be no
artefact to clean up. It also skipped the trips fetch for non-admins. It lasted one day: the trip desk
IS the Floor tab now, there is no option to hide, and `useSession`, `isAdmin` and the `isAdmin`
dependency on `load()` went with it.

**The Ready-to-load chip** (`a5bafb40` → `7a66ac3e`). Two chips on the pool header, All and Ready to
load, where ready meant CHECKED **and** INVOICED — both terms, because the depot's flow is check, then
billing raises the invoice, then loading, and a checked bill with no invoice cannot leave. The owner
removed it the same day. The predicate `isReadyToLoad` had exactly one caller and came out with it. The
selection widening in the same commit was **not** reverted.

---

## 9. 🔴 Lessons — these cost real time and will recur

### A `<td>` inside a comment counted as a real cell

`e656ad80` introduced the Due column by replacing a two-part anchor — the Route cell plus the old
guarded Slot cell — with the Due cell alone. The Route cell was inside that anchor and was deleted with
it. The verification counted `<td` with a regex over the whole row function and one of its nine matches
was the string `<td>` written **inside a comment**. Eight real cells plus one commented one read as
nine, the check passed, and the commit report claimed all three lists agreed. They did not, and every
column right of Route drew one position left on the live screen for two commits: the ROUTE header showed
the due time, DUE was empty, and the Status pill sat under ARTICLE. Fixed in `53c3729a`.

**Strip comments before counting anything in source.** A check that can be fooled by a comment is worse
than no check, because it is believed.

### A false `{cond && <td>}` renders NOTHING — it does not leave a gap

This is why one missing cell shifts every column to its right instead of leaving a hole where it would
be seen. In a `table-fixed` table with a colgroup of percentages, the colgroup, the header cells and the
body cells are three lists that must agree entry for entry, and every conditional cell must be guarded
on the SAME condition in all three. `floor-table.tsx` now carries the cell order as a numbered list in
the widths block so it can be counted by eye.

### One rule in five places

The selection gate was not in one place. It was in the row checkbox, the header checkbox (through
`isAllSelected`), `toggleAll`, the search auto-tick and the live-sync reconcile. **Four of the five would
each have silently undone the fix on their own** — the reconcile most quietly of all, by unticking the
operator's hand-made selection every fifteen seconds and telling him the bills had "changed elsewhere".

When a rule looks like it lives in one function, grep for its EFFECT and not its name.

### Widen a predicate by union, never by removing a term

§4 above. 44 rows against 2,604, measured.

### OneDrive altered the working tree twice mid-session

Three edits to `lib/floor/types.ts`, `lib/floor/queries.ts` and part of `floor-board.tsx` were **reverted
on disk between writes** and were caught by a `tsc` failure rather than at the time. Separately, two
files — `public/category-images/product-fbc-advance.webp` and `promise-ext.webp` — were **deleted
outright** by something outside the session.

The repo lives under `C:\Users\HP\OneDrive\`. **Pause OneDrive sync before a working session.** A silent
revert between two edits of the same file is indistinguishable from a bad patch, and the time goes into
re-diagnosing work that was already correct.

---

## 10. What is not built

Named as open in the design record's own "still open" list, repeated here so this file stands alone:

1. **A trip's bills can carry a later date than the trip**, and nothing on screen says why the floor
   cannot pick them. Needs a "3 bills promised for later dates · Move to this trip's date" affordance.
2. **Reorder stops** renders disabled — no route writes `trip_drops.dropSeq`.
3. **Sixteen orphaned component files** are still on disk. `build-trip-drawer.tsx` cannot be archived
   until its four option types move somewhere else.
4. **Nine columns clip below about 1360px.**

---

*OrbitOMS · code-update, SHIPPED · 2026-09-10 · twelve commits, `aead3c32` to `7a66ac3e`,
each confirmed in `git log`*
