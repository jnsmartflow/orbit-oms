# Discovery — the date rule, per-bill weight, and what commit bbb9628c orphaned

**2026-09-10 (Thu) · DISCOVERY ONLY · no code written, no schema touched, no DDL, nothing archived.**
Every database read in this document is a SELECT. Live numbers are today's and move.

Read for this: the v3 mockup, `code-discovery-2026-09-10-noslot-backlog.md`, `CLAUDE_PICKING.md`,
`CLAUDE_FLOOR.md §3`, `lib/picking/queue.ts`, `lib/picking/release-window.ts`, `lib/floor/queries.ts`,
`lib/floor/release.ts`, `components/picking/picking-board-mobile.tsx`, `prisma/schema.prisma`,
`app/api/floor/trips/[id]/release/route.ts`, `app/api/import/obd/route.ts`.

> 🔴 **One read on the list does not exist.** `docs/mockups/floor-trips/floor-trips-v4-columns.html`
> is not in the repo. I searched the whole tree for `*v4*` and for `*column*.html`; the floor-trips
> mockup folder holds `floor-trips-v1.html` and `floor-trips-v3.html` and nothing else. §B answers
> the DATA question about kilograms, which does not depend on the layout. It does not answer any
> question about which columns the set contains or how they are ordered. See §E1.

---

## A · The date rule

### A1 — the date terms in `buildPickingWhere`

There are two scopes and they behave completely differently.

**`scope: "openPending"` — the only scope any live caller selects** (both mobile boards and the
marker hook; `lib/picking/queue.ts:118-127` records that nothing reaches the other one by omission).
Its predicate, `lib/picking/queue.ts:346-430`:

```ts
{
  dispatchStatus: "dispatch",
  isRemoved: false,
  OR: [
    gateOn
      ? { workflowStage: SUPPORT_DONE_OUTPUT, pickVisibleAt: { not: null } }
      : { workflowStage: SUPPORT_DONE_OUTPUT },
    { workflowStage: { in: [PICK_ASSIGNED, PICK_DONE] } },
    { workflowStage: PICK_CHECKED,
      pickAssignment: { checkedAt: { gte: checkedStart, lt: checkedEnd } } },   // :425
  ],
}
```

🔴 **There is NO `dispatchTargetDate` term anywhere in this scope, and that is deliberate.** The
comment above the `OR` says so in as many words: *"NO dispatchTargetDate fence on the open arm — that
is the whole point of this scope."* The one date term in the whole predicate is on the CHECKED arm,
and it fences `pick_assignments.checkedAt` to today's IST instant window — a *when was this checked*
question, never *when is this due*. `checkedStart`/`checkedEnd` come from `getISTDayRange()`.

So the plain answer to "how far ahead can the supervisor see?" is: **there is no forward limit in
SQL.** A bill dated six months out, if it is `dispatchStatus: 'dispatch'` and at an open stage, is in
the payload. Everything that makes a future bill behave differently happens after the query, in the
`zone` derivation and in the component. That is important and it has never been written down.

**`scope: "single"` — the module default, selected by no app code.** `lib/picking/queue.ts:439` is a
single equality: `dispatchTargetDate: dateOnly`. Exactly one day, every stage including
`pick_checked`. Both public routes accept it by name, so it is caller-less, not unreachable, and the
file records that it must not be deleted as dead.

### A2 — how `zone` is computed, in both files

Character-for-character identical expressions. `lib/picking/queue.ts:763-764` and
`lib/floor/queries.ts:793-794`:

```ts
const zone: "due" | "upcoming" =
  !noDispatchDate && targetDate.getTime() > anchorMs && !isEarlyReleased ? "upcoming" : "due";
```

with `noDispatchDate = targetDate === null` and `isEarlyReleased = order.pickEarlyReleasedAt !== null`
in both. `ageDays` is likewise identical in both files.

**They agree today.** The only difference is what `anchorMs` is, and that difference is the point:

| file | anchor | what it means |
|---|---|---|
| `lib/picking/queue.ts:730` | `dateOnly` from `resolveTargetDate` — today in IST for `openPending` | is this bill due as of today |
| `lib/floor/queries.ts:635` | `anchorDate` — today live, the VIEWED day in history | was this bill due as of the day on screen |

Three rules ride along and are worth stating because they are easy to get wrong:

- **A null dispatch date is `due`, never `upcoming`.** Locked, and commented as locked in both files:
  unscheduled work must not hide behind the lock.
- **`isEarlyReleased` forces `due` permanently.** Once `orders.pickEarlyReleasedAt` is set, the bill
  is due on that day and every later day, with no job and no second write.
- **`zone` is recomputed from scratch on every fetch.** An upcoming bill graduates to due by itself
  when the IST day rolls over. Nothing is stored and nothing has to run.

### A3 — what an `upcoming` bill actually does on the supervisor's board

Read from `components/picking/picking-board-mobile.tsx`, not inferred.

**It is present, and it is readable. It is not assignable.**

- The Assign tab is split into two rendered zones: Zone 1 "Due now" from
  `filteredWaitingAll.filter(r => r.zone === "due")` (`:1608`) and Zone 2 "Upcoming" from
  `... === "upcoming"` (`:1664`). Both render cards.
- Zone 2 cards are tappable and open the detail screen. The pager
  (`filteredWaiting = [...due, ...upcoming]`, `:1673`) deliberately walks INTO Zone 2, with the
  comment *"reading a locked bill is allowed, so the pager must not be stricter than a tap."*
- Zone 2 cards carry **no checkbox**, because bulk selection derives from `filteredWaitingDue`.
- On the detail screen the "Assign to picker" button is gated at `:4281` on
  `detailRow.zone !== "upcoming"`. Its own comment calls that term *"the ONLY thing shutting this path
  for a locked bill"* — an upcoming row passes every other guard, since `isAssigned`, `isDone` and
  `isChecked` are all false on it.
- `:4304` renders the replacement: a genuinely `disabled` button with a lock glyph and the line
  "Opens \<day\>".
- Pick bundling runs over `filteredWaitingDue` only, so an upcoming bill is never inside a bundle
  offered to a picker.
- The lane strip's litres total also reads `filteredWaitingDue` only, so an upcoming bill does not
  inflate the day's stated workload.

### A4 — tomorrow versus next Saturday

**The owner's belief is half right, and the half that is wrong matters.**

By `zone`, there is **no difference at all**. `targetDate > anchorMs` is a plain greater-than.
Tomorrow and next Saturday are both `upcoming`, both in Zone 2, both locked, both showing the
disabled button. Tomorrow does **not** behave like today.

The real difference is a **separate field answering a separate question**: `releasableToday`, computed
by `isReleasableToday()` in `lib/picking/release-window.ts` and carried on every row. Its rule:

> A supervisor may release a future-dated bill early **only on the last working day before its
> dispatch date.** Sunday is the only non-working day. Holidays are not modelled.

So from today, Thu 2026-09-10:

| bill dated | last working day before it | unlockable today? |
|---|---|---|
| Fri 11 Sep | Thu 10 Sep | **yes** |
| Sat 12 Sep | Fri 11 Sep | no |
| Sun 13 Sep | Sat 12 Sep | no |
| Mon 14 Sep | Sun 13 → skipped → Sat 12 Sep | no |

The correct statement of the rule is therefore: **tomorrow is not automatically due, but tomorrow is
the only future day a supervisor can promote to today by hand** — through `POST /api/picking/release`,
which writes `orders.pickEarlyReleasedAt` and thereby flips `zone` to `due` from then on. The file
warns explicitly against folding the two questions together: `releasableToday` is about the ACTION,
`zone` is about where the bill SITS, and a bill already released early reports `releasableToday: false`
the next day while staying `due`.

### A5 — 🔴 the safety question: a trip dated three days out

**Traced end to end. The answer is: yes it reaches the board, no it can be worked.**

The write. `POST /api/floor/trips/[id]/release` (`route.ts:164-172`) calls the shared writer with
`targetDate: trip.tripDate` — the TRIP's date, not today. `releaseBillsToFloor` then does one
`orders.update` per bill setting `dispatchTargetDate` to that date, `dispatchStatus: 'dispatch'`,
`workflowStage: SUPPORT_DONE_OUTPUT`, `dispatchSlotSource: 'manual'`. Step 2 of the route stamps
`pickVisibleAt` on everything that landed at `pending_picking`.

Against the supervisor's predicate, term by term:

| term | value after the release | passes? |
|---|---|---|
| `dispatchStatus: "dispatch"` | `'dispatch'` | yes |
| `isRemoved: false` | false | yes |
| waiting arm `workflowStage: SUPPORT_DONE_OUTPUT` | `pending_picking` | yes |
| gate arm `pickVisibleAt: { not: null }` (gate on) | stamped by step 2 | yes |
| any `dispatchTargetDate` term | **there is none** | n/a |

**The bill is in the payload today.** Then, post-query: `targetDate` is today+3, `anchorMs` is today,
`pickEarlyReleasedAt` is null, so `zone === "upcoming"`. It renders in Zone 2 with no checkbox, and
the Assign CTA is shut by `picking-board-mobile.tsx:4281`. `releasableToday` is false, because today
is not the last working day before today+3.

**The two terms that decide it:** the ABSENCE of a `dispatchTargetDate` clause in the `openPending`
predicate is why it reaches the board, and `targetDate.getTime() > anchorMs` is why it cannot be
assigned. Neither changes with any of the trip work. **The rule is intact.**

Two consequences worth carrying into the column work, neither of them a defect:

1. **On the day before the trip, `releasableToday` turns true** and a supervisor may unlock the bill
   one day early. That is the designed early-release window doing its job, not a leak the trip desk
   opened.
2. **A trip's bills do not all share the trip's date.** `releaseBillsToFloor` is called with
   `skipAlreadyReleased: true` from the trip route, so a bill already at `pending_picking` with
   `dispatchStatus: 'dispatch'` keeps the date it already had — deliberately, so putting a bill on a
   trip cannot silently move a promise somebody made. A Due column must therefore read the **bill's**
   `dispatchTargetDate`, never the trip's `tripDate`. Those two genuinely differ.

---

## B · Weight

### B1 — does a weight field exist?

Yes, in three places, and one of them is already on the floor payload.

| where | column | null? | populated |
|---|---|---|---|
| `orders` | `grossWeight Float?` | nullable | 74 of 13,830 live orders are null |
| `import_obd_query_summary` | `totalWeight Float` | **NOT NULL** | 13,830 of 13,830 rows exist |
| `import_raw_line_items` | `netWeight Float?`, `totalWeight Float?` | nullable | 18,420 of 46,245 lines have a total |

`import_obd_query_summary` is the per-OBD snapshot with `orderId` unique. It is the exact table
`totalVolume` (litres) already comes from.

### B2 — 🔴 it is already fetched, already shipped, and rendered by nothing

This is the finding that changes the shape of the question. `lib/floor/queries.ts:603`:

```ts
querySnapshot: { select: { articleTag: true, totalVolume: true, totalWeight: true } },
```

and `:860`:

```ts
weightKg: order.querySnapshot?.totalWeight ?? null,
```

`lib/picking/types.ts:65` declares `weightKg: number | null` on the row type, so it rides
`/api/floor/board` on every bill. It was added on 2026-08-11 (commit `2853198c`). A sweep for
`weightKg` across `app`, `components` and `lib` finds **no component that reads it** — only the
declaration and the assignment.

So the answer to "where would it come from" is: **nowhere new.** The number is already in the browser.

### B3 — live coverage on today's board

Board set = the two-arm `floorBoardWhere` union, replicated in SQL
(`scripts/_weight_coverage_20260910.ts`).

| measurement | value |
|---|---|
| board rows | 64 |
| with a query-summary row | 64 |
| with `totalWeight > 0` | **64** |
| with `totalWeight = 0` | 0 |
| with no snapshot at all | 0 |
| with `totalVolume > 0` | 62 |
| board total | 25,891.6 kg |
| board total | 20,285.1 L |

**Every bill on today's board can show a weight.** Two of them weigh something and displace no litres
— dry goods or tools, presumably; not investigated (§E3).

Depot-wide, for context: 13,830 live orders, all 13,830 with a snapshot, 13,749 with weight above
zero, so 81 sit at zero.

The two sources agree exactly. Of the 13,756 live orders carrying both `orders.grossWeight` and a
snapshot row, 13,756 agree to within 0.001 and **zero differ**. Either source gives the same number;
use the one already on the payload.

### B4 — the cost, stated honestly

**A column read on a relation the board already selects.** Not a join to add. Not a per-line
computation. `querySnapshot` is a to-one relation already included for `articleTag` and `totalVolume`,
and `totalWeight` is already inside that same `select`. Adding a KG column to the table costs **zero
additional queries and zero additional round trips.** It is a rendering change and nothing else.

⚠ **One data caveat the owner should decide on.** The importer writes
`totalWeight: summary?.grossWeight ?? 0` at four sites in `app/api/import/obd/route.ts` (`:600`,
`:611`, `:1339`, `:3292`). A bill whose SAP gross weight was missing therefore lands as **0, not
null** — indistinguishable from a bill that genuinely weighs nothing. 81 depot-wide rows sit at zero;
none of them is on today's board. A KG column has to choose what 0 means on screen, and from the data
alone it cannot tell the two cases apart.

### B5 — for contrast, how litres and article already work

Same relation, same select, same shape — which is why KG is cheap.

| column | source | payload field | formatter |
|---|---|---|---|
| Litres | `import_obd_query_summary.totalVolume` | `volumeLitres` (`queries.ts:539`, `:859`) | `formatLitres()` in `components/floor/status-pill.tsx` |
| Article | `import_obd_query_summary.articleTag` | `articleTag` | `formatArticleTag()` in `lib/floor/format.ts` (D/C/T/B) |
| **KG** | `import_obd_query_summary.totalWeight` | `weightKg` (`queries.ts:860`) | **none exists yet** |

KG is the third scalar on a select that already fetches two, and the only thing missing is a
formatter and a cell.

---

## C · Orphans

### C0 — method, and a sweep that disagreed with itself

Three sweeps, because the first one was wrong and the discipline is what caught it.

- **Sweep 1** — a regex over import statements with a char class on every slash, including a
  relative-path branch `from "\./<name>"`. **Over-matched.** A relative `./rail-card` written inside
  `components/mrn/mrn-rail.tsx` was counted against `components/floor/rail-card.tsx`, and the same
  happened for `status-pill` against two MRN files. Those three hits are false. Reported here rather
  than quietly dropped, because a false importer is what stops a real orphan being found.
- **Sweep 2 — authoritative.** Resolves every `@/`-prefixed and every relative specifier to an
  absolute file on disk, across `app`, `components`, `lib` and `scripts`, and separates `import type`
  from value imports. `./rail-card` inside `components/mrn/` now resolves to
  `components/mrn/rail-card.tsx` and cannot be confused. Script kept at
  `scratchpad/resolve-imports.js`.
- **Sweep 3** — the API routes, run twice: an ERE with a char class on every slash, and MSYS-native
  `grep -F` on the literal prefix. Both produced the identical route set. Sweep 3b's extra rows were
  prose mentions inside comments and trailing-period artefacts, not routes. **No route appeared in one
  sweep and not the other.**

Sweeps 2 and 3 agree with each other. Sweep 1's three extra importers are the only disagreement and
they are resolved against sweep 2.

### C1 — orphan ROOTS: no importer at all, value or type

| file | what it was |
|---|---|
| `components/floor/floor-board.tsx` | the whole old Floor tab — slot tabs, the pivot, By picker, By group |
| `components/floor/floor-rail.tsx` | the 344px decision rail |
| `components/floor/assign-bar.tsx` | Change slot · Choose picker · Assign |
| `components/floor/assign-context-banner.tsx` | the "deciding what to give X" band |
| `components/floor/trip-selection-bar.tsx` | Remove from trip |

### C2 — orphaned transitively: reachable ONLY through a root

Through `floor-board.tsx`:
`carryover-banner.tsx` · `desk-pool.tsx` · `floor-tabs.tsx` · `group-row.tsx` · `picker-card.tsx` ·
`slot-band.tsx` · `trip-band.tsx` · `upcoming-strip.tsx`

Through `floor-rail.tsx`:
`rail-card.tsx` · `rail-empty.tsx` — and through `rail-card.tsx` alone, `tint-strip.tsx`

**Sixteen component files in total.** Their exports go with them: `SlotTabKey`, `FloorTabs`,
`SlotBand`, `DeskPool`, `PickerCardStatus`, `pickerCardStatus`, `PickerCard`, `GroupRow`,
`UpcomingStrip`, `CarryoverBanner`, `TripBand`, `RailReleaseSlot`, `RailCard`, `TintStrip`,
`RailEmptyVariant`, `RailEmpty`. `buildPickerGroups` is module-private inside `floor-board.tsx`.

### C3 — `lib/floor/`: nothing is orphaned

Every one of the fifteen files has a live importer whose import is CALLED. `suggest.ts` is the one
worth naming: it is imported and genuinely called by `getFloorRail`, which is genuinely called by
`/api/floor/board`. It runs. Its output has no reader — see C5.

### C4 — the floor API routes: all seventeen still have a caller

Checked as calls, not as imports — every row below is a real `fetch()` or a `postJson()`/hook call
site, not a mention in a comment.

| route | live caller |
|---|---|
| `board` | `floor-page.tsx:272`, `:1063` (reconcile) |
| `hold` · `cancelled` | `floor-page.tsx:273`, `:274` |
| `marker` | `floor-page.tsx:1100` via `usePickingMarker({ url })` |
| `actions` | `floor-page.tsx` ×6 through `postJson` (urgent, hold, cancel, restore, change-slot) |
| `release` | `floor-page.tsx:801` (Hold tab bulk), `:960` (detail panel) |
| `order/[orderId]` | `detail-panel.tsx:207` |
| `ship-to` | `floor-page.tsx:968` |
| `ship-to-search` | `detail-panel.tsx:755` |
| `pick-gate` | `floor-page.tsx:346`, `pick-gate-toggle.tsx:58` |
| `pick-visible` | `floor-page.tsx:727` |
| `trips` (GET, POST) | `floor-page.tsx:304`, `trip-form.tsx:92` |
| `trips/[id]` (GET, PATCH) | `floor-page.tsx:436`, `trip-vehicle-editor.tsx:104` |
| `trips/[id]/bills` | `floor-page.tsx:470`, `:529`, `trip-form.tsx:121` |
| `trips/[id]/release` · `/cancel` | `floor-page.tsx:560`, `:616` |
| `trips/options` | `floor-page.tsx:386`, `:646` |

Two of those call sites are inside orphans and do not count: `build-trip-drawer.tsx:134`/`:157`. Both
routes have live callers anyway.

### C5 — computed every load, rendered by nothing

Not orphans by the import test, and the honest reason to list them separately: this is server work
being paid for on every board reload with no reader at the other end.

1. **`rail` on `/api/floor/board`.** `getFloorRail` runs four sequential queries (orders, the
   duplicate-SO `groupBy`, `order_splits`, `tint_assignments`) plus the whole `suggestSlot` engine,
   on every load. **6 cards today.** The client still touches `data.rail` twice: `detailList`'s
   `case "rail"` is now **unreachable** — the only `openDetail(id, "rail")` call went with
   `FloorRail`, and the three surviving calls pass `"floor"`/`"history"`, `"hold"` and `"cancelled"` —
   and `detailHasDuplicateSo`'s `railHit` branch is reachable but redundant, since the widened board
   predicate now carries those same bills as rows with the same flag.
2. **`waitingSkus` and `oilSkus` on `/api/floor/board`.** Two extra sequential awaits inside
   `getFloorBoard`. **17 waiting bills, 209 (bill, SKU) pairs today.** Only the By-group view read
   them. `picking-board-mobile.tsx:1634` reads its OWN copy off `/api/picking/queue` and is completely
   unaffected.
3. **`FloorBoardRow.weightKg`** — fetched since 2026-08-11, never rendered. This is §B's answer, and
   the one item on this list that should gain a reader rather than lose a writer.

---

## D · Do not archive

Everything here looks floor-orphaned from one angle and is load-bearing from another. Step 4b must
leave all of it alone.

- 🔴 **`components/floor/build-trip-drawer.tsx` — the trap in this list.** The `BuildTripDrawer`
  component is orphaned. Its four option types — `DeliveryTypeOption`, `DispatchWindowOption`,
  `VehicleOption`, `TransporterOption` — are type-imported by `floor-page.tsx`, `trip-form.tsx` **and**
  `trip-vehicle-editor.tsx`, all three live. **The file cannot be archived until those types move
  somewhere else.** Archiving it breaks the trip desk that replaced it.
- **`components/floor/dispatch-slot-picker.tsx`** — shared beyond Floor entirely. Value-imported by
  `components/billing/billing-action-ribbon.tsx` (Billing) and by `detail-panel.tsx` and
  `hold-bar.tsx`; type-imported by `app/(mail-orders)/mail-orders/review-view.tsx` (Mail Orders),
  `floor-page.tsx` and `hold-tab.tsx`. Archiving it breaks Billing and Mail Orders.
- **`components/floor/floor-skeleton.tsx`** — imported by the orphaned `floor-rail.tsx`, and also by
  `floor-page.tsx`, `cancelled-tab.tsx` and `hold-tab.tsx`.
- **`components/floor/floor-table.tsx`** — imported by five orphans and by four live files
  (`cancelled-tab`, `hold-tab`, `route-row`, `trip-desk`). Its `shipMarkers` export is CALLED at
  `hold-tab.tsx:86` and `cancelled-tab.tsx:118`.
- **`components/floor/route-row.tsx`, `progress-bar.tsx`, `status-pill.tsx`** — each imported by
  orphans and by the new desk. `status-pill` also owns `formatLitres`, which every litres surface on
  the screen goes through.
- **`lib/floor/types.ts`** — `FloorRailCard` and `SlotSuggestion` exist only for the rail, but the
  file is type-imported by more than thirty live files including three API routes. Never a file-level
  archive; if those two types go, they go one at a time.
- **`lib/floor/` in full** — `filter · format · hold-log · hold-pdf · queries · release ·
  release-stages · scope · search · selection · sort · suggest · types · use-floor-rail-poll`. All
  live. `release.ts` in particular is the one owner two routes share.
- **All seventeen `/api/floor/*` routes** — see C4.
- **Nothing under `lib/picking/` or `components/picking/`** is touched by any of this. The two mobile
  faces read `/api/picking/queue` and are unaffected by every finding above.

`components/floor/tint-strip.tsx` is worth one line the other way: it *looks* like it might be shared
with the Tint module and it is not — sweep 2 finds exactly one importer, the orphaned `rail-card.tsx`.
It is archivable with the rail.

---

## E · What I could not verify

1. **`docs/mockups/floor-trips/floor-trips-v4-columns.html` does not exist.** Searched the tree for
   `*v4*` and `*column*.html`; the floor-trips folder holds only v1 and v3. Everything in §B is a data
   answer, not a layout answer — I do not know which columns the Due/KG set contains, what order they
   sit in, what widths they take, or whether Due is a date, a day name or a countdown. §B4's cost
   answer does not depend on any of that; a recut of `floor-table.tsx`'s four positional width arrays
   very much does.
2. **Nothing was verified on screen.** There is no login available here. Every UI claim in §A3 and
   §A4 is read from component source, not observed running.
3. **The two zero-litre, non-zero-KG bills on today's board** were not investigated. They could be
   tools or dry goods, or an import artefact.
4. **The 81 depot-wide bills at `totalWeight = 0`** cannot be classified from the database. The
   importer's `?? 0` makes "weighs nothing" and "SAP sent no weight" the same stored value; separating
   them needs the SAP source, not a SELECT.
5. **Live numbers are today's, 2026-09-10, and move.** The board was 64 rows when §B3 ran and 44 rows
   yesterday. Nothing here should be quoted as a standing figure.
6. **The orphan sweep covered `app`, `components`, `lib` and `scripts` only.** If anything under
   `docs/`, a test harness or a config file imports one of the sixteen orphaned components, this
   sweep did not see it. `archive/` was deliberately excluded.
7. **I did not check runtime reachability**, only static import and call graphs. A component with no
   importer cannot render; a component with an importer that is itself orphaned cannot either, which
   is what C2 rests on. I did not run the app to confirm it.
