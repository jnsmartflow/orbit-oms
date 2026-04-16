# Context Update v71 — Tint Operator Redesign + Signal Badges + Multi-Screen Fixes

## NEW/MODIFIED FILES

| File | Purpose |
|------|---------|
| `app/api/tint/operator/my-orders/route.ts` | Added billTo, area, route, deliveryType fields + totalAssignedToday/totalDoneToday counts |
| `app/api/tint/manager/missing-customers/route.ts` | NEW — GET endpoint for orders with customerMissing=true in Chandresh's SMUs |
| `app/api/tint/manager/reorder/route.ts` | Per-operator reorder (only swaps within same operator's queue) |
| `app/api/tint/manager/assign/route.ts` | Sets sequenceOrder to MAX+1 on assignment (FIFO within operator) |
| `app/api/tint/operator/done/route.ts` | Assigns slotId on order at tinting completion |
| `app/api/tint/operator/split/done/route.ts` | Assigns slotId on parent order at split completion |
| `app/api/import/obd/route.ts` | Tint orders get slotId=null at import; applyMailOrderEnrichment skips tint |
| `components/tint/tint-operator-content.tsx` | Full v4 redesign: Outlook split layout, job pill, TI form, shade grid |
| `components/tint/tint-manager-content.tsx` | Operator segments, missing customer badge, age badge, neutral pills, delivery type fix |
| `components/tint/tint-table-view.tsx` | §40 table rewrite, serial numbers, roomy spacing, age badge |
| `components/tint/challan-content.tsx` | UniversalHeader + 320px compact rows + neutral action bar |
| `components/tint/challan-document.tsx` | B&W print layout, bill-to address fix |
| `lib/permissions.ts` | Added delivery_challans, shade_master, ti_report page keys |
| `lib/mail-orders/utils.ts` | Added getOrderSignals() shared signal builder; BATCH_COPY_LIMIT=14 |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | Uses shared getOrderSignals() |
| `app/(mail-orders)/mail-orders/review-view.tsx` | Full 15-badge signal system + remark type badges in footer |
| All 8 layout.tsx files | Sidebar uses session.user.role instead of hardcoded role |

## NEW API ENDPOINTS

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/tint/manager/missing-customers` | tint_manager, admin, ops | Orders with customerMissing=true in Retail Offtake / Decorative Projects SMUs |

## BUSINESS RULES ADDED

### Tint Operator Screen — v4 Redesign
- Layout: UniversalHeader Row 1 + teal segment job pill in Row 2 + Bill/Ship cards Row 3 + 320px SKU left panel + flex TI form right
- Job pill: teal-600 active segment with #seq, customer, OBD, chevron dropdown
- Queue dropdown: scoreboard (Today's Target, progress bar) + job cards (current=teal, future dimmed)
- Left panel: 3-line cards (code + description + qty), gray-900 selected, amber-300 pending, green-300 done borders
- TI form: horizontal suggestion strip, compact qty row with inline save shade toggle, pigment-coloured shade cells
- Shade cells: 27 pigment-accurate colour maps (TINTER_SHADE_COLORS + ACOTONE_SHADE_COLORS) with bg/bgFill/border/top/topFill/label per shade
- CTA split: "Save TI" (gray-900) vs "Save TI & Start" (green-600) — separate save from workflow
- Future jobs can save TI but not start; only current job can start
- "Add Another Entry" removed from UI
- Mobile: left panel hidden below md breakpoint
- Progress bar colours: amber <25%, teal 25-75%, green >75%
- Teal only in: sidebar + job pill segment. No teal on CTAs or left panel cards.

### Sequence Order Sync
- Operator screen sorts by sequenceOrder (was operatorSequence)
- Reorder API filters per-operator (only swaps within same operator's queue)
- Assign API sets sequenceOrder = MAX(operator's queue) + 1

### Signal Badge System
- getOrderSignals() in utils.ts: shared by Table View + Review View
- 15 badge types: OD, CI, Bounce (blocker); Bill Tomorrow, Cross {CODE}, → Ship-to, Urgent (attention); 7 Days, Extension, Bill {N}, DPL, Challan, Truck (info); ✂ Split, ⚠ Split (split)
- Review View footer Notes shows remark type badges (contact/instruction/cross/customer/unknown)

### Sidebar Role Fix
- All 8 layout files pass session.user.role instead of hardcoded role
- Nav items centralized via permissions.ts (delivery_challans, shade_master, ti_report added)

### TM Delivery Type Filter Fix
- Filter values match DB: "Local", "Upcountry", "IGT", "Cross Depot" (was uppercase)

## PENDING ITEMS

- SQL needed for role_permissions: delivery_challans, shade_master, ti_report rows for tint_manager
- BATCH_COPY_LIMIT reduced from 20 to 14
- SlotSummaryItem interface unused in tint-manager-content.tsx
- operatorSequence field still exists in schema but no longer used for sorting
