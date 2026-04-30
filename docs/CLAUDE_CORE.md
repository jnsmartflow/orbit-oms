# CLAUDE_CORE.md — Orbit OMS Core
# v73 · Schema v26.6 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_UI.md · April 2026

---

## 1. What this app is

Depot-level order management for a paint distribution company (Akzo Nobel / JSW Dulux, Surat depot, single depot). Two parallel pipelines:

- **OBD pipeline:** SAP XLS import → tinting → support review → dispatch planning → warehouse picking → vehicle dispatch
- **Mail order pipeline:** Forwarded email parsing → SKU enrichment → SAP punching → SO number capture → dispatch data flows back to OBD

Internal tool. Role-based access. Scale: ~100-200 OBDs/day, ~150+ mail orders/day, ~25-35 dispatch plans/day. Live at https://orbitoms.in.

---

## 2. Tech stack (locked)

| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router |
| Language | TypeScript (strict) |
| Styling | Tailwind + shadcn/ui |
| ORM | Prisma |
| Database | Supabase (PostgreSQL) |
| Auth | NextAuth.js v5 |
| Host | Vercel |
| Package manager | npm |
| XLS | `xlsx` npm package |

Never introduce new libraries without being asked.

---

## 3. Engineering rules — non-negotiable

- Never `prisma db push`. Schema changes via Supabase SQL Editor + `npx prisma generate`.
- Never `prisma.$transaction`. Use sequential awaits.
- Never delete files unless explicitly instructed.
- All API routes: `export const dynamic = 'force-dynamic'`
- `tsc --noEmit` passes before commit.
- Supabase columns are camelCase (no `@map`).
- Vercel region: `bom1`.
- Auth: `lib/auth.ts` (Node) vs `auth.config.ts` (Edge). Do not merge.
- `@page` CSS: top-level in globals.css, never nested.
- DB passwords: no `@`, `#`, `$` (breaks URL parsing).
- `Array.from()` around Set/Map iterators.
- PowerShell on depot PC: PS 5.1. `[BitConverter]::ToString($h).Replace("-","").ToLower()` (not `[Convert]::ToHexString()`). `Invoke-WebRequest -UseBasicParsing` (not `Invoke-RestMethod`). `$x = default; try { $x = expr } catch { $x = fallback }` — never `$x = try {...} catch {...}` (PS7+ only).
- Parser files UTF-8 with BOM for non-ASCII chars.
- Google Maps URLs: `https://www.google.com/maps?q=LAT,LONG`. Never `place_id:` format (triggers bot protection).

---

## 4. Infrastructure

**Domain:** orbitoms.in (Namecheap, renews April 2027). DNS: A `@` → Vercel IP, CNAME `www` → Vercel DNS. SSL auto-provisioned. `orbitoms.in` redirects to `www.orbitoms.in`.

**Hosting:** Vercel Hobby, production = `main` branch, region `bom1` Mumbai.

**Database:** Supabase Pro ($25/mo, never pauses), region `ap-south-1`. Pooler: Transaction mode, port 6543, pool size 15, max clients 200. DIRECT_URL on port 5432 for `prisma generate`.

**Env vars (Vercel):** `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (https://www.orbitoms.in), `IMPORT_HMAC_SECRET`, `MAIL_ORDER_HMAC_SECRET`.

**Codebase:** `F:\Harsh Onedrive\OneDrive\VS Code\orbit-oms` · GitHub `jnsmartflow/orbit-oms`. Branches: `main` (prod), `dev`.

**PowerShell pipelines (depot PC, outside git):** location `C:\Users\HP\OneDrive\VS Code\mail-orders\`
- `Parse-MailOrders-v6_5.ps1` — forwarded email parser. Outlook COM. Dedup via `processed_ids_fw.json`.
- `Auto-Import.ps1` — SAP OBD fetch. Task Scheduler every 10min, 8AM-8PM. HMAC-signed ingest. State files: `daily-state.txt`, `last-page1.txt`.
- `Watch-OrderEmails-v2.ps1` — deprecated. RE: email pipeline replaced by FW: dispatch extraction.

**Monitoring:** Sentry deferred (OneDrive/Windows npm conflict). UptimeRobot pending. Use `/api/health` for manual checks.

---

## 5. Roles and users

| Role | ID | Access | Key users |
|---|---|---|---|
| admin | 1 | All + admin panel | admin@orbitoms.com (Admin@2026) |
| tint_manager | — | /tint/manager, TI Report, Shades, Delivery Challans, Mail Orders | Chandresh Kolgha |
| tint_operator | — | /tint/operator | Deepak Vasava, Chandrasing Valvi |
| dispatcher | — | /planning | — |
| support | — | /support | Rahul |
| floor_supervisor | — | /warehouse | — |
| picker | — | /warehouse | 10 seeded users |
| operations | 12 | /operations/* (all boards read-only) | operations@orbitoms.com (operations123 — change in prod) |
| billing_operator | 13 | /mail-orders | Deepanshu Thakur (25), Bankim (26) — Billing@123 |

**Login redirects:** admin→/admin, dispatcher→/planning, support→/support, tint_manager→/tint/manager, tint_operator→/tint/operator, floor_supervisor/picker→/warehouse, operations→/operations/support, billing_operator→/mail-orders.

**Phase 1 route guard:** `PHASE1_BLOCKED` in `middleware.ts` blocks non-admin from `/support`, `/planning`, `/warehouse`, `/operations`, `/dispatcher`. Remove from array to unlock.

**Sidebar:** All 8 layout files pass `session.user.role as RoleSidebarRole` (not hardcoded). Nav items come from `buildNavItems()` in `lib/permissions.ts` only — no manual appending.

**Permissions:** `lib/permissions.ts` has `PAGE_NAV_MAP`, `PageKey` type, `ALL_PAGE_KEYS`. Three TM page keys: `delivery_challans`, `shade_master`, `ti_report`. Grant via `role_permissions` rows.

---

## 6. Team (for domain context)

| Person | Role |
|---|---|
| Chandresh | Tint Manager (TM primary user) |
| Deepak Vasava, Chandrasing Valvi | Tint Operators |
| Deepanshu Thakur | Billing Operator (Mail Orders + SAP punching primary) |
| Bankim | Billing Operator (secondary) |
| Rahul | Support queue |
| Prakashbhai | Team lead, reports to Smart Flow (developer) |

---

## 7. Database schema — v26.5

Evolution: v21 base → v22 (6 mo_*) → v23 (orders dispatch) → v24 (customer match) → v25 (split) → v26 (mo_order_remarks) → v26.1 (isLocked) → v26.2 (mo_line_status) → v26.3 (carton + piecesPerCarton) → v26.4 (mo_learned_customers) → v26.5 (orders.orderDateTime) → v26.6 (orders.manualTintEntry + manual_tint_entries audit table).

### 7.1 Setup / Master (23 tables)

```
status_master              — UNIFIED. Domains: dispatch|tinting|pick_list|import|workflow|priority
system_config              — Key-value. Keys: day_boundary_time, last_cleanup_date,
                             history_days_visible, slot_cascade_grace_minutes, last_cascade_check
role_master                — Roles including operations(12), billing_operator(13)
role_permissions           — (roleSlug, pageKey, canView, canImport, canExport, canEdit, canDelete)

product_category           — Emulsion, Primer, Tinter, Enamel, Texture, Putty
product_name               — WS, Aquatech, Weathercoat... FK → product_category
base_colour                — White Base, Deep Base, Clear, N/A
sku_master                 — SKU + colour combo. FKs: productCategoryId, productNameId, baseColourId.
                             grossWeightPerUnit does NOT exist.

transporter_master         — Transporter companies
vehicle_master             — capacityKg, vehicleType, isActive, driverName, driverPhone

delivery_type_master       — Local | Upcountry | IGT | Cross (exact casing stored)
slot_master                — id 1 Morning(10:30), 2 Afternoon(12:30), 3 Evening(15:30),
                             4 Night(18:00), 5 Next Day Morning. sortOrder, isNextDay.
                             Slot 5 is never assigned (concept removed v67).
delivery_type_slot_config  — EXISTS but UNUSED (see §9 Slot Assignment)
route_master, area_master, area_route_map, sub_area_master
sales_officer_master, sales_officer_group
contact_role_master
delivery_point_master      — Ship-to. primaryRouteId, deliveryTypeOverride, salesOfficerGroupId, customerRating (A/B/C)
delivery_point_contacts    — contactRoleId FK

users                      — Depot staff. bcryptjs 10 rounds. roleId FK → role_master.
```

### 7.2 Import (5 tables)

```
import_batches             — One per import session
import_raw_summary         — One per OBD. smuNumber, soNumber, obdEmailDate, obdEmailTime
import_raw_line_items      — Per line. lineId = row index. batchCode always NULL.
import_enriched_line_items — Lines joined with sku_master
import_obd_query_summary   — Per-OBD totals: weight, qty, volume, hasTinting, totalArticle

Volume always in LITRES (L). Never display m³.
```

### 7.3 Orders + Tinting (10 tables)

```
orders                     — Parent container, one per OBD. workflowStage = overall status.
                             slotId FK, originalSlotId (set once)
                             orderDateTime TIMESTAMPTZ — true order time (mo_orders.receivedAt → obdEmailDate+Time)
                             smu TEXT, customerMissing BOOLEAN
                             isPicked, pickedAt, pickedById
                             soNumber (indexed, from SAP "SONum")
                             remarks, shipToOverride BOOLEAN, slotToOverride BOOLEAN
                             sequenceOrder INT (single source for operator queue sort)
                             orderType — 'tint' gets slotId=null at import
                             manualTintEntry — true when manually pulled in via /tint/manager

order_splits               — Per tint batch/split. dispatchStatus drives planning.
                             isPicked, pickedAt, pickedById, sequenceOrder
split_line_items           — Per line assigned to a split
split_status_logs          — INSERT-ONLY audit per split
tint_assignments           — Per whole-OBD assignment (non-split flow).
                             operatorSequence field exists but UNUSED (use sequenceOrder)
tint_logs                  — INSERT-ONLY. orderId + optional splitId.
order_status_logs          — INSERT-ONLY. changeType: slot_cascade, day_boundary_slot_reset (both DISABLED).
tinter_issue_entries       — INSERT-ONLY. Per base batch TI entry.
manual_tint_entries        — INSERT-ONLY. Per pull-in or revert action. Reason + lineIds preserved.
```

### 7.4 Dispatch + Warehouse (7 tables)

```
dispatch_plans             — One plan = vehicle + slot + trip. Unique: (planDate, slotId, vehicleId, tripNumber)
dispatch_plan_orders       — Orders in plan. ORDER-LEVEL (not split). clearedAt TIMESTAMPTZ.
                             IMPORTANT: table is dispatch_plan_orders, NOT dispatch_plan_splits.
pick_assignments           — Picker assignments. orderId FK unique per active. clearedAt.
pick_lists                 — One pick list per plan
pick_list_items            — Line items to pick
dispatch_change_queue      — Notifications when support holds/cancels in-plan order

dispatch_plan_vehicles was DROPPED (redundant, vehicleId on dispatch_plans).
```

### 7.5 Delivery Challan (2 tables)

```
delivery_challans          — One per eligible order. Auto-created at import time for SMU = Retail Offtake or Decorative Projects. Number: CHN-{YEAR}-{5-digit seq}. Sequence by orderDateTime.
delivery_challan_formulas  — Per-line tinting formula
```

### 7.6 Mail Orders (10 tables, mo_* prefix)

Separate fuzzy matching system — not connected to normalized SAP catalog. See `CLAUDE_MAIL_ORDERS.md` for full detail.

```
mo_orders                  — Per parsed email
mo_order_lines             — Per product line (includes isCarton, cartonCount)
mo_order_remarks           — Remark lines (billing|delivery|contact|instruction|cross|customer|area|unknown)
mo_line_status             — SKU found/not-found tracking
mo_product_keywords        — ~809 rows. Must NOT contain base colour words.
mo_base_keywords           — ~215 rows
mo_sku_lookup              — ~1,400+ rows. material UNIQUE. piecesPerCarton.
mo_customer_keywords       — 667+ rows. Auto-grows on operator picks.
mo_learned_customers       — Operator correction log with guard rules (hitCount≥3, ≥2 operators)
```

---

## 8. Key business rules (cross-cutting)

- **Volume unit:** Always litres. Never cubic metres.
- **Customer types:** Bill To = dealer (always in master). Ship To = site (may be new).
- **Cross billing ≠ ship-to override.** Cross billing is informational (another depot). Ship-to is different delivery address.
- **Dispatch Hold:** Punch order but don't dispatch. Billing blocks (OD/CI/bounce/extension): cannot punch at all.
- **OD/CI detection:** word-boundary regex `\bOD\b`, `\bCI\b`. `.includes()` false-positives on "Plywood".
- **Tinting eligibility:** SMU-gated. Only "Decorative Projects" or "Retail Offtake" get tinted.
- **Stainer vs tinter by pack:** 50/100/200ML = universal stainer. 1L = machine tinter / Acotone.
- **Warehouse zone sort:** putty (deepest) → oil → wood → water → stainer (nearest dispatch). Pack size ASC (picker walks in empty, picks on return).
- **Challan eligibility:** SMU = "Retail Offtake" or "Decorative Projects" only. Auto-created at import time (not lazily).
- **UTC→IST for mail order timestamps:** `AssumeUniversal` + `ConvertTimeFromUtc`. Never `.ToUniversalTime()`.
- **Keyword length sorting is critical for enrichment** — shorter generic keywords override longer specific ones without DESC sort. Apply everywhere keyword matching is done.

---

## 9. Slot assignment

Simple time-based thresholds, IST. **`delivery_type_slot_config` table exists but is not consumed anywhere.**

| Time (IST) | Slot |
|---|---|
| < 10:30 | Morning (id=1) |
| < 12:30 | Afternoon (id=2) |
| < 15:30 | Evening (id=3) |
| ≥ 15:30 (or null) | Night (id=4) |

**Non-tint orders:** slot assigned at import via `resolveSlot()` on `orderDateTime`.

**Tint orders (`orderType === "tint"`):** `slotId = null` at import. Slot assigned at tinting completion based on IST completion time. Split orders: slot set on parent when last split completes (latest completion wins).

**Slot cascade and day-boundary reset are DISABLED.** `lib/slot-cascade.ts` and `lib/day-boundary.ts` exist but are not called from any API route. Do not re-enable. If ever re-enabled, must skip tint orders.

**No Next Day Morning assignment.** Slot 5 exists in master but is never set.

**`applyMailOrderEnrichment()`:** On SAP import, checks mo_orders for matching soNumber. If found, applies dispatchStatus, priorityLevel, remarks, overrides, and sets `orderDateTime` from mo_orders.receivedAt. Skips slot recalculation for tint orders. One soNumber can map to multiple OBDs (1:N via updateMany).

---

## 10. Screens index

Full detail for each screen lives in the domain file. This section is the cross-reference.

### Admin panel
Route `/admin`. Admin only. LIVE.
Screens: customer, SKU, route/area, user, system config, import.

### Mail Orders
Route `/mail-orders`. billing_operator, tint_manager, admin. LIVE (primary active development).
→ See `CLAUDE_MAIL_ORDERS.md`

### Tint Manager / Operator / Challans / Shades / TI Report
Routes `/tint/*`. LIVE.
→ See `CLAUDE_TINT.md`

### Support
Route `/support`. support, admin, operations. Built, blocked by Phase 1 guard.
Columns: checkbox | OBD/DATE | CUSTOMER | ROUTE/TYPE | VOL(L) | AGE | DISPATCH | PRIORITY | SLOT.
Features: history view, slot sections, bulk actions, group checkboxes, date picker, OrderDetailPanel.
Stub until activation — expand in CORE §11 when unblocked, extract to own file when > 150 lines.

### Dispatch Planning
Route `/planning`. dispatcher, admin, operations. Built, blocked.
Planning at ORDER level (not split level). All splits of one OBD go to same vehicle.

### Warehouse
Route `/warehouse`. floor_supervisor, picker, admin, operations. Built, blocked.
300px left (unassigned) / flex right (pickers). Assignment at order level. Duplicate camelCase+snake_case pick columns on orders and order_splits — use camelCase via Prisma.

### Operations View
Route `/operations/support|tinting|tint-operator|dispatch|warehouse`. operations, admin. Built, blocked.
Each sub-route renders the existing board component.

### Login / Not Ready
Routes `/login`, `/not-ready`. LIVE. `/not-ready` auto-signs out, shown for Phase 1 blocked routes.

---

## 11. Screen stubs (extract when mature)

### Support
- OrderDetailPanel integration built, awaiting activation
- Known pending: cascade badge (when originalSlotId !== slotId, show ⏩ from {originalSlot.name}), audit history in detail panel (order_status_logs exists, not rendered), smart slot assignment (orders at/after cutoff auto-escalate)
- Apply neutral theme (TM v39 palette) when unblocked

### Planning
- Design frozen for Dispatch Planning Board Phase 4
- Parallel dispatcher + floor supervisor workflow
- Vehicle assignment by KG with progress bar
- Future: `dispatch_plan_splits` FK if moving to split-level (currently order-level)
- MIS Override Layer designed: `mis_dispatch_overrides` table, admin-only, insert-only audit, `isActive` flag, Excel MIS flags Real vs Override rows

### Warehouse
- Design frozen. Split view layout.
- Barcode/QR label generation post-TI submission planned. TSC TE200 thermal printer. QR encodes OrbitOMS URL. PIN-gated scan page. `labelPrintedAt`/`labelPrintedBy` columns planned on tinter_issue_entries.
- WhatsApp notification Option C designed (wa.me links, dispatcher's personal WhatsApp, zero infra). SO phone field in schema unverified.

### Admin
- Customer master coordinate enrichment for route optimization pending
- Learned customer admin view pending (currently manage via Supabase SQL)
- Keyword management UI pending

---

## 12. Universal header system

Component: `components/universal-header.tsx`. Used by ALL boards. Never create parallel headers.

**Row 1 (52px sticky, z-30):** Title (ReactNode, accepts toggles) · Stats (11px gray-400) · Clock IST HH:MM · ⌨ Shortcuts · Download · Search (180→260px).

**Row 2 (40px sticky top-[52px], z-30):** Segmented control + leftExtra · rightExtra · Filter ▾ · Date stepper.

**Color rule:** ONE teal element = active slot segment. Everything else gray.

**Slot segments:** 4 only (Morning, Afternoon, Evening, Night). Filter out Next Day Morning. No "All" button — deselected = show all.

**Per-board wiring:**

| Board | Segments | Filters | Date | Extras |
|---|---|---|---|---|
| Support | Slots (4) | View, Status, Del Type, Priority | Stepper | Search |
| Tint Manager | Operator pills (§TINT) | Del Type, Priority, Type | **None** | View toggle, missing-customer badge |
| Planning | Slots (4) | Del Type, Dispatch | Stepper | — |
| Warehouse | Slots (4) | Del Type, Pick Status | Stepper | — |
| Mail Orders | Slots (4) | Status, Match, Dispatch, Lock | Stepper | Column toggle, Table/Review/Focus toggle in title |
| Tint Operator | Job pill (teal, dropdown) | — | None | Progress bar (rightExtra) |
| TI Report | Date presets | Tinter Type, Operator | None | Date range (leftExtra), Download |
| Shade Master | — | Tinter Type, Status | None | — |
| Delivery Challan | — | SMU, Route | Stepper | Search |

**page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title.

Full visual spec: `CLAUDE_UI.md §6`.

---

## 13. Sidebar behaviour

- Default state: collapsed (72px, icons only)
- Hover expands to 220px as **overlay** (page never shifts)
- Mouse leave collapses after 150ms delay (flicker prevention)
- No click toggle. No localStorage persistence. Always starts collapsed.
- API: `useRoleSidebar()` returns `{ isExpanded, expand, collapse }`. Old API (`isCollapsed`, `toggle`) removed.
- Main content locked at `marginLeft: 72px` / `maxWidth: calc(100vw - 72px)`.

Files: `components/shared/role-sidebar-provider.tsx`, `role-sidebar.tsx`, `role-layout-client.tsx`.

---

## 14. Session start checklist

Before generating any code, confirm:

1. Read `CLAUDE.md` (repo root), `docs/CLAUDE_CORE.md`, `docs/CLAUDE_UI.md`, and the relevant domain file(s). State "Files read: ..." at the top.
2. Schema version **v26.6**. If user mentions a table you don't see in §7, ask before proceeding.
3. `<UniversalHeader />` is mandatory for all boards. No custom headers.
4. `page.tsx` pattern: bare component, no wrapper.
5. Planning at **ORDER level** (not split). Table name is `dispatch_plan_orders`, not `dispatch_plan_splits`.
6. **Slot cascade / day boundary reset are DISABLED.** Do not re-enable.
7. **Tint orders:** `slotId = null` at import. Slot assigned at tinting completion.
8. **Non-tint orders:** slot assigned at import via `resolveSlot(orderDateTime)`.
9. Delivery challans auto-created at import time for SMU = "Retail Offtake" or "Decorative Projects".
10. Sidebar role: always `session.user.role` — never hardcoded.
11. Fixed table standard (§40 UI): `table-layout: fixed` + `<colgroup>` + percentage widths. All data tables.
12. All engineering non-negotiables in §3.

---

## 15. Cross-module pending items

**Deferred / future:**
- Sentry error monitoring (OneDrive/Windows npm conflict)
- UptimeRobot on /api/health
- Operations user password change in production
- Multi-language support (Gujarati first — planning only)

**Data cleanup:**
- Operator screen backfill: `operatorSequence` field still exists in `tint_assignments`/`order_splits` schema but no longer used for sorting. Can remove later.
- Duplicate pick columns on orders and order_splits (camelCase + snake_case). Use camelCase via Prisma.
- `delivery_type_slot_config` table unused. Can drop when confident.
- `lib/slot-cascade.ts`, `lib/day-boundary.ts` files present but never called.
- `SlotSummaryItem` interface in tint-manager-content.tsx defined but unused.

**One-time backfill endpoints (keep for emergency, can delete when stable):**
- `POST /api/admin/fix-slots` — backfills `orderDateTime` + recalculates slotId
- `POST /api/admin/fix-challans` — creates missing delivery_challans for eligible SMU orders
- `POST /api/mail-orders/backfill-customers` — marked TEMPORARY

**Infrastructure:**
- Dev branch convention (`main` = prod auto-deploys, `dev` for WIP)

Module-specific pending items live in their domain files.

---

*CORE v72 · Orbit OMS · April 2026*
