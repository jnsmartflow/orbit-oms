# Context Update v69 — Challan Redesign + TM Operator Segments + Slot-at-Completion

## NEW/MODIFIED FILES

| File | Purpose |
|------|---------|
| `components/tint/challan-content.tsx` | Left panel: 320px compact rows, UniversalHeader with search/filters/date stepper |
| `components/tint/challan-document.tsx` | B&W print-optimized challan document — no teal/blue, grayscale logo, ruled layout |
| `components/tint/tint-manager-content.tsx` | Operator workload segments replace slot segments; old hidden header removed |
| `components/tint/tint-table-view.tsx` | SlotBadge component removed (was unused) |
| `app/api/tint/operator/done/route.ts` | Assigns slotId on order at tinting completion |
| `app/api/tint/operator/split/done/route.ts` | Assigns slotId on parent order at split completion |
| `app/api/import/obd/route.ts` | Tint orders get slotId=null at import; non-tint unchanged |

## BUSINESS RULES ADDED

### Challan Document — B&W Print
- Document uses only grayscale palette (#111827 through #fff)
- Logo filter: `grayscale(100%) brightness(0)` for pure black print
- Address bar (#374151) is the only dark background section
- Table uses 2px #111827 top/bottom rules, #f9fafb header bg

### Tint Manager — Operator Workload Segments
- Row 2 shows operator pills: "Unassigned · N", "Deepak · N", etc.
- Unassigned count = orders in pending_tint_assignment or remainingQty > 0
- Operator count = assigned + in-progress (orders + activeSplits) by operator ID
- Tapping pill filters all 4 columns to that operator; tap again deselects
- Operator filter removed from Filter dropdown (moved to segments)
- Workload dropdown removed (replaced by segment pills)
- Slot segments removed — slots are dispatch windows, irrelevant to tinting
- Date stepper removed — TM is always a live view
- Old hidden header block deleted (was display:none)

### Slot Assignment at Tinting Completion
- **Tint orders** (`orderType === "tint"`): slotId = null at import time
- Slot assigned when tinting completes, based on IST completion time:
  - `< 10:30` → Morning (id=1)
  - `< 12:30` → Afternoon (id=2)
  - `< 15:30` → Evening (id=3)
  - `>= 15:30` → Night (id=4)
- **Whole order done** (`/api/tint/operator/done`): sets slotId + originalSlotId on order
- **Split done** (`/api/tint/operator/split/done`): sets slotId + originalSlotId on parent order; last split completion wins (each updates the slot)
- **Non-tint orders**: unchanged — slot assigned at import via resolveSlot()
- `applyMailOrderEnrichment()`: skips slot recalculation for tint orders
- No backfill needed — existing tint orders keep import-time slots

## PENDING ITEMS

- Challan content: `headerFilters` sync uses single-select only (length === 1); multi-select will show all
- TM: `SlotSummaryItem` interface still defined but unused — can remove later
- Slot cascade (`lib/slot-cascade.ts`) remains disabled and should skip tint orders if ever re-enabled
