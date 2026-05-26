# CLAUDE_CORE.md — OrbitOMS Core
# v74 · Schema v27.4 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_UI.md

---

## 1. What this app is

Depot-level order management for a paint distribution company (JSW Dulux, formerly Akzo Nobel India). Single depot, Surat. Two parallel pipelines:

- **OBD pipeline:** SAP XLS import → tinting → support review → dispatch planning → warehouse picking → vehicle dispatch
- **Mail order pipeline:** Forwarded email parsing → SKU enrichment → SAP punching → SO number capture → dispatch data flows back to OBD

Plus three standalone modules:
- **Place Order** (`/place-order`) — depot phone-order entry; **`/order`** public mobile equivalent
- **Attendance** (`/attendance`) — check-in/out PWA with OT workflow
- **Sampling Library** (`/tint/sampling-library`) — digital paper register, shade recipes + usage history

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
- **Soft-delete reads:** every `orders` list/find adds `where: { isRemoved: false }`. Every `delivery_challans` list adds `where: { isVoided: false }` — EXCEPT challan sequence-number allocation, which MUST include voided rows to avoid collision.
- **Voided challan audit surface:** challan list/detail uses `OR: [{ isRemoved: false }, { isRemoved: true, challan: { isVoided: true } }]` so Chandresh still sees voided-challan rows for removed OBDs.

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
| `Auto-Import.ps1` v2.0 | `F:\VS Code\OBD-Import Tool v2\` | PAUSED | SAP OBD fetch. HMAC-signed ingest. Tally-based pagination, yesterday recovery, lazy session reuse. **Paused as of 2026-05-14**; manual SAP upload is the active path. |
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

**Permissions:** `lib/permissions.ts` has `PAGE_NAV_MAP`, `PageKey` type, `ALL_PAGE_KEYS`. Grant via `role_permissions` rows. Current page keys:

| Page key | Granted to |
|---|---|
| `import_obd` | admin, dispatcher, support, billing_operator, tint_manager (canImport gated separately) |
| `delivery_challans` | tint_manager (view + edit), admin |
| `shade_master` | tint_manager (view + edit), admin |
| `ti_report` | tint_manager (view + export), admin |
| `sampling_library` | tint_manager (view + edit), tint_operator (view), admin |
| `place_order` | admin, billing_operator, tint_manager, support, dispatcher |
| `attendance` | all roles gated per rollout stage |
| `removed_orders` | admin only |

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

## 7. Database schema — v27.4

Versions: v21 base → v22 (mo_*) → v23 (orders dispatch) → v24 (customer match) → v25 (split) → v26 (mo_order_remarks) → v26.1 (isLocked) → v26.2 (mo_line_status) → v26.3 (carton + piecesPerCarton) → v26.4 (mo_learned_customers) → v26.5 (orders.orderDateTime) → v26.6 (user_roles + manual_tint_entries + users.phone + mo_sku_lookup.refDescription) → v27.0 (attendance foundation) → v27.1 (attendance settings hardening) → v27.2 (OT workflow + 2026-05-13 place-order v2 tables) → **v27.3** (sampling_register + sampling_recipes + sampling_usage_log; orders.isRemoved + delivery_challans.isVoided; tint_skip_events + tint_pause_events; tint_assignments + import_raw_line_items netWeight/totalWeight) → **v27.4** (sampling_usage_log.deliveryNumber backfill + tinter_issue_entries.samplingNo/shadeName).

### 7.1 Setup / Master

```
status_master              UNIFIED. Domains: dispatch|tinting|pick_list|import|workflow|priority
system_config              Key-value
role_master                Roles 1-14 (see §5)
role_permissions           (roleSlug, pageKey, canView, canImport, canExport, canEdit, canDelete)
user_roles                 Multi-role assignment (§5)
users                      Depot staff. bcryptjs 10 rounds. roleId FK. phone TEXT (nullable, 10-digit).
                           Attendance columns: attendanceConsentAt, attendanceConsentVersion,
                           attendanceExempt, attendanceTestUser.

product_category, product_name, base_colour, sku_master
transporter_master, vehicle_master
delivery_type_master       Local | Upcountry | IGT | Cross
slot_master                Slots 1-5
delivery_type_slot_config  UNUSED
route_master, area_master, area_route_map, sub_area_master
sales_officer_master, sales_officer_group
contact_role_master
customer_type_master, premises_type_master
delivery_point_master      Ship-to. primaryRouteId, deliveryTypeOverride, salesOfficerGroupId,
                           customerRating (A/B/C)
delivery_point_contacts    contactRoleId FK, isPrimary BOOLEAN
```

### 7.2 Import (full detail → `CLAUDE_IMPORT.md`)

```
import_batches             One per import session
import_raw_summary         One per OBD. smuNumber, soNumber, obdEmailDate, obdEmailTime
import_raw_line_items      Per line. lineId, skuCodeRaw, batchCode, netWeight, totalWeight
                           lineStatus 'active'|'removed_by_import', removedAt, removedReason
import_enriched_line_items Lines joined with sku_master
import_obd_query_summary   Per-OBD totals
import_shadow_log          INSERT-ONLY shadow log
```

### 7.3 Orders + Tinting

```
orders                     workflowStage, slotId, originalSlotId, dispatchSlotDeadline,
                           orderDateTime, smu, customerMissing, isPicked, pickedAt, pickedById,
                           soNumber, remarks, shipToOverride, slotToOverride, sequenceOrder,
                           orderType.

                           SOFT-DELETE columns (v27.3):
                           isRemoved BOOLEAN DEFAULT false NOT NULL
                           removalReason TEXT (CUSTOMER_CANCELLED | WRONG_ORDER)
                           removalRemark TEXT (mandatory free text)
                           removedAt TIMESTAMPTZ, removedById, restoredAt, restoredById

order_splits               Per tint batch/split
split_line_items           Per line
split_status_logs          INSERT-ONLY audit

tint_assignments           Per whole-OBD tint assignment.
                           operatorSequence UNUSED — sort by sequenceOrder.
                           v27.3 columns: skippedAt, skipEventId (FK BIGINT);
                                          pauseCount INT, lastPausedAt, currentProgress JSONB,
                                          accumulatedMinutes INT (canonical "total tinting time"
                                          on done — pause route increments per pause; done route
                                          folds final delta).
                           Status enum: assigned | tinting_in_progress | paused | skipped | done.

tint_skip_events           v27.3. id BIGSERIAL. orderId, assignmentId (FK),
                           skippedById, skippedAt, reason TEXT,
                           tinterType TEXT?, outOfStockColours TEXT[],
                           remark TEXT?, createdAt.

tint_pause_events          v27.3. id BIGSERIAL. orderId, assignmentId,
                           pausedById, pausedAt, pauseReason TEXT,
                           progressAtPause JSONB, elapsedMinutesAtPause INT,
                           pauseRemark TEXT?, resumedAt, resumedById, resumeRemark.

tint_logs, order_status_logs   INSERT-ONLY. order_status_logs gets OBD_REMOVED,
                               OPERATOR_SKIP, OPERATOR_PAUSE, OPERATOR_RESUME events.
tinter_issue_entries       Per base batch TI entry.
                           v27.4: samplingNo TEXT?, shadeName TEXT? — wires TI to sampling library.
tinter_issue_entries_b     Bucket-level TI entries.
                           v27.4: samplingNo TEXT?, shadeName TEXT?.
shade_master               DEPRECATED. Sampling Library is the live source of truth for new
                           shades. Table still exists with historical data; scheduled for
                           deletion after a retention window. Do not write to it.
manual_tint_entries        Manual override: orderId FK, lineIds JSON, reason, createdBy, createdAt.
```

### 7.4 Dispatch + Warehouse

```
dispatch_plans             UNIQUE (planDate, slotId, vehicleId, tripNumber)
dispatch_plan_orders       Order-level. clearedAt TIMESTAMPTZ.
pick_assignments           Picker assignments. orderId FK unique per active.
pick_lists, pick_list_items
dispatch_change_queue
```

### 7.5 Delivery Challan

```
delivery_challans          One per eligible order (Retail Offtake / Decorative Projects).
                           Number: CHN-{YEAR}-{5-digit seq}.

                           VOID columns (v27.3):
                           isVoided BOOLEAN DEFAULT false NOT NULL
                           voidReason TEXT (mirrors order removal reason)
                           voidRemark TEXT, voidedAt TIMESTAMPTZ

delivery_challan_formulas  Per-line tinting formula
```

### 7.6 Mail Orders (mo_*)

```
mo_orders                  Per parsed email
mo_order_lines             Per product line. isCarton, cartonCount.
mo_order_remarks           billing|delivery|contact|instruction|cross|customer|area|unknown
mo_line_status             SKU found/not-found tracking
mo_product_keywords        ~1,076 rows
mo_base_keywords           ~267 rows
mo_sku_lookup              ~1,599 rows. material UNIQUE. refMaterial, refDescription.
mo_customer_keywords       Auto-grows on operator picks
mo_learned_customers       Operator correction log with guard rules
```

Full detail in `CLAUDE_MAIL_ORDERS.md`.

### 7.7 Place Order (v2 tables)

```
mo_order_form_index_v2     481+ rows. family, product, baseColour, displayName,
                           searchTokens, tinterType, productType, sortOrder,
                           isActive, section, subgroup. UNIQUE (family, product, baseColour).
mo_sku_lookup_v2           1,642 rows. Parallel clean-name version. material UNIQUE.
```

Full detail in `CLAUDE_PLACE_ORDER.md`.

### 7.8 Attendance + OT

```
attendance_records         Per CHECK_IN | CHECK_OUT event.
                           OT columns: otClaimed, otClaimReason, otTotalLessThan95,
                           otApprovalStatus, otApprovedById, otApprovedAt,
                           otApprovedAdjustedMinutes.

attendance_summary         One per (userId, attendanceDate). totalWorkedMinutes,
                           otClaimedMinutes, status, hasMissingCheckout, sessionsCount.

attendance_settings        GLOBAL row. rolloutStage, otPromptEnabled, otRequiresApproval,
                           dpdpConsentVersion, geofenceLatitude/Longitude/RadiusMeters,
                           lateGraceMinutes, halfDayThresholdMinutes, photoRetentionDays,
                           otCutoffHourIST, otAutoApproveThresholdMinutes,
                           otMonthlyGraceLimit, depotWorkingMinutes,
                           workStartTime, workEndTime, checkInWindowStart, checkInWindowEnd,
                           requirePhoto, requireLocation, photoMaxWidthPx, photoJpegQuality.
```

Full detail in `CLAUDE_ATTENDANCE.md`.

### 7.9 Sampling Library

```
sampling_register          samplingNo TEXT PK. shadeName, tinterType (TINTER|ACOTONE),
                           siteId FK?, siteNameRaw, salesOfficerId, dealerName, notes,
                           isActive, needsReview, createdById, createdAt, updatedAt.

sampling_recipes           id PK. samplingNo FK CASCADE, skuCode, productName,
                           packCode (PackCode enum), tinQty, 13 TINTER + 14 ACOTONE
                           pigment columns (all Decimal default 0), isPrimary, usageCount,
                           firstUsedAt, lastUsedAt, createdAt, updatedAt.
                           UNIQUE (samplingNo, skuCode, packCode).

sampling_usage_log         id PK. samplingNo FK CASCADE, recipeId FK SET NULL,
                           usageDate DATE?, operatorId FK?, operatorNameRaw, tinQty,
                           dealerNameRaw, siteId FK?, siteNameRaw, skuCodeRaw,
                           packCode?, deliveryNumber TEXT? (v27.4), sourceRowIndex,
                           createdAt.
```

Full detail in `CLAUDE_SAMPLING_LIBRARY.md`.

---

## 8. Key business rules (cross-cutting)

- **Volume unit:** Always litres. Never cubic metres.
- **Customer types:** Bill To = dealer (always in master). Ship To = site (may be new).
- **Cross billing ≠ ship-to override.** Cross billing is informational; ship-to is different delivery address.
- **Dispatch Hold:** Punch order but don't dispatch. Billing blocks: cannot punch at all.
- **OD/CI detection:** word-boundary regex `\bOD\b`, `\bCI\b`. `.includes()` false-positives on "Plywood".
- **Tinting eligibility:** SMU-gated. Only "Decorative Projects" or "Retail Offtake" get tinted.
- **Stainer vs tinter by pack:** 50/100/200ML = universal stainer. 1L = machine tinter / Acotone.
- **Warehouse zone sort:** putty (deepest) → oil → wood → water → stainer (nearest dispatch). Pack size ASC.
- **Challan eligibility:** SMU = "Retail Offtake" or "Decorative Projects". Auto-created at import.
- **UTC→IST for mail order timestamps:** `AssumeUniversal` + `ConvertTimeFromUtc`. Never `.ToUniversalTime()`.
- **Keyword length sorting is critical** — shorter generic keywords override longer specific ones without DESC sort.
- **Bill To = dealer / Ship To = site** terminology applies on challans and mail orders.

---

## 9. Slot assignment

Time-based thresholds, IST.

| Time (IST) | Slot |
|---|---|
| < 10:30 | Morning (id=1) |
| < 12:30 | Afternoon (id=2) |
| < 15:30 | Evening (id=3) |
| ≥ 15:30 (or null) | Night (id=4) |

**Non-tint orders:** slot assigned at import via `resolveSlot()` on `orderDateTime`.

**Tint orders (`orderType === "tint"`):** `slotId = null` at import. Slot assigned at tinting completion based on IST time. Splits: parent slot set when last split completes.

**Slot cascade and day-boundary reset are DISABLED.** Files `lib/slot-cascade.ts` and `lib/day-boundary.ts` exist but are not called.

**`applyMailOrderEnrichment()`:** On SAP import, checks `mo_orders` for matching `soNumber`. If found, applies `dispatchStatus`, `priorityLevel`, `remarks`, overrides, and sets `orderDateTime` from `mo_orders.receivedAt`. Skips slot recalc for tint orders. One soNumber can map to many OBDs (`updateMany`).

---

## 10. Universal header system

Component: `components/universal-header.tsx`. Used by ALL boards.

**Row 1 (52px sticky, z-30):** Title (ReactNode) · Stats (11px gray-400) · Clock IST HH:MM · ⌨ Shortcuts · Download · Search (180→260px).

**Row 2 (40px sticky top-[52px], z-30):** Segmented control + leftExtra · rightExtra · Filter ▾ · Date stepper (calendar popover).

**Color rule:** ONE teal element = active slot segment. Everything else gray. *Per-screen exemption:* Sampling Library uses teal on multiple elements intentionally (`CLAUDE_UI.md §22`).

**Slot segments:** 4 only. Filter out Next Day Morning. No "All" button.

Per-board wiring summary in `CLAUDE_UI.md §6`.

---

## 11. Sidebar behaviour

- Default state: collapsed (72px, icons only)
- Hover expands to 220px as **overlay** (page never shifts)
- Mouse leave collapses after 150ms delay
- No click toggle. No localStorage persistence. Always starts collapsed.
- API: `useRoleSidebar()` returns `{ isExpanded, expand, collapse }`.
- Main content locked at `marginLeft: 72px` / `maxWidth: calc(100vw - 72px)`.

Files: `components/shared/role-sidebar-provider.tsx`, `role-sidebar.tsx`, `role-layout-client.tsx`.

`/place-order` uses the same sidebar. `/attendance` uses no sidebar (full-screen PWA layout). `/order` uses no sidebar (public mobile).

---

## 12. Screens index

Full detail in domain files. Cross-reference only here.

### Admin
`/admin`. admin, ops_admin. Customer / SKU / route / area / user / system config / import / attendance dashboard / **removed-orders** (admin-only restore page).

### Mail Orders
`/mail-orders`. billing_operator, tint_manager, admin. → `CLAUDE_MAIL_ORDERS.md`

### Tint Manager / Operator / Challans / Shades / TI Report
`/tint/*`. → `CLAUDE_TINT.md`

### Sampling Library
`/tint/sampling-library`. tint_manager, tint_operator (read), admin. → `CLAUDE_SAMPLING_LIBRARY.md`

### Attendance
`/attendance` (end-user PWA), `/admin/attendance` (admin dashboard + ot-pending + settings + ot-audit). → `CLAUDE_ATTENDANCE.md`

### Place Order
`/place-order` (desktop, label "Purchase Order (PO)"). `/order` (public mobile). → `CLAUDE_PLACE_ORDER.md`

### Import
`/admin/import`. → `CLAUDE_IMPORT.md`

### Support
`/support`. support, admin, operations. Columns: checkbox | OBD/DATE | CUSTOMER | ROUTE/TYPE | VOL(L) | AGE | DISPATCH | PRIORITY | SLOT. History view, slot sections, bulk actions, date picker, OrderDetailPanel.

### Dispatch Planning
`/planning`. dispatcher, admin, operations. Planning at ORDER level. All splits of one OBD go to same vehicle.

### Warehouse
`/warehouse`. floor_supervisor, picker, admin, operations. 300px left (unassigned) / flex right (pickers).

### Operations View
`/operations/support|tinting|tint-operator|dispatch|warehouse`. operations, ops_admin, admin.

### Public
- `/order` — public mobile order form. No login. Generates mailto.
- `/demo` — animated tutorial. Rewrites to `/order-demo.html`.
- `/login`, `/not-ready`, `/unauthorized`.

`middleware.ts` public paths: `/login`, `/unauthorized`, `/not-ready`, `/api/auth`, `/api/health`, `/order`, `/api/order`, `/demo`, `/order-demo.html`, `/api/cron/*` (bearer auth).

---

## 13. Landmines

Existing in code but intentionally disabled, broken, or stale. Do not "fix" without explicit instruction.

- **`lib/slot-cascade.ts`, `lib/day-boundary.ts`** — present but never called. If re-enabled, must skip tint orders.
- **`operatorSequence` field** on `tint_assignments`/`order_splits` — exists in schema, no longer used for sorting. Sort by `sequenceOrder` only.
- **`delivery_type_slot_config` table** — exists but not consumed anywhere.
- **`SlotSummaryItem` interface** in `tint-manager-content.tsx` — defined but unused.
- **Duplicate pick columns** on `orders` and `order_splits` (camelCase + snake_case). Use camelCase via Prisma.
- **TM reorder API** (`/api/tint/manager/reorder/route.ts` ~line 429) uses `prisma.$transaction` — violates §3, left as-is for simple two-update swap.
- **One-time backfill endpoints** (keep for emergency):
  - `POST /api/admin/fix-slots` — backfills `orderDateTime` + recalculates slotId
  - `POST /api/admin/fix-challans` — creates missing delivery_challans
  - `POST /api/mail-orders/backfill-customers` — marked TEMPORARY
- **`enrich-v2.ts`** — duplicate `SkuEntry` type, not imported anywhere.
- **`CATEGORY_KEYWORDS` constant** in `enrich.ts` — dead code.
- **GEN SKUs** — 8 deleted: `5860311, 5984151, 5967877, 5955808, 5955810, 5955818, 5955826, 5911947`. If new GEN SKUs appear in imports, delete them.
- **Challan sequence allocation must include voided rows** — opposite of every other challan read. Don't filter `isVoided: false` in sequence-numbering queries.
- **Auto-Import paused** — only manual SAP upload runs since 2026-05-14. If resumed, audit cross-source orphan policy first (see `CLAUDE_IMPORT.md §15`).
- **`shade_master` deprecated.** Sampling Library Phase 4 shipped. All new shade saves write to `sampling_register` + `sampling_recipes` + `sampling_usage_log`. `shade_master` table still exists with historical data but is no longer read or written by the live operator workflow. Scheduled for deletion after a retention window. Do not write to it.

---

*CORE v74 · Schema v27.4 · OrbitOMS*
