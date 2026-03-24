# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT.md fully before doing anything else."
# Version: Phase 3 · Schema v16 · Config Master v2 · Updated March 2026

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

## 3. Database — 46 tables, 5 groups (Schema v16)

Schema v16 = Schema v15 + per-line TI linking
(rawLineItemId added to tinter_issue_entries + tinter_issue_entries_b;
skuCode added to shade_master; shade_master uniqueness updated;
all 27 shade columns on shade_master are nullable Decimal?).

### Group 1: Setup / Master tables (24 tables — Phase 1 ✅ complete)

```
── Config / Status ──────────────────────────────────────────────────────────
status_master              — UNIFIED status table. All workflow statuses.
                             Domains: dispatch | tinting | pick_list | import | workflow | priority
system_config              — Key-value store. Always read from DB — never hardcode.
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

── Shade Master ──────────────────────────────────────────────────────────────
shade_master               — Saved tint formulas per customer per SKU.
                             See Section 13 for full spec.
```

### Group 2: Import tables (5 tables — Phase 2 ✅ complete)

```
import_batches             — One row per import session.
import_raw_summary         — One row per OBD from header XLS. 18 mapped columns + smuNumber.
                             obdEmailDate + obdEmailTime stored here.
                             smuNumber TEXT (nullable)
                             shipToCustomerId + shipToCustomerName — sourced here for shade matching
import_raw_line_items      — One row per line item. 10 columns including article + articleTag.
                             Back-relations: tinterIssueEntries, tinterIssueEntriesB
import_enriched_line_items — Lines enriched with sku_master join.
import_obd_query_summary   — Per-OBD totals: weight, qty, volume, hasTinting, totalArticle, articleTag.
```

### Group 3: Orders + Tinting + Support (10 tables)

```
orders                     — Parent container. One row per OBD post-import.
order_splits               — One row per tint batch/split. PRIMARY unit of work.
                             Fields: tiSubmitted, operatorSequence
split_line_items           — One row per line assigned to a split.
split_status_logs          — INSERT-ONLY. Audit trail per split.
tint_assignments           — One row per whole-OBD assignment (non-split flow).
                             Fields: tiSubmitted, operatorSequence
tint_logs                  — INSERT-ONLY. Immutable.
order_status_logs          — INSERT-ONLY. Immutable.
tinter_issue_entries       — INSERT-ONLY for new entries. PATCH allowed before tinting_done.
                             One row per tinting SKU line (TINTER type).
                             Fields: orderId, splitId?, tintAssignmentId?, rawLineItemId?,
                             submittedById, baseSku, tinQty, tinterType, packCode,
                             YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK,
                             OXR, HEY, HER, COB, COG, createdAt
tinter_issue_entries_b     — INSERT-ONLY for new entries. PATCH allowed before tinting_done.
                             One row per tinting SKU line (ACOTONE type).
                             Fields: orderId, splitId?, tintAssignmentId?, rawLineItemId?,
                             submittedById, baseSku, tinQty, packCode,
                             YE2, YE1, XY1, XR1, WH1, RE2, RE1, OR1,
                             NO2, NO1, MA1, GR1, BU2, BU1, createdAt
```

### Group 4: Dispatch + Warehouse (7 tables — Phase 3 stubs)

```
vehicle_master, dispatch_plans, dispatch_plan_vehicles, dispatch_plan_orders,
dispatch_change_queue, pick_lists, pick_list_items
```

### Group 5: Delivery Challan (2 tables — v14)

```
delivery_challans          — One row per order. Auto-created on first challan open.
delivery_challan_formulas  — Per-line tinting formula. UNIQUE(challanId, rawLineItemId).
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
order_created → pending_tint_assignment → tint_assigned → tinting_in_progress
→ tinting_done → pending_support → dispatch_confirmation → dispatched

### domain: tinting (split status)
tint_assigned → tinting_in_progress → tinting_done → pending_support
→ dispatch_confirmation → dispatched | cancelled

### domain: dispatch
dispatch | waiting_for_confirmation | hold

### domain: priority
normal | urgent

### domain: import
processing | completed | partial | failed

### domain: pick_list
pending_pick | pick_assigned | picking | pending_verification | ready_for_dispatch
| verification_failed | vehicle_confirmed | loading | loading_complete | dispatched

---

## 6. User roles

| Role | Primary screen | Key permissions |
|---|---|---|
| Admin | /admin | All master data CRUD, system_config, user management, shade master |
| Dispatcher | /dispatcher | Build plans, assign vehicles, confirm, Hold notifications |
| Support | /support | View ALL orders + splits, set dispatch_status, priority, slot override |
| Tint Manager | /tint/manager | Create splits, assign operators, monitor pipeline, Delivery Challans |
| Tint Operator | /tint/operator | Start/Done on jobs. Fill TI form. Save/load shade formulas. |
| Floor Supervisor | /warehouse/supervisor | Assign pickers, verify material, loading |
| Picker | /warehouse/picker | Own assigned OBDs only |

**Import screen roles:** Admin, Dispatcher, Support.
**RBAC rule:** Every API route uses `requireRole(session, ['Role'])` server-side.

---

## 7. Workflow stages

### OBD-level (orders.workflowStage)
```
order_created → pending_tint_assignment → tinting_in_progress
→ pending_support → dispatch_confirmation → dispatched
```

### Split-level (order_splits.status)
```
tint_assigned → (TI submitted → tiSubmitted=true) → tinting_in_progress
→ tinting_done (resting) → pending_support → dispatch_confirmation → dispatched
```

Key rules:
- Each split moves independently
- `tinting_done` IS a resting stage — stays until Support acts
- Completed column: completedAt >= startOfToday — resets midnight
- ALL splits done + no remaining qty → orders = pending_support
- cancelled splits excluded from all qty calculations

---

## 8. OBD Import — column mapping

### Source files
| File | Sheet |
|---|---|
| OBD Header XLS | `LogisticsTrackerWareHouse` |
| Line Items XLS | `Sheet1` (PowerShell merger) |

### import_raw_line_items fields
obdNumber, lineId, skuCodeRaw, skuDescriptionRaw, batchCode, unitQty, volumeLine,
isTinting (bool), article, articleTag

### PowerShell OBD merger tool
`C:\Users\HP\OneDrive\Orbit OMS\OBD-Tools\`
- `pack-sizes.txt` — pack size → type + carton qty
- `tinting-keywords.txt` — keywords marking line as tinting

---

## 9. Slot assignment logic
No hardcoded cutoff times. All rules in `slot_master` + `delivery_type_slot_config`.

---

## 10. system_config keys

| Key | Purpose |
|---|---|
| `soft_lock_minutes_before_cutoff` | Plan soft-lock |
| `hard_lock_minutes_before_cutoff` | Plan hard-lock |
| `ready_escalation_minutes` | Escalation timer |
| `upgrade_small_overflow_pct` | Max overflow % |
| `upgrade_max_dealer_combo` | Max dealers concentration |
| `aging_priority_days` | Days before tier-3 priority |
| `aging_alert_days` | Days before escalation |
| `change_queue_urgent_alert` | Urgent Hold notifications |
| `company_name` | Challan header |
| `company_subtitle` | Challan header |
| `depot_address` | Challan header |
| `depot_mobile` | Challan header |
| `gstin` | Challan header/footer |
| `tejas_contact` | Challan header |
| `registered_office` | Challan footer |
| `website` | Challan footer |

**All system_config values must always be read from DB — never hardcode.**

---

## 11. Tint Splits Architecture

### Core concept
`order_splits` = PRIMARY unit of work. `orders` = parent container only.

### order_splits key fields
```
id, orderId, splitNumber, assignedToId, assignedById
status, dispatchStatus, totalQty, totalVolume, articleTag
sequenceOrder    — TM Kanban reorder (NOT operator queue)
tiSubmitted      — true once TI form submitted for this split
operatorSequence — operator's personal queue position (set at creation)
startedAt, completedAt, createdAt, updatedAt
```

### Business rules
| Rule | Detail |
|---|---|
| Create + assign | Always one step |
| TI required | At least one TI entry must be submitted before Start |
| Done gate | ALL isTinting lines must have TI entries before Done allowed |
| One job at a time | Hard rule per operator |
| Sequential order | Operator works by operatorSequence ASC |
| Cancel split | Only when status = tint_assigned |
| Completed column | completedAt >= startOfToday, resets midnight |

### API routes

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/tint/manager/orders` | TM, Admin | All kanban data incl. completedAssignments |
| GET | `/api/tint/manager/operators` | TM, Admin | Active tint operators |
| POST | `/api/tint/manager/assign` | TM, Admin | Assign whole OBD |
| POST | `/api/tint/manager/cancel-assignment` | TM, Admin | Cancel assignment |
| POST | `/api/tint/manager/splits/create` | TM, Admin | Create splits |
| POST | `/api/tint/manager/splits/reassign` | TM, Admin | Reassign split |
| POST | `/api/tint/manager/splits/cancel` | TM, Admin | Cancel split |
| GET | `/api/tint/operator/my-orders` | Operator | Queue + completed today (splits + assignments) |
| POST | `/api/tint/operator/tinter-issue` | Operator | Submit TINTER TI entries |
| GET | `/api/tint/operator/tinter-issue/[id]` | Operator | Fetch TINTER entries |
| PATCH | `/api/tint/operator/tinter-issue/[entryId]` | Operator | Edit existing TINTER entry (before Done) |
| POST | `/api/tint/operator/start` | Operator | Start whole OBD |
| POST | `/api/tint/operator/done` | Operator | Complete whole OBD (TI completeness gate) |
| POST | `/api/tint/operator/split/start` | Operator | Start split |
| POST | `/api/tint/operator/split/done` | Operator | Complete split (TI completeness gate) |
| PATCH | `/api/tint/manager/orders/[id]/status` | TM, Admin | Set status on order |
| PATCH | `/api/tint/manager/splits/[id]/status` | TM, Admin | Set status on split |
| GET | `/api/support/orders` | Support, Admin | All orders + splits |
| PATCH | `/api/support/orders/[id]` | Support, Admin | Update order |
| PATCH | `/api/support/splits/[id]` | Support, Admin | Update split |
| GET | `/api/tint/manager/orders/[id]/splits` | TM, Admin | Single order splits |

---

## 12. Tinter Issue Architecture (v17)

### Two tinter types
| Enum | Brand | Table | Columns |
|---|---|---|---|
| `TINTER` | Tinter | `tinter_issue_entries` | YOX LFY GRN TBL WHT MAG FFR BLK OXR HEY HER COB COG (13) |
| `ACOTONE` | Acotone | `tinter_issue_entries_b` | YE2 YE1 XY1 XR1 WH1 RE2 RE1 OR1 NO2 NO1 MA1 GR1 BU2 BU1 (14) |

### Pack codes enum
`500ml | 1L | 4L | 10L | 20L` — fixed list.
Prisma enum keys: `ml_500 | L_1 | L_4 | L_10 | L_20`
API accepts BOTH display values ("20L") AND enum keys ("L_20") via PACK_CODE_MAP.

### packCode derivation in UI
```typescript
derivePackCode(volumeLine, unitQty):
  packSize = volumeLine / unitQty
  >= 20 → 'L_20' | >= 10 → 'L_10' | >= 4 → 'L_4' | >= 1 → 'L_1' | else → 'ml_500'
```

### Per-line TI model
Each TI entry = ONE tinting SKU line from the OBD.
`rawLineItemId` links entry back to `import_raw_line_items`.

### tinter_issue_entries fields
```
id, orderId, splitId?, tintAssignmentId?, rawLineItemId?,
submittedById, baseSku, tinQty, tinterType, packCode,
YOX…COG, createdAt
```

### tinter_issue_entries_b fields
```
id, orderId, splitId?, tintAssignmentId?, rawLineItemId?,
submittedById, baseSku, tinQty, packCode,
YE2…BU1, createdAt
```

### Edit rule (EXCEPTION to INSERT-ONLY)
PATCH is allowed on both TI tables BEFORE job reaches tinting_done.
Once job = tinting_done or later → entries are locked, PATCH returns 403.
Ownership check: submittedById = session user OR split/assignment assignedToId = session user.

### TI gate (Start)
At least ONE TI entry must exist (tiSubmitted = true) before Start allowed.

### Done gate (NEW v17)
ALL isTinting lines must have at least one TI entry (rawLineItemId covered)
before Done is allowed. Returns 400 with missingLines array if incomplete.

### One-job rule
`operator_active_job` view — check on every Start action.

### API routes (v17)

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/tint/operator/tinter-issue` | Operator | Submit TINTER entries |
| GET | `/api/tint/operator/tinter-issue/[id]` | Operator | Fetch TINTER entries |
| PATCH | `/api/tint/operator/tinter-issue/[entryId]` | Operator | Edit TINTER entry (before Done) |
| POST | `/api/tint/operator/tinter-issue-b` | Operator | Submit ACOTONE entries |
| GET | `/api/tint/operator/tinter-issue-b/[id]` | Operator | Fetch ACOTONE entries |
| PATCH | `/api/tint/operator/tinter-issue-b/[entryId]` | Operator | Edit ACOTONE entry (before Done) |
| GET | `/api/tint/operator/shades` | Operator, TM, Admin | Shades by customer+tinterType. skuCode+packCode → suggestions mode with lastUsedAt |
| POST | `/api/tint/operator/shades` | Operator, TM, Admin | Create shade (409 on duplicate) |
| PUT | `/api/tint/operator/shades/[id]` | Operator, TM, Admin | Overwrite shade |
| GET | `/api/admin/shades` | Operator, TM, Admin | Paginated shade list |
| PATCH | `/api/admin/shades/[id]` | Operator, TM, Admin | Toggle isActive |

### DB helpers
- `next_operator_sequence(operatorId)` — MAX+1 across active jobs
- `operator_active_job` — view, one row per operator in tinting_in_progress

---

## 13. Shade Master Architecture (v17)

### shade_master key fields
```
id
shadeName           — user-defined name
shipToCustomerId    — TEXT (from import_raw_summary — NOT FK to delivery_point_master)
shipToCustomerName  — TEXT
tinterType          — TinterType enum (TINTER | ACOTONE)
packCode            — PackCode enum (500ml | 1L | 4L | 10L | 20L)
skuCode             — TEXT (skuCodeRaw from import_raw_line_items)
baseSku             — TEXT
tinQty              — decimal
-- TINTER columns (Decimal? nullable when ACOTONE): YOX LFY GRN TBL WHT MAG FFR BLK OXR HEY HER COB COG
-- ACOTONE columns (Decimal? nullable when TINTER): YE2 YE1 XY1 XR1 WH1 RE2 RE1 OR1 NO2 NO1 MA1 GR1 BU2 BU1
createdById, isActive, createdAt, updatedAt
```

### CRITICAL: All 27 shade columns are Decimal? (nullable) in Prisma schema
TINTER shade → ACOTONE columns are null. ACOTONE shade → TINTER columns are null.
Never define these as non-nullable — will cause P2032 runtime errors.

### Uniqueness constraint
`UNIQUE (shipToCustomerId, shadeName, skuCode, packCode, tinterType)`

### packCode API validation
API uses PACK_CODE_MAP to accept both display values AND enum keys:
```
'500ml' → PackCode.ml_500
'1L'    → PackCode.L_1
'4L'    → PackCode.L_4
'10L'   → PackCode.L_10
'20L'   → PackCode.L_20
'ml_500', 'L_1', 'L_4', 'L_10', 'L_20' → also accepted
```
Apply this mapping in ALL shade API routes (GET suggestions, POST, PUT).

### shipToCustomerId source
ALWAYS from `import_raw_summary.shipToCustomerId` — NOT from orders table.
The my-orders API fetches import_raw_summary and overrides shipToCustomerId/Name
on every job/split in the response. UI uses this value for shade lookups.

### Shade suggestion matching
GET /api/tint/operator/shades with skuCode + packCode → suggestions mode:
- Matches: shipToCustomerId + tinterType + skuCode + packCode + isActive
- Returns lastUsedAt (MAX createdAt from TI table for that shade's baseSku)
- Sorted by lastUsedAt DESC (most recent first, nulls last)
- Max 3 shown in UI, "+ N more" expands all

### Rules
- Shade creation: operator TI form only — never from admin
- Admin/TM/Operator: deactivate/reactivate via PATCH /api/admin/shades/[id]
- Any operator can use any saved shade — not locked to creator
- TINTER and ACOTONE shades completely separate — no cross-fill ever
- Selecting shade from Browse all shades → auto-matches SKU line by shade.skuCode

---

## 14. TI Form UI — Smart Single Form (v17)

The TI form is a single scrollable form (NOT a wizard). Multiple entries possible.

### Form structure per entry

```
[Tinter] [Acotone]          ← top-level tinter selector (shared across entries)

ALL SAVED SHADES            ← combobox, all active shades for customer + tinterType
  Browse all shades...        On select → auto-fills SKU + qty + shade values

ENTRY 1
  Base SKU [dropdown ▼]     ← only isTinting=true lines from this OBD
    {skuCodeRaw} · {desc} · {unitQty} qty · {packCode}
    On select → fills tinQty, packCode, rawLineItemId, skuCodeRaw
              → triggers suggestions fetch
              → if existing TI entry for this line → enters edit mode + pre-fills

  SUGGESTIONS               ← shown only when SKU selected + matches exist
    🎨 {shadeName} · {pack}   Last used: DD MMM YYYY    [Use this]
    (max 3, expand link if more)

  TIN QTY [____]  PACK SIZE [read-only derived]

  Selected shade: 🎨 {name}  [Clear ×]   ← shown when shade selected
  (clears shade + resets shade columns + shows all columns)

  SHADE QUANTITIES
    When shade selected → only non-zero columns shown
    When no shade → all columns shown
    [+ Show all columns (N hidden)] / [− Show active only] toggle

  Save as shade formula [Switch]
    ON → Shade name [input]
    Saves on submit → POST /api/tint/operator/shades with skuCode

[+ Add Another Entry]

Submit button:
  tint_assigned status     → "Submit TI & Start"
  tinting_in_progress      → "Add TI Entry" (no Start called again)
  editingEntryId set       → "Update TI Entry" (PATCH instead of POST)
```

### Edit mode
- Clicking ✅ row in TI Coverage strip → enters edit mode for entry 1
- Selecting done SKU from Base SKU dropdown → auto-enters edit mode
- "Editing existing entry" indigo badge + "Cancel edit" link shown
- On submit → PATCH /api/tint/operator/tinter-issue/[entryId] or tinter-issue-b/[entryId]
- After PATCH → refresh existingTIEntries, clear edit mode, show "TI entry updated" toast

### TI Coverage strip
Shown above TI form for all jobs with tinting lines.
- ✅ green row — rawLineItemId has at least one TI entry
- ⏳ amber row — no TI entry yet
- Green row shows non-zero shade values as compact reference: "YOX: 10  LFY: 50"
- Tinter/Acotone badge per row
- Summary: "N of M lines covered" (green when all done, amber when partial)
- Clicking any row → pre-fills entry 1 form
- Updates after every TI submit or edit

### Zero tinting lines
If job has no isTinting=true lines → hide TI form entirely → Start allowed directly.

### packCode display
packCode is DERIVED from line data (derivePackCode) — shown as read-only text.
Operator never selects pack size manually.

---

## 15. Tint Manager Kanban — v4

### Column data sources
| Column | Filter |
|---|---|
| Pending Assignment | workflowStage = pending_tint_assignment OR (tint_assigned/tinting_in_progress AND remainingQty > 0) |
| Assigned | splits.status = tint_assigned + orders tint_assigned remainingQty=0 |
| In Progress | splits.status = tinting_in_progress + orders tinting_in_progress remainingQty=0 |
| Completed | splits (completedAt >= today) + tint_assignments (completedAt >= today, status=tinting_done) |

### remainingQty
Computed API-side. When > 0 → order stays in Pending. When = 0 → moves to stage column.

### Assign vs Create Split
- hasSplits = non-cancelled splits count > 0
- hasSplits = false → Assign button
- hasSplits = true → Create Split only — direct assign blocked

### + button popover
Fixed positioning via getBoundingClientRect(). Priority + Dispatch Status toggles.

### Filter bar
44px. 4 groups: SLOT | PRIORITY | DISPATCH | TYPE. All client-side.

### Two-badge status trail
Left: ✓ Tinting Done (green)
Right: dispatch→green | hold→red | waiting→amber | null→blue Pending Support

---

## 16. Tint Operator screen — v5

### Layout
```
Topbar (52px) + Stat bar (4 cells)
LEFT 35%  — Queue panel
RIGHT 65% — Job detail + TI form (inline)
```

### Operator workflow
```
1. Job appears in queue (assigned by TM)
2. Select job → detail + TI form loads right
3. Select tinter type (Tinter / Acotone)
4. Select Base SKU from dropdown → qty + pack auto-fill + suggestions appear
5. Optionally select saved shade → form auto-fills + collapse to non-zero columns
6. Fill/review shade quantities
7. Optionally save as shade formula
8. Submit TI & Start → tiSubmitted=true → job starts
9. TI form stays open — fill remaining lines as needed
10. For each additional line → Add TI Entry
11. Try Mark as Done → if missing lines → warning panel shows
12. Fill missing lines → Mark as Done → tinting_done → Completed Today
13. Next job auto-loads
```

### Key constraints
- ONE job in tinting_in_progress at a time (hard)
- Jobs in operatorSequence order (lowest first)
- At least one TI entry required before Start (tiSubmitted gate)
- ALL isTinting lines must have TI entries before Done (Done gate)
- TI form visible and editable in BOTH tint_assigned AND tinting_in_progress
- TI entries locked after tinting_done — PATCH returns 403
- rawLineItemId stored on every TI entry
- shipToCustomerId for shade lookup comes from import_raw_summary via my-orders API

---

## 17. Support queue — v3
Orders table + edit sheet showing splits + per-split dispatch status toggle.

---

## 18. SKU structure
`product_category → product_name → sku_master ← base_colour`
grossWeightPerUnit does NOT exist on sku_master.

---

## 19. Sales Officer Group pattern
`sales_officer_group.salesOfficerId → sales_officer_master`
`delivery_point_master.salesOfficerGroupId → sales_officer_group`

---

## 20. Customer route/type inheritance
1. Area level: area_master.deliveryTypeId + area_master.primaryRouteId
2. Customer override: delivery_point_master.deliveryTypeOverrideId + primaryRouteId
Check customer first → fall back to area if null.

---

## 21. Audit trail rules
- tint_logs, order_status_logs, split_status_logs — INSERT-ONLY always
- tinter_issue_entries, tinter_issue_entries_b — INSERT-ONLY for new entries
  EXCEPTION: PATCH allowed before tinting_done for editing submitted entries
Any UPDATE or DELETE beyond the above is architecturally wrong.

---

## 22. DB connection rule
⚠️ All schema changes via Supabase SQL Editor — never `npx prisma db push`.
After SQL: run `npx prisma generate` in VS Code terminal.
After .next cache corruption: `Remove-Item -Recurse -Force .next` then `npm run dev`.

---

## 23. Folder structure

```
/app
  /api/admin/shades                       — GET paginated | PATCH isActive
  /api/admin/shades/[id]                  — PATCH isActive
  /api/tint/manager                       — Kanban APIs
  /api/tint/manager/challans              — Challan list
  /api/tint/manager/challans/[id]         — GET + PATCH challan
  /api/tint/operator                      — Operator APIs
  /api/tint/operator/shades               — GET (suggestions mode) | POST create
  /api/tint/operator/shades/[id]          — PUT overwrite
  /api/tint/operator/tinter-issue         — TINTER TI submit
  /api/tint/operator/tinter-issue/[id]    — GET fetch | PATCH edit (before Done)
  /api/tint/operator/tinter-issue-b       — ACOTONE TI submit
  /api/tint/operator/tinter-issue-b/[id]  — GET fetch | PATCH edit (before Done)
  /api/tint/operator/my-orders            — Queue + completed. Includes shipToCustomerId from import_raw_summary.
  /api/support                            — Support APIs
  /api/import                             — Import API
  /(admin)                                — Admin layout
  /(dispatcher)                           — Dispatcher layout
  /(support)                              — Support layout
  /(tint)                                 — Tint layout
  /(tint)/challan                         — Delivery Challan
  /(tint)/shades                          — Shade Master screen (Operator + TM + Admin)
  /(warehouse)                            — Warehouse layout
/components
  /tint
    tint-manager-content.tsx
    tint-operator-content.tsx              — Smart single-form TI (v17)
    shade-master-content.tsx
    split-builder-modal.tsx
    sku-details-sheet.tsx
    challan-content.tsx
    challan-document.tsx
/lib
  prisma.ts, auth.ts, rbac.ts, config.ts
/prisma
  schema.prisma                            — Schema v16
```

---

## 24. Phase completion status

| Phase | Status |
|---|---|
| Phase 1 — Foundation | ✅ Complete |
| Phase 2 — Order pipeline | ✅ Complete |
| Phase 3 — Tint splits + UI polish | ✅ Complete |
| Phase 3.5 — Delivery Challan | 🔄 In progress |
| Phase 3.6 — Shade Master + Acotone + Smart TI form | ✅ Complete |
| Phase 4 — Dispatch planning | ⏳ Not started |
| Phase 5 — Warehouse execution | ⏳ Not started |

---

## 25. Delivery Challan — feature spec (v14)

### Route & auth
- Route: `/(tint)/challan`
- Auth: TM + Admin — `requireRole(['TINT_MANAGER', 'ADMIN'])`

### API routes
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/tint/manager/challans` | Paginated list |
| GET | `/api/tint/manager/challans/[orderId]` | Full data. Auto-creates challan if not exists. |
| PATCH | `/api/tint/manager/challans/[orderId]` | Save transporter, vehicleNo, formulas, printedAt |

### Challan number: `CHN-{YEAR}-{5-digit}` — server-side only
### Editable fields: Transporter | Vehicle No. | Formula (isTinting rows only)
### Print: @media print hides all chrome, shows document only

---

## 26. Session start checklist

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v16** — 46 tables. Context file is v17.
3. `order_splits` is the PRIMARY unit of work for tinting — not `orders`
4. `split_status_logs`, `tint_logs`, `order_status_logs` are INSERT-ONLY always
5. `tinter_issue_entries` + `tinter_issue_entries_b` — INSERT-ONLY for new, PATCH allowed before tinting_done
6. Each split has its own independent lifecycle
7. `tinting_done` IS a resting stage for splits
8. Completed column: completedAt >= today, resets midnight
9. All DB schema changes go via Supabase SQL Editor — never `prisma db push`
10. Run `npx prisma generate` after every SQL migration
11. Never install new libraries unless explicitly instructed
12. Read existing files before modifying them
13. All status references use status_master with domain filter
14. `remainingQty` computed by API — never compute client-side
15. `hasSplits` MUST exclude cancelled splits
16. Topbar `sticky top-0 z-40`, filter bar `sticky top-[52px] z-40`
17. `+` button uses fixed positioning via getBoundingClientRect()
18. Two-badge trail on BOTH KanbanCard AND SplitKanbanCard
19. Assigned column sorts CLIENT-SIDE: sequenceOrder → priorityLevel → obdDate+Time
20. `operatorSequence` ≠ `sequenceOrder` — NEVER confuse
21. TI gate (Start): at least one TI entry (tiSubmitted=true) before Start
22. Done gate: ALL isTinting lines must have TI entries — returns 400 + missingLines if not
23. One-job rule: operator_active_job view — check on every Start
24. `next_operator_sequence(operatorId)` sets sequence at assignment
25. Operator screen: LEFT 35% queue, RIGHT 65% job detail + TI form
26. TI form visible in BOTH tint_assigned AND tinting_in_progress
27. Challan auto-created on first GET — never client-generated
28. Challan number server-side only
29. Formula editable ONLY on isTinting=true rows
30. smuNumber nullable — placeholder if null, never throw
31. **TWO tinter types: TINTER (13 cols) and ACOTONE (14 cols) — separate tables**
32. **tinter_issue_entries = TINTER. tinter_issue_entries_b = ACOTONE**
33. **shade_master: ALL 27 shade columns are Decimal? (nullable) — NEVER non-nullable**
34. **shade_master: shipToCustomerId + skuCode are TEXT — NOT FKs**
35. **Shade uniqueness: shipToCustomerId + shadeName + skuCode + packCode + tinterType**
36. **Pack codes: 500ml | 1L | 4L | 10L | 20L — Prisma keys: ml_500 L_1 L_4 L_10 L_20**
37. **API uses PACK_CODE_MAP — accepts both display values AND enum keys**
38. **shipToCustomerId for shade lookup ALWAYS from import_raw_summary — not orders table**
39. **my-orders API fetches import_raw_summary and overrides shipToCustomerId on all jobs**
40. **Shade creation: operator TI form only — admin can only deactivate/reactivate**
41. **TI form: smart single form — Base SKU dropdown drives auto-fill**
42. **Only isTinting=true lines shown in Base SKU dropdown**
43. **packCode is derived (derivePackCode) — read-only display, operator never selects**
44. **rawLineItemId stored on every TI entry — links entry to SKU line**
45. **Suggestions: match customer + skuCode + packCode + tinterType — show lastUsedAt**
46. **Browse all shades → auto-matches SKU line by shade.skuCode if match found**
47. **Shade selected → collapse to non-zero columns + show "Selected shade" pill**
48. **Edit mode: clicking ✅ TI Coverage row OR selecting done SKU → PATCH not POST**
49. **TI Coverage strip shows shade values inline for ✅ done lines**
50. **Done warning panel lists missing lines — clears when all lines covered**

---

*Version: Phase 3 · Schema v16 · Context v17 · Config Master v2 · Operator Screen v5 · March 2026*