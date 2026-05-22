# CLAUDE_CORE.md — OrbitOMS Core
# v73 · Schema v27.2 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_UI.md

---

## 1. What this app is

Depot-level order management for a paint distribution company (JSW Dulux, formerly Akzo Nobel India). Single depot, Surat. Two parallel pipelines:

- **OBD pipeline:** SAP XLS import → tinting → support review → dispatch planning → warehouse picking → vehicle dispatch
- **Mail order pipeline:** Forwarded email parsing → SKU enrichment → SAP punching → SO number capture → dispatch data flows back to OBD

Plus two standalone modules:
- **Place Order** (`/place-order`) — depot phone-order entry, mailto-based submit
- **Attendance** (`/attendance`) — check-in/out PWA with OT workflow

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
| Storage | Supabase Storage (attendance selfies, private bucket) |
| Icons (PWA) | `@resvg/resvg-js` (devDep) |

Never introduce new libraries without being asked.

---

## 3. Engineering rules — non-negotiable

- Never `prisma db push`. Schema changes via Supabase SQL Editor + `npx prisma generate`.
- `npx prisma db pull` fails locally with P1001 (Supabase direct host is IPv6-only; depot ISP is IPv4-only). Workflow: ALTER in Supabase SQL Editor → hand-edit `prisma/schema.prisma` to match → `npx prisma generate`.
- Never `prisma.$transaction`. Use sequential awaits.
- Never delete files unless explicitly instructed.
- All API routes: `export const dynamic = 'force-dynamic'`
- `npx tsc --noEmit` passes before commit.
- Supabase columns are camelCase (no `@map`).
- Vercel region: `bom1`.
- Auth: `lib/auth.ts` (Node) vs `auth.config.ts` (Edge). Do not merge.
- `@page` CSS: top-level in globals.css, never nested.
- DB passwords: no `@`, `#`, `$` (breaks URL parsing).
- `Array.from()` around Set/Map iterators.
- All commits go directly to `main`. No feature branches, no PR workflow. Smoke-test locally before push.
- PowerShell on depot PC: PS 5.1. `[BitConverter]::ToString($h).Replace("-","").ToLower()` (not `[Convert]::ToHexString()`). `Invoke-WebRequest -UseBasicParsing` (not `Invoke-RestMethod`). `$x = default; try { $x = expr } catch { $x = fallback }` — never `$x = try {...} catch {...}` (PS7+ only).
- Parser files UTF-8 with BOM for non-ASCII chars.
- Google Maps URLs: `https://www.google.com/maps?q=LAT,LONG`. Never `place_id:` format.
- HMAC-signed auto-import uses fixed string `"auto-import-v1"` (timestamp-free, avoids PC clock drift).
- `<UniversalHeader />` is mandatory for all boards. No custom headers.
- `page.tsx` pattern: bare `<ComponentName />`, no wrapper div, no title.
- Fixed table standard (`CLAUDE_UI.md §40`) for ALL data tables.
- Sidebar role: always `session.user.role` — never hardcoded.

---

## 4. Infrastructure

**Domain:** orbitoms.in (Namecheap). DNS: A `@` → Vercel IP, CNAME `www` → Vercel DNS. SSL auto-provisioned. `orbitoms.in` redirects to `www.orbitoms.in`.

**Hosting:** Vercel Hobby. Production = `main` branch. Region `bom1` Mumbai. Vercel auto-deploys on push to `main`.

**Database:** Supabase Pro ($25/mo, never pauses). Region `ap-south-1`. Pooler: Transaction mode, port 6543, pool size 15, max clients 200. DIRECT_URL on port 5432 for `prisma generate`.

**Env vars (Vercel):** `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (https://www.orbitoms.in), `IMPORT_HMAC_SECRET`, `MAIL_ORDER_HMAC_SECRET`, `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

**Local codebase:** `C:\Users\HP\OneDrive\VS Code\orbit-oms` · GitHub `jnsmartflow/orbit-oms`. Working branch: `main`.

**Depot PC PowerShell tools (outside git):**

| Tool | Location | Schedule | Purpose |
|---|---|---|---|
| `Parse-MailOrders-v6_5.ps1` | `C:\Users\HP\OneDrive\VS Code\mail-orders\` | continuous | Forwarded email parser. Outlook COM. Dedup via `processed_ids_fw.json`. |
| `Auto-Import.ps1` v2.0 | `F:\VS Code\OBD-Import Tool v2\` | Task Scheduler every 10 min, 8AM–8PM | SAP OBD fetch. HMAC-signed ingest. Tally-based pagination, yesterday recovery, lazy session reuse. |
| `Watch-Import-V2.ps1` | `F:\VS Code\OBD-Import Tool v2\` | manual | Cycle summary watcher. Supports `-Today` and `-Date YYYY-MM-DD` modes. |

**Auto-Import v2 state files** (in `Master\`): `yesterday-recovery-state.txt`, `pending-upload.txt`, `last-spec-call.txt`, `last-noise-call.txt`, `obd-tally-<date>.txt`, `session-cookie.txt` (4-hour cache), `daily-state.txt`. ExecutionTimeLimit on `2_Auto_Import` scheduler task is `PT5M`. Repetition interval `PT10M`, `StopAtDurationEnd=false`.

**Monitoring:** `/api/health` for manual checks. `vercel.json` has 2 cron schedules (attendance rollover + photo purge, Hobby tier cap).

---

## 5. Roles and users

`role_master` IDs and primary access:

| ID | Role | Primary route | Key users |
|---|---|---|---|
| 1 | admin | `/admin` | admin@orbitoms.com |
| 2 | dispatcher | `/place-order` (gated, see below) | Ajay Vansiya, Dhanraj Shah |
| 3 | support | `/place-order` (gated) | Priya Chaudhari, Rahul |
| 4 | tint_manager | `/tint/manager` | Chandresh Kolgha |
| 5 | tint_operator | `/tint/operator` | Deepak Vasava, Chandrasing Valvi |
| 6 | floor_supervisor | `/warehouse` | — |
| 7 | picker | `/warehouse` | seeded |
| 12 | operations | `/operations/support` | operations@orbitoms.com |
| 13 | billing_operator | `/mail-orders` | Deepanshu Thakur (id=25), Bankim (id=26) |
| 14 | ops_admin | `/admin` | Dhruv (id=27), Kuldeep (id=28) |

**Login redirects** (`lib/rbac.ts` `ROLE_REDIRECTS` map): admin→`/admin`, dispatcher→`/place-order`, support→`/place-order`, tint_manager→`/tint/manager`, tint_operator→`/tint/operator`, floor_supervisor/picker→`/warehouse`, operations→`/operations/support`, billing_operator→`/mail-orders`, ops_admin→`/admin`.

**Dispatcher / support gated permissions:** these roles have `role_permissions.canView = true` only for `pageKey = 'place_order'`. All other pageKeys are `canView = false` until the real dispatcher/support screens go live.

**Multi-role users (`user_roles` table):**

```
user_roles
├── id          SERIAL PK
├── userId      FK → users.id (CASCADE)
├── roleId      FK → role_master.id (RESTRICT)
├── isPrimary   BOOLEAN
├── createdAt   TIMESTAMPTZ
└── createdById FK → users.id (nullable)

UNIQUE (userId, roleId)
UNIQUE (userId) WHERE isPrimary = true
```

Primary role drives login redirect and href overrides. Additional rows add nav items and unlock APIs. `users.roleId` retained as denormalised primary-role pointer for fast reads.

**Login identifiers:** `users` has `phone TEXT` with `CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$')` and partial unique index `WHERE phone IS NOT NULL`. NextAuth credentials provider accepts email OR 10-digit phone — `/^\d{10}$/` regex routes the lookup. Field `id`/`name` stays `email` (auth contract). Strict 10-digit only — no `+91`, dashes, or spaces.

**Permissions:** `lib/permissions.ts` has `PAGE_NAV_MAP`, `PageKey` type, `ALL_PAGE_KEYS`. Grant via `role_permissions` rows. TM page keys: `delivery_challans`, `shade_master`, `ti_report`. Place Order key: `place_order`. Attendance key: `attendance`.

**Sidebar:** Layout files pass `session.user.role as RoleSidebarRole` (not hardcoded). Nav items come from `buildNavItems()` in `lib/permissions.ts` only — no manual appending.

**Route guard:** `PHASE1_BLOCKED` in `middleware.ts` is currently `[]` (all routes unblocked). To temporarily block a route, add the path to this array.

---

## 6. Team

| Person | Role |
|---|---|
| Chandresh Kolgha | Tint Manager |
| Deepak Vasava, Chandrasing Valvi | Tint Operators |
| Deepanshu Thakur | Billing Operator (primary, id=25) |
| Bankim | Billing Operator (id=26) |
| Rahul | Support |
| Ajay Vansiya, Dhanraj Shah | Dispatcher (Place Order only for now) |
| Priya Chaudhari | Support (Place Order only for now) |
| Dhruv (id=27), Kuldeep (id=28) | Ops Admin |
| Prakashbhai | Team lead, reports to Smart Flow (developer) |

---

## 7. Database schema — v27.3

Versions in order: v21 base → v22 (mo_*) → v23 (orders dispatch) → v24 (customer match) → v25 (split) → v26 (mo_order_remarks) → v26.1 (isLocked) → v26.2 (mo_line_status) → v26.3 (carton + piecesPerCarton) → v26.4 (mo_learned_customers) → v26.5 (orders.orderDateTime) → v26.6 (user_roles + manual_tint_entries + users.phone + mo_sku_lookup.refDescription) → v27.0 (attendance foundation) → v27.1 (attendance settings hardening) → v27.2 (OT workflow on attendance_records + attendance_summary + attendance_settings + 2026-05-13 place-order v2 tables) → v27.3 (sampling_usage_log.deliveryNumber — Phase 3 delivery no backfill).

### 7.1 Setup / Master

```
status_master              UNIFIED. Domains: dispatch|tinting|pick_list|import|workflow|priority
system_config              Key-value. Keys: day_boundary_time, last_cleanup_date,
                           history_days_visible, slot_cascade_grace_minutes, last_cascade_check
role_master                Roles 1-14 (see §5)
role_permissions           (roleSlug, pageKey, canView, canImport, canExport, canEdit, canDelete)
user_roles                 Multi-role assignment (§5)
users                      Depot staff. bcryptjs 10 rounds. roleId FK. phone TEXT (nullable, 10-digit).
                           attendance columns: attendanceConsentAt, attendanceConsentVersion,
                           attendanceExempt BOOLEAN, attendanceTestUser BOOLEAN.

product_category           Emulsion, Primer, Tinter, Enamel, Texture, Putty
product_name               WS, Aquatech, Weathercoat... FK → product_category
base_colour                White Base, Deep Base, Clear, N/A
sku_master                 SKU + colour combo. FKs: productCategoryId, productNameId, baseColourId.
                           grossWeightPerUnit does NOT exist.

transporter_master         Transporter companies
vehicle_master             capacityKg, vehicleType, isActive, driverName, driverPhone

delivery_type_master       Local | Upcountry | IGT | Cross (exact casing stored)
slot_master                id 1 Morning(10:30), 2 Afternoon(12:30), 3 Evening(15:30),
                           4 Night(18:00), 5 Next Day Morning. Slot 5 never assigned.
delivery_type_slot_config  EXISTS but UNUSED
route_master, area_master, area_route_map, sub_area_master
sales_officer_master, sales_officer_group
contact_role_master
customer_type_master, premises_type_master
delivery_point_master      Ship-to. primaryRouteId, deliveryTypeOverride, salesOfficerGroupId,
                           customerRating (A/B/C)
delivery_point_contacts    contactRoleId FK, isPrimary BOOLEAN
```

### 7.2 Import

```
import_batches             One per import session
import_raw_summary         One per OBD. smuNumber, soNumber, obdEmailDate, obdEmailTime
import_raw_line_items      Per line. lineId = row index. batchCode always NULL.
                           lineStatus TEXT default 'active', removedAt, removedReason
import_enriched_line_items Lines joined with sku_master
import_obd_query_summary   Per-OBD totals: weight, qty, volume, hasTinting, totalArticle
import_shadow_log          INSERT-ONLY shadow log for SAP brain cutover
```

Volume always in LITRES (L). Never display m³.

### 7.3 Orders + Tinting

```
orders                     Parent. workflowStage = overall status.
                           slotId FK, originalSlotId, dispatchSlotDeadline
                           orderDateTime TIMESTAMPTZ — true order time
                           smu TEXT, customerMissing BOOLEAN
                           isPicked, pickedAt, pickedById
                           soNumber (indexed, from SAP "SONum")
                           remarks, shipToOverride, slotToOverride
                           sequenceOrder INT (single source for operator queue sort)
                           orderType — 'tint' gets slotId=null at import

order_splits               Per tint batch/split. dispatchStatus drives planning.
                           isPicked, pickedAt, pickedById, sequenceOrder
split_line_items           Per line assigned to a split.
                           lineStatus, removedAt, removedReason, lastSeenInBatchId
split_status_logs          INSERT-ONLY audit per split
tint_assignments           Per whole-OBD assignment (non-split flow).
                           operatorSequence field exists but UNUSED (use sequenceOrder)
tint_logs                  INSERT-ONLY. orderId + optional splitId.
order_status_logs          INSERT-ONLY. changeType: slot_cascade, day_boundary_slot_reset (both DISABLED).
tinter_issue_entries       INSERT-ONLY. Per base batch TI entry.
tinter_issue_entries_b     Bucket-level TI entries (b variant)
shade_master               Saved shade combinations per customer + SKU
manual_tint_entries        Manual override pulling non-tint OBD into tint workflow.
                           orderId FK, lineIds JSON, reason TEXT, createdBy, createdAt.
```

### 7.4 Dispatch + Warehouse

```
dispatch_plans             One plan = vehicle + slot + trip. UNIQUE (planDate, slotId, vehicleId, tripNumber)
dispatch_plan_orders       Orders in plan. ORDER-LEVEL (not split). clearedAt TIMESTAMPTZ.
                           Table name is dispatch_plan_orders, NOT dispatch_plan_splits.
pick_assignments           Picker assignments. orderId FK unique per active. clearedAt.
pick_lists                 One pick list per plan
pick_list_items            Line items to pick
dispatch_change_queue      Notifications when support holds/cancels in-plan order

dispatch_plan_vehicles was DROPPED (vehicleId on dispatch_plans).
```

### 7.5 Delivery Challan

```
delivery_challans          One per eligible order. Auto-created at import time for SMU = Retail Offtake
                           or Decorative Projects. Number: CHN-{YEAR}-{5-digit seq}. Sequence by orderDateTime.
delivery_challan_formulas  Per-line tinting formula
```

### 7.6 Mail Orders (mo_* prefix)

```
mo_orders                  Per parsed email
mo_order_lines             Per product line. isCarton, cartonCount.
mo_order_remarks           billing|delivery|contact|instruction|cross|customer|area|unknown
mo_line_status             SKU found/not-found tracking
mo_product_keywords        ~1,076 rows. Must NOT contain base colour words.
mo_base_keywords           ~267 rows
mo_sku_lookup              ~1,599 rows. material UNIQUE. piecesPerCarton.
                           refMaterial (Generic/master code), refDescription.
mo_customer_keywords       Auto-grows on operator picks
mo_learned_customers       Operator correction log with guard rules (hitCount≥3, ≥2 operators)
```

See `CLAUDE_MAIL_ORDERS.md` for full column lists.

### 7.7 Place Order (v2 tables)

```
mo_order_form_index_v2     481+ rows. family, product, baseColour, displayName, searchTokens,
                           tinterType, productType, sortOrder, isActive, section, subgroup.
                           UNIQUE (family, product, baseColour).
mo_sku_lookup_v2           1,642 rows. Parallel to mo_sku_lookup, clean v2 names.
                           material UNIQUE.
mo_order_form_index        Legacy. Untouched. Not used by /place-order.
```

`product` and `baseColour` columns in v2 carry bucket + variant info, not strictly product + colour. See `CLAUDE_PLACE_ORDER.md`.

### 7.8 Attendance + OT

```
attendance_records         Per CHECK_IN | CHECK_OUT event. userId, type, eventAt, attendanceDate,
                           latitude/longitude (DECIMAL 10,7), accuracyMeters, isOutsideGeofence,
                           photoPath, deviceInfo, ipAddress.
                           OT columns: otClaimed, otClaimReason, otTotalLessThan95,
                           otApprovalStatus, otApprovedById, otApprovedAt, otApprovedAdjustedMinutes.

attendance_summary         One per (userId, attendanceDate) UNIQUE. firstCheckInAt, lastCheckOutAt,
                           totalWorkedMinutes, otClaimedMinutes, status, hasMissingCheckout, sessionsCount.

attendance_settings        GLOBAL row. rolloutStage, otPromptEnabled, otRequiresApproval,
                           dpdpConsentVersion, geofenceLatitude, geofenceLongitude, geofenceRadiusMeters,
                           lateGraceMinutes, halfDayThresholdMinutes, photoRetentionDays.
                           OT columns: otCutoffHourIST, otAutoApproveThresholdMinutes.
```

See `CLAUDE_ATTENDANCE.md` for full detail.

---

## 8. Key business rules (cross-cutting)

- **Volume unit:** Always litres. Never cubic metres.
- **Customer types:** Bill To = dealer (always in master). Ship To = site (may be new).
- **Cross billing ≠ ship-to override.** Cross billing is informational (another depot). Ship-to is different delivery address.
- **Dispatch Hold:** Punch order but don't dispatch. Billing blocks (OD/CI/bounce/extension): cannot punch at all.
- **OD/CI detection:** word-boundary regex `\bOD\b`, `\bCI\b`. `.includes()` false-positives on "Plywood".
- **Tinting eligibility:** SMU-gated. Only "Decorative Projects" or "Retail Offtake" get tinted.
- **Stainer vs tinter by pack:** 50/100/200ML = universal stainer. 1L = machine tinter / Acotone.
- **Warehouse zone sort:** putty (deepest) → oil → wood → water → stainer (nearest dispatch). Pack size ASC.
- **Challan eligibility:** SMU = "Retail Offtake" or "Decorative Projects" only. Auto-created at import time.
- **UTC→IST for mail order timestamps:** `AssumeUniversal` + `ConvertTimeFromUtc`. Never `.ToUniversalTime()`.
- **Keyword length sorting is critical for enrichment** — shorter generic keywords override longer specific ones without DESC sort.
- **Bill To = dealer / Ship To = site** terminology applies on challans and mail orders.

---

## 9. Slot assignment

Simple time-based thresholds, IST.

| Time (IST) | Slot |
|---|---|
| < 10:30 | Morning (id=1) |
| < 12:30 | Afternoon (id=2) |
| < 15:30 | Evening (id=3) |
| ≥ 15:30 (or null) | Night (id=4) |

**Non-tint orders:** slot assigned at import via `resolveSlot()` on `orderDateTime`.

**Tint orders (`orderType === "tint"`):** `slotId = null` at import. Slot assigned at tinting completion based on IST completion time. Split orders: slot set on parent when last split completes (latest completion wins).

**Slot cascade and day-boundary reset are DISABLED.** Files `lib/slot-cascade.ts` and `lib/day-boundary.ts` exist but are not called from any API route.

**`applyMailOrderEnrichment()`:** On SAP import, checks `mo_orders` for matching `soNumber`. If found, applies `dispatchStatus`, `priorityLevel`, `remarks`, overrides, and sets `orderDateTime` from `mo_orders.receivedAt`. Skips slot recalculation for tint orders. One soNumber can map to multiple OBDs (1:N via `updateMany`).

---

## 10. Universal header system

Component: `components/universal-header.tsx`. Used by ALL boards.

**Row 1 (52px sticky, z-30):** Title (ReactNode, accepts toggles) · Stats (11px gray-400) · Clock IST HH:MM · ⌨ Shortcuts · Download · Search (180→260px).

**Row 2 (40px sticky top-[52px], z-30):** Segmented control + leftExtra · rightExtra · Filter ▾ · Date stepper (calendar popover).

**Color rule:** ONE teal element = active slot segment. Everything else gray.

**Slot segments:** 4 only (Morning, Afternoon, Evening, Night). Filter out Next Day Morning. No "All" button.

Per-board wiring:

| Board | Segments | Filters | Date | Extras |
|---|---|---|---|---|
| Support | Slots (4) | View, Status, Del Type, Priority | Stepper | Search |
| Tint Manager | Operator pills | Del Type, Priority, Type | **None** | View toggle, missing-customer badge |
| Planning | Slots (4) | Del Type, Dispatch | Stepper | — |
| Warehouse | Slots (4) | Del Type, Pick Status | Stepper | — |
| Mail Orders | Slots (4) | Status, Match, Dispatch, Lock | Stepper | Column toggle, Table/Review toggle in title |
| Tint Operator | Job pill (teal, dropdown) | — | None | Progress bar (rightExtra) |
| TI Report | Date presets | Tinter Type, Operator | None | Date range (leftExtra), Download |
| Shade Master | — | Tinter Type, Status | None | — |
| Delivery Challan | — | SMU, Route | Stepper | Search |

Full visual spec in `CLAUDE_UI.md §6`.

---

## 11. Sidebar behaviour

- Default state: collapsed (72px, icons only)
- Hover expands to 220px as **overlay** (page never shifts)
- Mouse leave collapses after 150ms delay
- No click toggle. No localStorage persistence. Always starts collapsed.
- API: `useRoleSidebar()` returns `{ isExpanded, expand, collapse }`.
- Main content locked at `marginLeft: 72px` / `maxWidth: calc(100vw - 72px)`.

Files: `components/shared/role-sidebar-provider.tsx`, `role-sidebar.tsx`, `role-layout-client.tsx`.

`/place-order` uses the same sidebar (no longer full-bleed). `/attendance` uses no sidebar (full-screen PWA layout).

---

## 12. Screens index

Full detail in domain files. Cross-reference only here.

### Admin
Route `/admin`. admin, ops_admin. Screens: customer, SKU, route/area, user, system config, import, attendance (read-only Phase 1).

### Mail Orders
`/mail-orders`. billing_operator, tint_manager, admin. → `CLAUDE_MAIL_ORDERS.md`

### Tint Manager / Operator / Challans / Shades / TI Report
`/tint/*`. → `CLAUDE_TINT.md`

### Attendance
`/attendance` (end-user PWA), `/admin/attendance` (admin dashboard). → `CLAUDE_ATTENDANCE.md`

### Place Order
`/place-order`. Label "Purchase Order (PO)". admin, billing_operator, tint_manager, support, dispatcher. → `CLAUDE_PLACE_ORDER.md`

### Support
`/support`. support, admin, operations. Columns: checkbox | OBD/DATE | CUSTOMER | ROUTE/TYPE | VOL(L) | AGE | DISPATCH | PRIORITY | SLOT. Features: history view, slot sections, bulk actions, date picker, OrderDetailPanel.

### Dispatch Planning
`/planning`. dispatcher, admin, operations. Planning at ORDER level (not split level). All splits of one OBD go to same vehicle.

### Warehouse
`/warehouse`. floor_supervisor, picker, admin, operations. 300px left (unassigned) / flex right (pickers). Assignment at order level. Duplicate camelCase+snake_case pick columns on orders and order_splits — use camelCase via Prisma.

### Operations View
`/operations/support|tinting|tint-operator|dispatch|warehouse`. operations, ops_admin, admin. Each sub-route renders the existing board component.

### Public
- `/order` — public mobile order form for Sales Officers. No login. Generates mailto to `surat.order@outlook.com`.
- `/demo` — animated tutorial. Rewrites to `/order-demo.html`.
- `/login`, `/not-ready`, `/unauthorized` — auth pages.

`middleware.ts` public paths: `/login`, `/unauthorized`, `/not-ready`, `/api/auth`, `/api/health`, `/order`, `/api/order`, `/demo`, `/order-demo.html`, `/api/cron/*` (bearer auth, not session).

---

## 13. Landmines

These exist in code but are intentionally disabled, broken, or stale. Do not "fix" without explicit instruction.

- **`lib/slot-cascade.ts`, `lib/day-boundary.ts`** — files present but never called. If ever re-enabled, must skip tint orders.
- **`operatorSequence` field** on `tint_assignments`/`order_splits` — exists in schema, no longer used for sorting. Sort by `sequenceOrder` only.
- **`delivery_type_slot_config` table** — exists but not consumed anywhere.
- **`SlotSummaryItem` interface** in `tint-manager-content.tsx` — defined but unused.
- **Duplicate pick columns** on `orders` and `order_splits` (camelCase + snake_case). Use camelCase via Prisma. Snake_case copies are legacy.
- **TM reorder API** (`/api/tint/manager/reorder/route.ts` line ~429) uses `prisma.$transaction` — violates §3, left as-is for simple two-update swap.
- **One-time backfill endpoints** (keep for emergency):
  - `POST /api/admin/fix-slots` — backfills `orderDateTime` + recalculates slotId
  - `POST /api/admin/fix-challans` — creates missing delivery_challans for eligible SMU orders
  - `POST /api/mail-orders/backfill-customers` — marked TEMPORARY
- **`enrich-v2.ts`** — duplicate `SkuEntry` type, not imported anywhere.
- **`CATEGORY_KEYWORDS` constant** in `enrich.ts` — dead code, can be removed.
- **GEN SKUs** — 8 deleted: `5860311, 5984151, 5967877, 5955808, 5955810, 5955818, 5955826, 5911947`. If new GEN SKUs appear in imports, delete them.

---

*CORE v73 · Schema v27.2 · OrbitOMS*
