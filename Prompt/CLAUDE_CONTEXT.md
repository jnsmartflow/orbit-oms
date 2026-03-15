# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT.md fully before doing anything else."
# Version: Phase 2 · Schema v11 · Config Master v2 · Updated March 2026

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

## 3. Database — 38 tables, 4 groups (Schema v11)

Schema v11 = Schema v10 Phase 2 stubs expanded to full definitions.

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
vehicle_master             — Phase 3 table. transporterId FK → transporter_master.

── Geography & Delivery ─────────────────────────────────────────────────────
delivery_type_master       — Local | Upcountry | IGT | Cross. Drives slot rules.
slot_master                — Dispatch slot definitions. Admin-managed. No hardcoded times.
delivery_type_slot_config  — Per-delivery-type slot rules (time_based or default windows).
route_master               — Named routes: Varacha, Bharuch, Adajan, Surat City…
area_master                — Areas. delivery_type AND primaryRoute live here.
                             primaryRouteId FK → route_master
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

### Group 2: Import tables (5 tables — Phase 2 ✅ full definitions)

```
import_batches             — One row per import session.
                             Fields: batchRef, importedById, headerFile, lineFile,
                             totalObds, skippedObds, failedObds, status
import_raw_summary         — One row per OBD from header XLS.
                             18 mapped columns from SAP export. rowStatus per row.
import_raw_line_items      — One row per line item from line items XLS.
                             8 columns. rowStatus per row.
import_enriched_line_items — Written on confirm. Lines enriched with sku_master join.
                             Includes computed lineWeight.
import_obd_query_summary   — One row per OBD. Computed totals: weight, qty, volume, hasTinting.
```

### Group 3: Orders + Tinting + Support (5 tables — Phase 2 ✅ full definitions)

```
orders                     — Core order table. One row per OBD post-import.
                             Key fields: obdNumber, orderType, workflowStage,
                             dispatchSlot, dispatchSlotDeadline, dispatchStatus,
                             customerId, priorityLevel
order_splits               — Phase 3. Stub only.
tint_assignments           — Tint operator assignments per order.
tint_logs                  — INSERT-ONLY. Immutable tint audit trail.
order_status_logs          — INSERT-ONLY. Immutable order audit trail.
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

## 4. REMOVED TABLES (v10) — never reference these

| Table | Replaced by |
|---|---|
| `sku_sub_master` | `base_colour` FK on `sku_master` |
| `dispatch_status_master` | `status_master` domain=dispatch |
| `tinting_status_master` | `status_master` domain=tinting |
| `delivery_priority_master` | `status_master` domain=priority |

---

## 5. status_master — all statuses by domain

Query pattern: **always** filter `WHERE domain = '<domain>'`.

### domain: import
| code | label |
|---|---|
| processing | Processing |
| completed | Completed |
| partial | Partial |
| failed | Failed |

### domain: workflow
| code | label |
|---|---|
| order_created | Order Created |
| pending_tint_assignment | Pending Tint Assignment |
| tinting_in_progress | Tinting In Progress |
| tinting_done | Tinting Done |
| pending_support | Pending Support |
| dispatch_confirmation | Dispatch Confirmation |
| dispatched | Dispatched |

### domain: priority
| code | label |
|---|---|
| normal | Normal |
| urgent | Urgent |

### domain: dispatch
| code | label |
|---|---|
| dispatch | Dispatch |
| waiting_for_confirmation | Waiting for Confirmation |
| hold | Hold |

### domain: tinting
| code | label |
|---|---|
| pending_tint_assignment | Pending Tint Assignment |
| tinting_in_progress | Tinting In Progress |
| tinting_done | Tinting Done |

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
| Support | /support | View ALL orders, set dispatch_status, priority, slot override |
| Tint Manager | /tint/manager | Assign tint operators via Kanban |
| Tint Operator | /tint/operator | Start/Done on assigned OBDs only |
| Floor Supervisor | /warehouse/supervisor | Assign pickers, verify material, control loading |
| Picker | /warehouse/picker | Own assigned OBDs only — blank until assigned |

**Import screen roles:** Admin, Dispatcher, Support — all three can access /import.

**RBAC rule**: Every API route uses `requireRole(session, ['Role'])` server-side. Never trust client-side checks.

---

## 7. Workflow stages

```
order_created
  ↓ (if tint order)
pending_tint_assignment → tinting_in_progress → tinting_done
  ↓ (all orders converge here)
pending_support
  ↓
dispatch_confirmation   ← Support sets dispatch_status = 'dispatch'
  ↓
dispatched
```

**Routing fork at import:**
- ANY line item has `Tinting = true` → `orderType = 'tint'` → `workflowStage = pending_tint_assignment`
- ALL line items have `Tinting = false` → `orderType = 'non_tint'` → `workflowStage = pending_support`
- Tinting flag is DERIVED from line items. Never trust the header-level Tinting column alone.

**Support visibility:** Support can see and act on ALL orders regardless of tint/non-tint status and regardless of where they are in tinting.

**Stage 4 Hold:** If Support sets dispatch_status = hold AND order is already on a draft dispatch plan → system writes a row to `dispatch_change_queue`. Dispatcher manually removes the order. No auto-removal.

---

## 8. OBD Import — XLS column mapping (Phase 2)

### Source files
| File | Sheet name |
|---|---|
| OBD Header XLS | `LogisticsTrackerWareHouse` |
| Line Items XLS | `Sheet1` |

### OBD Header → import_raw_summary (18 columns mapped)

| XLS column (exact) | DB field | Type | Notes |
|---|---|---|---|
| `OBD Number` | `obdNumber` | String | Primary key for dedup check |
| `Status` | `sapStatus` | String? | SAP status, stored as-is |
| `SMU` | `smu` | String? | |
| `SMU Code` | `smuCode` | String? | |
| `MaterialType` | `materialType` | String? | |
| `NatureOfTransaction` | `natureOfTransaction` | String? | |
| `Warehouse` | `warehouse` | String? | |
| `OBD Email Date` | `obdEmailDate` | DateTime? | Used for slot calculation |
| `OBD Email Time` | `obdEmailTime` | String? | Stored as "HH:MM" |
| `UnitQty` | `totalUnitQty` | Int? | Header-level total |
| `GrossWeight` | `grossWeight` | Float? | Header-level total |
| `Volume` | `volume` | Float? | Header-level total |
| `Bill To Customer Id` | `billToCustomerId` | String? | Billing party |
| `Bill To Customer Name` | `billToCustomerName` | String? | Billing party name |
| `ShipToCustomerId` | `shipToCustomerId` | String? | FK → delivery_point_master.customerCode |
| `Ship To Customer Name` | `shipToCustomerName` | String? | Stored as-is |
| `InvoiceNo` | `invoiceNo` | String? | |
| `InvoiceDate` | `invoiceDate` | DateTime? | |

**All other 44 columns in the header file are ignored.**

### Line Items → import_raw_line_items (all 8 columns)

| XLS column (exact) | DB field | Type | Notes |
|---|---|---|---|
| `obd_number` | `obdNumber` | String | FK to header |
| `line_id` | `lineId` | Int | SAP line number |
| `sku_codes` | `skuCodeRaw` | String | Joined → sku_master.skuCode |
| `sku_description` | `skuDescriptionRaw` | String? | Stored as-is |
| `batch_code` | `batchCode` | String? | Nullable |
| `unit_qty` | `unitQty` | Int | |
| `volume_line` | `volumeLine` | Float? | |
| `Tinting` | `isTinting` | Boolean | Per-line tinting flag |

### Computed fields (derived at enrich stage)

| Field | Logic | Written to |
|---|---|---|
| `orderType` | `ANY(line.isTinting = true)` → `'tint'` else `'non_tint'` | `orders` |
| `workflowStage` | `orderType = 'tint'` → `pending_tint_assignment` else `pending_support` | `orders` |
| `dispatchSlot` | OBD Email Date + Time evaluated against delivery_type_slot_config | `orders` |
| `lineWeight` | `unitQty × sku_master.grossWeightPerUnit` — NOTE: weight IS on sku_master in v11 (see Section 10) | `import_enriched_line_items` |
| `totalWeight` | `SUM(lineWeight)` per OBD | `import_obd_query_summary` |
| `customerId` | `delivery_point_master WHERE customerCode = shipToCustomerId` | `orders` |

### Import behaviour decisions (locked)

| Decision | Choice |
|---|---|
| Duplicate OBD handling | Skip that OBD, import the rest |
| Invalid rows (bad SKU) | Show in preview — user unchecks before confirming |
| Tinting flag source | Derived from line items (ANY isTinting = true) |
| Slot timestamp source | OBD Email Date + OBD Email Time from the file |
| Import screen location | Shared `/import` route — accessible to Admin, Dispatcher, Support |

### rowStatus values (per OBD and per line)

| Value | Meaning |
|---|---|
| `valid` | Ready to import |
| `duplicate` | OBD number already exists in orders table — pre-unchecked in UI |
| `error` | Unknown customer (header) or unknown SKU (line item) |

---

## 9. Slot assignment logic (v10/v11 — fully config-driven)

**No hardcoded cutoff times anywhere in the codebase.**

All slot rules live in `slot_master` + `delivery_type_slot_config`.

**Slot determination at import time:**
1. Parse `obdEmailDate` + `obdEmailTime` from the import file into a DateTime.
2. Read `delivery_type_slot_config` for the order's delivery type (from customer's area or override).
3. If `slotRuleType = time_based`: evaluate OBD time against `windowStart`/`windowEnd` in sortOrder. First match wins.
4. If `slotRuleType = default`: assign that slot unconditionally.
5. `isDefault = true` row = fallback if no window matches.
6. If `obdEmailDate` or `obdEmailTime` is null → use `isDefault = true` slot.
7. Slot is **set once at import and never auto-recalculated**.

**Current seed rules for Local delivery type:**
| Window | Slot |
|---|---|
| 00:00 – 10:29 | Morning 10:30 |
| 10:30 – 12:29 | Afternoon 12:30 |
| 12:30 – 15:29 | Evening 15:30 |
| 15:30 – 17:59 | Night 18:00 (isDefault = true) |
| 18:00 – 23:59 | Next Day Morning 10:30 |

**Upcountry:** Single default slot = Night 18:00.

**Slot override:** Both Support and Dispatcher can override. Written to `orders.dispatchSlotOverride`. Audit trail in `order_status_logs`.

---

## 10. system_config — 8 keys (v10/v11)

`dispatch_cutoff_time` does NOT exist. Slot timing is in `slot_master` + `delivery_type_slot_config`.

| Key | Default | Purpose |
|---|---|---|
| `soft_lock_minutes_before_cutoff` | 30 | Plan enters soft-lock |
| `hard_lock_minutes_before_cutoff` | 15 | Plan enters hard-lock |
| `ready_escalation_minutes` | 10 | Escalation timer after material ready |
| `upgrade_small_overflow_pct` | 12 | Max overflow % before upgrade suggested |
| `upgrade_max_dealer_combo` | 3 | Max dealers in concentration check |
| `aging_priority_days` | 2 | Days before order elevates to tier-3 priority |
| `aging_alert_days` | 3 | Days before escalation alert fires |
| `change_queue_urgent_alert` | true | Urgent Hold notifications shown prominently |

---

## 11. SKU structure (v11)

Each SKU row = one unique product + colour combination.

```
product_category → product_name → sku_master ← base_colour
```

- `grossWeightPerUnit` **exists on sku_master in v11** — required for lineWeight calculation at enrichment.
- `sku_sub_master` REMOVED. Colour variants are separate sku_master rows.
- Use `base_colour.name = 'N/A'` for non-tint SKUs with no colour variant.

---

## 12. Sales Officer Group pattern

```
sales_officer_group.salesOfficerId → sales_officer_master
delivery_point_master.salesOfficerGroupId → sales_officer_group
```

- Customer belongs to exactly one group.
- To reassign entire group: `UPDATE sales_officer_group SET salesOfficerId = <new>`
- To move one customer: `UPDATE delivery_point_master SET salesOfficerGroupId = <new_group>`

---

## 13. Customer route/type inheritance

Two-level inheritance:
1. **Area level** (default): `area_master.deliveryTypeId` and `area_master.primaryRouteId`
2. **Customer level** (override): `delivery_point_master.deliveryTypeOverrideId` and `delivery_point_master.primaryRouteId`

Application logic: check customer-level override first → fall back to area value if null.

---

## 14. The 16 dispatch logic rules (Phase 3)

**Vehicle assignment (L1–L3):**
- L1: ≤900kg + local = Light. 901–2000kg OR upcountry = Medium. >2000kg = Heavy.
- L2: vehicle_id must be set before plan confirmed.
- L3: vehicle locked permanently once loading starts.

**Priority sort (L4) — 6 tiers:**
1. Key Customer / Key Site
2. Urgent priority
3. Aged ≥ aging_priority_days
4. Earliest dispatch_slot_deadline
5. Address group (same ship_to + slot), heaviest first
6. Weight DESC

**Overflow (L5–L8):** See dispatch logic docs.
**Rolling wave (L9–L12):** Soft lock → hard lock transitions.
**Warehouse execution (L13–L16):** Picker assignment, discrepancy, escalation, tint gate.

---

## 15. Audit trail rules — non-negotiable

- `tint_logs` — INSERT-ONLY. Every tint status change = new row.
- `order_status_logs` — INSERT-ONLY. Every order state change = new row.

Any UPDATE or DELETE on these tables is architecturally wrong.

---

## 16. DB connection rule

⚠️ **Direct Prisma DB connection from local machine is unreliable.**
All DB schema changes must be done via **Supabase SQL Editor**.
`npx prisma db push` and `npm run seed` fail with auth errors locally.
Prisma client works fine at **runtime** (Next.js API routes connect successfully).

When schema changes are needed: generate SQL → paste into Supabase SQL Editor.

---

## 17. Folder structure

```
/app
  /api/admin            — Admin CRUD API routes
  /api/import           — Import API routes (Phase 2)
  /api/auth             — NextAuth
  /(admin)              — Admin role layout group
  /(import)             — Shared import layout group (Admin, Dispatcher, Support)
  /(dispatcher)         — Dispatcher role layout group (Phase 3)
  /(support)            — Support role layout group (Phase 2)
  /(tint)               — Tint team layout group (Phase 2)
  /(warehouse)          — Supervisor + picker layout group (Phase 3)
/components
  /ui                   — shadcn/ui primitives (do not edit)
  /shared               — Reusable app components
  /admin                — Admin-specific components
    csv-import-modal.tsx  ← shared import modal pattern (reference for preview table)
/lib
  prisma.ts             — Prisma client singleton
  auth.ts               — NextAuth config
  rbac.ts               — requireRole() guard
  config.ts             — system_config reader (always reads from DB)
/prisma
  schema.prisma         — Source of truth — Schema v11 (38 tables, Phase 2 expanded)
  seed.ts               — Seed script
```

---

## 18. Phase completion status

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Foundation | ✅ Complete | Schema v10→v11, all admin screens, auth, RBAC |
| Phase 2 — Import Engine | 🔄 In Progress | Schema v11 done, import API + UI next |
| Phase 2 — Support screen | ❌ Not started | /support — view orders, set status/priority |
| Phase 2 — Tint Manager | ❌ Not started | /tint/manager — Kanban assignment |
| Phase 2 — Tint Operator | ❌ Not started | /tint/operator — Start/Done |
| Phase 3 — Dispatch | ❌ Not started | |
| Phase 3 — Warehouse | ❌ Not started | |

---

## 19. Session start checklist

Before generating any code, confirm:
1. You have read this file fully
2. Schema v11 is your reference — 38 tables, Phase 2 tables fully expanded
3. Config Master v2 is your seed data reference
4. You know which Phase (currently: Phase 2) and which specific step/screen
5. You will not install new libraries unless explicitly instructed
6. You will read existing files before modifying them
7. You will not reference removed tables: sku_sub_master, dispatch_status_master, tinting_status_master, delivery_priority_master
8. All status references use status_master with domain filter
9. All slot lookups query slot_master / delivery_type_slot_config — never hardcode times
10. grossWeightPerUnit EXISTS on sku_master — used for lineWeight at enrichment

---

## 20. Prisma query patterns for v11

```typescript
// ── Status lookup (always filter by domain) ────────────────────────────────
const workflowStatuses = await prisma.status_master.findMany({
  where: { domain: 'workflow', isActive: true },
  orderBy: { sortOrder: 'asc' }
})

// ── Slot rule evaluation at import time ───────────────────────────────────
const slotRules = await prisma.delivery_type_slot_config.findMany({
  where: { deliveryTypeId, isActive: true },
  include: { slot: true },
  orderBy: { sortOrder: 'asc' }
})
// Then evaluate obdEmailTime against windowStart/windowEnd in order

// ── Order with customer and tint assignments ───────────────────────────────
const order = await prisma.orders.findUnique({
  where: { id },
  include: {
    customer: { include: { area: true, salesOfficerGroup: { include: { salesOfficer: true } } } },
    querySnapshot: true,
    tintAssignments: { include: { assignedTo: true } },
    statusLogs: { orderBy: { createdAt: 'desc' }, take: 10 }
  }
})

// ── Create order with audit log (always in transaction) ───────────────────
await prisma.$transaction(async (tx) => {
  const order = await tx.orders.create({ data: { ... } })
  await tx.order_status_logs.create({
    data: { orderId: order.id, fromStage: null, toStage: order.workflowStage, changedById: userId }
  })
})

// ── Customer with full hierarchy ───────────────────────────────────────────
const customer = await prisma.delivery_point_master.findUnique({
  where: { id },
  include: {
    area: { include: { deliveryType: true, primaryRoute: true } },
    salesOfficerGroup: { include: { salesOfficer: true } },
    primaryRoute: true,
    deliveryTypeOverride: true,
    contacts: { include: { contactRole: true } },
  }
})
```

---

*Version: Phase 2 · Schema v11 · Config Master v2 · March 2026*