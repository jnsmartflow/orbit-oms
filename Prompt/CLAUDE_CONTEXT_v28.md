# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v28.md fully before doing anything else."
# Version: Phase 4 Dispatcher Board Design Locked · Schema v17 · Context v28 · March 2026

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

## 3. Database — 51 tables, 5 groups (Schema v17)

Schema v17 = Schema v16 + Phase 4 dispatch/warehouse tables fully defined.

### Group 1: Setup / Master tables (23 tables — Phase 1 complete)

```
-- Config / Status
status_master              — UNIFIED status table. All workflow statuses.
                             Domains: dispatch | tinting | pick_list | import | workflow | priority
system_config              — Key-value store. Always read from DB — never hardcode.
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
delivery_type_slot_config  — Per-delivery-type slot rules (time_based or default windows).
route_master               — Named routes: Varacha, Bharuch, Adajan, Surat City...
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
                             NEW v27: isPicked (bool), pickedAt (timestamp), pickedById (FK users)
order_splits               — EXPANDED v13. One row per tint batch/split.
                             dispatchStatus on splits drives the planning board.
                             NEW v27: isPicked (bool), pickedAt (timestamp), pickedById (FK users) — for warehouse picking
split_line_items           — One row per line assigned to a split.
split_status_logs          — INSERT-ONLY. Audit trail per split.
tint_assignments           — One row per whole-OBD assignment (non-split flow).
tint_logs                  — INSERT-ONLY. Immutable. orderId + optional splitId.
order_status_logs          — INSERT-ONLY. Immutable. Per-order audit trail.
tinter_issue_entries       — INSERT-ONLY. One row per base batch TI entry.
```

### Group 4: Dispatch + Warehouse (6 tables — Schema v17 complete)

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
                             Unique: (planId, orderId)
                             CORRECTION v28: Live DB has dispatch_plan_orders (order-level), NOT dispatch_plan_splits.
                             All splits of one OBD go to same vehicle — cannot split across plans.
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

## 17. Phase 4 Screen Designs (UPDATED v28)

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

### 17.2 Floor Supervisor Board — NOT YET DESIGNED

Separate screen for Floor Supervisor focused on:
- What needs to be picked
- Pick status tracking at OBD level
- Tinting status visibility
- Loading Complete action

Design deferred to next session.

---

## 18-32. [Unchanged from v27]

(Sections 18-32 remain unchanged — refer to v27 for full content)

---

## 33. Planning Board UI Components (UPDATED v28)

Page: /planning
Roles: Dispatcher, Floor Supervisor, Admin

**IMPORTANT v28:** Current implementation (v27) does NOT match locked design. Rebuild required.

### Current state (v27 — needs rebuild)

Components exist but with old design:
- `planning-board-content.tsx` — fetches data, manages state
- `delivery-type-section.tsx` — colored sections (wrong)
- `slot-section.tsx` — slot cards (wrong design)
- `route-section.tsx` — route grouping (wrong)
- `plan-card.tsx` — trip cards (wrong design)
- `unassigned-group.tsx` — unassigned orders (wrong layout)
- `order-row.tsx` — order display (wrong design)

### Target state (v28 — to build)

Match HTML mockup v8 exactly:
- Calm, neutral design
- Left panel: Unassigned with Auto Draft prominent + grouping filters
- Right panel: Trips with collapsible cards
- Customer pills with 3-row layout
- Route in trip header, Area in customer pill
- Tinting indicator on pills

### API routes (v27 — keep as-is)

All API routes from v27 remain valid:
- `GET /api/planning/board` — orders with dispatchStatus='dispatch'
- `GET /api/planning/vehicles` — active vehicles
- `POST /api/planning/plans` — create draft plan
- `POST /api/planning/plans/[id]/add-orders` — add orders
- `POST /api/planning/plans/[id]/remove-order` — remove order
- `POST /api/planning/plans/[id]/assign-vehicle` — assign vehicle
- `POST /api/planning/orders/[id]/mark-picked` — toggle isPicked
- `POST /api/planning/plans/[id]/loading-complete` — dispatch all

---

## 34. Dispatcher Board Implementation Plan (NEW v28)

### Step 1: Update board API response

Add missing fields to `/api/planning/board`:
- `customer.area.name` (for pill row 3)
- `customer.area.route.name` (for trip header)
- `order.hasTinting` or derive from splits
- `customer.customerRating` (for Key star)

### Step 2: Rebuild components

Replace all planning components with new design:

**New component structure:**
```
/components/planning/
  planning-page.tsx          — Main page wrapper
  planning-header.tsx        — Header with date, refresh, stats
  delivery-tabs.tsx          — Underline tabs for delivery type
  slot-bar.tsx               — Horizontal slot cards
  unassigned-panel.tsx       — Left panel (Auto Draft + filters + customers)
  customer-card.tsx          — Customer card for unassigned list
  trips-panel.tsx            — Right panel (trip list)
  trip-card.tsx              — Collapsible trip card
  customer-pill.tsx          — 3-row customer pill inside trip
  detail-panel.tsx           — Slide-in panel for customer details
```

### Step 3: State management

```typescript
// Page state
const [selectedDate, setSelectedDate] = useState<Date>(new Date())
const [deliveryType, setDeliveryType] = useState<string>('Local')
const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
const [grouping, setGrouping] = useState<'none' | 'route' | 'area' | 'priority'>('route')
const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set())
const [detailPanelOrder, setDetailPanelOrder] = useState<Order | null>(null)
```

### Step 4: Role-based rendering

```typescript
const role = session?.user?.role
const canManagePlan = ['dispatcher', 'admin'].includes(role)
const canPick = ['floor_supervisor', 'admin'].includes(role)
```

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

## 36. Session Start Checklist (UPDATED v28)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v17** — Phase 4 dispatch tables defined
3. **CORRECTION v28:** Planning is at ORDER level, not split level
4. Live DB has `dispatch_plan_orders` (FK to orders), NOT `dispatch_plan_splits`
5. All splits of one OBD go to same vehicle — no splitting across plans
6. `order_splits.dispatchStatus` still drives visibility on planning board
7. `orders.isPicked` and `order_splits.isPicked` both exist for picking
8. Dispatcher Planning Board design is **LOCKED** — see Section 17.1
9. Floor Supervisor Board design is **NOT YET DONE** — separate session
10. Current planning components (v27) need **FULL REBUILD** to match v8 mockup
11. API routes from v27 are valid — no changes needed
12. Calm, neutral design — color only for urgent slot, pending picks, dispatch button
13. Customer pills have 3 rows: Name+Priority+Key / OBDs·Weight·Units / Area+Tinting
14. Route shown in trip header, Area shown in customer pill
15. Grouping options in Unassigned: None / Route / Area / Priority
16. Auto Draft is prominent (indigo button at top of Unassigned panel)
17. Draft trips expanded, Confirmed trips collapsed by default
18. Detail panel slides in from right on customer click

---

*Version: Phase 4 Dispatcher Board Design Locked · Schema v17 · Context v28 · March 2026*
