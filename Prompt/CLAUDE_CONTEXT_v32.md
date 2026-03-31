# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v32.md fully before doing anything else."
# Version: Phase 4 Day Boundary · Schema v19 · Context v32 · March 2026

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

## 3. Database — 52 tables, 5 groups (Schema v19)

Schema v19 = Schema v18 + clearedAt on dispatch_plan_orders and pick_assignments + system_config keys for day boundary.

### Group 1: Setup / Master tables (23 tables — Phase 1 complete)

```
-- Config / Status
status_master              — UNIFIED status table. All workflow statuses.
                             Domains: dispatch | tinting | pick_list | import | workflow | priority
system_config              — Key-value store. Always read from DB — never hardcode.
                             NEW v19 keys: day_boundary_time ('00:00'), last_cleanup_date, history_days_visible ('30')
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

### 17.2 Floor Supervisor Warehouse Board — DESIGN LOCKED v30

**Page:** `/warehouse`
**Role:** Floor Supervisor (primary), Admin
**Purpose:** Pick coordination — assign pickers, track pick status, mark picked
**Mockup:** `docs/mockups/warehouse-board-supervisor-v8.html`

#### Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ HEADER: Warehouse Board · Date · Refresh · Stats (Unassigned, Picking, Picked)  │
├─────────────────────────────────────────────────────────────────────────────────┤
│ DELIVERY TYPE TABS: Local | Upcountry | IGT | Cross (same as dispatcher)       │
├─────────────────────────────────────────────────────────────────────────────────┤
│ SLOT TABS: Morning (12min 3/6) | Afternoon (0/4) | Evening | Night | Next Day  │
│ (underline tabs, NOT cards — one active at a time, shows pick progress X/Y)    │
├─────────────────────┬───────────────────────────────────────────────────────────┤
│ LEFT (300px)        │ RIGHT (flex)                                              │
│ UNASSIGNED          │ PICKERS                                                   │
│                     │                                                           │
│ Auto-sorted:        │ ┌─ Ramesh K. ████░░ 1/3  1,262 kg ──────────────────┐   │
│ Slot→Vehicle→Prio   │ │  ┌──────────┐  ┌──────────┐   ✓ 1 done · 234kg  │   │
│                     │ │  │①Raj Hdw  │  │②Patel Hw │                       │   │
│ ┌─ Customer ──────┐ │ │  │820kg 2OBD│  │312kg 1OBD│                       │   │
│ │ [✓] ● ★ Name   │ │ │  │🚚 Trip 1 │  │🚚 Trip 3 │                       │   │
│ │ Area · 2 OBDs   │ │ └──────────────────────────────────────────────────┘   │
│ │ 450 kg          │ │                                                           │
│ │ 🚚Trip 3 🎨1   │ │ ┌─ Sunil P. ░░░░░░ 0/2  750 kg ────────────────────┐   │
│ │ Slot·Veh·P1★    │ │ │  ┌──────────┐  ┌──────────┐                       │   │
│ └─────────────────┘ │ │  │①ABC Paint│  │②XYZ Trade│                       │   │
│                     │ └──────────────────────────────────────────────────┘   │
│ ┌─ Customer ──────┐ │                                                           │
│ │ [ ] ● Name      │ │ ┌─ Deepak V. ████████░ 3/4  1,100 kg ──────────────┐   │
│ │ Area · 1 OBD    │ │ │  ┌──────────┐   ✓ 3 done · 850kg [▾]             │   │
│ │ 450 kg          │ │ │  │④Nayan Pnt│                                      │   │
│ │ 🚚Trip 1 🎨Done │ │ └──────────────────────────────────────────────────┘   │
│ │ Vehicle·P2      │ │                                                           │
│ └─────────────────┘ │ AVAILABLE                                                 │
│                     │ Vikram S.  3 done today         [Available]               │
│ ...more cards...    │ Jayesh M.                       [Available]               │
│                     │ Bharat T.                       [Available]               │
│ ┌─────────────────┐ │                                                           │
│ │ 0 selected      │ │                                                           │
│ │ [Picker ▾][Asgn]│ │                                                           │
│ └─────────────────┘ │                                                           │
└─────────────────────┴───────────────────────────────────────────────────────────┘
```

#### Design Principles — Same as Dispatcher

| Principle | Implementation |
|---|---|
| **Calm, neutral base** | Gray/white everywhere. Color = exception only |
| **Color only for action** | Red = urgent slot. Amber = unpicked. Green = available picker |
| **Progressive disclosure** | Picking lanes expanded, Available lanes collapsed |
| **Card style** | Matches dispatcher pill sizing (320px wide) |

#### Split View — 300px / flex

| Panel | Width | Content |
|---|---|---|
| **Left** | 300px fixed | Unassigned orders, auto-sorted, checkbox select, picker dropdown + Assign |
| **Right** | flex-1 | Picker lanes (Picking expanded, Available collapsed) |

#### Slot Tabs (NOT slot bar cards)

Underline-style tabs (one active at a time), each showing:
- Slot name
- Urgent badge (red) if < 30 min
- Pick progress: "3/6" (picked / total)

Only orders for the active slot shown below.

#### Left Panel — Unassigned

**Top to bottom:**
1. **Header:** "Unassigned" + count + total kg + OBD count
2. **Sort indicator:** "Auto-sorted: Slot → Vehicle → Priority"
3. **Customer cards:** Vertical list, auto-sorted

**Customer Card (in Unassigned):**
```
┌─────────────────────────────────────┐
│ [✓] ● ★ Customer Name          ▼  │  ← Checkbox + priority + star + expand
│ Area · 2 OBDs              450 kg  │
│ 🚚 Trip 3 · Tempo    🎨 1         │  ← Vehicle hint + tinting count
│ Slot closing · Vehicle · P1 ★      │  ← WHY hint (amber badge)
├─────────────────────────────────────┤  ← Expanded (on click):
│ ● 9105942598  🎨 Tint   250kg 12u │
│ ● 9105942597            200kg 12u  │
└─────────────────────────────────────┘
```

**WHY hint (priority reason):** Small amber badge explaining auto-sort ranking:
- "Slot closing · Vehicle · P1 ★" (strongest)
- "Vehicle · P2" (mid)
- "P3 · No vehicle" (weakest)

**Vehicle hint:** Gray tag showing trip + vehicle info if order is on a confirmed trip.
No tag if order is not yet on any trip.

4. **Assign footer:** "X selected" + Picker dropdown (10 pickers) + "Assign" button

**Auto-sort logic (frozen on assignment):**
1. Slot urgency (most urgent slot first)
2. Vehicle assigned (confirmed trip with vehicle = physical truck waiting)
3. Customer priority (P1 > P2 > P3)
4. Key customer boost (★ rating A bumps up within same tier)
5. Tinting ready beats tinting pending

**Lock behavior:** Once a picker is assigned to orders, those orders leave the unassigned list and move to the picker's lane. The sort order in the picker lane is locked — new orders arriving from import waves go to unassigned, not into existing picker lanes.

#### Right Panel — Picker Lanes

**Two sections:**

**1. Picking (expanded by default)** — pickers with unpicked items

**Picker lane header (one row):**
```
[R] Ramesh K.  ████░░  1/3       1,262 kg  ▼
```
- Avatar circle (colored) + Name + Progress bar + Picked count + Total kg + Expand chevron

**Picker lane expanded content:**
```
┌──────────────┐  ┌──────────────┐   ✓ 1 done · 234 kg [▾]
│ ① Raj Hdw    │  │ ② Patel Hw   │
│ 2 OBDs·820kg │  │ 1 OBD·312kg  │
│ Sachin GIDC  │  │ Kapodara     │
│ 🚚 Trip 1    │  │ 🚚 Trip 3    │
└──────────────┘  └──────────────┘
```

**Pending cards (320px wide, dispatcher-style):**
- Row 1: Sequence number (①②③) + Customer name + Pick progress (0/2)
- Row 2: OBD count · **Weight (bold)** · Unit count
- Row 3: Area
- Row 4: Vehicle tag (🚚 Trip 1) + Tinting badge if applicable
- Click to expand: OBD rows with individual Pick buttons
- Room reserved for SKU-level detail in future iterations

**Done chip:** `✓ 3 done · 850 kg [▾]` — inline after pending cards
- Click to expand: shows faded done cards (180px, opacity-50)
- Collapsed by default — supervisor only sees pending work

**2. Available (collapsed one-liners)** — pickers who are idle or finished all work

```
AVAILABLE
[V] Vikram S.   3 done today              [Available]
[J] Jayesh M.                             [Available]
[B] Bharat T.                             [Available]
```

- Avatar + Name + "X done today" hint + Green "Available" badge
- No chevron, no expand — just signals availability
- Merged state: idle and all-done are both "Available"

#### Picker States — Two states only

| State | Meaning | Default display |
|---|---|---|
| **Picking** | Has unpicked items assigned | Expanded — shows pending cards + done chip |
| **Available** | No pending items (idle or all done) | Collapsed — one line with green badge |

#### Picker Lane Delivery Type Breakdown
- Each picker lane header shows pending order count per delivery type
- Format: L:2 · U:1 (short labels, text-[9px] gray, after kg value)
- Only shows non-zero pending counts (done orders excluded)
- Omit delivery types with 0 pending

#### Pickers Panel Filter
- Toggle buttons above picker lanes: All / Local / Upcountry / IGT / Cross
- Default: All (show everyone)
- Filtered: show pickers with PENDING orders matching selected delivery type + all Available pickers
- Filter considers pending only — done orders don't count
- Style: text-[9px] toggle buttons matching unassigned grouping filter pattern

#### Actions by Role

| Action | Floor Supervisor | Admin |
|---|---|---|
| Select unassigned orders | ✓ | ✓ |
| Assign picker | ✓ | ✓ |
| Mark Picked (per OBD) | ✓ | ✓ |
| Reorder sequence | ✓ | ✓ |

**NOT on this screen:**
- Loading Complete (lives on dispatcher board)
- Vehicle assignment (dispatcher's job)
- Create/edit trips (dispatcher's job)
- Draft trip management (dispatcher's job)

#### Scale Considerations

- 10 pickers, 3 supervisors
- Only 1 supervisor assigns at a time (no concurrent assignment conflicts)
- Typically 4-5 pickers active, rest available
- Compact picker rows ensure all 10 visible without excessive scrolling

---

## 18-32. [Unchanged from v27]

(Sections 18-32 remain unchanged — refer to v27 for full content)

---

## 33. Planning Board UI Components (UPDATED v29)

Page: /planning
Roles: Dispatcher, Floor Supervisor, Admin

### Implementation Status: COMPLETE

Components built (10 files in `components/planning/`):

| Component | Purpose |
|---|---|
| planning-page.tsx | Main orchestrator — types, state, API calls, Auto Draft logic |
| planning-header.tsx | Header: title, date picker, refresh, stats |
| delivery-tabs.tsx | Underline-style tabs: Local/Upcountry/IGT/Cross with counts |
| slot-bar.tsx | Horizontal slot cards — urgent gets red, done gets gray, others neutral |
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

### API routes (v27+v29+v32):

- `GET /api/planning/board` — orders with dispatchStatus='dispatch', includes customer.area, customerRating. Accepts ?date param. Returns isCarriedOver + daysOverdue per order. Plans include carried-over (non-dispatched from before today). clearedAt filtering: today=NULL only, history=show all.
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

## 36. Session Start Checklist (UPDATED v32)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v19** — includes clearedAt on dispatch_plan_orders + pick_assignments
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
31. DB columns are snake_case — Prisma @map required for all camelCase fields
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

---

## 37. Warehouse Board UI Components (UPDATED v31)

Page: /warehouse
Roles: Floor Supervisor, Admin

### Implementation Status: API + UI COMPLETE — day boundary integrated v32

### Components built (10 files in `components/warehouse/`):

| Component | Purpose |
|---|---|
| warehouse-page.tsx | Main orchestrator — types, state, API calls, auto-sort logic, 30s auto-refresh |
| warehouse-header.tsx | Header: title, date, refresh, stats (Unassigned/Picking/Picked/OBDs) |
| warehouse-delivery-tabs.tsx | Delivery type tabs with counts |
| warehouse-slot-tabs.tsx | Underline-style slot tabs with pick progress X/Y |
| unassigned-panel.tsx | Left 300px panel: sorted cards, checkbox select, assign footer |
| unassigned-card.tsx | Customer card: checkbox, priority dot, star, OBDs, weight, vehicle tag, WHY hint, expandable OBDs |
| pickers-panel.tsx | Right panel: picker lanes container + delivery type filter (All/L/U/I/C) |
| picker-lane.tsx | Expandable lane: header row with DT breakdown chips + pending cards + done chip |
| pick-card.tsx | 320px pending card: sequence, customer, OBDs, weight, area, vehicle, expand for OBD rows + Pick button |
| done-chip.tsx | Collapsed done summary: "✓ X done · Y kg [▾]", expand for faded done cards |

### API routes built:

| Route | Method | Purpose |
|---|---|---|
| /api/warehouse/board | GET | Orders for warehouse: unassigned (filtered by DT, client-side slot filter) + assigned (unfiltered), grouped by customer. Accepts ?date param. Slot filtering moved to client-side v32. |
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

### Picker assignment
- Supervisor selects 1+ customer cards in unassigned → picks a name from dropdown → clicks "Assign"
- Assignment creates rows in `pick_assignments` with sequential `sequenceNumber` per picker
- Assigned orders move from unassigned panel to the picker's lane
- Assignment is at ORDER level — all OBDs for one customer on the warehouse board are assigned together via their individual order rows

### Auto-sort logic (unassigned panel)
Orders in unassigned panel are auto-sorted by:
1. Slot urgency (most urgent slot first)
2. Vehicle assigned (order is on a confirmed trip with vehicle)
3. Customer priority (P1 > P2 > P3)
4. Key customer boost (★ rating A)
5. Tinting ready beats tinting pending

### Sort lock on assignment
- Once orders are assigned to a picker, they leave the auto-sorted unassigned list
- Their sequence in the picker lane is locked (set at assignment time)
- New orders arriving from import waves land in unassigned — supervisor manually assigns them
- No auto-resort of picker lanes

### Picking granularity
- Picking is at OBD level (per order)
- `orders.isPicked`, `orders.pickedAt`, `orders.pickedById` track pick status
- Customer card on warehouse board groups OBDs but each OBD has its own Pick button
- Tinting shown inline as badge — does not block picking

### Picker states
- **Picking:** has at least 1 unpicked assignment → lane expanded by default
- **Available:** no pending assignments (idle or all done) → collapsed one-liner with green badge
- No separate "Done" vs "Idle" states — both are "Available"

### What is NOT on the warehouse board
- Loading Complete (stays on dispatcher board or future separate screen)
- Vehicle assignment / trip creation / trip editing (dispatcher's job)
- Draft trip management (dispatcher's job)

---

## 39. Schema v18 Changes (NEW v30)

### New table: pick_assignments

```sql
CREATE TABLE pick_assignments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  picker_id INTEGER NOT NULL REFERENCES users(id),
  sequence_number INTEGER NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  assigned_by_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'assigned',  -- assigned | picked
  picked_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(order_id)  -- one active assignment per order
);

CREATE INDEX idx_pick_assignments_picker ON pick_assignments(picker_id);
CREATE INDEX idx_pick_assignments_status ON pick_assignments(status);
```

**Design decisions:**
- Separate table (not columns on orders) — cleaner separation, no schema change to orders table
- `order_id` is UNIQUE — one picker per order at a time
- `sequence_number` is per-picker (1, 2, 3... for each picker's queue)
- `status` tracks assignment lifecycle: assigned → picked
- `picked_at` set when supervisor marks all OBDs of the order as picked
- Links to existing `orders.isPicked` — when Mark Picked is clicked, both `orders.isPicked` and `pick_assignments.status` are updated

**Relationship to existing tables:**
- `orders.isPicked` / `pickedAt` / `pickedById` — still the source of truth for pick status
- `pick_assignments` — adds picker identity and sequence for warehouse board coordination
- Both updated together when marking picked

---

## 40. Day Boundary System (NEW v32)

### Overview

The day boundary system handles what happens when orders span multiple days. It consists of:
1. **Lazy cleanup** — soft-deletes stale assignments on first board load of the day
2. **Carried-over orders** — orders from before today shown with overdue badges
3. **History view** — read-only past date view showing exact state of that day
4. **Sort priority** — overdue orders always sort above today's orders

### Files involved

| File | Purpose |
|---|---|
| lib/day-boundary.ts | runDailyCleanupIfNeeded() — lazy daily cleanup |
| components/shared/carried-over-badge.tsx | Overdue badge: amber 1d, red 2d+ |
| Both board APIs | Date param, isCarriedOver/daysOverdue enrichment, clearedAt filtering |
| Both page components | selectedDate state, isHistoryView, read-only banner |
| All card/pill components | isHistoryView prop to hide action buttons |

### Lazy cleanup mechanism

1. First API call of the day triggers cleanup (checks system_config.last_cleanup_date)
2. **Warehouse:** pick_assignments WHERE status='assigned' AND assignedAt < today → SET clearedAt = NOW()
3. **Dispatcher:** dispatch_plan_orders for draft AND confirmed/loading plans from before today → SET clearedAt = NOW()
4. Updates last_cleanup_date to today
5. Wrapped in try/catch — failures don't break the board
6. Only runs for today's view, not history view

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

- **Unassigned orders from yesterday** → appear in today's Unassigned with overdue badge
- **Draft trip orders from yesterday** → soft-cleared from trip, appear in today's Unassigned
- **Confirmed/loading trip orders from yesterday (not dispatched)** → soft-cleared, appear in Unassigned
- **Dispatched orders** → done, not shown in today's view
- **Pick assignments (status='assigned') from yesterday** → soft-cleared, orders go to Unassigned
- **Pick assignments (status='picked') from yesterday** → kept for history

### System config keys

| Key | Default | Purpose |
|---|---|---|
| day_boundary_time | 00:00 | When rollover triggers (HH:MM, 24h) — currently unused, cleanup is lazy |
| last_cleanup_date | (today) | Prevents repeated cleanup — updated after each run |
| history_days_visible | 30 | Date picker min range |

---

## 41. Known Issues / Pending Fixes (NEW v32)

1. **Warehouse header stats mismatch** — header shows different count than unassigned panel in history view
2. **Cleanup Prisma field mapping** — pick_assignments.clearedAt had @map("cleared_at") mismatch, fixed by removing @map. Verify cleanup runs correctly on next day boundary.
3. **Slot cascade (NOT YET BUILT)** — when a slot's time passes, pending orders should auto-bump to next slot. Yesterday's leftovers should default to Morning. Design approved, implementation queued.
4. **Duplicate pick columns** — orders and order_splits both have camelCase (isPicked, pickedAt, pickedById) AND snake_case (is_picked, picked_at, picked_by_id) columns. Use camelCase ones via Prisma.

---

## 42. Queued Features (UPDATED v32)

- **Slot cascade:** Morning closes → pending orders move to Afternoon → Evening → Night → Next Day Morning. Yesterday's leftovers always start in Morning.
- **OBD date parsing fix** — source files use DD-MM-YYYY format, obdEmailDate is null on real orders
- **CustomerMissingSheet styling** — not matching admin customer form
- **Smart slot assignment** — orders arriving at/after slot cutoff auto-escalate
- **Visual "carried over" indicator for overdue orders in slot tabs**
- **MIS Override Layer** — Admin-only field-level overrides per OBD
- **Barcode/QR label generation** — post-TI submission
- **Customer data enrichment** — remaining area batches

---

*Version: Phase 4 Day Boundary · Schema v19 · Context v32 · March 2026*
