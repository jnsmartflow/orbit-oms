# Context Update v67

## SCHEMA CHANGES

New column on `orders` table (via Supabase SQL Editor):

```sql
ALTER TABLE orders ADD COLUMN "orderDateTime" TIMESTAMPTZ;
```

Prisma model: `orderDateTime DateTime? @db.Timestamptz(6)` added to `orders` model. Schema version: **v26.5**.

## NEW/MODIFIED FILES

- `app/api/import/obd/route.ts` — `resolveSlot()` replaced: simple time-based (Morning <10:30, Afternoon <12:30, Evening <15:30, Night >=15:30). No delivery_type_slot_config, no "Next Day Morning". `applyMailOrderEnrichment()` now sets `orderDateTime` from `mo_orders.receivedAt` + recalculates `slotId`. Both `handleConfirm` and `handleAutoImport` set `orderDateTime = emailDateTime` on order creation. Auto-creates `delivery_challans` for SMU = "Retail Offtake" or "Decorative Projects" after order creation, sequenced by `orderDateTime`.
- `app/api/support/slots/route.ts` — `runDailyCleanupIfNeeded()` and `runSlotCascadeIfNeeded()` calls disabled (commented out).
- `app/api/planning/board/route.ts` — Same cascade/cleanup calls disabled.
- `app/api/warehouse/board/route.ts` — Same cascade/cleanup calls disabled.
- `app/api/admin/fix-slots/route.ts` — One-time backfill endpoint. Sets `orderDateTime` (from `mo_orders.receivedAt` or merged `obdEmailDate+obdEmailTime`) and recalculates `slotId`/`originalSlotId` for all active orders.
- `app/api/admin/fix-challans/route.ts` — One-time backfill endpoint. Creates `delivery_challans` for eligible orders (SMU = Retail Offtake / Decorative Projects) without existing challans, sequenced by `orderDateTime`.
- `app/api/tint/manager/orders/route.ts` — Returns `orderDateTime` on all order/split/assignment payloads.
- `app/api/tint/manager/challans/route.ts` — SMU filter changed to `["Retail Offtake", "Decorative Projects"]`. Sort changed to `orderBy: { orderDateTime: "asc" }`.
- `components/tint/tint-manager-content.tsx` — `orderDateTime` added to `TintOrder`, `SplitCard`, `CompletedAssignment` types. `formatOrderDateTime()` helper added. Kanban cards and sorting use `orderDateTime` (fallback to `obdEmailDate/Time`).
- `components/tint/tint-table-view.tsx` — Re-assign action added to Assigned order rows. "Customer" column renamed to "Site Name". Slot column removed. Dispatch status badge added to `CustomerCell`. `formatOrderDate()` helper uses `orderDateTime`. Grid template updated to 9 columns.
- `components/tint/challan-content.tsx` — Custom header replaced with `<UniversalHeader />`. Left panel changed from 35% cards to 320px compact rows (teal selected state, 3-line layout). Filter/search moved to UniversalHeader. Action bar restyled (neutral, Print button dark).
- `components/tint/challan-document.tsx` — Full B&W print redesign. Removed blue header (#0d47a1) and teal bottom bar. Clean ruled layout: black accent borders, dark address bar, #f9fafb section headers, proper `<table>` with `<colgroup>`. Logo uses `grayscale(100%) brightness(0)` CSS filter.
- `lib/slot-cascade.ts` — NOT modified, but no longer called from any API route.
- `lib/day-boundary.ts` — NOT modified, but no longer called from any API route.

## NEW API ENDPOINTS

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/admin/fix-slots | admin, operations | Backfill `orderDateTime` + recalculate `slotId` from `mo_orders.receivedAt` or `obdEmailDate+Time` |
| POST | /api/admin/fix-challans | admin, operations | Create missing `delivery_challans` for eligible SMU orders |

## BUSINESS RULES ADDED

**Slot assignment — simple time-based (replaces delivery_type_slot_config):**
- Morning (id=1): obdEmailTime < "10:30"
- Afternoon (id=2): obdEmailTime >= "10:30" and < "12:30"
- Evening (id=3): obdEmailTime >= "12:30" and < "15:30"
- Night (id=4): obdEmailTime >= "15:30" or null
- Slot ID 5 (Next Day Morning) is never assigned. The concept is removed.

**Slot cascade and day-boundary reset — DISABLED.** Files `lib/slot-cascade.ts` and `lib/day-boundary.ts` are kept but not called. Slots are fixed at import time and never change.

**orderDateTime column:** The true order received time. Priority: `mo_orders.receivedAt` (when SO number matches) → `obdEmailDate + obdEmailTime` (merged via `mergeEmailDateTime()`). Used for slot assignment, display, and sorting. `obdEmailDate`/`obdEmailTime` retained on API responses as fallback.

**Delivery challan auto-creation:** Challans are created at import time (not lazily on click) for orders with SMU = "Retail Offtake" or "Decorative Projects". Challan number format: `CHN-{YEAR}-{5-digit seq}`. Sequence based on `orderDateTime` order within the batch. Created regardless of customer master status.

**Challan SMU filter:** Only "Retail Offtake" and "Decorative Projects" appear in the challan screen. Other SMU values (Deco, Deco Retail, Distributor) are excluded.

**TM table view:** Column "Customer" renamed to "Site Name". Slot column removed. Dispatch status badge (Dispatch/Hold/Waiting) shown inline next to site name. Re-assign action added to Assigned section rows.

## PENDING ITEMS

1. **Challan lazy creation removal** — The `[orderId]` detail API may still auto-create challans on click. Verify and remove if present (prompt 2 noted this but may not have addressed it).
2. **Challan print CSS** — Verify `@media print` rules in `globals.css` work with the new B&W layout. Old class names (ch-header, tint-yes) may need updating.
3. **orderDateTime on other screens** — Support, Planning, Warehouse boards still use `obdEmailDate`/`obdEmailTime`. Update when those screens go live.
4. **SMU dropdown in challan filter** — Old dropdown had "Project" option. Now handled by UniversalHeader filter with correct values.

## CHECKLIST UPDATES

- **Slot assignment:** Simple time-based. No delivery_type_slot_config. No Next Day Morning. No cascade.
- **orderDateTime:** New column on orders. Priority: mo_orders.receivedAt > obdEmailDate+Time. Used for slot, display, sorting.
- **Cascade/cleanup DISABLED:** lib/slot-cascade.ts and lib/day-boundary.ts exist but are not called. Do not re-enable.
- **Delivery challans:** Auto-created at import time for SMU = "Retail Offtake" or "Decorative Projects". Sequential by orderDateTime. Format CHN-{YEAR}-{5-digit}.
- **TM table:** "Site Name" (not Customer). No Slot column. Dispatch badge inline. Re-assign in Assigned rows.
- **Challan document:** B&W only. No teal, no blue. Logo grayscale filter. Proper <table> with <colgroup>.

## UI.md UPDATES

Add after §45:

### 46. Delivery Challan — Split View

**Left panel (320px):** Same pattern as Mail Orders Review View. Compact 3-line rows: OBD mono + challan badge / customer name / SMU dot + route + articles. Selected: teal-50 bg + teal left border. No search in panel — handled by UniversalHeader.

**Right panel:** Action bar (challan ID mono + OBD + customer gray-400 | Edit outline + Print dark) + challan document on #f9fafb background.

**UniversalHeader config:** No segments. Filter groups: SMU (Retail Offtake / Decorative Projects) + Route. Date stepper. Search.

### 47. Delivery Challan — Document (B&W Print)

**Color palette (document only):** #111827, #374151, #6b7280, #9ca3af, #d1d5db, #e5e7eb, #f0f0f0, #f9fafb, #fff. NO teal. NO blue.

**Structure:** Header (logo grayscale + DELIVERY CHALLAN centered + challan no.) → dark address bar (#374151) → SMU/OBD/Warehouse fields → Bill To / Ship To (with #f9fafb sub-headers) → Customer/SO/Receiver → Line items table (colgroup, 2px ruled borders) → Footer (terms + transport + signatures) → bottom bar (regd office + GSTIN).

**Table:** `table-layout: fixed` with `<colgroup>`: 5/13/35/15/8/12/12%. Header 28px #f9fafb. Data rows 32px. Blank rows to minimum 8. Totals row with 2px top border.
