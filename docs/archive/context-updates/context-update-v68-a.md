# Context Update v68

## MODIFIED FILES

- `components/tint/tint-manager-content.tsx` — Slot segments replaced with operator workload pills. Date stepper removed. Slot filter state/logic removed. Operator filter moved from Filter dropdown to segments. Old hidden header block deleted. Kanban column count pills changed to neutral gray. Empty state compacted. Age badge added to cards.
- `components/tint/tint-table-view.tsx` — Converted from CSS Grid to `table-layout: fixed` with `<colgroup>` per §40. SlotBadge and Slot column removed. Age badge added to OBD cell. Re-assign action added to Assigned order rows. Roomy spacing (10px vertical, 14px horizontal cell padding). Column widths: 13/10/22/7/9/6/15/10/8%.
- `app/api/import/obd/route.ts` — Tint orders (`orderType === "tint"`) get `slotId = null` and `originalSlotId = null` at import time. Non-tint orders unchanged.
- `app/api/tint/operator/action/route.ts` — On tinting completion ("tinting_done"), calculates slot from completion time using `resolveSlot()` thresholds and sets `slotId`/`originalSlotId` on the order.

## SCHEMA CHANGES

None. Test tint operator (id=5) deleted from `users` table. Dummy `shade_master` rows deleted. All import/order data truncated for fresh start (master data untouched).

## BUSINESS RULES ADDED

**TM header Row 2 — Operator workload pills (replaces slot segments):**
- "Unassigned · N" pill: count of orders in Pending column (no operator yet). Red-ish styling.
- One pill per operator from `/api/tint/manager/operators`: count = assigned + in progress combined.
- Tap pill to filter all columns to that operator's work. Tap again to deselect.
- Operator filter removed from Filter dropdown (moved to pills).
- Design matches UniversalHeader segment pattern (same as Mail Orders slot pills).

**TM has no date stepper.** It is a live production dashboard — always shows current state. Historical completion data is in TI Report.

**TM has no slot segments.** Slots represent dispatch windows, not tinting windows. Irrelevant to Chandresh's tinting workflow. Slot filter and slotSummary are no longer consumed by TM (API still returns them for other screens).

**Slot assignment for tint orders — at completion, not import:**
- Non-tint orders: slot assigned at import time via `resolveSlot()` (unchanged).
- Tint orders (`orderType === "tint"`): `slotId = null` at import. Slot assigned when operator marks tinting done, based on completion time (IST). Same thresholds: Morning <10:30, Afternoon <12:30, Evening <15:30, Night ≥15:30.
- For split orders: slot assigned on parent order when last split completes. Latest completion time determines the slot.
- No buffer before cutoff — completion at 10:25 → Morning slot.

**Age badge on TM orders (both views):**
- Today: no badge.
- 1 day old: amber pill "1d" (`bg-amber-50 text-amber-700 border-amber-200`).
- 2+ days old: red pill "2d"/"3d" etc. (`bg-red-50 text-red-700 border-red-200`).
- Shows in OBD cell next to date, inline on same line.

**TM table view — §40 compliant:**
- Proper `<table>` with `table-layout: fixed` and `<colgroup>` percentage widths.
- Column widths: OBD 13%, SMU 10%, Site Name 22%, Priority 7%, Articles 9%, Volume 6%, Operator/Action 15%, Time 10%, Actions 8%.
- Roomy spacing: 10px vertical padding, 14px horizontal padding per cell.
- Header: 32px, bg-gray-50, 10px uppercase gray-400. Data rows: ~44px with two-line OBD.

**Kanban card column pills:** All neutral `bg-gray-100 text-gray-700 border-gray-200`. No semantic colors on column headers.

**Kanban empty state:** Compact "No orders" italic text. No icon, no subtitle.

## PENDING ITEMS

1. **Missing customer visibility for non-tint orders** — TM only shows tint orders, but Chandresh manages customer master for all SMUs (Retail Offtake + Decorative Projects). Non-tint orders with missing customers have no visibility on TM. Need a badge/indicator on TM header showing count of ALL missing customers (tint + non-tint) for these two SMUs. Click opens resolution list.
2. **Verify Piece 2 with live data** — Slot-at-completion logic deployed but not tested with actual tint operator marking done. Verify slot gets assigned correctly.
3. **Customer missing sheet styling** — Does not match admin customer split-view form. Cosmetic only, low priority.

## CHECKLIST UPDATES

- **TM segments:** Operator workload pills, not slot pills. "Unassigned · N" + one per operator.
- **TM has no date stepper, no slot filter.** Always live view.
- **Tint order slot:** Assigned at tinting completion, NOT import. `slotId = null` until done.
- **Non-tint order slot:** Assigned at import time (unchanged).
- **TM table:** §40 compliant. `<table>` with `<colgroup>`. Column widths: 13/10/22/7/9/6/15/10/8%.
- **Age badge:** Shows on all orders 1+ days old. Amber for 1d, red for 2d+.
- **Test operator (id=5):** Deleted. Only Deepak Vasava and Chandrasing Valvi remain as tint_operator.
