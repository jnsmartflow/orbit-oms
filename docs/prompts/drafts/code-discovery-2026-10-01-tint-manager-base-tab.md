# code-discovery-2026-10-01 — Tint Manager "Base" tab

**Status:** DISCOVERY ONLY. No code, no writes, no commits. Code read at `745af671` (main = origin, 2026-10-01).
I ran one read-only probe against production (~21:00 IST) and deleted it afterwards. It used Floor's own
`getFloorBoard` / `getFloorHold` / `getFloorCancelled` / `floorBoardWhere` / `rowStatus`, so the Base numbers
below are Floor's predicate, not a copy of it.

**Files read:**
- CLAUDE.md (router v1.13)
- CLAUDE_CORE.md (v120, §3, §5)
- CLAUDE_FLOOR.md (v1.8, §2, §3, §4.1–§4.4, §5)
- CLAUDE_FLOOR_TRIPS.md (§8 which trips a desk shows, §13)
- CLAUDE_TINT.md (§1.9 marker)
- `code-discovery-2026-10-01-tint-manager-build-plan.md` (§A, §J)
- Code at every call site cited below

**Owner decisions this answers to (2026-10-01):**
- The Base tab = every non-tint bill (`orderType ≠ "tint"`) with SMU 74 Decorative Projects or 77 Retail
  Offtake.
- A bill is on Base **exactly while Floor's live board shows it**, using Floor's predicate, reused.
- Status = Floor's pill.
- Actions: Slot · Hold / Release · Shop delivery (bulk); single ship-to in the panel. No Assign.
- The same ticks as today: `tint_slot`, `tint_hold`, `tint_shop_delivery`, `tint_ship_to`.

---

## A. Floor's live board predicate, History, and an `extraWhere`

**The predicate:** `floorBoardWhere(todayRange, todayDateOnly)` (`lib/floor/queries.ts:479-499`) is a union
of four named arms. Each arm is a complete set of terms:

| Arm | Function (file:line) | Terms |
|---|---|---|
| 1 live base | `floorLiveBaseWhere` `:425-438` | `dispatchStatus="dispatch"`, not removed, and (stage ∈ `PICKING_OPEN_STAGES` = pending_picking / pick_assigned / pick_done, any date) OR (`pick_checked` AND `pickAssignment.checkedAt` within today IST) |
| 2 unslotted | `floorUnslottedWhere` `:166-168` | stage ∈ `RAIL_STAGES` (rank < 60), `dispatchStatus = null`, not removed |
| 3 carried pool | `floorCarriedPoolWhere` `:204-211` | `pick_checked`, `dispatch`, `tripDropId = null`, not removed (any check date) |
| 4 trip bills | `floorTripBillsWhere` `:321-329` | `dispatch`, not removed, `tripDropId ≠ null`, the trip ∈ `liveTripsOnDeskWhere(today)` (`lib/trips/live-trips.ts`) |

`getFloorBoard` (`:706`) AND-merges it with the hide-exclusion (`:829`), and the marker shares it through
`getFloorLiveMarkerWhere` (`:501-512`).

**What moves a bill off the board into History.** It stops matching all four arms:
- **checked on an earlier day and put on a truck that is no longer live.** Arm 1's checked branch is today
  only, arm 3 needs no trip, and arm 4 needs a live trip. A trip from an earlier day stays live only while
  it holds an unfinished bill (FLOOR_TRIPS §8, `live-trips.ts:60`, `:115-123`).
- **dispatched** (rank 100 is in no arm).
- **held:** `dispatchStatus="hold"` matches no arm, because arms 1, 3 and 4 pin `"dispatch"` and arm 2 pins
  `null`. A held bill moves to Floor's **Hold tab**, not History.
- **cancelled or removed.**

History is its own two-member OR (`:727-804`): promised-for-D or checked-on-D, OR on a trip dated D. Base
needs none of it: "leaves Base" is simply "no longer matches `floorBoardWhere`".

**Can the shared function take an `extraWhere`?** **Yes, with the exact pattern `getFloorHold` (`:1212-1229`)
and `getFloorCancelled` (`:1355-1439`) already use.**
- `getFloorBoard` today has an `opts` object with `onlyIds` (`:706-723`), and builds
  `where: { AND: opts.onlyIds ? [base, hide, {id in}] : [base, hide] }` at `:829-832`.
- Add `opts.extraWhere?: Prisma.ordersWhereInput`, pushed onto that `AND` only when given. With it omitted
  the `where` is byte-identical, so `scripts/parity-floor-rows.ts` proves Floor is unchanged.
- **Measured:** the DB filter
  `{ orderType: { not: "tint" }, smu: { in: PROJECT_SMU_NAMES } }` returned **23**. The post-filter of
  Floor's full board (`!isTint && smu ∈ PROJECT_SMU_NAMES`) also returned **23**. They match.
- With `extraWhere`, the whole-set extras (`windows` counts, `total`, `waitingSkus`, `oilSkus`, `:1170-1205`)
  describe only the subset. Skip `skusByObd` / `oilSkusByOrder` when `extraWhere` is set, exactly as
  `onlyIds` does (`:1188-1197`). That saves two reads; Base has no grouping reader.
- The SMU list already has one owner: `PROJECT_SMU_NAMES` (`lib/billing/pick-delete-rule.ts:21-23`), derived
  from `SMU_CODE_BY_NAME` (`lib/import-upsert/types.ts:243`) filtered by `isProjectSmu` / `PROJECT_SMU_CODES
  = ["74","77"]` (`lib/picking/colour-work.ts:50-57`). Reuse it; never retype the two names. `orders.smu`
  ↔ `smuCode` is 1:1 on live bills (build plan header), so reading `orders.smu` needs no join.

## B. Floor's status pill

- `rowStatus(row)` (`components/floor/status-pill.tsx:126-145`), first match wins:
  - `isDispatched` → dispatched
  - `isChecked` → done
  - `isDone` → needsCheck
  - `isAssigned` → withPicker
  - then `tintPhase` pending / assigned / tinting / done → the four tint pills
  - otherwise `waiting`
- All inputs are `FloorBoardRow` fields set in `getFloorBoard` (types `lib/floor/types.ts:116-189`).
- The "At desk" variant: `StatusPill heldBack` (`:304-330`) is driven by `isHeldBack(row)` (`:172-184`) =
  the server's `row.isAwaitingShow` (`queries.ts:1124`) AND a pickable-waiting status, **paired with the
  pick-gate switch** (`floor-table.tsx:871`, `heldBack={gateOn && isHeldBack(row)}`).
- **Reuse as-is: yes.** Base rows ARE `FloorBoardRow`s, because they come out of `getFloorBoard`. So
  `rowStatus` + `<StatusPill>` render the same meaning with no adapter. Non-tint bills never carry a
  `tintPhase`, so only waiting / withPicker / needsCheck / done appear in practice.
- **One gap: the gate state.** It is read from `GET /api/floor/pick-gate`, gated on **`floor` canEdit**
  (`app/api/floor/pick-gate/route.ts:48`). A TM user without `floor` can't read it.
- **Recommendation:** pass `heldBack={false}`, so a held-back bill reads "Waiting", which is true from the
  picker's side when the gate is off. Or have the Base route return the gate value alongside the rows. The
  gate is a Floor desk control; TM only displays it. Today 0 Base bills are awaiting show (§G), so this is
  cosmetic.

## C. Overlap: board vs Hold, and what the TM Hold and CI tabs should include

- **A held non-tint 74/77 bill is on Floor's Hold tab and NOT on the board.** Measured: 2 held Base bills,
  **0** also on the board. That follows from §A: `"hold"` matches no arm, and `floorHoldWhere` =
  `{ dispatchStatus: "hold", isRemoved: false }` (`queries.ts:1208-1210`).
- **So Base cannot be the place a held Base bill is released from.** The moment Base's Hold is pressed, the
  bill leaves Base, as it leaves Floor's board.
- **Recommendation: the TM Hold tab MUST include non-tint 74/77.** Otherwise the Tint Manager can hold a
  bill it can never release. `app/api/tint/manager/hold/route.ts:34` changes from
  `extraWhere { orderType: "tint" }` to `{ OR: [{ orderType: "tint" }, BASE_BILL_WHERE] }`.
  - Floor is unchanged (still no `extraWhere`).
  - The Hold-tab UI and its bar's Release (= unhold, `postTintAction("unhold")`) already handle any held row.
  - Its ⋯ items must hide the tint-only ones for a Base row (see H).
- **The CI tab: recommend NOT** for now. Cancel / CI / Restore are not Base actions (owner list), and
  `restore` / `cancel` / `ci` routes refuse non-tint (`tintBillRefusal`). Including the rows would show
  Restore buttons that 409.
  - Measured: **12** of Floor's 16 cancelled-today bills are non-tint 74/77, all 12 with a CI. They're
    likely billing / pick-delete CIs, and showing them read-only would be useful.
  - If the owner wants them: add the OR to `app/api/tint/manager/cancelled/route.ts:32` and hide Restore on
    non-tint rows (or widen restore, which is a bigger decision). **Owner decision 3.**

## D. Server gates — what must accept "tint OR Base"

Today every TM write calls `tintBillRefusal` (`lib/tint/manager-bill.ts:108-111`: removed → not found;
`orderType ≠ "tint"` → "Not a tint bill — use Floor").

**Must widen for Base's actions:**

| Route | file:line | For | Note |
|---|---|---|---|
| `POST /api/tint/manager/actions` | `actions/route.ts:94` | hold · unhold · change-slot | Must stay tint-only for `hand` / `unhand` unless the owner adds Hand to Base (it is not in the list). So the refusal takes the ACTION into account. |
| `POST /api/tint/manager/shop-delivery` | `shop-delivery/route.ts:81` | Shop delivery | Select must add `smu`. |
| `POST /api/tint/manager/ship-to` | `ship-to/route.ts:60` | panel Change ship-to / Clear | Select adds `smu`. |
| `GET /api/tint/manager/order/[orderId]` | `order/[orderId]/route.ts:38` (`detail.orderType !== "tint"` → 404) | the panel's detail read | `getOrderDetail` already returns `smu` + `orderType`. |
| `GET /api/tint/manager/hold` | `hold/route.ts:34` | Hold tab rows (§C) | extraWhere OR |
| **NEW** `GET /api/tint/manager/base` | — | the Base feed | `getFloorBoard({ mode: "live", extraWhere: BASE_BILL_WHERE })`. Gate: `tint_manager` canView (decide whether a tab tick is needed, see H). |

**Stay tint-only, unchanged:**
- `assign`, `base-bypass`, `cancel-assignment`, `splits/*`, `reorder`, `cancel`, `restore`, `ci`,
  `pick-delete/*`, `orders` (the tint board feed).
- `orders/[id]/remove`, `manual-entry`, `challans`.

**The single helper.** Keep the rule in `lib/tint/manager-bill.ts`, the file that already owns "which bills
the TM may touch":
- `BASE_BILL_WHERE = { orderType: { not: "tint" }, smu: { in: [...PROJECT_SMU_NAMES] } }`, for the feed,
  the Hold OR and the marker.
- `isBaseBill({ orderType, smu })`, the same rule as a predicate over row facts.
- `tintManagerBillRefusal(order, action)`: tint → ok; Base → ok only if `action ∈ BASE_ACTIONS` (`hold`,
  `unhold`, `change-slot`, `shop-delivery`, `ship-to`); otherwise "Not a tint or Base bill — use Floor".
- `tintBillRefusal` stays as-is for every tint-only route, so nothing there can be widened by accident.
- `TintBillFacts` gains `smu`. Every widened route adds `smu: true` to its select.
- `BASE_BILL_WHERE` and `isBaseBill` must be built from the one `PROJECT_SMU_NAMES`, so the two cannot drift.

**Release: unhold vs Floor's release-with-slot.** **Use unhold**, which is the TM's Release already (owner
decision 9; the TM Hold bar calls `actions` `unhold`, `applyBillAction` `lib/floor/bill-actions.ts:330-352`).
- **What unhold does:** clears the hold only. `dispatchStatus` becomes `"dispatch"` when the stage ∈
  `FLOOR_CLEAR_HOLD_STAGES` = pending_picking / pick_assigned / pick_done / pick_checked
  (`lib/floor/release-stages.ts:67-72`), otherwise `null`. It never moves the stage, never touches the slot
  or the picker, and refuses a bill with a live CI.
- **What Floor's `/api/floor/release` does** (FLOOR §4.2, `lib/floor/release.ts`):
  - writes `pending_picking` + `"dispatch"` + a chosen slot;
  - on a held `pick_assigned` bill it **removes the picker** (`returnAssignedBillToQueue`);
  - for pick_done / pick_checked it is the same as unhold.
- **Why unhold for Base bills:**
  1. One Release button on the TM means one thing on every row.
  2. It never takes a bill away from a picker who already has it.
  3. Where the bill lands is still a Floor board position:
     - pending_picking / picker stages + `dispatch` → arm 1 or 3 (or 4 on a trip), so it reappears on Base;
     - a held `pending_support` bill → `null` → arm 2 "no slot", so it also reappears on Base. Floor's desk
       then slots it or puts it on a trip, as for every undecided bill.
- **Today both held Base bills are `pick_checked`**, where the two releases write the same thing.

## E. Picking interaction

These bills reach picking at import: `applyNoMailOrderFallback` releases non-tint bills to `pending_picking`
+ `dispatch`.
- **No slot.** `evaluateDispatchSlot` declines every SMU but Deco Retail (FLOOR §3, `route.ts:520-528`).
  That is why **all 23** Base bills show "no slot" (§G), and why the Slot action is genuinely useful here.

What each Base action does at a picker stage or on a trip, through the shared code:

| Action | Picker has it (pick_assigned / pick_done) | On a trip | Source |
|---|---|---|---|
| Hold | **Allowed** — and it takes the bill **off the picker's list mid-pick**: the picking queue pins `dispatchStatus:"dispatch"` (`lib/picking/queue.ts:390`, `:472`). Same as Floor's Hold today. | **Allowed** (no trip refusal in `applyBillAction` hold, `bill-actions.ts:169-183`); the bill drops off its trip's stop on the board until released (arm 4 needs `dispatch`). | `bill-actions.ts:169` |
| Release (unhold) | Allowed; returns it to the same picker | Allowed | `:330-352` |
| Slot | Allowed (slot fields only, no stage or status) | Allowed | `:165-168` |
| Shop delivery | Allowed | **Refused** — "On trip {n} — remove it from the trip first" | `lib/floor/ship-to.ts` (`onTripRefusal`) |
| Ship-to (panel) | Allowed | **Refused** (same) | same |

**Risk: yes.** A TM Hold on a `withPicker` bill yanks it from the picker's My Picks with no push, and it can
hold a bill on a loaded trip. Floor carries exactly the same risk today; the TM would be a second desk able
to do it. Measured now: 1 Base bill with a picker, 14 on a trip. Shop delivery would refuse those 14, which
the toast will list.

**Owner decision 1:** on the TM, should Hold refuse `pick_assigned` / `pick_done` (and/or on-a-trip) Base
bills? A per-bill refusal in the widened gate is a one-line rule. Floor stays as-is.

## F. Live refresh — the TM marker

Today `app/api/tint/manager/marker/route.ts` aggregates over
`AND[ { orderType:"tint", isRemoved:false, OR[arms 1–5] }, hide ]` (`:104-155`), plus the GREATEST child
statement (`:175-186`). Base bills are outside `orderType:"tint"`, so **nothing on Base moves the marker
today**.

**Add, in the same single aggregate:** wrap the existing tint block as one member of a top-level OR:

```
AND[
  { OR: [
      { orderType:"tint", isRemoved:false, OR:[arms 1–5] },                      // unchanged
      { AND: [ floorBoardWhere(getISTDayRange(), todayDateOnly), BASE_BILL_WHERE ] }, // arm 6 — Base
      { AND: [ floorHoldWhere(), BASE_BILL_WHERE ] },                             // arm 7 — Base held (Hold tab, §C)
  ] },
  hide,
]
```

- **Floor's predicate is imported, not copied.** Arm 6 is `floorBoardWhere`, the same function Floor's
  board and marker use, so Base and its marker cannot drift (FLOOR §5). `getISTTodayDateOnly` is
  module-private (`queries.ts:381`); export it, or add a thin exported `floorBoardWhereToday()` beside
  `getFloorLiveMarkerWhere`.
- **Still one query and read-only.** The child-table GREATEST already includes `pick_delete_decisions`,
  which is what Floor's marker folds in via `getDecisionsLatest` (`lib/picking/duplicate-so.ts:194`).
- **Writes that move Base:** pick assign / done / check, trip add/remove and release all write
  `orders.updatedAt`, so they move `_max.updatedAt` over arm 6.
- **Gaps:**
  - Trip-row-only writes (Show to floor `shownAt`, trip status) don't move it. That is the same gap Floor
    has (FLOOR §5 → FLOOR_TRIPS §17), and it only affects the "At desk" reading (§B).
  - The tint arms keep their server-local `startOfToday`, and arm 6 uses Floor's IST range. That's correct:
    each arm mirrors the feed it watches.
- **Proof:** extend `scripts/parity-tint-marker.ts` with the Base set in its fingerprint, then run 30 minutes
  with 0 MISSED, as in step 9.
- `lib/tint/marker-coverage.test.ts` needs no change: the Base actions write `orders`, a stamp table. Add the
  new `base` GET route to nothing (read-only).

## G. Live numbers (read-only, 2026-10-01 ~21:00 IST)

| | count |
|---|---|
| Floor live board, all rows | 233 (37 of them tint) |
| **Base (non-tint 74/77 on Floor's board)** | **23** — DB `extraWhere` 23 = post-filter 23 |
| by SMU | Decorative Projects 18 · Retail Offtake 5 |
| by status (`rowStatus`) | **done 22** (DP 18, RO 4) · **withPicker 1** (RO) · waiting 0 · needsCheck 0 |
| by stage/status | pick_checked/dispatch 22 · pick_assigned/dispatch 1 |
| on a trip | 14 |
| no slot | **23 (all)** — the dispatch engine declines non-Deco-Retail SMUs |
| upcoming zone · awaiting show · Hand | 0 · 0 · 0 |
| **Held** non-tint 74/77 (Floor Hold tab) | **2** (both `pick_checked`, Retail Offtake, none on a trip), **0** of them on the board |
| Cancelled today non-tint 74/77 (Floor Cancelled tab) | 12 of 16, all 12 with a CI |

At 21:00 the floor has finished picking, so expect many more waiting / withPicker rows during the day.

## H. Build plan

Every step:
- `npx tsc --noEmit` passes;
- no `$transaction`, sequential awaits, one update and one log per bill (all inherited from shared code);
- stage files by name.

| Step | Files | Reuse / new | Gate |
|---|---|---|---|
| **1. The rule** | `lib/tint/manager-bill.ts`: `BASE_BILL_WHERE`, `isBaseBill`, `BASE_ACTIONS`, `tintManagerBillRefusal(order, action)`; `TintBillFacts` + `smu` | new exports beside `tintBillRefusal` (unchanged) | tsc |
| **2. Floor feed option** | `lib/floor/queries.ts`: `getFloorBoard` `opts.extraWhere` (and skip the waiting/oil reads when set); export `getISTTodayDateOnly` (or `floorBoardWhereToday`) | edit, Floor default byte-identical | tsc + **`scripts/parity-floor-rows.ts` OK** + floor-live suite |
| **3. Server** | **NEW** `app/api/tint/manager/base/route.ts` (force-dynamic, returns `rows` only, plus the pick-gate value if the owner wants "At desk"); widen `actions` (hold/unhold/change-slot only), `shop-delivery`, `ship-to`, `order/[orderId]`; `hold` GET extraWhere → OR | reuse `getFloorBoard`, `applyBillAction`, `setShipToOverride`, `getOrderDetail` | tsc; a read-only parity script: Base route rows = Floor board rows filtered by `isBaseBill` (ids + `rowStatus`), and TM Hold = tint ∪ Base held |
| **4. Marker** | `app/api/tint/manager/marker/route.ts` arms 6–7 (§F); `scripts/parity-tint-marker.ts` fingerprint + Base | edit | tint-sync suite + 30-min parity, 0 MISSED |
| **5. UI** | `board-tabs.tsx` (+ `"base"`, badge = row count); **NEW** `components/tint/manager/board-base-tab.tsx`: Floor's `rowStatus` + `StatusPill` per row, plus OBD / dealer-site / route / litres / slot cell (`board-slot-cell.tsx`) / trip tag; `board-bottom-bar.tsx` new `mode: "base"` (no Assign; items Slot · Hold · Shop delivery; **primary** see decision 2); `tint-manager-content.tsx` (fetch on load + every board reload, like Hold/CI; selection disjoint from rail/table/hold; Esc; panel target `{ kind: "base", row }`); `board-detail-panel.tsx` (new `"base"` target: identity + slot chip + ship-to; **hide** Assign / Re-assign / Send back / Stop & cancel / Remove OBD / tint items for non-tint); Hold tab rows ⋯ hide tint-only items for a Base row | reuse `StatusPill`, `SlotPickerButton`, `ShipToEditor`, `BoardShopDeliveryDialog`, `postTintAction` | tsc, `next build`, tint-sync + floor-live, manual check with a non-floor TM user |
| **6. Canon** | TINT §1.9 (marker arms 6–7), FLOOR §3 note (the `extraWhere` option, TM is a reader of `getFloorBoard`), ROADMAP (`live.feed.tint` classifier for Base) | docs | — |

**Owner decisions needed before step 1:**
1. **Hold on a picked-up or on-a-trip Base bill** (§E). Allow, as Floor does, or refuse on the TM for
   `pick_assigned` / `pick_done` and/or on a trip? Recommend **refuse `pick_assigned` / `pick_done`** on the
   TM (it silently empties a picker's hands) and allow the rest.
2. **The bar's one brand primary in Base mode.** There's no Assign. Recommend **Hold** as the primary (or
   **Slot**, since every Base bill is unslotted today), with Shop delivery in More.
3. **The CI tab:** include non-tint 74/77 read-only (no Restore), or leave tint-only? Recommend
   **tint-only for now** (§C).
4. **Tab visibility tick:** the Base tab on `tint_manager` canView alone, or its own view tick (as Hold uses
   `tint_hold`)? A new key would follow the §B registration list from the tabs build. Recommend **no new
   key**: the actions are already per-tick.
5. **Hand on Base:** not in the list, so it stays refused. Confirm.
6. **"At desk" pill:** show it (the Base route returns the gate value, a read of `app_settings`) or always
   "Waiting"? Recommend **always Waiting** (§B) unless the desk-control state matters to the tint desk.

---

## I. Owner decisions (2026-10-01)

Recorded before the build (§H steps 1–4 plus CI). They close §H's six questions and add two.

1. **Hold on a picked-up Base bill is REFUSED on the Tint Manager.** At `pick_assigned` / `pick_done` the
   refusal reads "A picker has this bill — hold it from Floor if you must". Hold is allowed at every other
   stage. Floor is unchanged.
2. **Base bar primary = Slot.** More = Hold / Release · Shop delivery · Raise CI.
3. **Raise CI IS allowed on Base bills** (the `tint_ci` tick).
   - The same `raiseFullBillCi` rules as Floor. The trip / dispatched / cancelled refusals are inherited,
     and there's no tint-room bypass or `stopTintWork`.
   - The TM CI tab shows tint ∪ Base cancelled/CI rows.
   - Restore stays tint-only: Base rows get no Restore button and a "CI live" label.
   - Plain Cancel stays tint-only.
4. **No new tab tick.** The Base tab sits on `tint_manager` canView.
5. **No Hand on Base.** `hand` / `unhand` stay tint-only.
6. **Status pill:** always `heldBack={false}` ("Waiting").
7. **The TM Hold tab lists tint ∪ Base held bills.**
8. **TRIP CUT-OFF (on top of Floor's predicate, Floor unchanged).** A Base bill on a trip shows on Base ONLY
   on the IST day it joined that trip. From the next day it is gone, even if Floor still shows it. It is ONE
   extra where-term, in the Base feed only.
9. **Trip display:** the trip number exactly as Floor holds it, letter first (e.g. `L-260930-23`). It comes
   from the stored `trips.tripNumber`, which `lib/trips/number.ts formatTripNumber` wrote. It is never
   retyped.
