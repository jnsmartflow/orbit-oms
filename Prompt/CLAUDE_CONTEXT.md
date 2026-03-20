# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT.md fully before doing anything else."
# Version: Phase 3 · Schema v13 · Config Master v2 · Updated March 2026

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

## 3. Database — 42 tables, 4 groups (Schema v13)

Schema v13 = Schema v12 + Tinter Issue architecture
(tinter_issue_entries added; order_splits + tint_assignments expanded).

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

### Group 3: Orders + Tinting + Support (9 tables — Phase 2 ✅ + Phase 3 ✅ + v13 ✅)

```
orders                     — Parent container. One row per OBD post-import.
                             workflowStage tracks overall OBD status.
                             PRIMARY UNIT OF WORK IS order_splits (not orders) for tint flow.
order_splits               — EXPANDED v13. One row per tint batch/split.
                             Each split = portion of OBD assigned to one operator.
                             Has its own full lifecycle. Splits are independent.
                             NEW v13 fields: tiSubmitted, operatorSequence
split_line_items           — One row per line assigned to a split.
                             Fields: splitId, rawLineItemId, assignedQty.
split_status_logs          — INSERT-ONLY. Audit trail per split.
tint_assignments           — One row per whole-OBD assignment (non-split flow).
                             Also has optional splitId FK for split context.
                             NEW v13 fields: tiSubmitted, operatorSequence
tint_logs                  — INSERT-ONLY. Immutable. orderId + optional splitId.
order_status_logs          — INSERT-ONLY. Immutable. Per-order audit trail.
tinter_issue_entries       — NEW v13. INSERT-ONLY. One row per base batch TI entry.
                             Linked to either splitId OR tintAssignmentId (never both).
                             Fields: orderId, splitId?, tintAssignmentId?,
                             submittedById, baseSku, tinQty,
                             YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK,
                             OXR, HEY, HER, COB, COG, createdAt
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
| Tint Operator | /tint/operator | Start/Done on assigned OBDs and splits. Fill Tinter Issue form. |
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
  ↓ (operator fills TI form → tiSubmitted = true)
  ↓ (operator clicks Start — TI gate + one-job guard must pass)
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
- `tinting_done` IS a resting stage for splits
- Completed column shows splits with `completedAt >= startOfToday`
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
status           — tint_assigned | tinting_in_progress | tinting_done | pending_support | dispatch_confirmation | dispatched | cancelled
dispatchStatus   — dispatch | hold | waiting_for_confirmation | null
totalQty         — sum of split_line_items.assignedQty
totalVolume      — proportional volume from lines
articleTag       — e.g. "30 Drum" or "1 Carton 2 Tin"
sequenceOrder    — TM Kanban manual reorder position (NOT the operator queue)
tiSubmitted      — NEW v13. bool. True once operator submits TI form for this split
operatorSequence — NEW v13. int. Operator's personal queue position.
                   Set at split creation time via next_operator_sequence().
                   DISTINCT from sequenceOrder — never confuse these two.
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
| TI required | Operator MUST submit tinter_issue_entries before Start is allowed |
| One job at a time | Operator can only have ONE job in tinting_in_progress at a time |
| Sequential order | Operator works jobs in operatorSequence order (lowest first) |

### API routes (v13)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/tint/manager/orders` | TM, Admin | Orders (Pending) + activeSplits + completedSplits |
| GET | `/api/tint/manager/operators` | TM, Admin | Active tint operators |
| POST | `/api/tint/manager/assign` | TM, Admin | Assign whole OBD to one operator. Sets operatorSequence. |
| POST | `/api/tint/manager/cancel-assignment` | TM, Admin | Cancel whole OBD assignment |
| POST | `/api/tint/manager/splits/create` | TM, Admin | Create splits. Sets operatorSequence per split. |
| POST | `/api/tint/manager/splits/reassign` | TM, Admin | Reassign a split to different operator |
| POST | `/api/tint/manager/splits/cancel` | TM, Admin | Cancel a split (tint_assigned only) |
| PATCH | `/api/tint/manager/reorder` | TM, Admin | Move Up / Move Down on Assigned column cards |
| PATCH | `/api/tint/manager/orders/[id]/status` | TM, Admin | Set dispatchStatus + priority on an order |
| PATCH | `/api/tint/manager/splits/[id]/status` | TM, Admin | Set dispatchStatus + priority on a split |
| GET | `/api/tint/operator/my-orders` | Operator | Both assigned orders AND splits. Returns tiSubmitted, operatorSequence, startedAt, hasActiveJob. Sorted by operatorSequence ASC. |
| POST | `/api/tint/operator/tinter-issue` | Operator, Admin | Submit TI entries. Sets tiSubmitted=true on split/assignment. |
| GET | `/api/tint/operator/tinter-issue/[id]` | Operator, Admin | Fetch existing TI entries for pre-fill |
| POST | `/api/tint/operator/start` | Operator | Start whole OBD. Guards: tiSubmitted=true + no active job. |
| POST | `/api/tint/operator/done` | Operator | Complete whole OBD assignment |
| POST | `/api/tint/operator/split/start` | Operator | Start a split. Guards: tiSubmitted=true + no active job. |
| POST | `/api/tint/operator/split/done` | Operator | Complete a split → status = tinting_done |
| GET | `/api/support/orders` | Support, Admin | All orders with splits included |
| PATCH | `/api/support/orders/[id]` | Support, Admin | Update order dispatch/priority/slot |
| PATCH | `/api/support/splits/[id]` | Support, Admin | Update split dispatch/priority/slot |
| GET | `/api/tint/manager/orders/[id]/splits` | TM, Admin | Fetch single order with ALL splits + line items for SplitDetailSheet |

---

## 12. Tinter Issue Architecture (v13)

### What it is
Before an operator can Start any job, they must fill the Tinter Issue form.
This records what base paint and tinter shades were issued for that job.

### tinter_issue_entries key fields
```
id
orderId           — FK → orders (always required)
splitId           — FK → order_splits (null for whole-OBD assignments)
tintAssignmentId  — FK → tint_assignments (null for split flow)
submittedById     — FK → users
baseSku           — text e.g. "WC-DB-20"
tinQty            — decimal
YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK, OXR, HEY, HER, COB, COG
                  — decimal, default 0 (13 shade columns, ml or grams)
createdAt
```
- INSERT-ONLY — never update or delete
- One or more rows per job (multiple base batches allowed)
- splitId and tintAssignmentId are mutually exclusive (DB constraint enforced)

### TI gate — enforced on Start
```
Split flow:    order_splits.tiSubmitted must = true
Whole-OBD:     tint_assignments.tiSubmitted must = true
If false → 400 "Please submit the Tinter Issue form before starting"
```

### One-job rule — enforced on Start
```
Check operator_active_job view for this operator.
If any row found → 400 "You already have a job in progress. Complete it first."
```

### operatorSequence vs sequenceOrder — NEVER confuse these
| Field | Table | Set by | Purpose |
|---|---|---|---|
| `sequenceOrder` | order_splits, tint_assignments | Tint Manager (Move Up/Down) | TM Kanban column ordering |
| `operatorSequence` | order_splits, tint_assignments | assign/create-split API via `next_operator_sequence()` | Operator's personal queue order |

### DB helpers
- `next_operator_sequence(operatorId)` — function. Returns MAX+1 across active jobs for that operator.
- `operator_active_job` — view. One row per operator currently in tinting_in_progress.

### Operator sequential rules
- Operator can only have ONE job in `tinting_in_progress` at a time
- Jobs must be worked in `operatorSequence` order (lowest first) — cannot skip
- `tiSubmitted` must be true before Start is allowed (hard gate)
- Operator CAN pre-fill TI for future jobs while current job is running
- `operatorSequence` is set at assignment time via `next_operator_sequence()` function
- `sequenceOrder` (TM Kanban) and `operatorSequence` (operator queue) are DIFFERENT fields on the same row

---

## 13. Tint Manager Kanban — v4 (4-column, splits-aware, full UI)

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
Group 2 — PRIORITY: [All] [🚨 Urgent] [Normal]
Group 3 — DISPATCH: [All] [🚚 Dispatch] [Hold] [Waiting]
Group 4 — TYPE: [All] [Split] [Whole]

### Two-badge status trail
Left badge: always "✓ Tinting Done" (green — bg #eaf3de, border #97c459, text #27500a)
Right badge determined by dispatchStatus:
  'dispatch'                 → 🚚 Dispatch (green)
  'hold'                     → Hold (red)
  'waiting_for_confirmation' → Waiting (amber)
  null / undefined           → Pending Support (blue — bg #eff6ff, border #bfdbfe, text #1e40af)

---

## 14. Tint Operator screen — v4 (65/35 split layout, TI-aware)

### Layout
```
Topbar (52px) — title + layout toggle (split ↔ focus) + clock
Stat bar (4 cells) — Pending | In Progress | Completed Today | Volume Done
Split container:
  LEFT 35%  — Queue panel (bg white)
    Remaining volume today hint
    Queue cards: Active → Next up → #2 #3... queued (grayed)
    Each card shows: TI Done ✓ / TI Needed badge
    "Fill TI now while you're free" nudge on Next Up card
    Completed Today section below divider
  RIGHT 65% — Job Detail panel (bg #f0f2f8)
    Job identity topbar: customer + OBD + stage badges + elapsed timer
    Stage colour strip (blue = in progress, amber = assigned)
    Meta strip: Articles · Volume · Slot · Sales Officer
    SKU lines table with TINT markers
    Tinter Issue Form (always visible inline)
    Footer: Submit TI & Start / Start Job / Mark as Done
```

### Layout toggle
- Split icon — 65/35 side by side (default, tablet)
- Focus icon — right panel full width, queue hidden
- Focus mode: floating FAB (bottom-left) opens queue slide-up sheet

### Operator workflow
```
1. Job appears in queue (assigned by TM)
2. Operator taps queue card → full detail loads on right
3. Operator fills Tinter Issue Form (inline right panel)
4. Taps "Submit TI & Start" → tiSubmitted=true, status→tinting_in_progress
5. Elapsed timer starts
6. Taps "Mark as Done" → status→tinting_done, moves to Completed Today
7. Next job auto-loads in right panel
8. Operator CAN pre-fill TI for future jobs while current job runs
```

### Queue card states
- **Active** — blue header, "Active" badge, elapsed timer
- **Next up** — navy-light header, "Next up" badge, Start enabled if TI done
- **Queued** — grey header, "#N" badge, 55% opacity, TI form accessible
- **Completed** — green header, trail badge, done time

### Key constraints
- ONE job in `tinting_in_progress` at a time per operator (hard rule)
- Jobs worked in `operatorSequence` order (lowest first, cannot skip)
- `tiSubmitted` must be true before Start is allowed (hard gate)
- Operator CAN fill TI for any queued job at any time

### Component file
`components/tint/tint-operator-content.tsx` — NEEDS FULL REWRITE
Reference: `tint-operator-final.html` (final approved design mockup)

---

## 15. Support queue — v3 (splits-aware)

Orders table shows all orders as before.
Edit sheet for tint orders shows:
- Existing order fields (dispatch status, priority, slot override)
- Splits summary section showing all splits for that OBD
- Per-split dispatch status toggle (calls `/api/support/splits/[id]`)
- Split status badges + line items per split

---

## 16. SKU structure (v12)

```
product_category → product_name → sku_master ← base_colour
```
- `grossWeightPerUnit` does NOT exist on sku_master — weight from import file
- `sku_sub_master` REMOVED

---

## 17. Sales Officer Group pattern

```
sales_officer_group.salesOfficerId → sales_officer_master
delivery_point_master.salesOfficerGroupId → sales_officer_group
```

---

## 18. Customer route/type inheritance

1. Area level (default): `area_master.deliveryTypeId` + `area_master.primaryRouteId`
2. Customer level (override): `delivery_point_master.deliveryTypeOverrideId` + `delivery_point_master.primaryRouteId`

Check customer-level first → fall back to area if null.

---

## 19. Audit trail rules — non-negotiable

- `tint_logs` — INSERT-ONLY. Every tint/split action = new row.
- `order_status_logs` — INSERT-ONLY. Every order change = new row.
- `split_status_logs` — INSERT-ONLY. Every split stage change = new row.
- `tinter_issue_entries` — INSERT-ONLY. Every TI submission = new row(s).

Any UPDATE or DELETE on these tables is architecturally wrong.

---

## 20. DB connection rule

⚠️ Direct Prisma DB connection from local machine is unreliable.
All DB schema changes must be done via **Supabase SQL Editor**.
`npx prisma db push` fails locally. Prisma client works fine at runtime.
When schema changes needed: generate SQL → paste into Supabase SQL Editor.
After SQL applied: run `npx prisma generate` in VS Code terminal.

---

## 21. Folder structure

```
/app
  /api/admin          — Admin CRUD API routes
  /api/auth           — NextAuth
  /api/tint/manager   — Tint Manager APIs (orders, assign, splits/*)
  /api/tint/operator  — Tint Operator APIs (my-orders, start, done, split/*, tinter-issue)
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
  schema.prisma       — Source of truth — Schema v13
  seed.ts             — Seed script
```

---

## 22. Phase completion status

| Phase | Status |
|---|---|
| Phase 1 — Foundation (schema, admin, auth) | ✅ Complete |
| Phase 2 — Order pipeline (import, support, tint manager v1, operator) | ✅ Complete |
| Phase 3 — Tint splits + UI polish | ✅ Splits complete · Operator screen redesign in progress |
| Phase 4 — Dispatch planning | ⏳ Not started |
| Phase 5 — Warehouse execution | ⏳ Not started |

---

## 23. Session start checklist

Before generating any code, confirm:
1. You have read this file fully
2. Schema is now **v13** — 42 tables
3. `order_splits` is the PRIMARY unit of work for tinting — not `orders`
4. `split_line_items` stores per-line qty assignments per split
5. `split_status_logs` is INSERT-ONLY — never update or delete
6. `tint_logs`, `order_status_logs`, `tinter_issue_entries` are INSERT-ONLY
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
27. Assigned column sorts CLIENT-SIDE: sequenceOrder → priorityLevel → obdEmailDate+Time ASC
28. Status trail right badge: dispatch→green | hold→red | waiting→amber | null→blue Pending Support
29. isReassign logic checks workflowStage + remainingQty + non-cancelled splits count
30. Assign API has 4 explicit cases — Cases 1+2 always allowed, Case 3 allowed, Case 4 blocked
31. SplitKanbanCard has Eye (SKU sheet) + Layers (SplitDetailSheet) + Plus + ···
32. SplitDetailSheet uses fixed overlay portal — NOT shadcn Sheet
33. SplitDetailSheet fetches fresh from GET /api/tint/manager/orders/[id]/splits on open
34. Split history excludes cancelled splits (filter status !== 'cancelled')
35. Re-assign is in sheet body (tint_assigned only) — Cancel is via ··· menu only
36. SplitCard type requires order.id, rawLineItem.volumeLine, rawLineItem.isTinting
37. `operatorSequence` ≠ `sequenceOrder` — NEVER confuse these two fields
38. TI gate: tiSubmitted must be true before ANY Start action is allowed
39. One-job rule: operator cannot have two jobs in tinting_in_progress simultaneously
40. `operator_active_job` view enforces the one-job rule — always check it on Start
41. `next_operator_sequence(operatorId)` function sets operatorSequence at assignment time
42. Operator screen is a 65/35 split: LEFT 35% = queue, RIGHT 65% = job detail + TI form inline
43. tint-operator-content.tsx needs full rewrite — reference tint-operator-final.html
44. No $transaction blocks in any API route — use sequential Prisma calls (Vercel + Supabase pooler constraint)
45. tinter_issue_entries: splitId and tintAssignmentId are mutually exclusive — DB constraint enforced
46. GET /api/tint/operator/my-orders must return: tiSubmitted, operatorSequence, startedAt, hasActiveJob per job
47. my-orders queue sorted by operatorSequence ASC
48. POST /api/tint/operator/tinter-issue: validates ownership before insert, sets tiSubmitted=true after insert

---

*Version: Phase 3 · Schema v13 · Config Master v2 · Operator Screen v4 · March 2026*