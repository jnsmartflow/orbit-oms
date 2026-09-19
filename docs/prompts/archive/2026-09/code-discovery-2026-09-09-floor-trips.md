# code-discovery-2026-09-09-floor-trips.md
# Discovery only — no code written, no schema proposed, SELECT-only against production.
# Session: 2026-09-09 · Scope: `/floor` dates & slots · stages · drops · By-picker removal · masters

**Docs read:** `CLAUDE.md` (router v1.12), `docs/CLAUDE_CORE.md` (v104 · Schema v27.24),
`docs/CLAUDE_FLOOR.md` (v1.4 · Schema v27.13), `docs/CLAUDE_PICKING.md` (v1.17 · Schema v27.15),
`docs/CLAUDE_TRIP_REPORT.md` (v1.2 · Schema v27.24).

**Code read in full:** `lib/floor/queries.ts`, `lib/floor/types.ts`, `lib/floor/sort.ts`,
`lib/floor/format.ts`, `lib/picking/queue.ts`, `lib/picking/visibility-gate.ts`,
`lib/workflow-stages.ts`, `lib/picking/sort.ts`, `components/floor/floor-board.tsx`,
`components/floor/floor-table.tsx`, `components/floor/picker-card.tsx`,
`components/floor/assign-bar.tsx`, `components/floor/assign-context-banner.tsx`,
`app/api/floor/ship-to/route.ts`, `app/api/floor/order/[orderId]/route.ts`,
`app/api/floor/pick-gate/route.ts`, and the `orders` / `vehicle_master` /
`delivery_point_master` / `app_settings` / `dispatch_slot_master` blocks of `prisma/schema.prisma`.
`components/floor/floor-page.tsx` and `lib/floor/filter.ts` were read in the regions the questions
touch, not end to end (see H).

**A note on the doc versions.** `CLAUDE_FLOOR.md` is at v1.4, dated 2026-08-04. The Floor code has
moved a long way past it — pick grouping, the By-group view, duplicate-SO tagging, the invoice
column, the SAP-name fallback, the display-date resolver and the 2026-09-09 picking visibility gate
all post-date it. Where they disagree, this report follows the code and says so in **G**.

---

## A — Dates and slots

### A1 · Every date/time field Floor reads or displays

Sourced from `lib/floor/queries.ts` (the four feeds), `app/api/floor/order/[orderId]/route.ts`
(the detail payload) and `app/api/floor/actions|release/route.ts` (the writes).

| Field | Table | Reached by Floor |
|---|---|---|
| `orders.orderDateTime` | orders | yes |
| `orders.obdEmailDate` | orders | yes |
| `orders.dispatchTargetDate` | orders | yes |
| `orders.dispatchWindowId` → `dispatch_slot_master.windowTime` / `sortOrder` | orders / dispatch_slot_master | yes |
| `orders.dispatchSlotSource` | orders | yes |
| `orders.dispatchSlotRuleId` | orders | yes |
| `orders.heldAt` | orders | yes |
| `orders.invoiceDate` | orders | yes |
| `orders.pickVisibleAt` | orders | yes (2026-09-09) |
| `orders.pickEarlyReleasedAt` | orders | yes |
| `orders.updatedAt` | orders | indirectly, via the live-sync marker |
| `pick_assignments.assignedAt` / `pickedAt` / `checkedAt` | pick_assignments | yes |
| `order_status_logs.createdAt` | order_status_logs | yes |
| `tint_assignments.completedAt` | tint_assignments | yes (rail suggestion only) |

**Fields on `orders` that Floor never touches**, checked by sweep rather than assumed:
`arrivalSlotId`, `slotId`, `originalSlotId`, `dispatchSlot`, `dispatchSlotDeadline`, `invoicedAt`,
`removedAt`, `restoredAt`, `hiddenAt`, `createdAt`. A grep for each across `lib/floor`,
`components/floor` and `app/api/floor` returns nothing. `arrivalSlotId` in particular is
**write-only from import** — its only writers are `app/api/import/obd/route.ts`,
`lib/import-upsert.ts` and `lib/import-upsert/header.ts`, and no reader exists anywhere in the live
tree.

### A2 · FILTER, SORT or DISPLAY — at the call site

**`orderDateTime`**
- FILTER: never, on any Floor feed.
- SORT: yes, indirectly. It feeds `obdDateTime` on the payload, which `byFifo` compares
  (`lib/picking/sort.ts:72`), and which orders the left rail directly
  (`lib/floor/queries.ts:511-516`, oldest first).
- DISPLAY: yes, through `resolveFloorDisplayDate()` (`lib/floor/queries.ts:478` and `:702`), rendered
  at `components/floor/floor-table.tsx:459`.
- Also an ENGINE INPUT for the rail slot suggestion — `lib/floor/queries.ts:460` passes it as
  `emailDateTime`.

**`obdEmailDate`**
- FILTER: never.
- SORT: yes, as the primary of the `obdEmailDate ?? orderDateTime` pair that sets `obdDateTime` on
  the Hold and Cancelled rows (`lib/floor/queries.ts:967`, `:1049`), and as the age anchor
  (`arrivalAgeDays`, `:500`).
- DISPLAY: yes, and it is the **default** clock the board shows — see A3(b).
- WRITE: `app/api/floor/actions/route.ts:125` stores it into `heldAt` on a hold.

**`dispatchTargetDate`**
- FILTER: yes, in HISTORY mode only — `lib/floor/queries.ts:644`, `{ dispatchTargetDate: anchorDate }`.
  The LIVE predicate (`floorLiveBaseWhere`, `:188-200`) contains no date term at all.
- SORT: no. `FLOOR_SPINE` (`lib/floor/sort.ts`) has no date rule.
- CLASSIFY: yes — `zone` and `ageDays` are computed from it at `lib/floor/queries.ts:689-696`.
- DISPLAY: yes, on the By-group Slot column (`components/floor/floor-table.tsx:592`), on the Upcoming
  strip chip (`:319`), and in the detail panel (`components/floor/detail-details.tsx:75`).

**`dispatchWindowId`**
- FILTER: never against the database. It is used to GROUP client-side — the All-view slot bands
  (`components/floor/floor-board.tsx:674`) and the per-window counts (`:843`).
- SORT: yes, through `windowSortOrder` → `byWindow` (`lib/picking/sort.ts:40`).
- DISPLAY: yes, as `windowTime`.
- WRITE: `app/api/floor/release/route.ts:109` and `app/api/floor/actions/route.ts:115`.

**`dispatchSlotSource`**
- FILTER: never on Floor. (CORE §7.4's manual-skip guard is in the IMPORT route, not here.)
- SORT: never.
- DISPLAY: yes — `app/api/floor/order/[orderId]/route.ts:123` gates the synthetic "auto-slot"
  Activity line on `=== "auto"`.
- WRITE: `"manual"` on both Release and change-slot.

**`dispatchSlotRuleId`**
- FILTER / SORT: never.
- DISPLAY: yes — `components/floor/detail-activity.tsx:54` maps it to a rule hint.
- Never written or cleared by Floor. See G4.

**`heldAt`** — FILTER never; SORT indirectly (it is the `approx` fallback behind `heldSince`, which
the Hold tab sorts on, `lib/floor/queries.ts:976-981`); DISPLAY yes, with a `~` prefix.

**`pick_assignments.checkedAt`** — FILTER **yes, and it is the load-bearing one**: the live arm
(`lib/floor/queries.ts:196`) and the history arm (`:648`) both fence on it inside `getISTDayRange()`.
DISPLAY yes (`floor-table.tsx:115`).

**`assignedAt` / `pickedAt`** — DISPLAY only (elapsed pills, `floor-table.tsx:115-117`), plus the
By-picker card's busy tiers (`floor-board.tsx:110-122`).

**`invoiceDate`** — DISPLAY only (`floor-table.tsx:505`, `detail-details.tsx:61`).

**`pickVisibleAt`** — on Floor, DISPLAY only: it swaps the Status pill label
(`floor-table.tsx:385`) and drives the header count and Show strip via `isHeldBack()`
(`components/floor/status-pill.tsx:47`). It is a FILTER on the **Picking** side, in
`buildPickingWhere`'s waiting branch (`lib/picking/queue.ts:382`). Floor WRITES it, at
`app/api/floor/pick-visible/route.ts:176`.

**`order_status_logs.createdAt`** — FILTER yes, but in JS not SQL: the Cancelled tab keeps only
today's rows at `lib/floor/queries.ts:1032`. Also the hold-event clock (`:933`).

**`tint_assignments.completedAt`** — an engine input only, for a finished full tint OBD's rail
suggestion (`lib/floor/queries.ts:472`). Never filtered, never sorted.

### A3 · The two FLOOR §10 landmines, against the code as it stands

**(a) "Slot tabs group by `windowTime` alone, ignoring `dispatchTargetDate`" — CONFIRMED, unchanged.**

`components/floor/floor-board.tsx:314`

```ts
const tabRows = slotTab === "all" ? viewRows : viewRows.filter((r) => r.windowTime === slotTab);
```

and the same shape at `:319` for `tabRowsAll`. There is no date term. `viewRows` descends from
`dueRows` (`:226`), which is `rows.filter((r) => r.zone !== "upcoming")` — and `zone` admits a null
target date and every PAST date into `due` (`lib/floor/queries.ts:692-693`). So a bill promised for
last Tuesday at 10:30 and a bill promised for today at 10:30 stack under the same tab, separated
only by the `{n}d` age chip in the OBD cell (`floor-table.tsx:451-457`).

Live, this is not theoretical: of the 197 rows on the live floor right now, **25 carry a
dispatchTargetDate in the past and 1 carries none** (F4).

Note the All view is different and is not part of the landmine — it bands on `windowId`
(`floor-board.tsx:674`), which is the same window by id rather than by time string.

**(b) "The row displays `orderDateTime` while the slot was decided from `obdEmailDate`" — REFUTED
AS WRITTEN. The code changed; the doc did not.**

`lib/floor/format.ts:149` `resolveFloorDisplayDate()` now chooses between the two clocks, and both
Floor row builders go through it (`lib/floor/queries.ts:478` for the rail, `:702` for the board):

- neither present → nothing shown;
- only one present → show it, unflagged;
- both present and EQUAL → show `obdEmailDate`, unflagged;
- both present, SAME IST calendar day → show `orderDateTime` and set `isEmailTime: true`, which
  renders a small mail glyph beside the time (`floor-table.tsx:460-464`);
- both present, DIFFERENT IST day → show `obdEmailDate`, unflagged.

The engine's own rule, `pickEffectiveClock()` (`lib/dispatch/dispatch-engine.ts:109-136`), is
same-day → the EARLIER of the two, different-day → the LATER.

**The residual gap, stated precisely.** On a same-IST-day bill the display shows the email clock
while the engine slotted on whichever of the two was earlier. When the email clock is the later of
the pair, the screen shows a time the slot was not derived from — but it now carries a marker
saying which clock it is, which is what the original landmine said was missing. On a different-day
bill display and engine both land on `obdEmailDate`… **except** that the engine takes the LATER and
`resolveFloorDisplayDate` takes `obdEmailDate` unconditionally, so if `orderDateTime` is the later
one they diverge silently and with no marker.

**Live, that residual case is currently empty.** Of the 40 open bills, all 40 carry both clocks,
**0 differ by IST calendar day**, and 34 differ by instant (F3). So today every open bill is in the
same-day branch, where the marker exists.

---

## B — Stages

### B4 · The `workflowStage` vocabulary and who reads it

`lib/workflow-stages.ts` is the single registry. `STAGE_LADDER` holds twelve entries:
`order_created` 10 · `pending_tint_assignment` 20 · `tint_assigned` 30 · `tinting_in_progress` 40 ·
`pending_support` 50 · `pending_picking` 60 · `closed` 60 · `pick_assigned` 70 · `pick_done` 80 ·
`pick_checked` 90 · `dispatched` 100 · `cancelled` null.

Derived sets and their real consumers, each confirmed at the call site:

| Export | Consumers that actually run |
|---|---|
| `SUPPORT_DONE_OUTPUT` (`pending_picking`) | Floor release (write, `release/route.ts:111`) · Floor pick-visible (guard, `:133`) · import enrichment (write, `obd/route.ts:475`) · picking assign (guard) / unassign (write) / release (guard) · tint operator done + split done + base-bypass (write) · `buildPickingWhere` waiting branch (`queue.ts:382-383`) · `countHeldBackWaiting` (`visibility-gate.ts:98`) |
| `PICK_ASSIGNED` | picking assign (write) · `getFloorPickers` on-hand count (`queries.ts:328`) · `/api/warehouse/pickers:75` · row flag on both boards |
| `PICK_DONE` | picking done (write) · row flag |
| `PICK_CHECKED` | picking approve (write) · **Floor's live arm** (`queries.ts:195`) and **history arm** (`:646`) · `buildPickingWhere` checked arm (`queue.ts:424`) · billing picking-where |
| `PICKING_OPEN_STAGES` = [pending_picking, pick_assigned, pick_done] | **`floorLiveBaseWhere` arm 1** (`queries.ts:193`) · `scripts/_slot-audit.ts`. **Picking no longer uses it as a set** — `buildPickingWhere` split it into two sibling OR branches on 2026-09-09 so the gate term could be AND-ed onto the waiting branch alone (`queue.ts:359-393`) |
| `PICKING_ACTIVE_STAGES` = open + pick_checked | Floor HISTORY predicate (`queries.ts:642`) · picking `single` scope (`queue.ts:448`) |
| `PICKING_CANCELLABLE_STAGES` | `app/api/picking/cancel/route.ts:167` · the ⋯ menu gate in `picking-board-mobile.tsx:3724` |
| `SUPPORT_DONE_STAGE_NAMES` (rank ≥ 60) | admin fix-slots · operations summary ×2 · tint missing-customers |
| `SUPPORT_PICKING_QUEUE_STAGE_NAMES` (rank == 60) | admin fix-challans only |
| `STAGE_LADDER` (raw) | `RAIL_STAGES` in `lib/floor/queries.ts:74` — rank < 60, derived not hand-written |
| `pickingRowStage()` | `picking-board-mobile.tsx:3724` and `:4401` |
| `FLOOR_RELEASABLE_STAGES` (`lib/floor/release-stages.ts`, Floor's own) | `app/api/floor/release/route.ts:96` |

**Three exports have zero live callers** — sweep across `app/`, `lib/`, `components/`, `scripts/`,
excluding their own definition file, matched only comments:

- `supportMayEdit()` — the only hit outside `workflow-stages.ts` is a comment at
  `app/api/floor/release/route.ts:92` saying Floor deliberately does not use it.
- `isSupportDone()` — no hits at all.
- `stageRank()` — one hit, a comment at `app/api/picking/release/route.ts:204`.

`CLAUDE_PICKING.md §2` already records `supportMayEdit` as dead. It does not record `isSupportDone`
or `stageRank`, which are equally dead. The `STAGE_LADDER` array itself is still load-bearing —
`RAIL_STAGES` derives from it, and so do the four `*_STAGE_NAMES` sets.

### B5 · Write paths that set `workflowStage = 'dispatched'`

**There are none. Not one, anywhere in the live tree.**

Two sweeps, reconciled:

- MSYS-native `grep -rn "dispatched" app lib components scripts prisma --include=*.ts --include=*.tsx`
- `rg` for `workflowStage\s*:\s*["'][a-z_]+["']` plus `workflowStage: [A-Z_]` for the constant form

Both return the same set. Every occurrence of the literal `dispatched` in a Prisma context is a
READ: `app/api/operations/summary/route.ts:37` (`prisma.orders.count`), and
`app/api/tint/operator/my-orders/route.ts:163`, which is a `split.status` value, a different column.
The remainder are comments, log-note strings ("Auto-dispatched by enrichment"), `dispatch_plans.status`,
a `prisma/seed.ts` `status_master` label, and an unrelated `dispatchedRef` variable in
`components/ci/new-return.tsx`.

The known route that used to write it — dispatch-plan confirmation — went with the Planning board
on 2026-07-28 (`archive/2026-07-planning-board/`).

**So `dispatched` is a stage with 4,137 live rows (F1) and no writer.** Those rows came from the
one-time manual sweep recorded in `CLAUDE_FLOOR.md §7` and whatever preceded it. The
`pick_checked → dispatched` drain hole (`CLAUDE_PICKING.md §7`) is not merely open — it has grown:
CORE's last recorded figure was 1,546 rows at `dispatched` on 2026-07-27; today it is 4,137, so
roughly 2,600 rows moved with no code path in the tree that could have moved them. See G6.

---

## C — Drops: which field names the delivery customer

### C6 · The key

**The effective delivery customer is `COALESCE(shipToOverrideCustomerId, customerId)`, a foreign key
into `delivery_point_master`.** The expression appears identically in five places and is never
written any other way:

- `lib/floor/queries.ts:422` (rail), `:685` (board), `:938` (hold), `:1025` (cancelled) —
  `const dealer = order.shipToOverrideCustomer ?? order.customer;`
- `app/api/floor/order/[orderId]/route.ts:129` — same expression.
- `lib/picking/queue.ts:737-743` — the id form, `overrideDealer ?? plainDealer ?? null`, with a
  comment stating it is byte-for-byte the relation form.

**How a ship-to override changes it.** `POST /api/floor/ship-to` (`app/api/floor/ship-to/route.ts`)
is the only Floor writer. It:

1. validates the target exists in `delivery_point_master`;
2. writes **`shipToOverrideCustomerId`** and keeps the legacy boolean `shipToOverride` in step
   (`customerId !== null`);
3. writes nothing at all when the value is unchanged, deliberately, so the live-sync marker does not
   fire;
4. records the change as an `order_status_logs` row whose `fromStage`/`toStage` are the OLD and NEW
   customer ids stringified, or `"cleared"`.

It **never touches `customerId`**. The original ship-to is preserved, which is why both
`FloorRailCard` and `FloorBoardRow` carry `customerName` (the original) alongside
`shipToOverrideName` (the redirect target) and `dealerName` (the effective one) —
`lib/floor/types.ts:74-75` and `:120-121`.

`customerId: null` is accepted by the route to clear a redirect, but Floor's UI never sends it —
`detail-panel.tsx` types `onChangeShipTo` as `(orderId, customerId: number)`.

### The fallback, and why it matters for grouping

When the FK does not resolve, three surfaces fall back differently:

| Surface | Fallback |
|---|---|
| Floor board / rail / hold / cancelled | the literal `"(Unmatched)"` — `lib/floor/queries.ts:707` etc. |
| Floor detail panel | `order.shipToCustomerName`, then `"(Unmatched)"` — `order/[orderId]/route.ts:139` |
| Picking queue | `nonBlank(dealer name) ?? nonBlank(order.shipToCustomerName) ?? "(Unmatched)"` — `lib/picking/queue.ts:818-821` |

`orders.shipToCustomerId` is a **String, NOT NULL** (`prisma/schema.prisma:861`) — SAP's own ship-to
code, distinct from the numeric `customerId` FK. It is the only key an unmatched bill has.

**Live check.** All 40 currently-open bills resolve a `customerId` (0 nulls) and none has a blank
`shipToCustomerId`, so grouping on the FK alone loses nothing today. Across the whole live table,
**482 of 13,791 bills carry no `customerId`** — so a grouping key that is FK-only would silently
merge every unmatched bill into one bucket. A composite key
`COALESCE(cust_id::text, 'sap:' || shipToCustomerId)` is what F5's numbers were computed on.

⚠ **259 live bills carry `shipToOverride = true` with `shipToOverrideCustomerId` NULL** — free-text
redirects from mail-order enrichment with no resolved customer, exactly as CORE §7.3 warns. Those
group under their ORIGINAL customer, which is wrong for a drop but is the only answer the data
supports.

---

## D — By picker

### D7 · Every importer, and whether it runs

**Sweep discipline.** Two independent passes, both with a char class on every slash in every branch
of the alternation:

```
grep -rnE "components[/]floor[/]picker-card|[.][/]picker-card|components[/]floor[/]assign-context-banner|[.][/]assign-context-banner|lib[/]article-tag-parse|@[/]lib[/]article-tag-parse" app lib components scripts
git grep -nE  <the same pattern>
```

Plus a symbol-name pass (`PickerCard|pickerCardStatus|AssignContextBanner|formatArticleBreakdown|lockedPicker|parseArticleTag|aggregateArticleTags|TYPE_ORDER`) run both ways.
**The two methods returned identical result sets. No disagreement to report.**

| Target | Importer | Import line | Is it CALLED? | Does the call RUN? |
|---|---|---|---|---|
| `components/floor/picker-card.tsx` | `components/floor/floor-board.tsx` | `:20` | yes — `<PickerCard>` at `:513`, `pickerCardStatus()` at `:511` | 🔴 **NO** — inside `if (mode === "picker")` at `:472`, and `mode` can never be `"picker"` (below) |
| `components/floor/assign-context-banner.tsx` | `components/floor/floor-page.tsx` | `:17` | yes — `<AssignContextBanner>` at `:1132` | 🔴 **NO** — guarded on `assignContext !== null` at `:1131`, and nothing can set it |
| — (comment only) | `components/floor/show-strip.tsx` | `:7` | no | n/a — a design-precedent citation in a comment |
| `lib/article-tag-parse.ts` | `lib/floor/format.ts` | `:8` | yes — `parseArticleTag` + `TYPE_ORDER` inside `formatArticleBreakdown()` | 🔴 **NO** for that function — its only caller is `floor-board.tsx:518`, inside the same dead picker branch |
| `lib/article-tag-parse.ts` | `lib/article-tag.ts` | `:32`, re-export `:231` | yes — `aggregateArticleTags` at `:323` | **YES** — the import roll-up |
| `lib/article-tag-parse.ts` | `app/api/tint/manager/orders/route.ts` | `:8` | yes — `:725` | **YES** — Tint Manager board payload |
| `lib/article-tag-parse.ts` | `components/picking/picking-board-mobile.tsx` | `:65` | yes — `:1908` | **YES** — supervisor bundle chips |
| `lockedPicker` prop | declared `components/floor/assign-bar.tsx:29/:43`, read `:134`, `:155`, `:157` | passed by `components/floor/floor-page.tsx:1244` | passed as an expression | 🔴 **resolves to `null` always** — `assignContext !== null && contextPickerName ? {...} : null` |

### 🔴 The finding: the whole By-picker branch is UNREACHABLE, and has been since 2026-08-27

`components/floor/floor-page.tsx:170` — `mode` initialises to `DEFAULT_VIEW_MODE`, which is
`"route"` (`:59`). There are exactly five `setMode` call sites:

| Line | Value it can produce |
|---|---|
| `:303` `openAssignContext` | `viewForContext(...)` → `"group"` or `"route"` |
| `:311` `closeAssignContext` | `DEFAULT_VIEW_MODE` → `"route"` |
| `:320` `toggleContextMode` | `viewForContext(...)` → `"group"` or `"route"` |
| `:333` `openGroupMode` | `"group"` |
| `:1114` the view toggle | `setMode(m)` — but the ternary at `:1110` routes `m === "picker"` to `closeAssignContext()` and `m === "group"` to `openGroupMode()`, so `m` can only be `"flat"` or `"route"` here |

So `mode === "picker"` is unsatisfiable. Nothing else in the file sets it; there is no URL param, no
localStorage, no server prop.

**How it happened.** Commit `8468297a` (2026-08-27, *"floor: default view mode to By route"*)
introduced `DEFAULT_VIEW_MODE = "route"` and made two substitutions — the initial `useState("picker")`
and `closeAssignContext`'s `setMode("picker")`. That second substitution is the one that closed the
door: `closeAssignContext` **was the only path back to the picker grid**, and it is what the "By
picker" toggle button still calls. Pressing "By picker" today lands the operator on By route.

**Everything downstream is dead with it**, none of it reachable and none of it removed:

- the picker card grid, `buildPickerGroups()`, `oldestWithPickerMinutes()`, `distinctRoutes()`
  (`floor-board.tsx:66-128`, `:472-526`);
- `pickerCardStatus()` and the whole `picker-card.tsx` file;
- `formatArticleBreakdown()` in `lib/floor/format.ts` — its only caller is that grid;
- the assign context: `assignContext`, `contextMode`, `openAssignContext`, `toggleContextMode`,
  `viewForContext`, `contextPickerName`, `contextCounts`, `contextReadOnly`;
- `AssignContextBanner` entirely;
- `assign-bar.tsx`'s `lockedPicker` arm;
- `groupAssignTo` and therefore the one-press "assign this whole bundle" button in
  `group-row.tsx:208-215` — `openGroupMode()` deliberately leaves `assignContext` null, so By group
  always renders the "Select all {n}" fallback at `:217`.

⚠ **`viewRows` / `inContext` / `contextPending` in `floor-board.tsx:240-255` are therefore always in
their short-circuit state**: `inContext` is false, so `viewRows === dueRows` and `selProps` is always
the full selection-wired object. The board behaves exactly as it did before the assign context was
built.

I could not click the screen to confirm (no login, see H). This is a static-reachability finding
from the code and the git history, and it is the kind of claim worth a two-minute check on the live
board before anything is removed on the strength of it.

### D8 · What would still be needed if By picker were removed

**Still needed — do not remove:**

| Thing | Why |
|---|---|
| `getFloorPickers()` (`lib/floor/queries.ts:318`) and the `pickers` key on `/api/floor/board` | feeds the assign-bar dropdown (`assign-bar.tsx:145`) and the detail panel's picker select (`detail-panel.tsx:632`) |
| `FloorPicker` type | same two consumers |
| `components/floor/status-pill.tsx` in full — `rowStatus`, `countByStatus`, `sumLitres`, `StatusCounts`, `isHeldBack` | read by `floor-table`, `floor-page`, `slot-band`, `route-row`, `group-row`, `assign-bar`, `progress-bar` |
| `components/floor/progress-bar.tsx` | rendered by `slot-band` and `route-row` |
| `lib/article-tag-parse.ts` | three live callers outside Floor (table above) |
| `lib/floor/format.ts`'s `formatArticleTag` and `formatDateIST` | `floor-table.tsx:602`, `:505`, `detail-details.tsx:61` |
| `assign-bar.tsx` itself | the bulk bar is the main assign path |
| `pick_assignments.assignedAt` on the payload | the elapsed pill in `floor-table.tsx:116` |

**Removable with the view, and nothing else references them:**
`components/floor/picker-card.tsx` (whole file) · `formatArticleBreakdown()` in `lib/floor/format.ts`
· `components/floor/assign-context-banner.tsx` (whole file) · `buildPickerGroups` /
`oldestWithPickerMinutes` / `distinctRoutes` / the `PickerGroup` interface in `floor-board.tsx` ·
the `lockedPicker` prop and its branch in `assign-bar.tsx` · the six assign-context state and
callback bindings in `floor-page.tsx` · `assignTo` / `onAssignGroup` in `group-row.tsx` and its
`floor-board` pass-through · `"picker"` from the four `mode` union declarations and the
`mode !== "picker"` guards at `floor-board.tsx:304`, `:331`, `:845`.

⚠ **`group-row.tsx`'s `assignTo` branch is a design decision, not merely dead code.** Removing it
removes the one-press bundle assign for good. If By group is meant to keep that affordance, the fix
is to make `openGroupMode` set a picker rather than to delete the branch. That is an owner call, not
a cleanup.

⚠ **CORE §3 forbids deleting files.** Nothing above is a recommendation to delete; it is an
inventory of what a removal would touch.

---

## E — Masters

### E9 · What the vehicles master holds today

`vehicle_master`, `prisma/schema.prisma:1299-1313` — **eleven columns, and that is all there is**:

```
id                  Int      PK autoincrement
vehicleNo           String   @unique
category            String
capacityKg          Float
maxCustomers        Int?
deliveryTypeAllowed String
transporterId       Int      FK → transporter_master (RESTRICT, unnamed — single FK)
driverName          String?
driverPhone         String?
isActive            Boolean  @default(true)
createdAt           DateTime @default(now())
dispatchPlans       dispatch_plans[]   (back-relation)
```

No `updatedAt`. No `@map`. No indexes beyond the PK and the `vehicleNo` unique.

**Live: 6 vehicles, all 6 active, all 6 carry both a driver name and a driver phone.**

**Is there driver data anywhere else in the schema?** A case-insensitive sweep for `driver` across
`prisma/schema.prisma` returns exactly four lines, in two models:

| Model | Columns |
|---|---|
| `vehicle_master` | `driverName String?`, `driverPhone String?` |
| `TripReport` (`trip_report`) | `driverName String?`, `driverMobile String?` |

**There is no driver table, no driver id, and no relation between the two pairs.** A vehicle's
driver is a free-text name and phone on the vehicle row; a trip's driver is a free-text name and
mobile mirrored verbatim from NTS. They share no key and nothing joins them. `vehicleNo` is the only
value that could plausibly bridge them, and no code does.

**Live coverage on the trip side**, last 7 days: 1,044 `trip_report` rows across **34 distinct
vehicle numbers**, 1,044 with a driver name and 1,040 with a mobile. So the trip mirror knows about
**34 vehicles** while `vehicle_master` holds **6** — the two are not describing the same fleet, and
`vehicle_master` is not a superset.

**Who reads `vehicle_master`:** three near-identical master-data browse pages
(`/admin/vehicles`, `/dispatcher/vehicles`, `/tint/manager/vehicles`), the admin CRUD routes
(`/api/admin/vehicles`, `/api/admin/vehicles/[id]`, `/api/admin/vehicles/import`), and a count in
`/api/admin/transporters/[id]`. **`dispatch_plans` is the only operational consumer of the
relation, and Planning was archived 2026-07-28.** Nothing on Floor, Picking or Trips reads it.

The admin write schema (`app/api/admin/vehicles/route.ts:30-38`) accepts exactly those eight
editable fields, and the audit log records all eight.

### E10 · How a second key would be added to `app_settings`

`app_settings` (`prisma/schema.prisma:1095-1106`) is a generic per-flag table, one row per named
switch, keyed by `settingKey` (UNIQUE, `app_settings_settingKey_key`), `isEnabled` defaulting to
**false**. Live contents right now: **exactly one row**, `picking.visibilityGate`, `isEnabled=false`,
last touched by user 20 at 2026-09-09 11:24 UTC.

The visibility gate's pattern, which a second key would follow verbatim, is four parts and **no
schema change**:

1. **One exported key constant, in the module that owns the flag.**
   `lib/picking/visibility-gate.ts:32` — `export const PICK_VISIBILITY_GATE_KEY = "picking.visibilityGate"`.
   The header says why in so many words: a hand-typed key in a `where` matches nothing and fails
   silently, so the gate would read as permanently off with no error. Same class as CORE §3's
   status-string rule.
2. **One reader that fails closed.** `isPickGateOn()` (`:52`) — `findUnique` on `settingKey`,
   `row?.isEnabled === true` (a strict test, not truthy), the whole thing in a `try/catch` returning
   `false`. Four distinct failure modes all resolve to off.
3. **One route with GET and POST on the same permission.**
   `app/api/floor/pick-gate/route.ts` — both verbs gate on `floor`/`canEdit`; the GET reads through
   the same helper rather than its own `findUnique`, and sets `Cache-Control: no-store`; the POST
   requires a strict boolean and does `prisma.app_settings.upsert` on the `settingKey` unique.
   `updatedAt` is `@default(now()) @updatedAt`, so it stamps on both create and update.
4. **The consumers take the answer as a parameter, never read it themselves.**
   `buildPickingWhere` is synchronous, so `getPickingQueue` resolves the flag once
   (`lib/picking/queue.ts:517`) and passes it down; the marker route asks the same helper. The
   `gateOn` parameter defaults to `false` so the six bench scripts and any forgetful caller get the
   ungated behaviour.

So: **a second key needs a new constant, a new reader, a new route (or a verb on an existing one),
and no migration.** The table already supports it. Two things to preserve if one is added — the
default-OFF semantics (`app_settings` is the opposite of `app_tag_settings`, which is default-ON,
and the schema comment at `:1082-1084` says so), and the rule that the switch and any per-row stamps
stay independent (`pick-gate/route.ts:18-27` spells out the failure that couples them).

⚠ **Seed does not know about this table.** `prisma/seed.ts` has no `app_settings` entry, so a
wipe-and-reseed drops every flag row and every flag reverts to its default. For the visibility gate
that is the safe direction (off). For a future flag whose safe direction is ON, it would not be.

---

## F — Live numbers

Read-only SELECTs against production through the pooler (`DATABASE_URL`), run 2026-09-09 ~18:50 IST.
Queries reproduced at the end of this section. **Definitions used**, since the question does not fix
them: *open bill* = `workflowStage IN ('pending_picking','pick_assigned','pick_done')` AND
`isRemoved = false` AND `dispatchStatus = 'dispatch'` — that is `floorLiveBaseWhere` arm 1.
*Today's live floor* = the full `floorLiveBaseWhere`, both arms.

**F1 · Orders per `workflowStage`, every stage, every date**

| workflowStage | total | isRemoved | live |
|---|---:|---:|---:|
| closed | 6,860 | 0 | 6,860 |
| dispatched | 4,137 | 0 | 4,137 |
| pick_checked | 2,522 | 0 | 2,522 |
| pending_support | 142 | 0 | 142 |
| cancelled | 71 | 0 | 71 |
| pending_tint_assignment | 46 | 46 | 0 |
| pending_picking | 29 | 0 | 29 |
| pick_assigned | 15 | 0 | 15 |
| pick_done | 13 | 0 | 13 |
| tinting_in_progress | 2 | 1 | 1 |
| tint_assigned | 1 | 0 | 1 |
| **total** | **13,838** | **47** | **13,791** |

Open bills under the arm-1 predicate: **40**.

**F2 · Open bills with a date-only `orderDateTime`** (exactly `00:00:00` UTC — the
`resolveArrivalClocks` test)

| | |
|---|---:|
| open bills | 40 |
| `orderDateTime` NULL | 0 |
| **`orderDateTime` date-only** | **1** |
| `obdEmailDate` NULL | 0 |
| `obdEmailDate` date-only | 5 |

Whole live table for context: **1,915 of 13,791** bills carry a date-only `orderDateTime`. The
`CLAUDE_FLOOR.md §8` figure of 1,854 of 9,521 (2026-08-03) has grown in absolute terms and fallen
slightly as a share.

**F3 · Open bills whose `orderDateTime` day differs from `obdEmailDate` day**

| | |
|---|---:|
| open bills carrying both clocks | 40 |
| **different IST calendar day** | **0** |
| different instant, same day | 34 |

**F4 · Today's live floor: bills whose `dispatchTargetDate` is not today (IST)**

| | |
|---|---:|
| rows on the live board | 197 |
| target date = today | 144 |
| **target date in the PAST** | **25** |
| **target date in the FUTURE** | **27** |
| **no target date at all** | **1** |

The 27 future rows are the Upcoming strip (`zone === "upcoming"`). The 25 past and the 1 null are in
the DUE zone and stack into the slot tabs alongside today's work — this is A3(a) measured.

**F5 · Drop test**

*Open bills only*, keyed on `COALESCE(shipToOverrideCustomerId, customerId)` + `dispatchTargetDate`:

| | |
|---|---:|
| distinct (customer, date) groups | 34 |
| groups with 2+ bills | 3 |
| bills sitting in those groups | 9 |
| largest group | **5** (Pradeep Paints, 2026-09-10) |

*Widened to the whole live floor* (open + checked-today), which is the population a drop sheet would
actually cover:

| | |
|---|---:|
| distinct (customer, date) groups | 114 |
| groups with 2+ bills | 34 |
| bills sitting in those groups | 116 of 197 |
| largest group | **16** |

Top groups on the live floor:

| Customer | Target date | Bills |
|---|---|---:|
| Mohan Colour Co | 2026-09-09 | 16 |
| Ambika Paints | 2026-09-09 | 11 |
| Nakoda Colours And Hardware | 2026-09-09 | 7 |
| Nijnaam Pump And Hareware | 2026-09-09 | 7 |
| Pradeep Paints | 2026-09-10 | 5 |
| Sarita Colours · Maruti Paints · Delight Paints · Pradeep Paints | 2026-09-09 | 4 each |

**Read the two tables together, not separately.** On the narrow "open" definition, drops look
marginal — 3 groups. On the real board they are the dominant shape: **59% of live rows share a
customer and a date with at least one other bill.** The difference is entirely the `pick_checked`
arm, i.e. bills already picked today. Which population a drop feature should key on is the design
question this number sets up.

**F6 · `pick_checked`**

| | |
|---|---|
| rows at `pick_checked`, not removed | **2,522** |
| oldest by `checkedAt` | 2026-08-17 05:11:44 UTC — order 12606, OBD 9108904561, promised 2026-08-15, invoice I536225067 |
| newest by `checkedAt` | 2026-09-09 13:17:45 UTC |

The oldest is 23 days old and carries an invoice number, i.e. it has certainly shipped. This is the
drain hole (B5) with a face on it.

**F7 · Two supporting counts, not asked for but load-bearing above**

| | |
|---|---:|
| `app_settings` rows | 1 (`picking.visibilityGate`, disabled) |
| `orders` ever stamped with `pickVisibleAt` | 1 |
| live bills with no `customerId` | 482 of 13,791 |
| live bills with `shipToOverride = true` and a NULL override id | 259 |
| `vehicle_master` rows / active / with driver name / with driver phone | 6 / 6 / 6 / 6 |
| `trip_report` rows last 7 days / distinct vehicles / with driver / with mobile | 1,044 / 34 / 1,044 / 1,040 |

**The SQL**, for anyone reproducing this in the Supabase SQL Editor. Editor-safe: no `BEGIN`/`COMMIT`,
no bare `LIMIT` inside a `UNION ALL` branch, no reserved word used unquoted.

```sql
-- F1
SELECT 'F1 stage: '||"workflowStage" AS metric, count(*)::text AS value
FROM orders GROUP BY 1
UNION ALL
-- F2
SELECT 'F2 open total', count(*)::text FROM orders
 WHERE "workflowStage" IN ('pending_picking','pick_assigned','pick_done')
   AND "isRemoved"=false AND "dispatchStatus"='dispatch'
UNION ALL
SELECT 'F2 open date-only orderDateTime', count(*)::text FROM orders
 WHERE "workflowStage" IN ('pending_picking','pick_assigned','pick_done')
   AND "isRemoved"=false AND "dispatchStatus"='dispatch'
   AND "orderDateTime" IS NOT NULL
   AND ("orderDateTime" AT TIME ZONE 'UTC')::time = '00:00:00'
UNION ALL
-- F3
SELECT 'F3 open clocks differ by IST day', count(*)::text FROM orders
 WHERE "workflowStage" IN ('pending_picking','pick_assigned','pick_done')
   AND "isRemoved"=false AND "dispatchStatus"='dispatch'
   AND "orderDateTime" IS NOT NULL AND "obdEmailDate" IS NOT NULL
   AND ("orderDateTime" AT TIME ZONE 'Asia/Kolkata')::date
    <> ("obdEmailDate"  AT TIME ZONE 'Asia/Kolkata')::date
UNION ALL
-- F4
SELECT 'F4 '||bucket, cnt::text FROM (
  WITH live AS (
    SELECT o.* FROM orders o
    LEFT JOIN pick_assignments pa ON pa.order_id = o.id
    WHERE o."dispatchStatus"='dispatch' AND o."isRemoved"=false
      AND ( o."workflowStage" IN ('pending_picking','pick_assigned','pick_done')
            OR ( o."workflowStage"='pick_checked'
                 AND (pa.checked_at AT TIME ZONE 'Asia/Kolkata')::date
                   = (date_trunc('day',(now() AT TIME ZONE 'Asia/Kolkata')))::date ) )
  )
  SELECT 'live rows' AS bucket, count(*) AS cnt FROM live
  UNION ALL SELECT 'target today',  count(*) FROM live
    WHERE "dispatchTargetDate" = (date_trunc('day',(now() AT TIME ZONE 'Asia/Kolkata')))::date
  UNION ALL SELECT 'target past',   count(*) FROM live
    WHERE "dispatchTargetDate" < (date_trunc('day',(now() AT TIME ZONE 'Asia/Kolkata')))::date
  UNION ALL SELECT 'target future', count(*) FROM live
    WHERE "dispatchTargetDate" > (date_trunc('day',(now() AT TIME ZONE 'Asia/Kolkata')))::date
  UNION ALL SELECT 'target null',   count(*) FROM live WHERE "dispatchTargetDate" IS NULL
) f4
UNION ALL
-- F5 (open bills)
SELECT 'F5 '||k, v::text FROM (
  WITH b AS (
    SELECT COALESCE("shipToOverrideCustomerId","customerId") AS cid,
           "shipToCustomerId" AS sap, "dispatchTargetDate" AS d
    FROM orders
    WHERE "workflowStage" IN ('pending_picking','pick_assigned','pick_done')
      AND "isRemoved"=false AND "dispatchStatus"='dispatch'
      AND "dispatchTargetDate" IS NOT NULL
  ), g AS (
    SELECT COALESCE(cid::text,'sap:'||sap) AS gk, d, count(*) AS n FROM b GROUP BY 1,2
  )
  SELECT 'groups' AS k, count(*) AS v FROM g
  UNION ALL SELECT 'groups with 2+', count(*) FROM g WHERE n >= 2
  UNION ALL SELECT 'largest group',  COALESCE(max(n),0) FROM g
) f5
UNION ALL
-- F6
SELECT 'F6 pick_checked rows', count(*)::text FROM orders
 WHERE "workflowStage"='pick_checked' AND "isRemoved"=false
UNION ALL
SELECT 'F6 oldest checkedAt', COALESCE(min(pa.checked_at)::text,'(none)')
FROM orders o LEFT JOIN pick_assignments pa ON pa.order_id=o.id
 WHERE o."workflowStage"='pick_checked' AND o."isRemoved"=false;
```

---

## G — Where docs and code disagree

Code wins in every row below. Nothing was changed; these are reported, not fixed.

**G1 · `CLAUDE_FLOOR.md §10` — "the floor row displays `orderDateTime` while the slot was decided by
`obdEmailDate`". Stale.** `resolveFloorDisplayDate()` (`lib/floor/format.ts:149`) has since been
built and is wired into both row builders. The board now prefers `obdEmailDate` and shows
`orderDateTime` only on a same-IST-day bill, flagged with a mail glyph. A narrower residual gap
survives — see A3(b). The doc's sibling landmine, (a), is still exactly true.

**G2 · `CLAUDE_FLOOR.md §11` describes By picker as "the view `/floor` LANDS on (`mode` defaults to
`"picker"`)". Two changes behind.** The default became `"route"` on 2026-08-27 (`8468297a`), and the
same commit made the picker view unreachable altogether (D7). The §11 row also describes the
By-picker card, `assign-context-banner.tsx` and `assign-bar.tsx`'s `lockedPicker` as live surfaces;
all three are unreachable.

**G3 · `CLAUDE_FLOOR.md` has no §7.5, and `lib/floor/queries.ts:801` cites one.** The comment above
`smuCode` says "Floor's own SMU treatment is unchanged (the `shipMarkers` site icon,
`CLAUDE_FLOOR.md §7.5`)". `CLAUDE_FLOOR.md` v1.4 stops at §11 with no §7.5; the design-doc section
numbers the code cites throughout (`design §7.5`, `§4.2`, `§6.4`) belong to a build draft, not to the
canonical file. Harmless individually, but a reader following the pointer lands nowhere.

**G4 · `CLAUDE_FLOOR.md §10` — "`change-slot` never clears `dispatchSlotRuleId`". CONFIRMED, still
true.** `app/api/floor/actions/route.ts:115` writes `dispatchTargetDate`, `dispatchWindowId` and
`dispatchSlotSource: "manual"` and nothing else. `release/route.ts:108-112` does the same. No Floor
path clears the rule id.

**G5 · `CLAUDE_FLOOR.md §3` — "Four SELECT-only feeds". There are more reads than that now.**
`getFloorBoard` alone issues seven sequential awaits: orders, `dispatch_slot_master`,
`import_raw_summary`, the duplicate-SO groupBy, `import_raw_line_items` for the By-group candidates,
`sku_master_v2` for the oil classification, plus the hide exclusion. §3 also does not mention
`waitingSkus` / `oilSkus`, `RULE2_ENABLED`, `getDuplicateSoNumbers`, or the `hideExclusion`
pass-through parameter added to all four feeds.

**G6 · `CLAUDE_FLOOR.md §10` and `CLAUDE_PICKING.md §7` both quote the `dispatched` population as
1,051 (2026-07-24) / 1,546 (2026-07-27). It is 4,137 today, and `pick_checked` is 2,522.** Both
files call the drain hole open; both understate it by roughly 2,600 rows. The July claim that
"`dispatched` stops at 21 Jul while `pick_checked` keeps growing" no longer holds — something has
moved ~2,600 rows into `dispatched` since, and B5 confirms nothing in the tree can have done it.
`lib/workflow-stages.ts:140`'s own inline comment already flags the earlier ~500-row jump as "not
currently understood"; this is the same phenomenon, five times larger.

**G7 · `CLAUDE_PICKING.md §2` records `supportMayEdit` as dead but not `isSupportDone` or
`stageRank`.** All three have zero live callers (B4).

**G8 · `lib/workflow-stages.ts`'s own header says "Today only Support reads this file."** Support was
retired 2026-07-27. Thirty files import it now, mostly Picking and Floor. The file-top comment about
future `tintMayEdit` / `pickingMayEdit` columns is likewise a plan that did not happen.

**G9 · `prisma/schema.prisma:976` — "⚠ NOTHING CONSUMES THESE YET" above `pickVisibleAt`.** Written
at mint. As of 2026-09-09 the column has five consumers: `buildPickingWhere`,
`countHeldBackWaiting`, `getFloorBoard`, `isHeldBack()` and `POST /api/floor/pick-visible`. Same for
`app_settings`'s "⚠ NOTHING CONSUMES THIS YET" at `:1086` — the pick gate consumes it.

**G10 · `CLAUDE_TRIP_REPORT.md` and `vehicle_master` describe different fleets.** Neither file claims
otherwise, but nothing anywhere records the gap: 34 vehicle numbers appear in the trip mirror in a
week against 6 rows in the master, and no key joins them. Worth writing down before any feature
assumes `vehicle_master` is the fleet.

**Verified CORRECT, no disagreement:** the `FLOOR_SPINE`-minus-`byAssigned` rule (`lib/floor/sort.ts`)
· the shared `floorLiveBaseWhere` between board and marker · the two-arm history predicate · the
`heldAt`-is-arrival-date read-side rule and its `HOLD_LOG_NOTES` fallback ladder · `FLOOR_RELEASABLE_STAGES`
being Floor's own and not `supportMayEdit` · the ship-to save's one-update / one-log / skip-if-unchanged
contract · `RAIL_SUGGESTIONS_ENABLED = true`.

---

## H — What I could NOT verify

1. **Nothing behind auth was checked.** Claude Code has no login to `orbitoms.in`, so no screen in
   this report was opened. Every UI claim — most importantly the By-picker unreachability in D7 — is
   static analysis of the component tree plus git history, not an observation of the running app.
   D7 should be confirmed by one person pressing "By picker" on `/floor` before anything is acted on.
2. **Two files were read in part, not in full.** `components/floor/floor-page.tsx` (~1,300 lines) was
   read in the regions covering mode/state, the assign context, the view toggle, the write handlers
   and the render of the board and bars; `lib/floor/filter.ts` was read down to the flag matcher. A
   `setMode` or `assignContext` write outside the regions I read would falsify D7 — I swept for both
   symbol names across the whole file and found none, which is strong but is not the same as having
   read every line.
3. **The remaining ~25 files under `components/floor/`** (rail-card, detail-panel, group-row,
   slot-band, route-row, hold-tab, cancelled-tab, show-strip, and the rest) were reached by targeted
   grep only. Section A2's FILTER/SORT/DISPLAY classification rests on those greps for those files.
4. **"Currently-open bills" is my definition, not the prompt's.** I used `floorLiveBaseWhere` arm 1.
   A different reading — including `pending_support`, or dropping the `dispatchStatus='dispatch'`
   term — moves F2, F3 and F5's first table materially. F5 is reported both ways for exactly that
   reason.
5. **All F numbers are a single snapshot**, 2026-09-09 around 18:50 IST, on a live board mid-shift.
   F4 and F5 in particular will read differently at 09:00 tomorrow.
6. **Whether the ~2,600 rows that reached `dispatched` since 2026-07-27 came from SQL, a script, or
   a since-archived route, I did not establish.** B5 proves no live code path writes the stage. It
   does not prove what did. `order_status_logs` for those orders would answer it and I did not query
   them.
7. **I did not check `archive/`.** Every sweep excluded it deliberately, so a claim of the form
   "nothing writes X" means nothing in the compiled tree. Archived code is not compiled or deployed
   (`tsconfig.json` excludes it), so this does not weaken B5, but it is worth stating.
8. **The `trip_report` / `vehicle_master` fleet gap (G10) is a count comparison, not a reconciliation.**
   I did not check whether the 34 trip vehicle numbers are formatted the same way as
   `vehicle_master.vehicleNo`, so "6 vs 34" may partly be a formatting mismatch rather than a
   coverage one.
9. **`chk_pick_assignments_status` and the other live CHECK constraints were taken from the docs,
   not re-queried.** Nothing in this report depends on them.
10. **Three scratch scripts were written to run the SELECTs** —
    `scripts/_discovery_probe_20260909.ts`, `_discovery_probe2_20260909.ts`,
    `_discovery_probe3_20260909.ts`. They are underscore-prefixed, so `tsconfig.json`'s
    `scripts/_*` exclusion keeps them outside the `tsc --noEmit` gate, matching the existing
    convention for scratch files. They are SELECT-only. They were not deleted (CORE §3).

---

*Discovery only. No application code written, no migration created, no schema proposed.
`prisma/schema.prisma` untouched. All database access read-only.*
