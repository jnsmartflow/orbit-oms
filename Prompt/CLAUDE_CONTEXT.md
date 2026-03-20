# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT.md fully before doing anything else."
# Version: Phase 3 · Schema v12 · Config Master v2 · Updated March 2026

---

## 1. What this application is

Orbit OMS is a depot-level order management system for a paint distribution company operating out of Surat, India. It manages the full lifecycle of customer orders from manual XLS import through tinting, support review, dispatch planning, warehouse picking, and vehicle dispatch.

This is an internal business tool — not a public-facing product. Users are depot staff: dispatchers, support agents, tint operators, warehouse supervisors, and pickers. Each role sees a different interface and has different permissions.

Scale: ~25–35 dispatch plans per day, ~100–200 OBDs (orders) per day, single depot.

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

## 3. Database — 41 tables, 4 groups (Schema v12)

Schema v12 = Schema v11 + Tint Splits architecture (order_splits expanded, split_line_items, split_status_logs added).

### Group 1: Setup / Master tables (23 tables — Phase 1 ✅ complete)

```
── Config / Status ──────────────────────────────────────────────────────────
status_master              — UNIFIED status table. All workflow statuses.
                             Domains: dispatch | tinting | pick_list | import | workflow | priority
system_config              — Key-value store. 8 keys. Always read from DB — never hardcode.
role_master                — 7 roles

── SKU Hierarchy ────────────────────────────────────────────────────────────
product_category           — Emulsion, Primer, Tinter, Enamel, Texture, Putty
product_name               — WS, Aquatech, Weathercoat… FK → product_category
base_colour                — White Base, Deep Base, Clear, N/A…
sku_master                 — Each row = one SKU code + colour combo.
                             FKs: productCategoryId, productNameId, baseColourId
                             NOTE: grossWeightPerUnit does NOT exist — weight comes from import file

── Transporter / Vehicle ────────────────────────────────────────────────────
transporter_master         — Transporter companies.
vehicle_master             — Phase 3 stub. transporterId FK → transporter_master.

── Geography & Delivery ─────────────────────────────────────────────────────
delivery_type_master       — Local | Upcountry | IGT | Cross. Drives slot rules.
slot_master                — Dispatch slot definitions. Admin-managed. No hardcoded times.
delivery_type_slot_config  — Per-delivery-type slot rules (time_based or default windows).
route_master               — Named routes: Varacha, Bharuch, Adajan, Surat City…
area_master                — Areas. delivery_type AND primaryRoute live here.
area_route_map             — Many-to-many area ↔ route (edge cases only)
sub_area_master            — Sub-areas for stop clustering

── Sales Officer ─────────────────────────────────────────────────────────────
sales_officer_master       — Sales officers
sales_officer_group        — Named customer portfolios. One SO per group.

── Customers ─────────────────────────────────────────────────────────────────
contact_role_master        — Owner | Contractor | Manager | Site Engineer
delivery_point_master      — Ship-to customers.
                             Fields: primaryRouteId (override), deliveryTypeOverride,
                             salesOfficerGroupId, customerRating (A/B/C)
delivery_point_contacts    — Contacts with contactRoleId FK → contact_role_master

── People ────────────────────────────────────────────────────────────────────
users                      — Depot staff accounts
```

### Group 2: Import tables (5 tables — Phase 2 ✅ complete)

```
import_batches             — One row per import session.
import_raw_summary         — One row per OBD from header XLS. 18 mapped columns. obdEmailDate + obdEmailTime stored here.
import_raw_line_items      — One row per line item. 10 columns including article + articleTag.
import_enriched_line_items — Lines enriched with sku_master join.
import_obd_query_summary   — Per-OBD totals: weight, qty, volume, hasTinting, totalArticle, articleTag.
```

### Group 3: Orders + Tinting + Support (8 tables — Phase 2 ✅ + Phase 3 splits ✅)

```
orders                     — Parent container. One row per OBD post-import.
                             workflowStage tracks overall OBD status.
                             PRIMARY UNIT OF WORK IS order_splits (not orders) for tint flow.
order_splits               — EXPANDED v12. One row per tint batch/split.
                             Each split = portion of OBD assigned to one operator.
                             Has its own full lifecycle. Splits are independent.
split_line_items           — NEW v12. One row per line assigned to a split.
                             Fields: splitId, rawLineItemId, assignedQty.
split_status_logs          — NEW v12. INSERT-ONLY. Audit trail per split.
tint_assignments           — One row per whole-OBD assignment (non-split flow).
                             Also has optional splitId FK for split context.
tint_logs                  — INSERT-ONLY. Immutable. orderId + optional splitId.
order_status_logs          — INSERT-ONLY. Immutable. Per-order audit trail.
```

### Group 4: Dispatch + Warehouse (7 tables — Phase 3 stubs)

```
vehicle_master
dispatch_plans
dispatch_plan_vehicles
dispatch_plan_orders
dispatch_change_queue      — Hold notifications for dispatcher
pick_lists
pick_list_items
```

---

## 4. REMOVED TABLES — never reference these

| Table | Replaced by |
|---|---|
| `sku_sub_master` | `base_colour` FK on `sku_master` |
| `dispatch_status_master` | `status_master` domain=dispatch |
| `tinting_status_master` | `status_master` domain=tinting |
| `delivery_priority_master` | `status_master` domain=priority |

---

## 5. status_master — all statuses by domain

Query pattern: always filter `WHERE domain = '<domain>'`.

### domain: workflow
| code | label |
|---|---|
| order_created | Order Created |
| pending_tint_assignment | Pending Tint Assignment |
| tint_assigned | Tint Assigned |
| tinting_in_progress | Tinting In Progress |
| tinting_done | Tinting Done |
| pending_support | Pending Support |
| dispatch_confirmation | Dispatch Confirmation |
| dispatched | Dispatched |

### domain: tinting (split status values)
| code | label |
|---|---|
| tint_assigned | Tint Assigned |
| tinting_in_progress | Tinting In Progress |
| tinting_done | Tinting Done |
| pending_support | Pending Support |
| dispatch_confirmation | Dispatch Confirmation |
| dispatched | Dispatched |
| cancelled | Cancelled |

### domain: dispatch
| code | label |
|---|---|
| dispatch | Dispatch |
| waiting_for_confirmation | Waiting for Confirmation |
| hold | Hold |

### domain: priority
| code | label |
|---|---|
| normal | Normal |
| urgent | Urgent |

### domain: import
| code | label |
|---|---|
| processing | Processing |
| completed | Completed |
| partial | Partial |
| failed | Failed |

### domain: pick_list
| code | label |
|---|---|
| pending_pick | Pending Pick |
| pick_assigned | Pick Assigned |
| picking | Picking |
| pending_verification | Pending Verification |
| ready_for_dispatch | Ready for Dispatch |
| verification_failed | Verification Failed |
| vehicle_confirmed | Vehicle Confirmed |
| loading | Loading |
| loading_complete | Loading Complete |
| dispatched | Dispatched |

---

## 6. User roles

| Role | Primary screen | Key permissions |
|---|---|---|
| Admin | /admin | All master data CRUD, system_config, user management |
| Dispatcher | /dispatcher | Build plans, assign vehicles, confirm, act on Hold notifications |
| Support | /support | View ALL orders + splits, set dispatch_status, priority, slot override |
| Tint Manager | /tint/manager | Create splits, assign tint operators, monitor tint pipeline, set dispatchStatus + priority on orders AND splits directly from Kanban |
| Tint Operator | /tint/operator | Start/Done on assigned OBDs and splits |
| Floor Supervisor | /warehouse/supervisor | Assign pickers, verify material, control loading |
| Picker | /warehouse/picker | Own assigned OBDs only |

**Import screen roles:** Admin, Dispatcher, Support — all three can access /import.
**RBAC rule:** Every API route uses `requireRole(session, ['Role'])` server-side. Never trust client-side checks.

---

## 7. Workflow stages

### OBD-level (orders.workflowStage)
```
order_created
  ↓ (if tint order)
pending_tint_assignment   ← OBD appears in Tint Manager Pending column
  ↓ (manager assigns operator OR creates splits)
tinting_in_progress       ← At least one split/assignment active
  ↓ (all splits done + no remaining qty)
pending_support           ← OBD summary visible in Support
  ↓
dispatch_confirmation
  ↓
dispatched
```

### Split-level (order_splits.status) — independent per split
```
tint_assigned             ← Split created + assigned to operator
  ↓ (operator clicks Start)
tinting_in_progress
  ↓ (operator clicks Done)
tinting_done              ← Split stays here, visible in Completed column today
  ↓ (Support acts on it)
pending_support
  ↓
dispatch_confirmation
  ↓
dispatched
```

**Key rules:**
- Each split moves through stages independently — does NOT wait for other splits
- `tinting_done` IS a resting stage for splits (unlike orders where it was skipped)
- Completed column shows splits with `status IN ('tinting_done', 'pending_support') AND completedAt >= startOfToday`
- Completed column resets at midnight
- When ALL splits are done AND no remaining unassigned qty → `orders.workflowStage = 'pending_support'`
- `cancelled` splits are excluded from all qty calculations

---

## 8. OBD Import — column mapping (v12)

### Source files
| File | Sheet name |
|---|---|
| OBD Header XLS | `LogisticsTrackerWareHouse` |
| Line Items XLS | `Sheet1` (generated by PowerShell OBD merger tool) |

### Line Items → import_raw_line_items (10 columns)

| XLS column | DB field | Notes |
|---|---|---|
| `obd_number` | `obdNumber` | FK to header |
| `line_id` | `lineId` | SAP line number |
| `sku_codes` | `skuCodeRaw` | |
| `sku_description` | `skuDescriptionRaw` | |
| `batch_code` | `batchCode` | |
| `unit_qty` | `unitQty` | |
| `volume_line` | `volumeLine` | |
| `Tinting` | `isTinting` | Boolean |
| `article` | `article` | Computed by PowerShell |
| `article_tag` | `articleTag` | Computed by PowerShell |

### Article & ArticleTag logic
Pack size = `volume_line / unit_qty`. Config in `pack-sizes.txt`.

| Pack Size | Type | Article | ArticleTag |
|---|---|---|---|
| 10, 20 | Drum | = unit_qty | `X Drum` |
| 25, 30 | Bag | = unit_qty | `X Bag` |
| 1 (6/ctn) | Carton/Tin | floor(qty/6) + remainder | `X Carton Y Tin` |
| 4 (4/ctn) | Carton/Tin | floor(qty/4) + remainder | `X Carton Y Tin` |
| 500 (12/ctn) | Carton/Tin | floor(qty/12) + remainder | `X Carton Y Tin` |

OBD summary aggregation in `import_obd_query_summary`:
- `totalArticle` = SUM of all line article values
- `articleTag` = grouped by type e.g. `30 Drum, 2 Carton, 1 Tin`

### PowerShell OBD merger tool
Location: `C:\Users\HP\OneDrive\Orbit OMS\OBD-Tools\`
Config files:
- `pack-sizes.txt` — pack size → type + carton qty mapping
- `tinting-keywords.txt` — keywords that mark line as tinting (TINT, GENRIC, GEN etc.)

---

## 9. Slot assignment logic (v12 — fully config-driven)

**No hardcoded cutoff times.** All slot rules in `slot_master` + `delivery_type_slot_config`.

OBD date/time comes from `import_raw_summary.obdEmailDate` + `obdEmailTime`.
Displayed on Tint Manager cards inline in OBD row: `9105750091 · Route · 19 Mar 11:09`

---

## 10. system_config — 8 keys

| Key | Default | Purpose |
|---|---|---|
| `soft_lock_minutes_before_cutoff` | 30 | Plan enters soft-lock |
| `hard_lock_minutes_before_cutoff` | 15 | Plan enters hard-lock |
| `ready_escalation_minutes` | 10 | Escalation timer |
| `upgrade_small_overflow_pct` | 12 | Max overflow % |
| `upgrade_max_dealer_combo` | 3 | Max dealers in concentration check |
| `aging_priority_days` | 2 | Days before tier-3 priority |
| `aging_alert_days` | 3 | Days before escalation alert |
| `change_queue_urgent_alert` | true | Urgent Hold notifications |

---

## 11. Tint Splits Architecture (v12)

### Core concept
`order_splits` is the **primary unit of work** through tinting, support, and dispatch.
`orders` is a **parent container** — tracks overall OBD status only.

### Split = a portion of an OBD assigned to one operator
- Created by Tint Manager upfront in one step (create + assign together)
- Can be any portion: full lines, partial qty, or mix of both
- Each split has its own independent lifecycle
- Multiple splits can be active simultaneously for the same OBD
- Partial splitting allowed — unassigned qty stays on OBD

### order_splits key fields
```
id, orderId, splitNumber, assignedToId, assignedById
status         — tint_assigned | tinting_in_progress | tinting_done | pending_support | dispatch_confirmation | dispatched | cancelled
dispatchStatus — dispatch | hold | waiting_for_confirmation | null
totalQty       — sum of split_line_items.assignedQty
totalVolume    — proportional volume from lines
articleTag     — e.g. "30 Drum" or "1 Carton 2 Tin"
startedAt, completedAt, createdAt, updatedAt
```

### split_line_items key fields
```
id, splitId, rawLineItemId, assignedQty, createdAt
```

### Business rules
| Rule | Detail |
|---|---|
| Create + assign | Always one step — manager picks operator while building split |
| Partial splitting | Allowed — remaining qty shown on Pending card |
| Independent lifecycle | Each split moves through stages independently |
| Auto pending_support | When split = tinting_done → stays there (does NOT auto-move) |
| OBD auto-complete | When ALL splits done AND no unassigned qty → orders = pending_support |
| Dispatch per split | Each split can go on different vehicle on different day |
| Qty validation | Sum of assignedQty across splits for a line ≤ line's totalUnitQty |
| Operator visibility | Operator sees BOTH regular assigned orders AND their splits |
| Cancel split | Only allowed when status = tint_assigned. Deletes split_line_items + order_splits. |
| Completed column | Shows splits with completedAt >= startOfToday. Resets at midnight. |

### API routes (v12)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/tint/manager/orders` | TM, Admin | Orders (Pending) + activeSplits + completedSplits |
| GET | `/api/tint/manager/operators` | TM, Admin | Active tint operators |
| POST | `/api/tint/manager/assign` | TM, Admin | Assign whole OBD to one operator |
| POST | `/api/tint/manager/cancel-assignment` | TM, Admin | Cancel whole OBD assignment |
| POST | `/api/tint/manager/splits/create` | TM, Admin | Create splits for an OBD |
| POST | `/api/tint/manager/splits/reassign` | TM, Admin | Reassign a split to different operator |
| POST | `/api/tint/manager/splits/cancel` | TM, Admin | Cancel a split (tint_assigned only) |
| GET | `/api/tint/operator/my-orders` | Operator | Both assigned orders AND splits |
| POST | `/api/tint/operator/start` | Operator | Start whole OBD assignment |
| POST | `/api/tint/operator/done` | Operator | Complete whole OBD assignment |
| POST | `/api/tint/operator/split/start` | Operator | Start a split |
| POST | `/api/tint/operator/split/done` | Operator | Complete a split → status = tinting_done |
| PATCH | `/api/tint/manager/orders/[id]/status` | TM, Admin | Set dispatchStatus + priority on an order |
| PATCH | `/api/tint/manager/splits/[id]/status` | TM, Admin | Set dispatchStatus + priority on a split |
| GET | `/api/support/orders` | Support, Admin | All orders with splits included |
| PATCH | `/api/support/orders/[id]` | Support, Admin | Update order dispatch/priority/slot |
| PATCH | `/api/support/splits/[id]` | Support, Admin | Update split dispatch/priority/slot |
| GET | `/api/tint/manager/orders/[id]/splits` | TM, Admin | Fetch single order with ALL splits + line items for SplitDetailSheet |

---

## 12. Tint Manager Kanban — v4 (4-column, splits-aware, full UI)

### Column data sources

| Column | Shows | Filter |
|---|---|---|
| Pending Assignment | OBD cards | `orders.workflowStage = 'pending_tint_assignment'` OR (`workflowStage IN ('tint_assigned','tinting_in_progress')` AND `remainingQty > 0`) |
| Assigned | Split cards + Order cards | `splits.status = 'tint_assigned'` + `orders.workflowStage = 'tint_assigned'` AND `remainingQty = 0` |
| In Progress | Split cards + Order cards | `splits.status = 'tinting_in_progress'` + `orders.workflowStage = 'tinting_in_progress'` AND `remainingQty = 0` |
| Completed | Split cards only | `splits.status IN ('tinting_done','pending_support') AND completedAt >= today` |

### remainingQty — key concept
`remainingQty` = sum of all line item unitQty minus sum of assignedQty across all non-cancelled splits.
- Computed by the API and returned per order in `/api/tint/manager/orders` response
- When `remainingQty > 0` → order stays visible in Pending even if splits exist
- When `remainingQty = 0` → order leaves Pending and shows in its workflowStage column

### SplitCard type — key fields
Frontend type for activeSplits/completedSplits returned by `/api/tint/manager/orders`.
Key fields include:
- `order.id: number` — required for SplitDetailSheet API call
- `lineItems[].rawLineItem.volumeLine: number | null` — for volume display
- `lineItems[].rawLineItem.isTinting: boolean` — for TINT badge
These fields are included in activeSplits + completedSplits API response.

### Assigned column — sort order
Sort is client-side in tint-manager-content.tsx (not server-side)
because obdEmailDate/obdEmailTime live on import_raw_summary, not on orders directly.

Sort applied to BOTH colOrderItems (tint_assigned orders) and
activeSplits (tint_assigned splits):
  1. sequenceOrder ASC — respects TM manual reordering (Move Up/Down)
  2. priorityLevel ASC — Urgent (lower number) floats above Normal
  3. obdEmailDate + obdEmailTime ASC — oldest OBD first within same priority

Server-side orderBy in /api/tint/manager/orders keeps only:
  orderBy: [{ sequenceOrder: 'asc' }]
as a rough pre-sort. Final sort is applied client-side.

### Manual reorder — Move Up / Move Down
`···` menu in Assigned column shows Move Up (ChevronUp) and Move Down (ChevronDown) actions.
Calls PATCH `/api/tint/manager/reorder` with `{ id, type, direction }`.
After save → `fetchOrders()` refreshes the board.

When a split is cancelled → sequenceOrder resets to 0 in splits/cancel/route.ts
When an order assignment is cancelled → sequenceOrder resets to 0 in cancel-assignment/route.ts
This ensures reassigned orders/splits always start at the bottom of the Assigned column
rather than inheriting their old position.

### Assign vs Create Split — business rule
- `hasSplits = (order.splits ?? []).filter(s => s.status !== 'cancelled').length > 0`
- If `hasSplits = false` → show Assign button (direct whole-OBD assignment allowed)
- If `hasSplits = true` → show Create Split button ONLY — direct assign is blocked
- Once splitting starts, ALL remaining qty must go through splits
- Cancelled splits do NOT count toward hasSplits

### Assign API — 4 allowed/blocked cases
CASE 1 — Fresh order, no splits ever created:
  workflowStage = 'pending_tint_assignment' → ALLOW unconditionally

CASE 2 — All splits cancelled, stage already reset:
  workflowStage = 'pending_tint_assignment' (reset by cancel) → ALLOW unconditionally

CASE 3 — Active splits exist but remainingQty > 0:
  workflowStage IN ('tint_assigned', 'tinting_in_progress')
  non-cancelled splits exist + remainingQty > 0 → ALLOW

CASE 4 — Active splits exist, remainingQty = 0:
  workflowStage IN ('tint_assigned', 'tinting_in_progress')
  non-cancelled splits exist + remainingQty = 0 → BLOCK
  Error: "Order is not in a state that allows assignment"

Any other workflowStage → BLOCK

### Assign modal — isReassign logic
The modal title and confirm button text are determined by:

  const isReassign =
    selectedOrder.workflowStage === 'tint_assigned' &&
    (selectedOrder.remainingQty ?? 0) === 0 &&
    (selectedOrder.splits ?? []).filter(s => s.status !== 'cancelled').length > 0

  Modal title:   isReassign ? 'Re-assign Operator' : 'Assign Operator'
  Button text:   isReassign ? 'Confirm Re-assign'  : 'Assign Operator'

This correctly shows "Assign" (not "Re-assign") when:
  - Order returned to Pending after all splits cancelled
  - Order has remainingQty > 0 and is showing in Pending

### Cancel split resets workflowStage
When a split is cancelled and ALL remaining splits for the OBD are now cancelled:
  `orders.workflowStage` resets to `'pending_tint_assignment'`
This is handled in `/api/tint/manager/splits/cancel/route.ts`.

### + button — status popover
Present on ALL cards in ALL 4 columns (KanbanCard and SplitKanbanCard).
Uses fixed positioning anchored via `getBoundingClientRect()` to avoid overflow clipping.
+ button turns navy (`pop-active`) when popover is open.
Popover contains:
- Priority toggle: Normal / Urgent (2-button)
- Dispatch Status toggle: Dispatch / Hold / Waiting (3-button)
- Save button — disabled until a change is made, spinner while saving
On save for order cards → `PATCH /api/tint/manager/orders/[id]/status`
On save for split cards → `PATCH /api/tint/manager/splits/[id]/status`
Body: `{ dispatchStatus?: string, priority?: 'normal' | 'urgent' }`
After save → `fetchOrders()` refetches all data.

### Filter bar (v2) — 44px height
Single bar with 4 filter groups separated by 0.5px vertical dividers.
All filters are client-side — no API call on filter change.

Group 1 — SLOT: [All · {count}] [10:30 · {count}] [12:30 · {count}] [15:30 · {count}]
  Counts computed from loaded orders by matching dispatchSlot.
  Active chip: bg `#1a237e`, text white. Count badge inside: `rgba(255,255,255,.22)`.

Group 2 — PRIORITY: [All] [🚨 Urgent] [Normal]
  Urgent active: bg `#fcebeb`, text `#791f1f`, border `#f09595`
  Normal active: bg `#eeedfe`, text `#3c3489`, border `#afa9ec`

Group 3 — DISPATCH: [All] [🚚 Dispatch] [Hold] [Waiting]
  Dispatch active: bg `#eaf3de`, text `#27500a`, border `#97c459`
  Hold active: bg `#fcebeb`, text `#791f1f`, border `#f09595`
  Waiting active: bg `#faeeda`, text `#633806`, border `#fac775`

Group 4 — TYPE: [All] [Split] [Whole]
  Split = has non-cancelled splits. Whole = no non-cancelled splits.

Right side:
- Active filter summary pill — only visible when any filter is non-default
  Style: bg `#e8eaf6`, border `#c5cae9`, color `#1a237e`, border-radius 6px
  Content: `● {slot} · {priority} · {dispatch} · {type} · {operator}` (only active parts)
  × button clears ALL filters at once
- Operator dropdown — filters cards by assigned operator name

Filter state variables:
```
slotFilter:     'all' | '10:30' | '12:30' | '15:30'
priorityFilter: 'all' | 'urgent' | 'normal'
dispatchFilter: 'all' | 'dispatch' | 'hold' | 'waiting_for_confirmation'
typeFilter:     'all' | 'split' | 'whole'
searchQuery:    string
```

### Universal search
Input in topbar right side, width 220px expanding to 260px on focus.
Client-side only — no API call on search.
Searches across: `obdNumber`, `customer.customerName`, `salesOfficer.name`, `lineItems[].skuCodeRaw`
Inline dropdown (max 4 results) with tag + value rows appears on 2+ chars typed.
Tags: "Customer" | "OBD" | "SKU"
Clear (×) button appears when input has value. Closes dropdown on outside click.

### Operator workload bar
Collapsible bar between filter bar and stat cards. Collapsed by default.
Toggle label: "OPERATOR WORKLOAD ▼ show / ▲ hide"
When expanded: one card per operator who has activity today.
Each operator card shows: navy avatar (initials), name, 3 count badges:
  amber = assigned count | blue = in-progress count | green = done count
Clicking an operator card sets `operatorFilter`. Clicking again deselects.
Stats computed client-side from `activeSplits + completedSplits + orders` — no new API call.

### Stat cards (v2 — compact with volume)
Grid: `grid-cols-4 gap-3`, card padding: `10px 14px`.
Each card: icon circle (32px) + right column:
  Row 1: number (`text-[20px] font-extrabold`) + label (`text-[10px] font-bold uppercase`) — `items-baseline gap-2 mb-1`
  Row 2: `"{totalVolume} L · {subLabel}"` — `text-[11px] text-gray-400`
Volume per column:
  Pending:     orders with `workflowStage = pending_tint_assignment` OR `remainingQty > 0`
  Assigned:    activeSplits (`tint_assigned`) + orders (`tint_assigned`, `remainingQty = 0`)
  In Progress: activeSplits (`tinting_in_progress`) + orders (`tinting_in_progress`, `remainingQty = 0`)
  Completed:   completedSplits + orders (`pending_support`)
Format: `>= 1000` → `"1,234 L"` with comma. `0 or null` → `"— L"`

### Sticky column header strip
Appears when `window.scrollY > 180` (user scrolls past stat cards).
Implementation: `sticky` positioning inside content flow as a sibling div above the board.
NOT fixed positioning — sticky inherits correct width and margins automatically.
`showColStrip` state + `window.scroll` listener (`passive: true`) controls visibility.
When hidden: `h-0 overflow-hidden opacity-0 pointer-events-none`
When visible: `opacity-100`, smooth `transition-opacity duration-300 ease-in-out`
Design: `grid grid-cols-4 gap-2 px-3`, `bg-[#f0f2f8]` wrapper (grey shows in gaps).
Each cell: `bg-white px-4 py-3` — matches exact column header style, no rounded corners.
Counts in strip stay in sync with filtered board counts — no extra state.

### Card structure (v2 — updated layout)
Icon row and badge row are SEPARATE rows — never combined:
```
Row 1 (icons): h-[24px], justify-end, gap-1
  Order cards:  👁 Eye + + Plus + ··· MoreHorizontal
  Split cards:  👁 Eye     — opens SkuDetailsSheet showing ONLY this split's lines
               🗂 Layers  — opens SplitDetailSheet with full split details + OBD history
               +  Plus    — opens status popover (priority + dispatch)
               ··· MoreHorizontal — dropdown menu

Row 2 (badges): min-h-[22px], flex-wrap, gap-1.5
  Priority badge (Normal/Urgent) + dispatch status badge (if set) + split badge (split cards)
```

Card bottom section (Pending only, inside `mt-2.5 pt-2.5 border-t`):
  `hasSplits = false` → navy Assign button (`py-3`)
  `hasSplits = true`  → outlined Create Split button (`py-3`, `border-[#1a237e]`, `text-[#1a237e]`)

Two-badge status trail applies to BOTH `KanbanCard` (orders) AND `SplitKanbanCard` in Completed column:
  Left badge: always `✓ Tinting Done` (green)
  Right badge: based on `dispatchStatus` → Dispatch | Hold | Waiting | Pending Support (blue fallback)

Topbar is `sticky top-0 z-40`.
Filter bar is `sticky top-[52px] z-40`.

### SplitDetailSheet
Triggered by: Layers icon (🗂) on any SplitKanbanCard in any column.
Implementation: fixed overlay portal (NOT shadcn Sheet) — avoids
overflow:hidden clipping from kanban column wrapper.
Width: 420px, right-anchored, full height.
Data: fetched fresh on open from GET /api/tint/manager/orders/[id]/splits.

Sheet sections:
  Header:
    subtitle: "SPLIT #{splitNumber} · {obdNumber}"
    title: customerName

  Body (scrollable):
    Section 1 — ASSIGNED OPERATOR
      Operator row: avatar + name + assigned time
      If colStage = tint_assigned:
        Re-assign button (outline, full width) → calls onReassign() + closes sheet

    Section 2 — SKU LINES
      Current split line items only
      Each line: skuCodeRaw + skuDescriptionRaw + QTY (assignedQty) + VOLUME (volumeLine)

    Section 3 — STATUS
      Current split status badge
      If completed: two-badge status trail (✓ Tinting Done → dispatch status)

    Divider

    Section 4 — ALL SPLITS FOR THIS OBD
      All splits from API ordered by splitNumber ASC
      EXCLUDES cancelled splits (status !== 'cancelled')
      Each split card:
        bg-[#f7f8fc] border border-[#e2e5f1] rounded-xl px-4 py-3
        Top row: Split #{N} + status badge + dispatch badge + date (right)
        Middle: operator avatar + name + articleTag (right)
        Bottom: line items — skuCode + description + qty units
      Current split highlighted: border-[#1a237e] bg-[#e8eaf6]

  Footer:
    Close button only — all stages
    Re-assign is in body (section 1), NOT in footer
    Cancel Split is NOT in sheet — use ··· menu on card instead

Behaviour per stage:
  tint_assigned       → body has Re-assign button + Close footer
  tinting_in_progress → read only, Close footer only
  completed           → read only + status trail, Close footer only

### Two-badge status trail — right badge logic
Applies to BOTH KanbanCard (orders) and SplitKanbanCard in Completed column.
Left badge: always "✓ Tinting Done" (green — bg #eaf3de, border #97c459, text #27500a)
Right badge determined by dispatchStatus:
  'dispatch'                 → 🚚 Dispatch (green)
  'hold'                     → Hold (red)
  'waiting_for_confirmation' → Waiting (amber)
  null / undefined           → Pending Support (blue — bg #eff6ff, border #bfdbfe, text #1e40af)

### Pending card features (v2)
- Icon row (top right): 👁 + + + ···
- Badge row: Normal/Urgent + dispatch status badge (if set)
- Customer name
- OBD row: `OBDNo · Route · Date Time`
- Meta grid: SMU | Sales Officer | Articles | Volume
- Split indicator (when `hasSplits = true`): amber pill `X Splits Active · Y remaining`
- Footer: Assign button (`hasSplits = false`) OR Create Split button (`hasSplits = true`)

### Split/Order card features (v2)
- Icon row (top right): + + ··· (no eye)
- Badge row: Split #N + Normal/Urgent + dispatch status badge (if set)
- Customer name
- OBD row: `OBDNo · Date Time`
- Meta grid: SMU | Sales Officer | Articles | Volume
- Operator row: avatar + name + timestamp (`px-3 py-2`)
- Status trail (Completed only): `✓ Tinting Done → [dispatch status badge]`
- `...` menu: `tint_assigned` → Re-assign + Cancel | other stages → No actions available

---

## 13. Tint Operator screen — v3 (splits-aware)

Operator sees BOTH:
1. Regular assigned orders (via tint_assignments, workflowStage = tint_assigned/tinting_in_progress)
2. Splits assigned to them (via order_splits, status = tint_assigned/tinting_in_progress)

Each card shows only the lines relevant to that operator (split lines or all OBD lines).
Start/Done actions use different routes for orders vs splits.

---

## 14. Support queue — v3 (splits-aware)

Orders table shows all orders as before.
Edit sheet for tint orders shows:
- Existing order fields (dispatch status, priority, slot override)
- Splits summary section showing all splits for that OBD
- Per-split dispatch status toggle (calls `/api/support/splits/[id]`)
- Split status badges + line items per split

---

## 15. SKU structure (v12)

```
product_category → product_name → sku_master ← base_colour
```
- `grossWeightPerUnit` does NOT exist on sku_master — weight from import file
- `sku_sub_master` REMOVED

---

## 16. Sales Officer Group pattern

```
sales_officer_group.salesOfficerId → sales_officer_master
delivery_point_master.salesOfficerGroupId → sales_officer_group
```

---

## 17. Customer route/type inheritance

1. Area level (default): `area_master.deliveryTypeId` + `area_master.primaryRouteId`
2. Customer level (override): `delivery_point_master.deliveryTypeOverrideId` + `delivery_point_master.primaryRouteId`

Check customer-level first → fall back to area if null.

---

## 18. Audit trail rules — non-negotiable

- `tint_logs` — INSERT-ONLY. Every tint/split action = new row.
- `order_status_logs` — INSERT-ONLY. Every order change = new row.
- `split_status_logs` — INSERT-ONLY. Every split stage change = new row.

Any UPDATE or DELETE on these tables is architecturally wrong.

---

## 19. DB connection rule

⚠️ Direct Prisma DB connection from local machine is unreliable.
All DB schema changes must be done via **Supabase SQL Editor**.
`npx prisma db push` fails locally. Prisma client works fine at runtime.
When schema changes needed: generate SQL → paste into Supabase SQL Editor.
After SQL applied: run `npx prisma generate` in VS Code terminal.

---

## 20. Folder structure

```
/app
  /api/admin          — Admin CRUD API routes
  /api/auth           — NextAuth
  /api/tint/manager   — Tint Manager APIs (orders, assign, splits/*)
  /api/tint/operator  — Tint Operator APIs (my-orders, start, done, split/*)
  /api/support        — Support APIs (orders, splits)
  /api/import         — Import API (obd)
  /(admin)            — Admin role layout group
  /(dispatcher)       — Dispatcher role layout group
  /(support)          — Support role layout group
  /(tint)             — Tint team layout group
  /(warehouse)        — Supervisor + picker layout group
/components
  /ui                 — shadcn/ui primitives (do not edit)
  /shared             — Reusable app components
  /admin              — Admin-specific components
  /tint               — tint-manager-content.tsx, tint-operator-content.tsx,
                        split-builder-modal.tsx, sku-details-sheet.tsx
  /support            — support-page-content.tsx
/lib
  prisma.ts           — Prisma client singleton
  auth.ts             — NextAuth config
  rbac.ts             — requireRole() guard
  config.ts           — system_config reader
/prisma
  schema.prisma       — Source of truth — Schema v12
  seed.ts             — Seed script
```

---

## 21. Phase completion status

| Phase | Status |
|---|---|
| Phase 1 — Foundation (schema, admin, auth) | ✅ Complete |
| Phase 2 — Order pipeline (import, support, tint manager v1, operator) | ✅ Complete |
| Phase 3 — Tint splits + UI polish | ✅ Splits complete · UI polish in progress |
| Phase 4 — Dispatch planning | ⏳ Not started |
| Phase 5 — Warehouse execution | ⏳ Not started |

---

## 22. Session start checklist

Before generating any code, confirm:
1. You have read this file fully
2. Schema v12 is your reference — 41 tables
3. `order_splits` is the PRIMARY unit of work for tinting — not `orders`
4. `split_line_items` stores per-line qty assignments per split
5. `split_status_logs` is INSERT-ONLY — never update or delete
6. `tint_logs` and `order_status_logs` are INSERT-ONLY — never update or delete
7. Each split has its own independent lifecycle through all stages
8. `tinting_done` IS a resting stage for splits (stays there until Support acts)
9. Completed column shows splits with `completedAt >= today` — resets at midnight
10. Operator sees BOTH regular assigned orders AND their splits
11. Support sees splits as separate items inside the order edit sheet
12. Tint Manager Pending cards show split indicator when partial splits exist
13. OBD date/time shown inline in card OBD row from `import_raw_summary`
14. Article/ArticleTag computed by PowerShell tool, stored in import_raw_line_items + import_obd_query_summary
15. Pack sizes config in `pack-sizes.txt`, tinting keywords in `tinting-keywords.txt`
16. All DB schema changes go via Supabase SQL Editor — never `prisma db push` locally
17. Run `npx prisma generate` after every SQL migration
18. You will not install new libraries unless explicitly instructed
19. You will read existing files before modifying them
20. All status references use status_master with domain filter
21. `remainingQty` is computed by the API per order — use it for Pending column filter, not local computation
22. Once any non-cancelled split exists (`hasSplits = true`), direct Assign is blocked — show Create Split only
23. `hasSplits` check MUST exclude cancelled splits: `filter(s => s.status !== 'cancelled').length > 0`
24. Topbar is `sticky top-0 z-40`, filter bar is `sticky top-[52px] z-40` — never remove these classes
25. `+` button popover uses fixed positioning via `getBoundingClientRect()` to avoid `overflow:hidden` clipping
26. Two-badge status trail renders on BOTH `KanbanCard` (orders) AND `SplitKanbanCard` in Completed column
28. Assigned column sorts CLIENT-SIDE: sequenceOrder → priorityLevel → obdEmailDate+Time ASC.
       Server-side orderBy keeps only sequenceOrder ASC as pre-sort.
32. Status trail right badge: dispatch→green | hold→red | waiting→amber | null→blue Pending Support
33. isReassign logic checks workflowStage + remainingQty + non-cancelled splits count
34. Assign API has 4 explicit cases — Cases 1+2 always allowed, Case 3 allowed, Case 4 blocked
35. SplitKanbanCard has Eye (SKU sheet) + Layers (SplitDetailSheet) + Plus + ···
36. SplitDetailSheet uses fixed overlay portal — NOT shadcn Sheet
37. SplitDetailSheet fetches fresh from GET /api/tint/manager/orders/[id]/splits on open
38. Split history excludes cancelled splits (filter status !== 'cancelled')
39. Re-assign is in sheet body (tint_assigned only) — Cancel is via ··· menu only
40. SplitCard type requires order.id, rawLineItem.volumeLine, rawLineItem.isTinting

---

*Version: Phase 3 · Schema v12 · Config Master v2 · Kanban v4.3 · March 2026*