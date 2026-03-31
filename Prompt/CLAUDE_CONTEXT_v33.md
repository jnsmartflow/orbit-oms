# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v33.md fully before doing anything else."
# Version: Phase 4 Slot Cascade · Schema v20 · Context v33 · March 2026

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

## 3. Database — 52 tables, 5 groups (Schema v20)

Schema v20 = Schema v19 + originalSlotId on orders + sortOrder on slot_master + slot cascade system_config keys.

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
import_raw_line_items      — One row per line item. 10 columns including article + articleTag.
                             NOTE v24: lineId is now row index (1,2,3...) not source file line_id.
                             NOTE v24: batchCode is always NULL — removed from source data.
import_enriched_line_items — Lines enriched with sku_master join.
import_obd_query_summary   — Per-OBD totals: weight, qty, volume, hasTinting, totalArticle, articleTag.
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
                             NOTE: Assignment is at ORDER level (customer's OBDs grouped together on warehouse board,
                             but assignment FK is per order since that's the pick unit)
pick_lists                 — NEW v17. One pick list per plan.
                             planId FK (CASCADE), pickerId FK, status, assignedAt/By, startedAt, completedAt, verifiedAt/By, notes
pick_list_items            — NEW v17. Line items to pick.
                             pickListId FK (CASCADE), splitLineItemId FK, orderId FK, skuCode, skuDescription,
                             qtyRequired, qtyPicked, isPicked, isVerified, pickedAt, verifiedAt, notes
dispatch_change_queue      — NEW v17. Notifications when support holds/cancels order in a plan.
                             orderId FK, planId FK (SET NULL), changeType, previousValue, newValue,
                             changedById, isAcknowledged, acknowledgedAt/By, notes

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

### 17.1 Dispatcher Planning Board — DESIGN LOCKED v28

**Page:** `/planning`
**Role:** Dispatcher (primary), Admin
**Purpose:** Create trips, assign orders to vehicles, confirm plans

#### Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ HEADER: Planning Board · Date · Refresh · Stats (Customers, OBDs, Trips)        │
├─────────────────────────────────────────────────────────────────────────────────┤
│ DELIVERY TYPE TABS: Local | Upcountry | IGT | Cross (underline style, not pills)│
├─────────────────────────────────────────────────────────────────────────────────┤
│ SLOT BAR: Horizontal slot cards (only urgent slot gets red, others neutral)     │
│ NEW v33: Closed slots show muted gray + "Closed" label (time-based auto-close) │
├────────────────────────┬────────────────────────────────────────────────────────┤
│ LEFT (300px)           │ RIGHT (flex)                                           │
│ UNASSIGNED SECTION     │ TRIPS SECTION                                          │
│                        │                                                        │
│ [Auto Draft All]       │ Trip 1 · Draft · Route · Vehicle                       │
│ (prominent indigo)     │   [Customer pills - expanded]                          │
│                        │   [Confirm button]                                     │
│ Group: [None][Route]   │                                                        │
│        [Area][Priority]│ Trip 2 · Draft · Route · Vehicle                       │
│                        │   [Customer pills - expanded]                          │
│ ┌─ ROUTE HEADER ─────┐ │                                                        │
│ │ Customer cards     │ │ Trip 3 · Confirmed · Route (collapsed)                 │
│ │ (checkbox select)  │ │                                                        │
│ └────────────────────┘ │ Trip 4 · All Picked · Route [Dispatch button]          │
│                        │                                                        │
│ [2 selected · 1,593kg] │ Trip 5 · Empty (dashed border)                         │
│ [+ Create Trip][Add▾]  │                                                        │
└────────────────────────┴────────────────────────────────────────────────────────┘
```

#### Design Principles — LOCKED

| Principle | Implementation |
|---|---|
| **Calm, neutral base** | Gray/white everywhere. Color = exception only |
| **Color only for action** | Red = urgent slot only. Amber dot = pick pending. Green = Dispatch button only |
| **No visual noise** | No colored borders on trips. No colored badges for status |
| **Progressive disclosure** | Draft trips expanded, Confirmed trips collapsed |

#### Slot Bar

| State | Style |
|---|---|
| **Urgent** (< 30 min) | Red border + red-50 bg + red text |
| **Normal** | White bg, gray border, gray text |
| **Closed** (NEW v33) | Gray-50 bg, gray-100 border, opacity-50, "Closed" label |
| **Done** | Gray-50 bg, muted, checkmark |

#### Unassigned Section (Left Panel)

**Top to bottom:**
1. **Header:** "Unassigned" + count + total kg
2. **Auto Draft button:** Indigo, prominent, with description "Groups by route · Max 1,500 kg per trip"
3. **Grouping filters:** Toggle buttons: None / Route / Area / Priority
4. **Customer list:** Grouped under headers when grouping selected
5. **Selection footer:** "X selected · Y kg" + Create Trip + Add to Trip buttons

**Customer Card (in Unassigned):**
```
┌─────────────────────────────────────┐
│ ● ★ Customer Name            [✓]   │  ← Priority dot + Key star + checkbox
│ Area · X OBDs                  Y kg│
└─────────────────────────────────────┘
```

#### Trips Section (Right Panel)

**Trip Card — Draft (expanded):**
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 🚚 Trip 1   Draft  ·  [Route Badge]                         1,280 kg  3 cust  ▼│
│    No vehicle / [Vehicle dropdown]                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐     │
│  │ ● Customer Name  ★ ◉│  │ Customer Name    ✓ │  │ ● Customer Name   ◉│     │
│  │ 2 OBDs · 450kg · 24u│  │ 1 OBD · 312kg · 8u │  │ 2 OBDs · 518kg ·32u│     │
│  │ Khatodara  🎨Tinting│  │ Kapodara           │  │ Nana Varachha      │     │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  1 of 3 picked                                                    [Confirm]    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Trip Card — Confirmed (collapsed):**
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 🚚 Trip 3   Confirmed  ·  [Route Badge]                     1,450 kg  3/4 ◉  ▶│
│    GJ-05-XX-1234 · Tempo                                                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Trip Card — All Picked (ready to dispatch):**
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 🚚 Trip 5   All Picked  ·  [Route Badge]            4,500 kg  8 cust [Dispatch]│
│    GJ-05-YY-5678 · Full Truck                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Customer Pill (inside Trip) — 3 rows

| Row | Content |
|---|---|
| **1** | Priority dot + Name + Key star (★) + Pick status (◉ amber = pending, ✓ gray = done) |
| **2** | OBD count · Weight (bold) · Unit count |
| **3** | Area + Tinting badge (🎨 purple) if applicable |

**Pill states:**
- **Pending pick:** White bg, gray border, amber dot on right
- **Picked:** Gray-50 bg, gray-100 border, gray checkmark on right

#### Visual Indicators

| Indicator | Meaning |
|---|---|
| `●` Red dot | P1 priority |
| `●` Amber dot | P2 priority |
| `●` Gray dot | P3 priority |
| `★` Gold star | Key customer (rating = A) |
| `◉` Amber dot (right side) | Pick pending |
| `✓` Gray checkmark (right) | Picked |
| `🎨 Tinting` Purple badge | Has tinting items |
| `[Route Badge]` Blue | Route name in trip header |

#### Actions by Role

| Action | Dispatcher | Floor Supervisor | Admin |
|---|---|---|---|
| Select customers | ✓ | — | ✓ |
| Create Trip | ✓ | — | ✓ |
| Add to Trip | ✓ | — | ✓ |
| Remove from Trip | ✓ | — | ✓ |
| Assign Vehicle | ✓ | — | ✓ |
| Confirm Trip | ✓ | — | ✓ |
| Auto Draft | ✓ | — | ✓ |
| Mark Picked | — | ✓ | ✓ |
| Loading Complete | — | ✓ | ✓ |

#### Detail Panel (slide-in from right)

Opens when clicking a customer pill. Shows:
- Customer info (name, address, priority, key status)
- Stats (kg, OBDs, units)
- Tinting alert if applicable
- OBD list with individual pick status
- "Remove from Trip" action

### 17.2 Floor Supervisor Warehouse Board — DESIGN LOCKED v30

(Unchanged from v32 — refer to v32 for full content)

---

## 18-32. [Unchanged from v27]

(Sections 18-32 remain unchanged — refer to v27 for full content)

---

## 33. Planning Board UI Components (UPDATED v33)

Page: /planning
Roles: Dispatcher, Floor Supervisor, Admin

### Implementation Status: COMPLETE

Components built (10 files in `components/planning/`):

| Component | Purpose |
|---|---|
| planning-page.tsx | Main orchestrator — types, state, API calls, Auto Draft logic |
| planning-header.tsx | Header: title, date picker, refresh, stats |
| delivery-tabs.tsx | Underline-style tabs: Local/Upcountry/IGT/Cross with counts |
| slot-bar.tsx | Horizontal slot cards — urgent gets red, done gets gray, closed gets muted (NEW v33) |
| unassigned-panel.tsx | Left 300px panel: Auto Draft (indigo), grouping filters, customer list, selection footer |
| customer-card.tsx | Unassigned customer card: priority dot + star + name + checkbox + area + weight |
| trips-panel.tsx | Right panel listing all trips |
| trip-card.tsx | Collapsible trip card: header with route badge + vehicle + weight, customer pills, confirm/update buttons |
| customer-pill.tsx | 3-row pill: priority+name+star+pick status, OBDs+weight+units, area+tinting badge |
| detail-panel.tsx | Slide-in right panel: customer info, stats grid, tinting alert, OBD detail, remove from trip |

### Design matches mockup v8:
- Calm neutral gray/white base, color only for action items
- Two-column layout: Left (300px unassigned) + Right (trips)
- Auto Draft prominent indigo button with description
- Grouping filters: None/Route/Area/Priority toggle buttons
- Draft trips expanded, Confirmed collapsed
- Customer pills with 3 rows, tinting badge, pick status
- Route badge in trip header, area in customer pill

### API routes (v27+v29+v32+v33):

- `GET /api/planning/board` — orders with dispatchStatus='dispatch', includes customer.area, customerRating. Accepts ?date param. Returns isCarriedOver + daysOverdue per order. Plans include carried-over (non-dispatched from before today). clearedAt filtering: today=NULL only, history=show all. **v33:** Now includes slotTime + isNextDay per slot for closed-slot detection. Calls runSlotCascadeIfNeeded() for today's date.
- `GET /api/planning/vehicles` — active vehicles, optional deliveryType filter
- `POST /api/planning/plans` — create draft plan (reuses empty trips)
- `POST /api/planning/plans/[id]/add-orders` — add orders (validates editable status)
- `POST /api/planning/plans/[id]/remove-order` — remove order (validates editable status)
- `POST /api/planning/plans/[id]/assign-vehicle` — assign vehicle (validates editable status)
- `POST /api/planning/orders/[id]/mark-picked` — toggle isPicked
- `POST /api/planning/plans/[id]/loading-complete` — dispatch all

---

## 34. Dispatcher Board Business Rules (UPDATED v29)

### Vehicle assignment
- Draft trips: Vehicle dropdown + "Confirm" button (assigns vehicle + sets status to confirmed)
- Confirmed trips: Vehicle dropdown + "Update" button (saves vehicle change only)
- Loading/Dispatched trips: No editing allowed (dropdown hidden)

### Editable until loading
| Action | draft | confirmed | loading | dispatched |
|---|---|---|---|---|
| Change vehicle | ✓ | ✓ | ✗ | ✗ |
| Add order | ✓ | ✓ | ✗ | ✗ |
| Remove order | ✓ | ✓ | ✗ | ✗ |

API routes validate status — return 400 if plan is loading or dispatched.

### Trip number management
- Trip numbers are sequential per day (Trip 1, 2, 3...)
- Empty trips are kept in DB (never deleted)
- Trip numbers never renumber (no gaps filled by renumbering)
- When creating new trip: reuse first empty trip if exists, else create with next number

### Reuse empty trips logic
1. User clicks "Create Trip" or "Auto Draft"
2. API checks: any empty trips for this date?
3. If yes → reuse that trip (reset to draft, assign orders)
4. If no → create new trip with next sequential number

This prevents orphan empty trips and keeps trip numbers sequential.

---

## 35. Schema Correction (NEW v28)

**IMPORTANT:** Context v27 incorrectly stated `dispatch_plan_splits` exists. Live DB has `dispatch_plan_orders`.

| v27 (incorrect) | v28 (correct) |
|---|---|
| `dispatch_plan_splits` with FK to `order_splits` | `dispatch_plan_orders` with FK to `orders` |
| Split-level planning | Order-level planning |
| Splits can go on different vehicles | All splits of one OBD go to same vehicle |

This is correct for business logic — customer receives all their items together.

---

## 36. Session Start Checklist (UPDATED v33)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v20** — includes originalSlotId on orders, sortOrder on slot_master, cascade config keys
3. **CORRECTION v28:** Planning is at ORDER level, not split level
4. Live DB has `dispatch_plan_orders` (FK to orders), NOT `dispatch_plan_splits`
5. All splits of one OBD go to same vehicle — no splitting across plans
6. `order_splits.dispatchStatus` still drives visibility on planning board
7. `orders.isPicked` and `order_splits.isPicked` both exist for picking
8. Dispatcher Planning Board is **COMPLETE** — matches mockup v8. See Section 17.1 + 33.
9. Warehouse Board design is **LOCKED at v8** — See Section 17.2.
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
38. **Day Boundary:** Sort: daysOverdue DESC first, then existing sort (slot→vehicle→priority→key→tinting)
39. **Day Boundary:** Date picker on both boards, max=today, min=30 days ago
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

---

## 37. Warehouse Board UI Components (UPDATED v33)

Page: /warehouse
Roles: Floor Supervisor, Admin

### Implementation Status: API + UI COMPLETE — slot cascade integrated v33

### Components built (10 files in `components/warehouse/`):

| Component | Purpose |
|---|---|
| warehouse-page.tsx | Main orchestrator — types, state, API calls, auto-sort logic, 30s auto-refresh |
| warehouse-header.tsx | Header: title, date, refresh, stats (Unassigned/Picking/Picked/OBDs) |
| warehouse-delivery-tabs.tsx | Delivery type tabs with counts |
| warehouse-slot-tabs.tsx | Underline-style slot tabs with pick progress X/Y. **v33:** Closed slot detection + muted styling |
| unassigned-panel.tsx | Left 300px panel: sorted cards, checkbox select, assign footer |
| unassigned-card.tsx | Customer card: checkbox, priority dot, star, OBDs, weight, vehicle tag, WHY hint, expandable OBDs |
| pickers-panel.tsx | Right panel: picker lanes container + delivery type filter (All/L/U/I/C) |
| picker-lane.tsx | Expandable lane: header row with DT breakdown chips + pending cards + done chip |
| pick-card.tsx | 320px pending card: sequence, customer, OBDs, weight, area, vehicle, expand for OBD rows + Pick button |
| done-chip.tsx | Collapsed done summary: "✓ X done · Y kg [▾]", expand for faded done cards |

### API routes built:

| Route | Method | Purpose |
|---|---|---|
| /api/warehouse/board | GET | Orders for warehouse: unassigned (filtered by DT, client-side slot filter) + assigned (unfiltered), grouped by customer. Accepts ?date param. **v33:** Includes slotTime + isNextDay per slot. Calls runSlotCascadeIfNeeded() for today. |
| /api/warehouse/pickers | GET | Picker-role users with assignment counts and pick stats for today |
| /api/warehouse/assign | POST | Assign orders to picker, creates pick_assignments with sequence numbers |
| /api/planning/orders/[id]/mark-picked | POST | Extended — syncs orders.isPicked + all splits + pick_assignments |

### Picker panel scoping
- Picker lanes are NEVER filtered by delivery type or slot tabs
- Left panel (unassigned) filters by delivery type (API) + slot (client-side)
- **IMPORTANT v32:** Slot filtering is CLIENT-SIDE only — API does not receive slotId param
- Right panel (pickers) always shows ALL assignments for today

---

## 38. Warehouse Board Business Rules (NEW v30)

(Unchanged from v32 — refer to v32 for full content)

---

## 39. Schema v18 Changes (NEW v30)

(Unchanged from v32 — refer to v32 for full content)

---

## 40. Day Boundary System (UPDATED v33)

### Overview

The day boundary system handles what happens when orders span multiple days. It consists of:
1. **Lazy cleanup** — soft-deletes stale assignments on first board load of the day
2. **Carried-over orders** — orders from before today shown with overdue badges
3. **Carried-over slot reset** — all carried-over orders get slotId set to Morning (NEW v33)
4. **History view** — read-only past date view showing exact state of that day
5. **Sort priority** — overdue orders always sort above today's orders

### Files involved

| File | Purpose |
|---|---|
| lib/day-boundary.ts | runDailyCleanupIfNeeded() — lazy daily cleanup + carried-over slot reset (v33) |
| lib/slot-cascade.ts | runSlotCascadeIfNeeded() — lazy 5-min cascade check (NEW v33) |
| components/shared/carried-over-badge.tsx | Overdue badge: amber 1d, red 2d+ |
| Both board APIs | Date param, isCarriedOver/daysOverdue enrichment, clearedAt filtering, cascade call |
| Both page components | selectedDate state, isHistoryView, read-only banner |
| All card/pill components | isHistoryView prop to hide action buttons |

### Lazy cleanup mechanism

1. First API call of the day triggers cleanup (checks system_config.last_cleanup_date)
2. **Warehouse:** pick_assignments WHERE status='assigned' AND assignedAt < today → SET clearedAt = NOW()
3. **Dispatcher:** dispatch_plan_orders for draft AND confirmed/loading plans from before today → SET clearedAt = NOW()
4. **Slot reset (NEW v33):** Carried-over orders (obdEmailDate < today, not dispatched/cancelled) → SET slotId = Morning slot
5. Updates last_cleanup_date to today
6. Wrapped in try/catch — failures don't break the board
7. Only runs for today's view, not history view

### Soft delete (clearedAt)

| Table | clearedAt = NULL | clearedAt = set |
|---|---|---|
| dispatch_plan_orders | Active — shows in today's trips | Cleared — hidden from today, visible in history |
| pick_assignments | Active — shows in picker lanes | Cleared — hidden from today, visible in history |

**Today's queries:** WHERE clearedAt IS NULL
**History queries:** no clearedAt filter (show everything)

### Overdue badge

| Days | Style | Text |
|---|---|---|
| 0 | Hidden | — |
| 1 | amber (text-amber-600 bg-amber-50) | 🕐 Overdue 1d |
| 2+ | red (text-red-600 bg-red-50) | 🕐 Overdue Xd |

Badge component: `components/shared/carried-over-badge.tsx`
Wired into: customer-card, customer-pill, unassigned-card, pick-card

### History view (read-only)

- Date picker in header: max=today, min=30 days ago
- When selectedDate < today: isHistoryView = true
- Banner: "📋 Viewing [date] — Read Only" (bg-gray-100)
- All action buttons hidden (not disabled): checkboxes, Auto Draft, Create Trip, Confirm, Dispatch, Assign, Pick
- Plans show their orders as they were (including cleared dispatch_plan_orders)
- Picker lanes show assignments as they were (including cleared pick_assignments)

### Sort hierarchy (unassigned panels)

1. **daysOverdue** descending (oldest first — 3d > 2d > 1d > 0)
2. Slot urgency
3. Vehicle assigned
4. Customer priority (P1 > P2 > P3)
5. Key customer boost (★ rating A)
6. Tinting ready > tinting pending

### Rollover rules (what happens each morning)

- **Unassigned orders from yesterday** → appear in today's Unassigned with overdue badge, slotId reset to Morning
- **Draft trip orders from yesterday** → soft-cleared from trip, appear in today's Unassigned, slotId reset to Morning
- **Confirmed/loading trip orders from yesterday (not dispatched)** → soft-cleared, appear in Unassigned, slotId reset to Morning
- **Dispatched orders** → done, not shown in today's view
- **Pick assignments (status='assigned') from yesterday** → soft-cleared, orders go to Unassigned
- **Pick assignments (status='picked') from yesterday** → kept for history

### System config keys

| Key | Default | Purpose |
|---|---|---|
| day_boundary_time | 00:00 | When rollover triggers (HH:MM, 24h) — currently unused, cleanup is lazy |
| last_cleanup_date | (today) | Prevents repeated cleanup — updated after each run |
| history_days_visible | 30 | Date picker min range |
| slot_cascade_grace_minutes | 15 | Minutes after slot time before cascade triggers (NEW v33) |
| last_cascade_check | (timestamp) | Prevents repeated cascade — updated after each run (NEW v33) |

---

## 41. Slot Cascade System (NEW v33)

### Overview

When a slot's cutoff time passes, pending orders automatically move to the next open slot. This prevents orders from sitting in expired slots forever.

### Mechanism — Lazy server-side check

File: `lib/slot-cascade.ts`
Export: `runSlotCascadeIfNeeded(today: string)`

1. **Throttle:** Reads `system_config.last_cascade_check` — skips if checked within 5 minutes
2. **Load slots:** All slot_master rows ordered by sortOrder ASC
3. **Grace period:** Reads `system_config.slot_cascade_grace_minutes` (default 15)
4. **Closed slots:** Slots where current IST > slotTime + grace. isNextDay slots skipped.
5. **Target slot:** First still-open slot. If none remain today → Next Day Morning (sortOrder=5)
6. **Protection:** Orders on confirmed/loading/dispatched trips are excluded from cascade
7. **Cascade:** Eligible orders get `slotId` updated to target slot. `originalSlotId` never touched.
8. **Audit:** `order_status_logs` entries with changeType = 'slot_cascade'
9. **Update:** `last_cascade_check` set to NOW()
10. **Safety:** Try/catch wraps everything — failures never crash the board API

### Cascade eligibility

| Order state | Cascades? | Reason |
|---|---|---|
| Unassigned (no trip) | ✓ | Nobody committed |
| In draft trip | ✓ | Still planning |
| In confirmed trip | ✗ | Vehicle committed |
| In loading trip | ✗ | Physically loading |
| Dispatched | ✗ | Done |
| Hold / Cancelled | ✗ | Not active |

### Cascade chain (within one day)

```
Morning (10:30+15) → Afternoon (12:30+15) → Evening (15:30+15) → Night (18:00+15) → Next Day Morning
```

After Night closes, no more cascading today — orders sit in Night until day boundary runs next morning and resets them to Morning.

### originalSlotId

- Set ONCE when slotId is first assigned (in support assign-slot API)
- Never changed by cascade or day boundary
- Preserves where the order was originally placed for reporting/MIS
- DB column: `originalSlotId` (camelCase, no @map)

### Slot closed detection (client-side UI)

Both `slot-bar.tsx` and `warehouse-slot-tabs.tsx` detect closed slots:
- Current IST > slotTime + 15 min grace → slot shows as "Closed"
- isNextDay slots: never show as closed on today's board
- History view: no slots shown as closed
- Warehouse auto-selects first non-closed slot tab

### Integration with board APIs

Both `GET /api/planning/board` and `GET /api/warehouse/board`:
1. Call `runDailyCleanupIfNeeded(today)` — once per day
2. Call `runSlotCascadeIfNeeded(today)` — every 5 min
3. Return fresh data with updated slotIds

Only runs for today's date — history view skips both calls.

---

## 42. Known Issues / Pending Fixes (UPDATED v33)

1. **Warehouse header stats mismatch** — header shows different count than unassigned panel in history view
2. **Cleanup Prisma field mapping** — pick_assignments.clearedAt had @map("cleared_at") mismatch, fixed by removing @map. Verify cleanup runs correctly on next day boundary.
3. ~~**Slot cascade (NOT YET BUILT)**~~ — **DONE v33.** Built and wired into both boards.
4. **Duplicate pick columns** — orders and order_splits both have camelCase (isPicked, pickedAt, pickedById) AND snake_case (is_picked, picked_at, picked_by_id) columns. Use camelCase ones via Prisma.
5. **Tint manager filter crash** — `orders.filter()` crashed when orders undefined. Fixed with `?? []` fallback in tint-manager-content.tsx line 1660.
6. **Slot cascade changedById** — uses hardcoded userId=1 (admin) for system-generated audit logs. Consider creating a dedicated "system" user if audit distinction needed.
7. **Import not working** — manual and auto import both have issues. Needs investigation next session.

---

## 43. Queued Features (UPDATED v33)

- ~~**Slot cascade**~~ — **DONE v33**
- **Import debugging** — manual and auto import both broken, needs root cause analysis
- **OBD date parsing fix** — source files use DD-MM-YYYY format, obdEmailDate is null on real orders
- **CustomerMissingSheet styling** — not matching admin customer form
- **Smart slot assignment** — orders arriving at/after slot cutoff auto-escalate
- **Visual "carried over" indicator for overdue orders in slot tabs**
- **MIS Override Layer** — Admin-only field-level overrides per OBD
- **Barcode/QR label generation** — post-TI submission
- **Customer data enrichment** — remaining area batches

---

*Version: Phase 4 Slot Cascade · Schema v20 · Context v33 · March 2026*
