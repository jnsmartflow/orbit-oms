# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v35.md fully before doing anything else."
# Version: Phase 4 Support UI · Schema v21 · Context v35 · March 2026

---

## 1. What this application is

Orbit OMS is a depot-level order management system for a paint distribution company operating out of Surat, India. It manages the full lifecycle of customer orders from manual XLS import through tinting, support review, dispatch planning, warehouse picking, and vehicle dispatch.

This is an internal business tool — not a public-facing product. Users are depot staff: dispatchers, support agents, tint operators, warehouse supervisors, and pickers. Each role sees a different interface and has different permissions.

Scale: ~25-35 dispatch plans per day, ~100-200 OBDs (orders) per day, single depot.

---

## 2. Tech stack — locked, do not deviate

| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui |
| ORM | Prisma |
| Database | Supabase (PostgreSQL) |
| Auth | NextAuth.js v5 |
| Deployment | Vercel + GitHub |
| Package manager | npm |
| XLS parsing | `xlsx` npm package (already installed) |

**Never introduce a new library without being explicitly asked. Use what is already installed.**

---

## 3. Database — 52 tables, 5 groups (Schema v21)

Schema v21 = Schema v20 + smu TEXT column on orders table.

### Group 1: Setup / Master tables (23 tables — Phase 1 complete)

```
-- Config / Status
status_master              — UNIFIED status table. All workflow statuses.
                             Domains: dispatch | tinting | pick_list | import | workflow | priority
system_config              — Key-value store. Always read from DB — never hardcode.
                             v19 keys: day_boundary_time ('00:00'), last_cleanup_date, history_days_visible ('30')
                             NEW v20 keys: slot_cascade_grace_minutes ('15'), last_cascade_check
role_master                — 7 roles

-- SKU Hierarchy
product_category           — Emulsion, Primer, Tinter, Enamel, Texture, Putty
product_name               — WS, Aquatech, Weathercoat... FK -> product_category
base_colour                — White Base, Deep Base, Clear, N/A...
sku_master                 — Each row = one SKU code + colour combo.
                             FKs: productCategoryId, productNameId, baseColourId
                             NOTE: grossWeightPerUnit does NOT exist — weight comes from import file

-- Transporter / Vehicle
transporter_master         — Transporter companies.
vehicle_master             — NEW v17: added capacityKg, vehicleType, isActive

-- Geography & Delivery
delivery_type_master       — Local | Upcountry | IGT | Cross. Drives slot rules.
slot_master                — Dispatch slot definitions. Admin-managed. No hardcoded times.
                             Seed data: Morning (10:30), Afternoon (12:30), Evening (15:30),
                             Night (18:00), Next Day Morning (10:30 next day)
                             NEW v20: sortOrder INT (1=Morning, 2=Afternoon, 3=Evening, 4=Night, 5=Next Day Morning)
                             Has isNextDay BOOLEAN for slots that refer to next calendar day
delivery_type_slot_config  — Per-delivery-type slot rules (time_based or default windows).
route_master               — Named routes: Varachha, Bharuch, Adajan, Surat City...
area_master                — Areas. delivery_type AND primaryRoute live here.
area_route_map             — Many-to-many area <-> route (edge cases only)
sub_area_master            — Sub-areas for stop clustering

-- Sales Officer
sales_officer_master       — Sales officers
sales_officer_group        — Named customer portfolios. One SO per group.

-- Customers
contact_role_master        — Owner | Contractor | Manager | Site Engineer
delivery_point_master      — Ship-to customers.
                             Fields: primaryRouteId (override), deliveryTypeOverride,
                             salesOfficerGroupId, customerRating (A/B/C)
delivery_point_contacts    — Contacts with contactRoleId FK -> contact_role_master

-- People
users                      — Depot staff accounts
```

### Group 2: Import tables (5 tables — Phase 2 complete)

```
import_batches             — One row per import session.
import_raw_summary         — One row per OBD from header XLS. 18 mapped columns + smuNumber (v14).
                             obdEmailDate + obdEmailTime stored here.
                             NEW v14: smuNumber TEXT (nullable — populated when import updated)
                             NEW v35: soNumber TEXT (nullable — SO number from SAP, column added via SQL Editor)
import_raw_line_items      — One row per line item. 10 columns including article + articleTag.
                             NOTE v24: lineId is now row index (1,2,3...) not source file line_id.
                             NOTE v24: batchCode is always NULL — removed from source data.
import_enriched_line_items — Lines enriched with sku_master join.
import_obd_query_summary   — Per-OBD totals: weight, qty, volume, hasTinting, totalArticle, articleTag.

import_raw_summary columns (full list):
  id, batchId, obdNumber, sapStatus, smu, smuCode, materialType, natureOfTransaction,
  warehouse, obdEmailDate, obdEmailTime, totalUnitQty, grossWeight, volume,
  billToCustomerId, billToCustomerName, shipToCustomerId, shipToCustomerName,
  invoiceNo, invoiceDate, soNumber, smuNumber, rowStatus, rowError, createdAt

import_enriched_line_items columns:
  id, createdAt, rawLineItemId, skuId, unitQty, volumeLine, lineWeight, isTinting, note

VOLUME NOTE: All volume values are in LITRES (L). SAP source data is already in litres.
  Do NOT label as m³ anywhere in the UI.
```

### Group 3: Orders + Tinting + Support (9 tables — Phase 2 + Phase 3 + v13)

```
orders                     — Parent container. One row per OBD post-import.
                             workflowStage tracks overall OBD status.
                             PRIMARY UNIT OF WORK IS order_splits (not orders) for tint flow.
                             NEW v15: customerMissing BOOLEAN DEFAULT false
                             NEW v16: slotId INT? FK -> slot_master (nullable)
                             dispatchSlot String? still exists (legacy plain text — use slotId going forward)
                             NEW v20: originalSlotId INT? FK -> slot_master (nullable)
                               Set ONCE when slotId is first assigned, never changed after.
                               Cascade and day boundary update slotId but never touch originalSlotId.
                             NEW v21: smu TEXT? — SMU name from SAP (e.g. "Deco Retail"). Populated during import.
                             NEW v27: isPicked (bool), pickedAt (timestamp), pickedById (FK users)
order_splits               — EXPANDED v13. One row per tint batch/split.
                             dispatchStatus on splits drives the planning board.
                             NEW v27: isPicked (bool), pickedAt (timestamp), pickedById (FK users) — for warehouse picking
split_line_items           — One row per line assigned to a split.
split_status_logs          — INSERT-ONLY. Audit trail per split.
tint_assignments           — One row per whole-OBD assignment (non-split flow).
tint_logs                  — INSERT-ONLY. Immutable. orderId + optional splitId.
order_status_logs          — INSERT-ONLY. Immutable. Per-order audit trail.
                             changeType values include: 'slot_cascade', 'day_boundary_slot_reset'
tinter_issue_entries       — INSERT-ONLY. One row per base batch TI entry.
```

### Group 4: Dispatch + Warehouse (7 tables — Schema v18)

```
vehicle_master             — Full schema. transporterId FK, vehicleNo (unique), category,
                             capacityKg, maxCustomers, deliveryTypeAllowed, driverName,
                             driverPhone, isActive
dispatch_plans             — NEW v17. One plan = one vehicle + one slot + one trip.
                             planDate, slotId FK, vehicleId FK, tripNumber, status (draft/confirmed/loading/dispatched),
                             totalOrders, totalWeightKg, totalVolume, createdById, confirmedAt/By, dispatchedAt/By, notes
                             Unique: (planDate, slotId, vehicleId, tripNumber)
dispatch_plan_orders       — NEW v17. Orders assigned to a plan. ORDER-LEVEL (not split-level).
                             planId FK (CASCADE), orderId FK, sequenceOrder, addedById
                             NEW v19: clearedAt TIMESTAMPTZ — soft delete for day boundary rollover
                             Unique: (planId, orderId)
                             CORRECTION v28: Live DB has dispatch_plan_orders (order-level), NOT dispatch_plan_splits.
                             All splits of one OBD go to same vehicle — cannot split across plans.
pick_assignments           — NEW v18. Picker assignments for warehouse board.
                             orderId FK (unique per active assignment), pickerId FK -> users,
                             sequenceNumber INT, assignedAt TIMESTAMP, assignedById FK -> users,
                             status TEXT DEFAULT 'assigned' (assigned | picked),
                             pickedAt TIMESTAMP?, notes TEXT?
                             NEW v19: clearedAt TIMESTAMPTZ — soft delete for day boundary rollover
                             Unique: (orderId) — one active assignment per order
                             NOTE: Assignment is at ORDER level
pick_lists                 — NEW v17. One pick list per plan.
pick_list_items            — NEW v17. Line items to pick.
dispatch_change_queue      — NEW v17. Notifications when support holds/cancels order in a plan.

NOTE: dispatch_plan_vehicles was DROPPED (redundant — vehicleId lives on dispatch_plans).
```

### Group 5: Delivery Challan (2 tables — NEW v14)

```
delivery_challans          — One row per order. Auto-created on first challan open.
delivery_challan_formulas  — Per-line tinting formula entered by TM before print.
```

---

## 4-16. [Unchanged from v27]

(Sections 4-16 remain unchanged — refer to v27 for full content)

---

## 17. Phase 4 Screen Designs (UPDATED v30)

(Unchanged from v34 — refer to v34 for full content)

---

## 18-32. [Unchanged from v27]

---

## 33. Planning Board UI Components (UPDATED v33)

(Unchanged from v34 — refer to v34 for full content)

---

## 34. Dispatcher Board Business Rules (UPDATED v29)

(Unchanged from v34 — refer to v34 for full content)

---

## 35. Schema Correction (NEW v28)

**IMPORTANT:** Live DB has `dispatch_plan_orders` (order-level), NOT `dispatch_plan_splits`.
Planning is at ORDER level — all splits of one OBD go to same vehicle.

---

## 36. Session Start Checklist (UPDATED v35)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v21** — includes soNumber on import_raw_summary (v35)
3. **CORRECTION v28:** Planning is at ORDER level, not split level
4. Live DB has `dispatch_plan_orders` (FK to orders), NOT `dispatch_plan_splits`
5. All splits of one OBD go to same vehicle — no splitting across plans
6. `order_splits.dispatchStatus` still drives visibility on planning board
7. `orders.isPicked` and `order_splits.isPicked` both exist for picking
8. Dispatcher Planning Board is **COMPLETE** — matches mockup v8
9. Warehouse Board design is **LOCKED at v8**
10. Vehicle changes: "Confirm" for draft trips, "Update" for confirmed trips
11. Editable until loading — API validates status, returns 400 if loading/dispatched
12. Empty trips: kept in DB, never deleted, reused when creating new trips
13. Trip numbers: sequential per day, never renumber, reuse empty trips instead
14. Auto Draft uses same create API — benefits from empty trip reuse automatically
15. Customer pills have 3 rows: Name+Priority+Key / OBDs·Weight·Units / Area+Tinting
16. Route shown in trip header, Area shown in customer pill
17. Detail panel slides in from right on customer click
18. Board API includes customer.area.name, customerRating, hasTinting via querySnapshot
19. **Warehouse Board:** Split view — 300px left (unassigned) / flex right (pickers)
20. **Warehouse Board:** Pending cards are 320px wide, dispatcher-style pills
21. **Warehouse Board:** Picker states: Picking (expanded) / Available (collapsed one-line)
22. **Warehouse Board:** Done items collapse into chip "✓ X done · Y kg [▾]"
23. **Warehouse Board:** Auto-sort freezes on picker assignment — new arrivals go to Unassigned
24. **Warehouse Board:** Loading Complete is NOT on warehouse board
25. **Warehouse Board:** `pick_assignments` table tracks picker assignment + sequence
26. **Warehouse Board:** Assignment at order level, display grouped by customer on UI
27. Picker lanes always show ALL assignments (unfiltered by delivery type/slot)
28. Picker panel filter (All/L/U/I/C) uses pending orders only, not done
29. Picker role seeded: 10 users (Ramesh K., Sunil P., etc.)
30. pick_assignments.sequence column (not sequence_number)
31. DB columns are camelCase (slotId, originalSlotId) — Prisma fields match without @map
32. **Day Boundary:** Lazy cleanup runs once per day via runDailyCleanupIfNeeded() in lib/day-boundary.ts
33. **Day Boundary:** Cleanup soft-deletes (sets clearedAt) instead of hard-deleting
34. **Day Boundary:** dispatch_plan_orders + pick_assignments both have clearedAt column
35. **Day Boundary:** Today's queries filter by clearedAt IS NULL; history queries show all
36. **Day Boundary:** Orders carry isCarriedOver (bool) + daysOverdue (int) — computed, not stored
37. **Day Boundary:** Overdue badge: amber for 1d, red for 2d+ — "🕐 Overdue Xd"
38. **Day Boundary:** Sort: daysOverdue DESC first, then existing sort
39. **Day Boundary:** Date picker on all three boards, max=today, min=30 days ago
40. **Day Boundary:** History view = read-only: banner shown, all action buttons hidden
41. **Day Boundary:** system_config keys: day_boundary_time, last_cleanup_date, history_days_visible
42. **Day Boundary:** Warehouse slot filtering is CLIENT-SIDE (not sent to API)
43. **Day Boundary:** Carried-over orders get slotId reset to Morning (sortOrder=1) during cleanup
44. **Slot Cascade:** lib/slot-cascade.ts — lazy 5-min check, same pattern as day-boundary
45. **Slot Cascade:** Auto-moves orders from closed slots to next open slot (DB update to slotId)
46. **Slot Cascade:** Only cascades unassigned + draft trip orders — confirmed/loading/dispatched trips protected
47. **Slot Cascade:** originalSlotId set once at first slot assignment, never changed after
48. **Slot Cascade:** Grace period: 15 min (system_config.slot_cascade_grace_minutes)
49. **Slot Cascade:** isNextDay slots (sortOrder=5) never cascade within same day
50. **Slot Cascade:** Closed slots show muted gray styling on both boards (client-side time check)
51. **Slot Cascade:** order_status_logs changeType = 'slot_cascade' for audit trail
52. **Slot Cascade:** changedById = 1 (admin user) for system-generated log entries
53. **Support Board:** History view complete — UI parity with Planning + Warehouse (v35)
54. **Support Board:** Default statusFilter = "pending" (not "all")
55. **Support Board:** Smart default slot — first non-closed slot on load (v35)
56. **Support Board:** Group checkbox for bulk select when groupBy active (v35)
57. **Support Board:** VOL column shows litres, integer, no suffix — from import_raw_summary.volume
58. **Support Board:** No "SH-" prefix on customer IDs anywhere in support table or hold tab
59. **Order Detail Panel:** Shared component at components/shared/order-detail-panel.tsx (v35)
60. **Order Detail Panel:** Generic API at app/api/orders/[id]/detail/route.ts (v35)

---

## 37. Warehouse Board UI Components (UPDATED v33)

(Unchanged from v34 — refer to v34 for full content)

---

## 38-41. [Unchanged from v34]

---

## 42. Known Issues / Pending Fixes (UPDATED v35)

1. **Warehouse header stats mismatch** — header shows different count than unassigned panel in history view
2. **Cleanup Prisma field mapping** — pick_assignments.clearedAt had @map("cleared_at") mismatch, fixed by removing @map. Verify cleanup runs correctly on next day boundary.
3. ~~**Slot cascade (NOT YET BUILT)**~~ — **DONE v33.**
4. **Duplicate pick columns** — orders and order_splits both have camelCase (isPicked, pickedAt, pickedById) AND snake_case (is_picked, picked_at, picked_by_id) columns. Use camelCase ones via Prisma.
5. **Tint manager filter crash** — fixed with `?? []` fallback in tint-manager-content.tsx line 1660.
6. **Slot cascade changedById** — uses hardcoded userId=1 (admin) for system-generated audit logs.
7. ~~**Import not working**~~ — **FIXED v34.**
8. **Slot cascade cascades pending_support orders** — cascade moves ALL orders including those not yet submitted by Support. Consider adding workflowStage filter to cascade eligibility.
9. **Support board default slot on refresh** — intermittent issue, deprioritised.

---

## 43. Queued Features (UPDATED v35)

- ~~**Slot cascade**~~ — **DONE v33**
- ~~**Import debugging**~~ — **DONE v34**
- ~~**OBD date parsing fix**~~ — **DONE v34**
- ~~**Support history view**~~ — **DONE v35**
- ~~**Order detail panel**~~ — **DONE v35** (Support only for now)
- **Cascade badge** — When `originalSlotId !== slotId`, show `⏩ from {originalSlot.name}` badge on order rows. All views (Support, Planning, Warehouse). Data already available — purely UI work.
- **soNumber import mapping** — column exists in DB + Prisma, need to map from SAP XLS column (column header name TBD — check source file)
- **Order detail panel** — wire into Planning board (customer pill click) and Warehouse board (pick card click)
- **Audit history in detail panel** — order_status_logs exists, not yet fetched/rendered
- **CustomerMissingSheet styling** — not matching admin customer form
- **Smart slot assignment** — orders arriving at/after slot cutoff auto-escalate
- **Visual "carried over" indicator for overdue orders in slot tabs**
- **MIS Override Layer** — Admin-only field-level overrides per OBD
- **Barcode/QR label generation** — post-TI submission
- **Customer data enrichment** — remaining area batches

---

## 44. Import Fix Session Log (v34)

(Unchanged from v34 — refer to v34 for full content)

---

## 45. Support Board Updates (NEW v35)

### Grid columns (support-orders-table.tsx)
```
gridTemplateColumns: "32px 1fr 2fr 0.7fr 0.4fr 0.5fr 0.9fr 0.6fr 1fr"
Columns: checkbox | OBD/DATE | CUSTOMER | ROUTE/TYPE | VOL(L) | AGE | DISPATCH | PRIORITY | SLOT
```

### VOL column
- Shows volume in litres from `import_raw_summary.volume`
- Integer display (Math.round) — no decimals, no "L" suffix in table
- Column header: "VOL (L)"
- Fetched via join in `/api/support/orders` — added `importVolume` field to order response

### Customer ID display
- No "SH-" prefix anywhere — raw ID only (e.g. `3256430` not `SH-3256430`)
- Applies to both main table and hold tab

### Status filter
- Default `statusFilter = "pending"` (changed from "all")
- Resets to "all" on slot section change
- Hold section ignores statusFilter entirely (server-side fix — status sub-filter wrapped in `if (section !== "hold")`)

### History view (complete — UI parity with Planning + Warehouse)
- `date` state is selectable with setter; `isHistoryView = date < todayIST`
- Date picker in header: max=today, min=30 days ago
- Read-only banner: "📋 Viewing DD-MM-YYYY — Read Only"
- Hold tab hidden in history view (`{!isHistoryView && ...}`)
- All action buttons hidden (not disabled) in history view
- Slot counts date-scoped: `/api/support/slots` accepts `?date` param
- `isCarriedOver` + `daysOverdue` computed in `/api/support/orders` response
- CarriedOverBadge rendered next to OBD number in each row

### Smart default slot
- On load and date change: picks first non-closed slot (not always index 0)
- Closed = current IST > slotTime + 15min grace AND isNextDay = false
- Falls back to last slot if all closed
- `SlotNavItem` includes `slotTime: string` and `isNextDay: boolean` from API

### Group checkbox
- When groupBy active (SMU/Route/Area/Priority): checkbox in each group header
- Unchecked → select all in group; Checked → deselect all; Indeterminate → partial
- Stays in sync with individual row checkboxes
- Hidden in history view; hidden if group has no selectable orders
- Uses `onToggleGroupSelect` callback from parent

### Hold tab fix
- Was showing all orders due to `statusFilter="pending"` overwriting `dispatchStatus="hold"` filter
- Fixed by wrapping status sub-filter in `if (section !== "hold")` in orders API
- stale orders cleared on section switch via `setOrders([])` before fetch

---

## 46. Order Detail Panel (NEW v35)

### Overview
Shared slide-in panel showing full order detail. Currently wired into Support board only.
Planned: Planning board (customer pill click) + Warehouse board (pick card click).

### Files
- **Component:** `components/shared/order-detail-panel.tsx`
- **API:** `app/api/orders/[id]/detail/route.ts`

### Component props
```ts
{
  orderId: number | null   // null = closed
  onClose: () => void
  isHistoryView?: boolean  // future-proof, no behaviour change yet
}
```

### Behaviour
- Self-contained — fetches own data when `orderId` changes
- Shows skeleton while loading
- Backdrop (bg-black/20) click closes panel
- Width: 600px, fixed right-0 top-0 h-full

### Layout (top to bottom)

**Header:**
- Line 1: OBD number (mono bold) + [×] close
- Line 2: customerName · shipToCustomerId
- Line 3: deliveryType · routeName · areaName
- Line 4: smu · materialType (muted, dot-separated)

**Section 1 — Reference (2-col grid):**
- Row 1: BILL TO (id + name) | SHIP TO (id + name)
- Row 2: OBD DATE (31 Mar · 10:12) | SO NO (— if null)
- Row 3: INV DATE | INV NO

**Section 2 — Quantities (3 stat boxes):**
- units · kg · L (integer, no decimals)

**Section 3 — Line Items:**
- Columns: SKU | DESCRIPTION | QTY | VOL (L) | 🎨
- ≤3 items: show all, no toggle
- >3 items: show first 3 + "＋ N more [Show all ▾]" expand toggle

**Section 4 — Splits (hidden if splits.length === 0):**
- Each row: Split N · status · dispatchStatus
- ≤3: show all; >3: expand toggle

**Section 5 — Workflow State (2-col):**
- Left: WORKFLOW / DISPATCH / SLOT + cascade badge
- Right: PRIORITY / TINTING

**Section 6 — Audit History:**
- "Coming soon" placeholder

### API response shape
```ts
{
  order: { id, obdNumber, workflowStage, dispatchStatus, slotId, slot,
           originalSlotId, originalSlot, priorityLevel, createdAt, smu,
           customer: { customerName, area: { name, primaryRoute, deliveryType } } },
  importSummary: { billToCustomerId, billToCustomerName, shipToCustomerId,
                   shipToCustomerName, obdEmailDate, obdEmailTime, soNumber,
                   invoiceNo, invoiceDate, materialType, totalUnitQty,
                   grossWeight, volume },
  lineItems: [{ skuCode, skuDescription, unitQty, lineWeight, volumeLine, isTinting }],
  splits: [{ id, status, dispatchStatus }],
  querySnapshot: { hasTinting, totalUnitQty, articleTag }
}
```

### Data sources
| Section | Source |
|---|---|
| Header | orders + customer + area + import_raw_summary |
| Reference | import_raw_summary (joined on obdNumber) |
| Quantities | import_raw_summary (grossWeight, volume, totalUnitQty) |
| Line items | import_enriched_line_items → import_raw_line_items → sku_master |
| Splits | order_splits |
| Workflow | orders + slot_master |

### soNumber status
- Column exists in DB (`ALTER TABLE import_raw_summary ADD COLUMN "soNumber" TEXT`)
- Added to Prisma schema manually: `soNumber String?` in ImportRawSummary model
- Import mapping NOT YET DONE — shows "—" for all current orders
- Will auto-populate once import route maps the SAP XLS column

---

## 47. Volume Units Reference (NEW v35)

All volume in this system is in **LITRES (L)**:
- `import_raw_summary.volume` — total order volume in L
- `import_enriched_line_items.volumeLine` — per-line volume in L
- `import_obd_query_summary` — volume in L
- Display: integer (Math.round), no decimals
- Label: "L" or "VOL (L)" — never "m³"

---

*Version: Phase 4 Support UI · Schema v21 · Context v35 · March 2026*
