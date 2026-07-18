# CLAUDE_CORE.md — OrbitOMS Core
# v80 · Schema v27.10 · July 2026 · Lives in: orbit-oms/docs/
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
- **Commit ≠ deploy.** Vercel builds from `origin/main`. A local commit on `main` is NOT live until `git push origin main`. DB reseeds run against Supabase directly and are independent of code deploy — easy to land schema/data changes without the code that uses them. Always finish a session with both a code push AND a verification that the new behaviour shows on production.
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
- **Partial unique index reconcile pattern (P2002):** when a partial unique index enforces "exactly one row of a kind per parent" (e.g. one Primary SO per customer), reconcile loops MUST demote-then-promote, never promote-then-demote. Pre-clear all rows of the constrained kind to a non-conflicting state (one `updateMany`) before running the main upsert loop. Drops role-comparison optimisations — safer than carrying stale-cache bugs.
- **Seed is source of truth.** Any structural/taxonomy/grouping change applied directly to a live DB will be wiped by the next wipe-and-reseed. All such changes must go into the seed script (the durable source). Direct-to-DB ALTERs are acceptable for hot fixes ONLY when paired with the matching seed edit.
- **Never fuzzy-match site names.** Site name suffixes like "FACE" / phase numbers distinguish genuinely different sites. Stripping or fuzzy-matching risks linking the wrong site. For backfill, prefer OBD→order→customerId resolution over name-based matches.
- **OneDrive + Next.js stale `.next` symptom:** `Error: Cannot find module './NNNN.js'` + `missing required error components, refreshing...`. Fix: stop the dev server, `taskkill /F /IM node.exe`, `rmdir /s /q .next`, restart. Pause OneDrive sync if `rmdir` hits a permission error.
- **Stop the dev server before any git operation in this repo.** Same OneDrive file-lock reason as above.

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
| 1 | admin | `/admin` | admin@orbitoms.in |
| 2 | dispatcher | `/place-order` (gated, see below) | Ajay Vansiya, Dhanraj Shah |
| 3 | support | `/place-order` (gated) | Priya Chaudhari, Rahul |
| 4 | tint_manager | `/tint/manager` | Chandresh Kolgha |
| 5 | tint_operator | `/tint/operator` | Deepak Vasava, Chandrasing Valvi |
| 6 | floor_supervisor | `/warehouse/supervisor` | — |
| 7 | picker | `/warehouse/picker` | seeded |
| 12 | operations | `/operations/support` | operations@orbitoms.in |
| 13 | billing_operator | `/mail-orders` | Deepanshu Thakur (id=25), Bankim (id=26) |
| 14 | ops_admin | `/admin/attendance` | Dhruv (id=27), Kuldeep (id=28) |
| 16 | logistics | `/trips` | Praveen (primary role — sees only Trip Report). Full detail: `CLAUDE_TRIP_REPORT.md §1`. |
| — | operation_manager | `/tint/manager` | Undocumented role slug (2026-07-10 discovery) — exists live in `role_permissions`/`lib/rbac.ts` with NO confirmed `role_master` row/ID. Not invented here; may be a legacy slug or a real role missing from this table. Identify before relying on it. |

**Login redirects** (`lib/rbac.ts` `ROLE_REDIRECTS` map — verified against live code 2026-07-16, three entries corrected): admin→`/admin`, dispatcher→`/place-order`, support→`/place-order`, tint_manager→`/tint/manager`, tint_operator→`/tint/operator`, **floor_supervisor→`/warehouse/supervisor`** (was wrongly `/warehouse`), **picker→`/warehouse/picker`** (was wrongly grouped with floor_supervisor under `/warehouse`), operations→`/operations/support`, billing_operator→`/mail-orders`, **ops_admin→`/admin/attendance`** (was wrongly `/admin`), operation_manager→`/tint/manager` (previously missing from this map entirely), logistics→`/trips`.

**Middleware — no forced attendance redirect (fixed 2026-07-04).** `middleware.ts` previously had an attendance gate (~lines 69-96) that redirected EVERY authenticated request to `/attendance` until check-in — not mobile-specific, but fired right after the login redirect above, so it looked mobile-only. That entire `if` block + the unused `istDateString` import were removed. Login (mobile and desktop) now routes straight to the role's landing page via `ROLE_REDIRECTS`, with no forced detour. Attendance itself is unaffected — still reachable directly at `/attendance`. Only 3 test accounts (admin/ops_admin) ever had the flag; no operational role relied on it. Confirmed via `middleware.ts` — no attendance-gate or `istDateString` reference remains. Full detail: `CLAUDE_TRIP_REPORT.md §7` (this fix shipped alongside the Trip Report build).

**Trip Report secondary-role grants:** 4 existing users were added to `logistics` as a **secondary** role via `user_roles` (primary roles kept, unaffected): Ajay Vansiya (dispatcher), Dhanraj Shah (dispatcher), Priya Chaudhari (support), Operations User (operations). The `operations` role itself is NOT granted `trip_report` — only these 5 named users (the 4 above + Praveen).

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
| `shade_master` | tint_manager (view), admin — DEPRECATED, retiring soon (see §13) |
| `ti_report` | tint_manager (view + export), admin |
| `sampling_library` | tint_manager (view + edit), tint_operator (view), admin |
| `customer_master` | admin, ops_admin, tint_manager (view + edit), support, dispatcher (view) |
| `place_order` | admin, billing_operator, tint_manager, support, dispatcher |
| `attendance` | all roles gated per rollout stage |
| `removed_orders` | admin only |
| `ti_report` (reused) | gates the Reports hub `/reports` (Tint Summary + TI Report) |
| `settings_hide` | admin only (v27.6). In `PageKey` union + `ALL_PAGE_KEYS` (admin auto-ALL_TRUE), **NOT** in `PAGE_NAV_MAP` (that feeds operational sidebars; would duplicate the admin entry). |
| `trip_report` | logistics (view only) + the 4 named secondary-role users above (§5). `operations` role NOT granted. → `CLAUDE_TRIP_REPORT.md §1`. |
| `mail_orders` | billing_operator (view + edit), operations (view + edit — **granted 2026-07-10**, one additive DB row, no code deploy), operation_manager (view + edit), tint_manager (**view only**, previously undocumented). Zero rows in `prisma/seed.ts` — DB-only, wiped on reseed. → `CLAUDE_MAIL_ORDERS.md §22`. |

**Sidebar:** Layout files pass `session.user.role as RoleSidebarRole` (not hardcoded). For **operational / role-based** sidebars, nav items come from `buildNavItems()` in `lib/permissions.ts` only — no manual appending. ⚠️ The **admin panel** sidebar is the separate `components/admin/admin-sidebar.tsx` (`NAV_SECTIONS` array: OVERVIEW / MASTER DATA / PEOPLE / OPERATIONS / PERSONAL / SETTINGS) — `buildNavItems()`/`PAGE_NAV_MAP` do NOT feed it. New admin items (e.g. Settings → Hide) are added there.

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

## 7. Database schema — v27.10

Versions: v21 base → v22 (mo_*) → v23 (orders dispatch) → v24 (customer match) → v25 (split) → v26 (mo_order_remarks) → v26.1 (isLocked) → v26.2 (mo_line_status) → v26.3 (carton + piecesPerCarton) → v26.4 (mo_learned_customers) → v26.5 (orders.orderDateTime) → v26.6 (user_roles + manual_tint_entries + users.phone + mo_sku_lookup.refDescription) → v27.0 (attendance foundation) → v27.1 (attendance settings hardening) → v27.2 (OT workflow + 2026-05-13 place-order v2 tables) → v27.3 (sampling_register + sampling_recipes + sampling_usage_log; orders.isRemoved + delivery_challans.isVoided; tint_skip_events + tint_pause_events; tint_assignments + import_raw_line_items netWeight/totalWeight) → v27.4 (sampling_usage_log.deliveryNumber backfill + tinter_issue_entries.samplingNo/shadeName) → v27.5 (customer_sales_officers + linkedSalesOfficerId on delivery_point_contacts + 3 columns on delivery_challan_formulas + sampling_recipes.packCode nullable with NULLS NOT DISTINCT + mo_sku_lookup_v2.isPrimary + mo_order_form_index_v2.mobileFamily) → v27.6 (mo_order_form_index_v2.region; Hide feature: `obd_visibility_rules` + `app_tag_settings` tables + orders.isHidden/hiddenById/hiddenReason/hiddenAt — §7.10) → v27.7 (Support gatekeeper + Hold/Dispatch-Target: orders.mailMatched; orders.heldAt, dispatchTargetDate, dispatchWindowId, arrivalSlotId; new `dispatch_slot_master` table — §7.4) → **v27.8** (Trip Report module, 2026-07-04/06: new standalone `trip_report` table — full columns → `CLAUDE_TRIP_REPORT.md §3`, §7.11 pointer here; `trip_report_delivery_no_dis_date_key` UNIQUE(deliveryNo, disDate); `mirror_trip_report_today` Postgres function) → **v27.9** (Support ship-to override, 2026-07-07: `orders.shipToOverrideCustomerId` Int? FK → `delivery_point_master`, relation `shipToOverrideCustomer` / `@relation("OrderShipToOverride")` — see dual-relation note in §7.3; `mo_orders.shipToOverrideCustomerId` Int? FK → `delivery_point_master`, relation `shipToOverrideCustomer` / `@relation("MoOrderShipToOverride")` — mo_orders' first relation to that table, no dual-relation trap) → **v27.10** (Picking Stage 2 — 2026-07-17/18 sessions, already shipped in code: `pick_assignments.checkedAt` DateTime? `@map("checked_at")` + `checkedById` Int? `@map("checked_by_id")`, relation `checkedBy` / `@relation("PickAssignmentCheckedBy")` — THIRD named relation from `pick_assignments` to `users`, alongside `picker`/`PickAssignmentPicker` and `assignedBy`/`PickAssignmentAssignedBy`, all correctly named on both sides today — no ambiguity. Supports the supervisor Approve step of the picking floor workflow — `CLAUDE_PICKING.md §6`).

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
delivery_point_master      Ship-to. primaryRouteId, salesOfficerGroupId
                           (now classification-tag only, no longer drives SO),
                           customerRating (A/B/C). salesOfficerId DEPRECATED — still read by
                           CSV importer until Phase 8 migration, write-ignored from admin UI.
                           **CORRECTED 2026-07-16: no `deliveryTypeOverride` column exists.**
                           Real columns are two separate FKs → `delivery_type_master.id`:
                           `dispatchDeliveryTypeId` Int? and `reportingDeliveryTypeId` Int?.
delivery_point_contacts    contactRoleId FK, isPrimary BOOLEAN.
                           linkedSalesOfficerId Int? FK → sales_officer_master ON DELETE SET NULL.
                           NULL for manual contacts; set for auto-managed SO contacts. v27.5.

customer_sales_officers    v27.5. NEW. Multi-SO per customer.
                           id, customerId (FK → delivery_point_master CASCADE),
                           salesOfficerId (FK → sales_officer_master RESTRICT),
                           role (enum CustomerSalesOfficerRole: PRIMARY|BACKUP|JUNIOR),
                           contactDismissed BOOLEAN DEFAULT false,
                           createdAt, updatedAt.
                           UNIQUE (customerId, salesOfficerId).
                           Partial UNIQUE INDEX on customerId WHERE role = 'PRIMARY'.
                           Indexes: salesOfficerId, (customerId, role).
```

### 7.1.b Enums

```
CustomerSalesOfficerRole   PRIMARY | BACKUP | JUNIOR
PackCode                   L_1 | L_4 | L_10 | L_20 | L_18 | L_18_5 | L_3_7 | ML_*  ...
TinterType                 TINTER | ACOTONE
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

                           HIDE columns (v27.6 — manual one-off hide, §7.10):
                           isHidden BOOLEAN DEFAULT false (indexed), hiddenById,
                           hiddenReason TEXT, hiddenAt TIMESTAMPTZ

                           GATEKEEPER column (v27.7 — Support module, 06-23 session):
                           mailMatched Boolean NOT NULL DEFAULT false — true when enrichment
                           matched a mail order; envelope icon in Support table gates on this.
                           Cannot use orderDateTime for this (it is NEVER null — see SUPPORT §5).

                           HOLD + DISPATCH-TARGET columns (v27.7 — Support module, 06-27 session):
                           heldAt TIMESTAMPTZ? — hold footprint anchor; set to obdEmailDate (NOT wall-clock)
                           dispatchTargetDate DATE? — chosen dispatch day (date-only; window carries the time)
                           dispatchWindowId INT? FK → dispatch_slot_master.id
                           arrivalSlotId INT? FK → slot_master.id — arrival-day slot; used for history grouping
                           (dispatchWindow is a Prisma relation on dispatchWindowId, not an extra column)

                           SHIP-TO OVERRIDE column (v27.9 — 2026-07-07 session, CLAUDE_SUPPORT.md §4.18):
                           shipToOverrideCustomerId INT? FK → delivery_point_master.id
                           relation `shipToOverrideCustomer`, @relation("OrderShipToOverride")
                           ⚠ DUAL-RELATION TRAP: `orders` already relates to delivery_point_master via
                           `customer` / @relation("OrderCustomer") (customerId). Both relations MUST stay
                           explicitly named on all sides (model + back-relation on delivery_point_master) —
                           an unnamed relation here is a Prisma ambiguity error, not a warning.
                           The legacy boolean `shipToOverride` flag is retained and kept in sync
                           (true when an id is set, false when cleared) — a flag can still be true
                           with the id null (free-text redirects with no resolved customer).

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
                           CHECKED columns (v27.10 — Picking Stage 2, 2026-07-17/18 sessions):
                           checkedAt DateTime? @map("checked_at"); checkedById Int?
                           @map("checked_by_id"), relation checkedBy /
                           @relation("PickAssignmentCheckedBy") — THIRD named relation to
                           `users` on this table, alongside picker/PickAssignmentPicker and
                           assignedBy/PickAssignmentAssignedBy. All three are correctly named
                           on both sides today (users model: pickAssignmentsAsPicker /
                           pickAssignmentsAssigned / pickAssignmentsChecked) — no Prisma
                           ambiguity. Any FUTURE 4th relation to `users` on this table must
                           follow the same explicit-naming discipline (§7.3's dual-relation-
                           trap pattern, same underlying rule).
                           HIDDEN CONSTRAINT: the live DB has `CHECK chk_pick_assignments_status`
                           restricting `status` to exactly `'assigned'` / `'picked'` —
                           invisible in this schema (no `@db` annotation surfaces Postgres
                           CHECK constraints; same pattern as `users.phone`'s CHECK, §5). A
                           third status string needs a SQL ALTER on this constraint FIRST
                           (Supabase SQL Editor, §3) — never just add a new value in
                           application code. This is exactly why Checked/Approved was modeled
                           as new `checkedAt`/`checkedById` columns instead of a third status
                           value — `CLAUDE_PICKING.md §6/§7`.
                           This table uses `@map` snake_case on every column (order_id,
                           picker_id, assigned_at, assigned_by_id, picked_at, checked_at,
                           checked_by_id) — predates and is EXEMPT from the camelCase-no-`@map`
                           rule (§3); an older table from the Phase 4 pick-list build.
pick_lists, pick_list_items
dispatch_change_queue

dispatch_slot_master       v27.7. Dispatch TIME windows — DISTINCT from arrival slots in slot_master.
                           id INT PK, windowTime TEXT (e.g. "10:30"), label TEXT?,
                           sortOrder INT, isActive BOOL, createdAt TIMESTAMPTZ, updatedAt TIMESTAMPTZ.
                           Seeded 4 windows: 10:30 / 12:30 / 16:00 / 18:00.
                           FK target for orders.dispatchWindowId. Will drive auto-slot-assignment
                           + downstream picking/planning when those layers are built.
```

### 7.5 Delivery Challan

```
delivery_challans          One per eligible order (Retail Offtake / Decorative Projects).
                           Number: CHN-{YEAR}-{5-digit seq}.

                           VOID columns (v27.3):
                           isVoided BOOLEAN DEFAULT false NOT NULL
                           voidReason TEXT (mirrors order removal reason)
                           voidRemark TEXT, voidedAt TIMESTAMPTZ

delivery_challan_formulas  Per-line tinting formula. v27.5 adds 3 columns for auto-fill tracking:
                           isManuallyOverridden BOOLEAN NOT NULL DEFAULT false
                             — permanent per-row lock once TM types a value; future TI never overwrites.
                           autoFilledAt TIMESTAMPTZ?
                             — timestamp of last auto-fill write; cleared on manual override.
                           sourceTiEntryId INTEGER?
                             — audit pointer to the TI row id that filled this formula.
                             No FK (cross-table — can be from either TI table).
```

### 7.6 Mail Orders (mo_*)

```
mo_orders                  Per parsed email
                           SHIP-TO OVERRIDE (v27.9): shipToOverrideCustomerId INT? FK →
                           delivery_point_master.id, relation `shipToOverrideCustomer`,
                           @relation("MoOrderShipToOverride") — mo_orders' FIRST relation to
                           delivery_point_master, no dual-relation trap. Legacy boolean
                           `shipToOverride` retained. Full detail: CLAUDE_MAIL_ORDERS.md §6.
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
mo_order_form_index_v2     ~454 active rows (after the full catalog restructure).
                           Columns:
                             family, product, baseColour, displayName, searchTokens,
                             tinterType, productType, sortOrder, isActive,
                             section, subgroup, uiGroup,
                             mobileFamily TEXT? (v27.5) — collapses Promise-family variants for
                                                          mobile labelling; declared but currently
                                                          NOT used as the label (label stays = family).
                             region TEXT? (v27.6) — optional grey-line qualifier (TOOLS 4" brushes:
                                                    Delhi NCR / UP Punjab / South); null on all paint.
                           UNIQUE (family, subProduct, baseColour) — **CORRECTED 2026-07-16**:
                           earlier docs wrongly said `(family, product, baseColour)`. `product` is
                           nullable; `subProduct` is NOT NULL — any duplicate guard must key on
                           `subProduct`, or it silently fails to catch duplicates on null-`product`
                           rows.
                           `product` is the SAP-clean stock name — the JOIN KEY into
                           mo_sku_lookup_v2.product. May be null on rows the seed couldn't resolve;
                           those rows render as "no packs" on the order form.

mo_sku_lookup_v2           ~1,680 rows (after the full catalog restructure). Parallel clean-name version.
                           material UNIQUE.
                           packCode TEXT — **CORRECTED 2026-07-16**: bare numeric string
                             ("1"/"4"/"10"/"20"/"500"/"400"/"12"/"25"...), NOT the `PackCode` enum
                             earlier docs claimed. `unit` is the separate type discriminator.
                           description TEXT NOT NULL — undocumented until 2026-07-16; every
                             insert must supply it, no db default.
                           isPrimary BOOLEAN NOT NULL DEFAULT true (v27.5)
                             — false on confirmed duplicate twins. **BOTH** `/api/order/data`
                               **AND** `/api/place-order/data` filter WHERE isPrimary = true
                               (confirmed live 2026-07-16 against `route.ts:92-93` — desktop was
                               fixed to match mobile in commit `46b500fb`, 2026-07-15). Earlier
                               "desktop unfiltered" claim is retired; do not reintroduce it
                               without re-reading the live route first.
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
                           Child sampling numbers use #PARENT-N suffix convention
                           (e.g. #134591-1) — see CLAUDE_SAMPLING_LIBRARY.md.

sampling_recipes           id PK. samplingNo FK CASCADE, skuCode, productName,
                           packCode (PackCode enum) — NULLABLE since v27.5 (legacy paper
                             register entries often have no pack recorded).
                           tinQty, 13 TINTER + 14 ACOTONE pigment columns
                           (all Decimal default 0), isPrimary, usageCount,
                           firstUsedAt, lastUsedAt, createdAt, updatedAt.
                           UNIQUE (samplingNo, skuCode, packCode) with NULLS NOT DISTINCT
                             — blocks duplicate null-pack rows on re-import. v27.5.

sampling_usage_log         id PK. samplingNo FK CASCADE, recipeId FK SET NULL,
                           usageDate DATE?, operatorId FK?, operatorNameRaw, tinQty,
                           dealerNameRaw, siteId FK?, siteNameRaw, skuCodeRaw,
                           packCode?, deliveryNumber TEXT? (v27.4), sourceRowIndex,
                           createdAt.
                           Suggestion engine matches by siteId STRICTLY (numeric FK).
                           Writes MUST populate siteId from orders.customerId
                           (= resolved ship-to FK). Fixed 2026-06-01.
```

Full detail in `CLAUDE_SAMPLING_LIBRARY.md`.

### 7.10 Visibility / Hide (v27.6)

Admin "Settings → Hide" feature. SQL: `sql/2026-06-12-hide-feature.sql` (no transaction wrapper). Prisma: scalar fields only, no relations; timestamps `@db.Timestamptz(6)`.

```
obd_visibility_rules       Bulk auto-hide rules. id, ruleName,
                           conditionType ('tag' | 'daysOld'),
                           conditionTag (e.g. 'HOLD'), conditionDaysGt INT,
                           isActive BOOLEAN DEFAULT true (indexed),
                           createdById, createdAt, updatedById, updatedAt.
                           v1 conditions: HOLD + daysOld only (schema is generic).

app_tag_settings           Per-badge on/off. id, tagKey TEXT UNIQUE,
                           isEnabled BOOLEAN DEFAULT true, updatedById, updatedAt.
                           Default-ON (no row = badge shows).

orders                     hide columns (see §7.3): isHidden, hiddenById, hiddenReason, hiddenAt.
```

Hide **audit reuses `order_status_logs`** (toStage `ORDER_HIDDEN` / `ORDER_UNHIDDEN`, note carries reason) — no separate audit table. Helpers `lib/hide/visibility.ts` (`getActiveHideRules`, `getHideExclusion` — NULL-safe, see §13 — `getHiddenWhere`, `matchesRule`), `lib/hide/tag-settings.ts`, `lib/hide/tag-catalog.ts`. Feature spec: `CLAUDE_UI.md §57`; MO tag-gating: `CLAUDE_MAIL_ORDERS.md §21`.

### 7.11 Trip Report (v27.8)

```
trip_report                Standalone Supabase mirror of NTS trip/delivery data — read-only,
                           not connected to the orders/OBD pipeline. sourceId TEXT @id (NTS's
                           own row id — changes per pull, not used for dedup).
                           UNIQUE (deliveryNo, disDate) — trip_report_delivery_no_dis_date_key.
                           Indexes: (disDate), (disDate, tripNo).
```

Full ~38-column list: `CLAUDE_TRIP_REPORT.md §3`. Populated by an external PowerShell puller (outside the repo) via the `mirror_trip_report_today(rows jsonb)` Postgres function — an atomic per-day delete+insert, not a row-level upsert (see `CLAUDE_TRIP_REPORT.md §2` for why). `/trips` access: `CLAUDE_TRIP_REPORT.md §1`; roles: §5 above.

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
- **Order recipient:** `/po` + `/place-order` send orders to **`surat.depot@akzonobel.com`** (AkzoNobel inbox auto-forwards to `surat.order@outlook.com`, the parser inbox — so the parser `OutlookAccount` config is unchanged). The frozen public `/order` page still sends to `surat.order@outlook.com`. (`CLAUDE_PLACE_ORDER.md §11`.)
- **Mobile external-scheme handoff:** on mobile, a synchronous `history.go()` in the same tick as a `mailto:` (or any external navigation) cancels the handoff — fire the external navigation first, defer any history reset via `setTimeout(…, 0)` (`CLAUDE_PLACE_ORDER.md §25`).

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

**`arrivalSlotId` (2026-06-29 — added v27.7 column, behaviour completed this consolidation):** stamped at import for ALL orders — tint and non-tint alike — via `resolveArrivalSlotId(emailDateTime)` (the 5-slot ruler in `lib/slots/slot-ruler.ts`: Morning/Afternoon/Evening/Late Evening/Night, distinct from the 4-slot table above). `slotId` stays null for tint until completion, unaffected by this. Full detail + landmines (manual-SAP no-time-column → Morning default, JSON auto-import re-stamp fix): `CLAUDE_IMPORT.md §12`.

**Slot cascade and day-boundary reset are DISABLED.** Files `lib/slot-cascade.ts` and `lib/day-boundary.ts` exist but are not called.

**`applyMailOrderEnrichment()`:** On SAP import, checks `mo_orders` for matching `soNumber`. If found, applies `dispatchStatus`, `priorityLevel`, `remarks`, overrides, and sets `orderDateTime` from `mo_orders.receivedAt`. Skips slot recalc for tint orders. One soNumber can map to many OBDs (`updateMany`).

---

## 10. Universal header system

Component: `components/universal-header.tsx`. Used by ALL boards.

**Row 1 (52px sticky, z-30):** Title (ReactNode) · Stats (11px gray-400) · Clock IST HH:MM · ⌨ Shortcuts · Download · Search (180→260px).

**Row 2 (40px sticky top-[52px], z-30):** Segmented control + leftExtra · rightExtra · Filter ▾ · Date stepper (calendar popover).

**Color rule:** ONE teal element = active slot segment. Everything else gray. *Per-screen exemption:* Sampling Library uses teal on multiple elements intentionally (`CLAUDE_UI.md §22`).

**Slot segments:** depot-wide boards (Support / Planning / Warehouse, `slot_master`-driven) show **4** — filter out Next Day Morning, no "All" button. **Mail Orders is a separate system** (computed at render from `receivedAt`, hardcoded names in `lib/mail-orders/utils.ts`, cutoffs in `system_config`) and shows **5** since 2026-06-18 (added "Late Evening"; `CLAUDE_MAIL_ORDERS.md §9.1`). The two slot systems never share numbers.

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

**Mobile shell (2026-07-05/06):** `role-layout-client.tsx` now also mounts a shared mobile app shell (`components/shared/mobile-shell.tsx`) globally as a sibling to `<RoleSidebar>` — a fixed, mobile-only (`block md:hidden`) Home/Menu/You bottom bar. Every page that wraps itself in `role-layout-client.tsx` inherits it automatically, no per-page work. Desktop sidebar untouched. Pages with their own layout that bypasses this wrapper (Attendance, `/order`) don't get it. Full spec: `CLAUDE_UI.md §59`.

---

## 12. Screens index

Full detail in domain files. Cross-reference only here.

### Admin
`/admin`. admin, ops_admin. Customer / SKU / route / area / user / system config / import / attendance dashboard / **removed-orders** (admin-only restore page) / **Settings → Hide** (`/admin/settings/hide`, admin-only — Rules / Hidden Orders / Tags tabs; `CLAUDE_UI.md §57`, schema §7.10).

### Mail Orders
`/mail-orders`. billing_operator, tint_manager, admin. → `CLAUDE_MAIL_ORDERS.md`

### Tint Manager / Operator / Challans / Shades
`/tint/*`. → `CLAUDE_TINT.md`

### Reports
`/reports` hub + `/reports/tint-summary`. tint_manager, admin, operations. Gated by the reused `ti_report` permission. **Tint Summary** daily MIS report + the former **TI Report** (folded in — old `/tint/manager/ti-report` and `/ti-report` redirect to `/reports?r=ti-report`). API: `GET /api/reports/tint-summary`. → `CLAUDE_TINT.md §11-§12`, `CLAUDE_UI.md §56`.

### Sampling Library
`/tint/sampling-library`. tint_manager, tint_operator (read), admin. → `CLAUDE_SAMPLING_LIBRARY.md`

### Attendance
`/attendance` (end-user PWA), `/admin/attendance` (admin dashboard + ot-pending + settings + ot-audit). → `CLAUDE_ATTENDANCE.md`

### Trip Report
`/trips` (list, per-trip detail), `/trips/[tripNo]/sheet` (A4 print). logistics + 4 named secondary-role users (§5). Read-only NTS trip mirror — standalone, not connected to the OBD pipeline. → `CLAUDE_TRIP_REPORT.md`

### Place Order
`/place-order` (desktop, label "Purchase Order (PO)"). `/order` (public mobile). → `CLAUDE_PLACE_ORDER.md`

### Import
`/admin/import`. → `CLAUDE_IMPORT.md`

### Support
`/support`. support, admin, operations. Columns: checkbox | OBD/DATE | CUSTOMER | ROUTE/TYPE | VOL(L) | AGE | DISPATCH | PRIORITY | SLOT. History view, slot sections, bulk actions, date picker, OrderDetailPanel.
→ `CLAUDE_SUPPORT.md` (gatekeeper, workflow pipeline, closed parking-stage, hold/dispatch-target, open agenda).

### Dispatch Planning
`/planning`. dispatcher, admin, operations. Planning at ORDER level. All splits of one OBD go to same vehicle.

### Warehouse
`/warehouse`. floor_supervisor, picker, admin, operations. 300px left (unassigned) / flex right (pickers).

### Picking
`/picking`. Desktop queue + mobile supervisor board (Assign/Check tabs), one route/responsive split. admin, operations today — `floor_supervisor` (the intended primary user) currently CANNOT open it, see §13 landmine. → `CLAUDE_PICKING.md`.

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
- **Challan PATCH `prisma.$transaction`** (`app/api/tint/manager/challans/[orderId]/route.ts:527`) — formula upsert wrapped in `$transaction`. Pre-existing; only Chandresh saves challans (low concurrency). Refactor in a dedicated session.
- **Challan cell-clear UX bug** — `components/tint/challan-content.tsx:211-213` filters empty strings out of PATCH body. Server has no delete branch. Clearing a cell in the UI does NOT clear the DB row. After auto-fill shipped, a TM cannot "unlock" a manually-overridden row by clearing it. Mitigation if needed: build a proper "Reset to auto" button.
- **One-time backfill endpoints** (keep for emergency):
  - `POST /api/admin/fix-slots` — backfills `orderDateTime` + recalculates slotId
  - `POST /api/admin/fix-challans` — creates missing delivery_challans
  - `POST /api/mail-orders/backfill-customers` — marked TEMPORARY
- **`enrich-v2.ts`** — duplicate `SkuEntry` type, not imported anywhere.
- **`CATEGORY_KEYWORDS` constant** in `enrich.ts` — dead code.
- **GEN SKUs** — 8 deleted: `5860311, 5984151, 5967877, 5955808, 5955810, 5955818, 5955826, 5911947`. If new GEN SKUs appear in imports, delete them.
- **Challan sequence allocation must include voided rows** — opposite of every other challan read. Don't filter `isVoided: false` in sequence-numbering queries.
- **Auto-Import paused** — only manual SAP upload runs since 2026-05-14. If resumed, audit cross-source orphan policy first (see `CLAUDE_IMPORT.md §15`).
- **`shade_master` deprecated.** Sampling Library Phase 4 shipped (2026-05-25). All new shade saves write to `sampling_register` + `sampling_recipes` + `sampling_usage_log`. `shade_master` table still exists with historical data but is no longer read or written by the live operator workflow. Scheduled for deletion after a retention window. Do not write to it.
- **Split-done usage-log gap.** `app/api/tint/operator/split/done/route.ts` never writes a `sampling_usage_log` row. Split-completed tints never appear in the Sampling Library usage history or same-site suggestions. Pre-existing, separate from any other tint bug. ROADMAP item: decide whether splits should log usage.
- **`/api/order/data` and `/api/place-order/data` carry duplicated v2 payload queries** — no shared helper yet. If you edit the v2 payload shape, edit BOTH or extract a shared builder.
- **Legacy `mo_order_form_index` + `mo_sku_lookup` orphaned by `/order` and `/place-order`** — both frontends now read v2 tables. BUT the mail parser + enrichment still read the LEGACY tables. Do NOT delete the legacy tables until the parser is migrated to v2 (Stage 3 of the v2 single-source plan; see `CLAUDE_PLACE_ORDER.md`).
- **Pre-existing `prisma.$transaction` in admin customer routes** (`app/api/admin/customers/route.ts` lines 133 & 186) — flagged in multi-SO commit, left untouched. Refactor when convenient.
- **NULL three-valued logic (Hide filter).** Prisma `NOT { field: value }` on a NULLABLE column DROPS NULL rows (a "hide if HOLD" rule hid every order whose `dispatchStatus` was null). For "exclude matching" filters build NULL-safe KEEP conditions: `{ OR: [ { field: null }, { field: { not: value } } ] }`, AND-combined. Implemented in `getHideExclusion()`. The hide filter is AND-merged into every order-display query (Tint Manager, TM missing-customers, Tint Operator my-orders, Support, Planning, Warehouse, Operations) — NOT into Hidden-Orders/restore views, challan audit OR, import internals, or `mo_orders` (out of v1 scope).
- **`orders.dispatchStatus` Hold value is lowercase `"hold"`.** The capitalized `"Hold"` belongs to the mail-orders pipeline (`getOrderSignals` status badge), not the orders table.
- **MO badges are centralized in `getOrderSignals()`** (one emit point — easy to tag-gate, §MAIL_ORDERS §21). **Tint badges are NOT centralized** (hardcoded across 3 components, `getAgeBadge` duplicated) — gating them needs a shared badge registry first (the deferred "hard part").
- **Hide does NOT delete.** Rules + manual hide are reversible; rule-hidden orders have no per-order un-hide in v1 (Hidden Orders shows "Managed by rule"); only manual hides get an Un-hide button.
- **Orphaned `components/support/ship-to-override-modal.tsx`** — dead code predating the 2026-07-07 inline ship-to override picker (`CLAUDE_SUPPORT.md §4.18`). No trigger opens it, its form is free-text (not the search picker), its `onSave` is a no-op. Left untouched (never delete files unless instructed) — the live feature is the inline cell, fully independent of this file.
- **`floor_supervisor` cannot open `/picking`** — the intended primary user has no `role_permissions` row (nor a `prisma/seed.ts` row) for `pageKey='picking'`. SQL + a matching seed row are prepared but **not yet run** — diagnosed and ready, not a design question, hence a landmine rather than a ROADMAP item. Full detail + the SQL: `CLAUDE_PICKING.md §7`.
- **SECURITY — `GET /api/mail-orders/backfill-enrich` is fully unauthenticated** — no session check, no HMAC. Marked `TEMPORARY — delete after backfill` in its own source but still live. Performs a bulk write across `mo_order_lines`. Reachable by anyone with the URL. Surfaced 2026-07-10, not fixed.
- **SECURITY — broad no-role-check gap across `app/api/mail-orders/**`** — most routes check only "is there a valid session," never role/permission (full route list: `CLAUDE_MAIL_ORDERS.md §18`). Any logged-in user of any role can PATCH/POST Mail Orders data by calling these directly. Consequence: a view-only (`canEdit=false`) grant on this module — e.g. `tint_manager`'s — is currently a UI illusion only, not server-enforced.
- **Mail Orders write routes gate on `canView`, not `canEdit`** — same pattern independently found on `/picking`'s write routes (`assign`/`unassign` both check `canView`). There is no distinct read-only access on either module today; a real write probably should check `canEdit`. Pre-existing on both, not introduced by any one session.
- **`addToPackMap` dedupe-collision risk** (`app/api/place-order/data/route.ts` and `/api/order/data`) — dedup key is first-row-wins with **no `orderBy`** on the `skuRows` query. If two `isPrimary=true` rows ever collide on the same rendered pack, which one wins is unspecified. Unrelated to the isPrimary filter itself (§7.7) — a separate, still-open risk.
- **"WHITE BASE" in a SKU `description` does NOT reliably mean Brilliant White** — at least 3 WS Powerflexx SKUs were found misfiled under `baseColour='BRILLIANT WHITE'` despite being `90 BASE` (fixed 2026-07-16). Likely not isolated — a catalog-wide `description ILIKE '%WHITE BASE%'` sweep under `baseColour='BRILLIANT WHITE'` is a candidate follow-up, not yet run.

---

## 14. Operational checklists

- **Sampling duplicate merge:** dedupe by EXACT full formula (recipe fingerprint), never shade name; use RAW `packCode` enum in SQL (not the display label); never delete `sampling_register` rows (inactivate `isActive=false`); preserve the single-`isPrimary` invariant on the master. Full runbook + reference graph: `CLAUDE_SAMPLING_LIBRARY.md §12`. Note: GEN-SKU delete-list SKUs may still appear as historical sampling variants — merging does not auto-strip them.

---

## 15. Key lib modules (cross-cutting / new this cycle)

Quick index; full detail in domain file maps.

| Module | Purpose | Doc |
|---|---|---|
| `lib/place-order/pack-buckets.ts` | desktop variant-grid columns (`PACK_TO_BUCKET`, `FAMILY_BUCKET_OVERRIDES`, silent-drop) | PLACE_ORDER §24 |
| `lib/place-order/keyword-family-map.ts` | whole-query word→family search promotion (shared mobile+desktop) | PLACE_ORDER §13 |
| `lib/place-order/sub-product-descriptors.ts` | two-line descriptors + `isVariantQualifierTab` + `getSecondLine` | UI §43 |
| `lib/place-order/email.ts` | `buildEmail` + `emailLineLabel` (single name source for all 3 builders) | PLACE_ORDER §11 |
| `lib/sampling/pack-litres.ts` | dose-litres map + `packDoseLitres`/`scalePigments`/`perLitreFingerprint` | SAMPLING §11 |
| `lib/hide/*` | `visibility.ts`, `tag-settings.ts`, `tag-catalog.ts` (Hide feature) | §7.10, UI §57 |
| `lib/reports/tint-summary-data.ts` | Tint Summary report data source-of-truth | TINT §12 |

Engineering note: a parallel session owns `scripts/_*` scratch files (sampling/report seed helpers) — they throw `tsc --noEmit` errors but are never committed; exclude `scripts/_*` from tsconfig or delete to keep the gate clean. Same treatment for `docs/dhruv-review/**` (added 2026-07-08) — a parked, untracked draft-review snapshot with its own stale/incomplete types; excluded from `tsconfig.json` for the same reason (never committed, not live code).

---

*CORE v80 · Schema v27.10 · OrbitOMS*
