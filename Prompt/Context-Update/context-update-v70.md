# Context Update v70 — Challan B&W, TM Operator Segments, Slot-at-Completion, Table §40

## NEW/MODIFIED FILES

| File | Purpose |
|------|---------|
| `components/tint/challan-content.tsx` | UniversalHeader + 320px compact row list + neutral action bar |
| `components/tint/challan-document.tsx` | B&W print-optimized challan — grayscale only, no teal/blue |
| `components/tint/tint-manager-content.tsx` | Operator workload segments, neutral pills, age badge, compact empty state |
| `components/tint/tint-table-view.tsx` | §40 table-layout:fixed rewrite, roomy spacing, age badge, operator segments |
| `app/api/tint/operator/done/route.ts` | Assigns slotId on order at tinting completion based on IST time |
| `app/api/tint/operator/split/done/route.ts` | Assigns slotId on parent order at split completion |
| `app/api/import/obd/route.ts` | Tint orders get slotId=null at import; applyMailOrderEnrichment skips tint |
| `lib/mail-orders/utils.ts` | BATCH_COPY_LIMIT = 14 |

## BUSINESS RULES ADDED

### Slot Assignment at Tinting Completion
- Tint orders (`orderType === "tint"`): slotId = null at import time
- Slot assigned when tinting completes, based on IST completion time:
  - `< 10:30` → Morning (id=1), `< 12:30` → Afternoon (id=2), `< 15:30` → Evening (id=3), else Night (id=4)
- Whole order done: sets slotId + originalSlotId on order
- Split done: sets slotId + originalSlotId on parent order; last split completion wins
- Non-tint orders: unchanged — slot assigned at import via resolveSlot()
- applyMailOrderEnrichment(): skips slot recalculation for tint orders

### Tint Manager — Operator Workload Segments
- Row 2 shows operator pills: "Unassigned · N", "Deepak · N", etc.
- Unassigned count = orders in pending_tint_assignment or remainingQty > 0
- Operator count = assigned + in-progress (orders + activeSplits) by operator ID
- Tapping pill filters all 4 columns; tap again deselects
- Operator filter removed from Filter dropdown (now in segments)
- Slot segments, date stepper, workload dropdown all removed
- Old hidden header block deleted

### TM Table View — §40 Compliance
- All sections use `<table>` with `table-layout: fixed` and `<colgroup>` (13/10/22/7/9/6/15/10/8%)
- Header: 9px 14px padding, bg-gray-50, border #ebebeb
- Data rows: 10px 14px padding, hover #fafafa, border #f0f0f0
- OBD cell: vertical-align top, two lines (OBD + date+age badge)
- Operator avatar: 22×22px
- Section spacing: mb-4 (16px)

### Age Badge
- Shows on orders in all views (card + table) when order is 1+ days old
- 1 day: amber ("1d"), 2+ days: red ("Nd")
- Calculated IST-aware from orderDateTime or obdEmailDate

### Column Header Pills
- All 4 kanban column count pills use neutral gray (`bg-gray-100 text-gray-700 border-gray-200`)

### Challan Document — B&W Print
- Grayscale only palette (#111827 through #fff), logo filter: grayscale(100%) brightness(0)
- Address bar (#374151) only dark section
- Table: 2px #111827 top/bottom rules, #f9fafb header bg

## PENDING ITEMS

- SlotSummaryItem interface still defined but unused in tint-manager-content.tsx
- Slot cascade (lib/slot-cascade.ts) remains disabled; should skip tint orders if re-enabled
- BATCH_COPY_LIMIT reduced from 20 to 14
