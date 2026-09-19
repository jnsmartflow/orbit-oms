# Code discovery — role census: count and sort
# 2026-08-31 · READ-ONLY · no application code changed · Lives in: docs/prompts/drafts/

**Premise (given, not re-litigated).** OrbitOMS is moving from role-based to USER-based access. A job
title becomes a LABEL; a per-user table holds the ticks; `role_master` survives only as (a) that
label and (b) a STARTER SET copied at user creation; `role_permissions` retires. One deliberate
exception: where the job title decides WHICH VERSION of a screen to draw, it stays.

**This document counts and sorts what that touches. It does not design the migration and does not
recommend for or against.**

**Method.** Every count is a reproducible sweep, not an estimate. Three parsers were written to
`scratchpad/`: a route parser that attributes each gate to its enclosing exported handler (so a GET's
`canView` is never read as a POST's gate); an actor parser that looks inside each write's argument
AND at the whole handler body, with the two signals reconciled by hand where they disagreed; and a
pile classifier that pins hand-assigned FACE/ROUTING sites by `file:line` so the totals re-derive.
Comment text and import statements are stripped before matching. `archive/**` excluded throughout.

Live data is a read-only `SELECT` (`scripts/_chk-role-census-20260831.ts`) against production,
2026-08-31. No INSERT/UPDATE/DELETE/ALTER was issued.

---

## 1. Every mechanism, with counts

422 role-reading sites across **208 files**. `lib/permissions.ts` and `lib/rbac.ts` are excluded as
the definition files (their own internals are itemised in §1b).

| Mechanism | Sites | Files | Pile | Example 1 | Example 2 |
|---|---:|---:|---|---|---|
| `requireRole` | **117** | 95 | PERMISSION | `app/api/admin/users/route.ts:38` | `app/(admin)/admin/layout.tsx:15` |
| `checkAnyPermission` | **78** | 75 | PERMISSION | `app/api/floor/actions/route.ts:51` | `app/(floor)/floor/layout.tsx:26` |
| inline `session.user.role ===/!== "…"` | **61** | 35 | PERMISSION | `app/api/admin/hide/rules/route.ts:24` | `app/api/tint/manager/assign/route.ts:23` |
| `roles.includes("…")` | **47** | 38 | PERMISSION (1 FACE) | `app/api/mrn/create/route.ts:57` | `app/(ops)/layout.tsx:38` ← the FACE one |
| `checkPermission` | **38** | 31 | PERMISSION | `app/api/admin/skus/route.ts:79` | `app/(tint)/tint/manager/skus/page.tsx:19` |
| `hasRole` | **16** | 12 | PERMISSION | `app/api/admin/attendance/export/route.ts:41` | `app/api/tint/operator/shades/route.ts:62` |
| `getAllPermissionsForRole(s)` | **14** | 13 | ROUTING | `app/(tint)/tint/manager/layout.tsx:30` | `app/mrn/page.tsx:46` |
| `buildNavItems` | **12** | 12 | ROUTING | `app/picking/page.tsx:50` | `app/(ops)/layout.tsx:53` |
| `as RoleSidebarRole` cast | **12** | 12 | FACE | `app/picking/page.tsx:144` | `app/(mail-orders)/mail-orders/layout.tsx:69` |
| `getPagePermissions` | **9** | 9 | PERMISSION | `app/(admin)/admin/customers/page.tsx:16` | `app/(dispatcher)/dispatcher/skus/page.tsx:20` |
| inline `primaryRole` / `userRole ===` | **8** | 6 | PERMISSION (4 FACE, 2 ROUTING) | `app/picking/page.tsx:82` ← FACE | `components/admin/admin-sidebar.tsx:164` ← ROUTING |
| client role array (`canImportOBDs` + 1) | **7** | 7 | PERMISSION | `app/(mail-orders)/mail-orders/mail-orders-page.tsx:169` | `components/tint/tint-manager-content.tsx:1888` |
| `ROLE_REDIRECTS[…]` use | **3** | 3 | ROUTING | `app/page.tsx:11` | `app/login/page.tsx:11` |
| **TOTAL** | **422** | **208** | | | |

**Client-side role arrays — there are two distinct ones, not one.** Six `canImportOBDs` declarations
in two versions (recorded in `code-discovery-2026-08-30-permission-actions.md §4`): the mail-orders
one carries 7 roles, the five tint ones carry 5. The seventh "client role array" match is
`app/(ops)/layout.tsx:31`, `["admin","ops_admin"].includes(r)` — the (ops) group's own gate.

**`middleware.ts` reads role exactly once**, at `:67` inside the `PHASE1_BLOCKED` guard. That array
is `[]` today (`middleware.ts:30`), so the branch is unreachable. Middleware performs **no** role
gating otherwise — every `/admin` and module gate is a layout, confirming
`code-discovery-2026-08-28-admin-panel.md §6a`.

**Layouts.** 11 group/page layouts each run the same four-step shape: `auth()` → `roles` →
`checkAnyPermission(roles, <key>, "canView")` → `getAllPermissionsForRoles` + `buildNavItems` →
`role={primaryRole as RoleSidebarRole}`. `app/(ops)/layout.tsx` is the one that differs (§3).

### 1b. Inside the two definition files — 6 further role reads, excluded from the 422

| Site | What it decides | Pile |
|---|---|---|
| `lib/permissions.ts:93-117` `ROLE_HREF_OVERRIDES` | 3 roles × 4 page keys = **12 href rewrites** — `tint_manager`/`operation_manager` get `/tint/manager/customers`, `dispatcher` gets `/dispatcher/customers` | **AMBIGUOUS** |
| `lib/permissions.ts:131` | `roleSlug === "admin"` → always show the Attendance nav item | AMBIGUOUS |
| `lib/permissions.ts:136` | `roleSlug === "ops_admin"` → **suppress** the Attendance nav item (they get `/admin/attendance` instead) | AMBIGUOUS |
| `lib/permissions.ts:231/246/261/281/313` | the five admin short-circuits inside the helpers | PERMISSION |
| `lib/rbac.ts:23-45` `ROLE_REDIRECTS` | 13 role→landing-page entries | ROUTING |
| `lib/auth.ts:65-72` `gateAppliesTo` — `if (role === "admin") return flags.attendanceTestUser` | whether the attendance check-in gate applies at all | **AMBIGUOUS** |

### Pile totals

| Pile | Sites | Share |
|---|---:|---:|
| **PERMISSION** | **374** | 88.6% |
| **FACE** | **17** | 4.0% |
| **ROUTING** | **31** | 7.3% |
| **AMBIGUOUS** | **0** in the 422; **4 mechanisms** in §1b + 3 named in §9 | — |

The AMBIGUOUS pile is deliberately empty inside the 422 because every one of those sites resolves
cleanly. The genuinely undecidable material is structural, not per-site, and is named in §1b and §9.

---

## 2. The requireRole / inline-role routes — the full list

**94 mutating route files carry a hardcoded-role gate.** Of those, **30 also** check a permission
flag on the same mutating handler (belt-and-braces: the role list narrows, the flag decides), and
**64 are role-only** — no flag anywhere on the write.

Method note: gates are attributed to the enclosing exported handler. `requireRole(session, [ADMIN])`
appearing twice in a file (once in GET, once in POST) is counted once per handler.

### 2a. Admin master data — `requireRole([ADMIN])` only (39 files)

Every one protects a master-data table write. All PERMISSION.

| File | Method | Role array | Protects |
|---|---|---|---|
| `admin/areas/[id]/route.ts:19` | PATCH | `[ADMIN]` | area rename + route remap |
| `admin/areas/import/route.ts:10` | POST | `[ADMIN]` | bulk area CSV import |
| `admin/base-colours/[id]/route.ts:16` | PATCH | `[ADMIN]` | base colour edit |
| `admin/base-colours/import/route.ts:10` | POST | `[ADMIN]` | bulk base colour import |
| `admin/base-colours/route.ts:27` | POST | `[ADMIN]` | base colour create |
| `admin/contact-roles/[id]/route.ts:16` | PATCH | `[ADMIN]` | contact-role edit |
| `admin/contact-roles/route.ts:23` | POST | `[ADMIN]` | contact-role create |
| `admin/customer-types/route.ts:26` | POST | `[ADMIN]` | customer-type create |
| `admin/customers/import/route.ts:61` | POST | `[ADMIN]` | bulk customer import (4 writes) |
| `admin/dispatch-cutoffs/[id]/route.ts:16` | PATCH | `[ADMIN]` | cutoff edit |
| `admin/permissions/route.ts:36` | POST | `[ADMIN]` | **upserts `role_permissions` itself** |
| `admin/premises-types/route.ts:26` | POST | `[ADMIN]` | premises-type create |
| `admin/product-categories/[id]/route.ts:16` | PATCH | `[ADMIN]` | category edit |
| `admin/product-categories/import/route.ts:10` | POST | `[ADMIN]` | bulk category import |
| `admin/product-categories/route.ts:27` | POST | `[ADMIN]` | category create |
| `admin/product-names/[id]/route.ts:17` | PATCH | `[ADMIN]` | product-name edit |
| `admin/product-names/import/route.ts:10` | POST | `[ADMIN]` | bulk product-name import |
| `admin/product-names/route.ts:36` | POST | `[ADMIN]` | product-name create |
| `admin/routes/[id]/route.ts:17` | PATCH | `[ADMIN]` | route edit |
| `admin/routes/import/route.ts:10` | POST | `[ADMIN]` | bulk route import |
| `admin/sales-officers/[id]/route.ts:18` | PATCH | `[ADMIN]` | SO edit |
| `admin/sales-officers/import/route.ts:10` | POST | `[ADMIN]` | bulk SO import |
| `admin/sales-officers/route.ts:28` | POST | `[ADMIN]` | SO create |
| `admin/skus/[id]/route.ts:31` | PATCH | `[ADMIN]` | SKU edit (old `sku_master`) |
| `admin/skus/import/route.ts:12` | POST | `[ADMIN]` | bulk SKU import |
| `admin/slot-rules/[id]/route.ts:26` | PATCH | `[ADMIN]` | slot-rule edit |
| `admin/slot-rules/route.ts:39` | POST | `[ADMIN]` | slot-rule create |
| `admin/slots/[id]/route.ts:20` | PATCH | `[ADMIN]` | slot edit |
| `admin/slots/route.ts:27` | POST | `[ADMIN]` | slot create |
| `admin/so-groups/[id]/route.ts:22` | PATCH | `[ADMIN]` | SO-group edit |
| `admin/so-groups/route.ts:33` | POST | `[ADMIN]` | SO-group create |
| `admin/sub-areas/[id]/route.ts:17` | PATCH | `[ADMIN]` | sub-area edit |
| `admin/sub-areas/import/route.ts:10` | POST | `[ADMIN]` | bulk sub-area import |
| `admin/system-config/route.ts:31` | PATCH | `[ADMIN]` | global config |
| `admin/transporters/[id]/route.ts:19` | PATCH | `[ADMIN]` | transporter edit |
| `admin/transporters/import/route.ts:10` | POST | `[ADMIN]` | bulk transporter import |
| `admin/transporters/route.ts:30` | POST | `[ADMIN]` | transporter create |
| `admin/users/[id]/route.ts:23` | PATCH | `[ADMIN]` | **edits `users.roleId`**, name, email, active, password |
| `admin/users/route.ts:38` | POST | `[ADMIN]` | **creates a user with `roleId`** |
| `admin/vehicles/[id]/route.ts:23` | PATCH | `[ADMIN]` | vehicle edit |
| `admin/vehicles/import/route.ts:10` | POST | `[ADMIN]` | bulk vehicle import |

*(41 rows — `admin/areas/import` and `admin/customers/import` are listed once each.)*

### 2b. Admin master data — `requireRole` + inline-role + a flag (7 files)

The "six-role gate then admin-bypass then flag" shape. All PERMISSION.

| File | Method | Role array | Then | Protects |
|---|---|---|---|---|
| `admin/areas/route.ts:55` | POST | `[ADMIN, DISPATCHER, SUPPORT, TINT_MANAGER, TINT_OPERATOR, FLOOR_SUPERVISOR]` | `!== "admin"` → `routes_areas`/`canEdit` | area create |
| `admin/customers/route.ts:149` | POST | `[ADMIN, DISPATCHER, SUPPORT, TINT_MANAGER, TINT_OPERATOR, FLOOR_SUPERVISOR, OPERATION_MANAGER]` | → `customers`/`canEdit` | customer create + `orders` updateMany |
| `admin/customers/[id]/route.ts:112` | PATCH | same 7 | → `customers`/`canEdit` | customer edit (5 writes) |
| `admin/routes/route.ts:39` | POST | same 6 as areas | → `routes_areas`/`canEdit` | route create |
| `admin/skus/route.ts:77` | POST | same 6 | → `skus`/`canEdit` | SKU create |
| `admin/sub-areas/route.ts:37` | POST | `[ADMIN]` | `!== "admin"` → `routes_areas`/`canEdit` | sub-area create |
| `admin/vehicles/route.ts:39` | POST | same 6 | → `vehicles`/`canEdit` | vehicle create |

### 2c. Admin — inline `session.user.role !== "admin"` only, no `requireRole` (8 files)

These read the **primary** role only; a secondary admin grant would be refused here and allowed by
`requireRole`. All PERMISSION. (Recorded in `code-discovery-2026-08-28-admin-panel.md §6c`.)

| File | Method | Check | Protects |
|---|---|---|---|
| `admin/hide/orders/[id]/hide/route.ts:20` | POST | `role !== "admin"` | hide an order |
| `admin/hide/orders/[id]/unhide/route.ts:20` | POST | same | un-hide an order |
| `admin/hide/rules/route.ts:40` | POST | same | create a visibility rule |
| `admin/hide/rules/[id]/route.ts:25` | PATCH | same | edit a rule |
| `admin/hide/rules/[id]/route.ts:139` | DELETE | same | **hard-delete** a rule |
| `admin/removed-orders/[id]/restore/route.ts:22` | POST | same | restore a removed OBD |
| `admin/tag-settings/route.ts:33` | PATCH | same | tag-gating settings |
| `admin/attendance/ot-pending/[recordId]/route.ts:40` | PATCH | `hasRole([ADMIN, OPS_ADMIN])` | approve/reject overtime |
| `admin/attendance/settings/route.ts:165` | PATCH | `hasRole([ADMIN, OPS_ADMIN])` | attendance policy knobs |

### 2d. Backfill / fix endpoints (2 files)

| File | Method | Role array | Protects |
|---|---|---|---|
| `admin/fix-challans/route.ts:13` | POST | `[ADMIN, OPERATIONS]` | creates missing `delivery_challans` |
| `admin/fix-slots/route.ts:45` | POST | `[ADMIN, OPERATIONS]` | rewrites `orders.slotId` in bulk |

### 2e. Tint Manager (12 files)

| File | Method | Role array | Then | Protects |
|---|---|---|---|---|
| `tint/manager/assign/route.ts:22` | POST | `[TINT_MANAGER, ADMIN, OPERATIONS, OPERATION_MANAGER]` | `!== admin && !== OPERATIONS` → `tint_manager`/`canEdit` | assign a tint job |
| `tint/manager/cancel-assignment/route.ts:11` | POST | same 4 | same | cancel an assignment |
| `tint/manager/splits/cancel/route.ts:16` | POST | same 4 | same | cancel a split |
| `tint/manager/splits/create/route.ts:65` | POST | same 4 | same | create splits |
| `tint/manager/splits/reassign/route.ts:17` | POST | same 4 | same | reassign a split |
| `tint/manager/splits/[id]/status/route.ts:13` | PATCH | same 4 | **role only** | split stage change |
| `tint/manager/orders/[id]/status/route.ts:13` | PATCH | same 4 | **role only** | order stage change |
| `tint/manager/reorder/route.ts:17` | PATCH | same 4 | **role only** | operator queue reorder |
| `tint/manager/challans/[orderId]/route.ts:437` | PATCH | same 4 | **role only** | challan save (+ formula upsert) |
| `tint/manager/manual-entry/route.ts:43` | POST | `[TINT_MANAGER, ADMIN]` | **role only** | manual tint entry (6 writes) |
| `tint/manager/manual-entry/revert/route.ts:54` | POST | `[TINT_MANAGER, ADMIN]` | **role only** | revert a manual entry (5 writes) |
| `tint/manager/orders/[id]/remove/route.ts:29` | POST | inline `=== "admin"` bypass | → `tint_manager`/**`canView`** | soft-remove an OBD + void challan |

### 2f. Tint Operator (10 files)

| File | Method | Role array | Then | Protects |
|---|---|---|---|---|
| `tint/operator/start/route.ts:17` | POST | `[TINT_OPERATOR, OPERATIONS]` | → `tint_operator`/`canEdit` | start a tint job |
| `tint/operator/done/route.ts:31` | POST | `[TINT_OPERATOR, OPERATIONS]` | → `canEdit` | finish a tint job |
| `tint/operator/split/start/route.ts:23` | POST | `[TINT_OPERATOR, OPERATIONS]` | → `canEdit` | start a split |
| `tint/operator/split/done/route.ts:31` | POST | `[TINT_OPERATOR, OPERATIONS]` | → `canEdit` | finish a split |
| `tint/operator/pause/route.ts:51` | POST | inline admin bypass | → `tint_operator`/**`canView`** | pause a job |
| `tint/operator/resume/route.ts:30` | POST | inline admin bypass | → **`canView`** | resume a job |
| `tint/operator/shades/route.ts:136` | POST | `hasRole(ALLOWED_ROLES)` = `[TINT_OPERATOR, TINT_MANAGER, ADMIN]` | **role only** | create a shade (deprecated table) |
| `tint/operator/shades/[id]/route.ts:56` | PUT | same | **role only** | edit a shade |
| `tint/operator/tinter-issue/route.ts:29` | POST | `hasRole([TINT_OPERATOR, ADMIN, OPERATIONS])` | **role only** | log a tinter issue |
| `tint/operator/tinter-issue/[id]/route.ts:74` | PATCH | same | **role only** | resolve a tinter issue |
| `tint/operator/tinter-issue-b/route.ts:28` | POST | same | **role only** | tinter-issue B create |
| `tint/operator/tinter-issue-b/[id]/route.ts:75` | PATCH | same | **role only** | tinter-issue B resolve |

### 2g. MRN, Picking, Import — `roles.includes("admin")` bypass wrappers (10 files)

Each is `if (!roles.includes("admin")) { checkAnyPermission(...) }` — the role read is only an admin
short-circuit ahead of a flag. All PERMISSION. Full flag detail in the 08-30 report §3.

`mrn/create:57` · `mrn/[mrnId]/start:48` · `end:50` · `header:64` · `line/[lineId]:88` ·
`lines:60` · `delete:52` · `resolve-skus:48` · `picking/push-test:19` · `import/obd:3795`
(the last preceded by `requireRole([ADMIN, DISPATCHER, SUPPORT, BILLING_OPERATOR, TINT_MANAGER,
OPERATION_MANAGER, OPERATIONS])` at `:3786`).

### 2h. `picking/findings/report` (1 file)

`app/api/picking/findings/report/route.ts:167` — `roles.includes(ADMIN) || roles.includes(OPERATIONS)`
gates a **test hook**, not the write; the write is gated on `picking`/`canView` at `:57`. PERMISSION,
except `:170` `primaryRole === "picker"` which is FACE (§3).

### 2i. Not a mutating route, but the same shape

`app/api/warehouse/pickers/route.ts:49` — GET, `requireRole([FLOOR_SUPERVISOR, ADMIN, OPERATIONS])`,
returns the picker roster. Flagged because CORE §12 marks this file as a survivor routinely mistaken
for a casualty, and because its **body** is a role-scoped query (§5).

---

## 3. FACE sites — what must survive

**17 sites, 5 of them real branches and 12 of them a label cast.**

### 3a. The five real branches

| # | Site | The branch | What breaks if the job title stops being reliable |
|---|---|---|---|
| 1 | `app/picking/page.tsx:82-83` | `isPickerRole = primaryRole === "picker"`; `showPickerFace = isPickerRole \|\| (canUseTestHook && view=picker)` | The page renders either "My Picks" or the supervisor board. With no reliable title, a picker gets the **supervisor board** — which lists every picker's bills and offers Assign — or a supervisor gets a one-person board. Not a permission failure: both parties hold `picking.canView`. |
| 2 | `app/api/picking/combined/route.ts:63` | `if (primaryRole === "picker") pickerId = own session id` else the `pickerId` query param (admin/operations preview only) | This is the **scope boundary for a picker's own data**. The comment at `:64-65` is explicit: "a picker cannot ask for anybody else's combined list even by editing the URL." If the title stops identifying a picker, this falls to the `else` arm, which requires `canUseTestHook` — so a real picker's board would 403 rather than leak. Fails closed, but the face is gone. |
| 3 | `app/api/picking/findings/report/route.ts:170` | `if (primaryRole === "picker")` — narrows the finding to his own assignment | Same shape as #2. A mis-identified picker takes the wider arm. |
| 4 | `app/mrn/page.tsx:69` | `showSupervisorFace = primaryRole === "floor_supervisor"` → `components/mrn/mrn-shell.tsx:133` returns the phone face or billing's desktop rail | The comment at `app/mrn/page.tsx:63-67` states the rule: "The role branch — NEVER a viewport branch." A floor supervisor on a phone would get billing's desktop rail. |
| 5 | `app/(ops)/layout.tsx:38` | `if (roles.includes("admin"))` → `AdminLayoutClient` (admin sidebar), else → `RoleLayoutClient` (`RoleSidebar`) | Two **entirely different chrome trees** for the same four attendance pages. An admin losing the branch gets the role sidebar at `/admin/attendance`, inconsistent with every other `/admin/*` route. |

### 3b. The twelve `as RoleSidebarRole` casts

`role={primaryRole as RoleSidebarRole}` at: `app/(floor)/floor/layout.tsx:49` ·
`app/(import)/import/layout.tsx:44` · `app/(mail-orders)/mail-orders/layout.tsx:69` ·
`app/(operations)/operations/layout.tsx:46` · `app/(ops)/layout.tsx:71` ·
`app/(place-order)/layout.tsx:57` · `app/(tint)/tint/manager/layout.tsx:49` ·
`app/(tint)/tint/operator/layout.tsx:53` · `app/(tint)/tint/sampling-library/layout.tsx:49` ·
`app/mrn/page.tsx:108` · `app/picking/page.tsx:144` · `app/trips/page.tsx:46`.

The value is consumed at `components/shared/role-sidebar.tsx:103` (`ROLE_LABELS[role]`, the sidebar
section heading) and `components/shared/mobile-shell-context.tsx:185` (`formatRoleLabel(role)`, the
You sheet). **These are label lookups only** — no behaviour hangs off them. Under the new model the
label is exactly what `role_master` survives to provide, so they are the least disturbed sites.

🔴 **`RoleSidebarRole` is already wrong and should be read as a live defect, not a dependency.**
The union (`role-sidebar.tsx:17-28`) holds **11 names**. Cross-checked against the live 13-row
`role_master`:

- **6 live roles are missing** from it: `admin`, `dispatcher`, `floor_supervisor`, `picker`,
  `logistics`, `floor_access`. Every one of the 12 sites above is a **cast**, not a check, so
  TypeScript never catches it; `ROLE_LABELS[role]` returns `undefined` at runtime and the sidebar
  heading renders empty. `app/mrn/page.tsx:105-107` already carries a comment acknowledging this for
  `floor_supervisor` and `picker`.
- **4 names in the union are not roles at all**: `import`, `support_import`, `planning`, `warehouse`
  — the last two named after boards retired in July 2026 (CORE §12).

### 3c. Checked and found NOT to be FACE

- `components/shared/role-sidebar.tsx:95` `DESKTOP_HIDDEN_PAGE_KEYS = new Set(["picking"])` — hides a
  nav item by **page key**, not by role. Unaffected.
- `components/shared/mobile-shell.tsx:61` `homeHref = navItems[0]?.href` — the phone Home button
  derives from the **menu order**, not the role. It becomes a per-user question the moment the menu
  does (§4).
- `components/mrn/mrn-shell.tsx:120` — a comment referencing `primaryRole === "floor_supervisor"`,
  not a site.
- `lib/billing/flag.ts` — the Billing v2 pilot gate is **already per-user**
  (`users.billingV2TestUser` + a global stage), reading no role at all. It is the one module that
  already works the way the target model does.

---

## 4. Landing + menu, end to end

### 4a. Landing page — three hops, one map

1. **Login.** `lib/auth.ts:204-208` normalises `role_master.name` to a slug
   (`"Tint Operator"` → `tint_operator`) and builds `roles` from `user_roles`, falling back to
   `[primaryRole]` when that table is empty (`:208`).
2. **Token → session.** `auth.config.ts:53-60` puts `role` + `roles` on the JWT; `:61-77` copies them
   onto `session.user`. Both are **cached in the token** — a role change does not reach a live
   session until re-login (unlike `billingV2TestUser`, read fresh per page load).
3. **Redirect.** `app/page.tsx:11` and `app/login/page.tsx:11`, both
   `redirect(ROLE_REDIRECTS[session.user.role] ?? "/unauthorized")`.
   `app/unauthorized/page.tsx:10` uses the same map for its "Go to my dashboard" link.
   The map is `lib/rbac.ts:23-45`, **13 entries**, keyed on the primary role slug.

**New source needed:** a per-user landing column. `ROLE_REDIRECTS` becomes the starter value copied at
user creation. Note `app/unauthorized/page.tsx:22` also **displays** the role
(`role.replace("_"," ")`) — a label use, which survives.

### 4b. Menu — one builder, three consumers

```
session.user.roles
   → getAllPermissionsForRoles(roles)        lib/permissions.ts:309   (OR-merge across roles)
   → buildNavItems(allPerms, primaryRole, {attendanceTestUser, rolloutStage})   :119
        ├── filter:  allPerms[pageKey]?.canView === true                        :142
        ├── special: pageKey "attendance" → admin true / ops_admin false / else user flags  :130-141
        └── rewrite: ROLE_HREF_OVERRIDES[roleSlug][pageKey]                     :124, :144-147
   → navItems[]  ──┬── RoleSidebar          desktop rail, minus DESKTOP_HIDDEN_PAGE_KEYS
                   ├── MobileShellProvider  the phone Menu sheet
                   └── MobileShell:61       homeHref = navItems[0].href  ← the phone Home button
```

**Every dependency that needs a new source:**

| # | Dependency | Today | Needs |
|---|---|---|---|
| 1 | `getAllPermissionsForRole(s)` — 14 sites | queries `role_permissions` by `roleSlug` | the per-user tick table, keyed on userId |
| 2 | `buildNavItems` — 12 sites | filters on `allPerms[pageKey].canView` | unchanged shape if #1 returns the same map per user |
| 3 | `ROLE_HREF_OVERRIDES` (`lib/permissions.ts:93-117`) | 12 rewrites keyed on `roleSlug` — the same page key resolves to 3 different URLs | **AMBIGUOUS** — a tick says whether you may see Customers, not *which* Customers screen you get |
| 4 | The attendance nav special case (`:130-141`) | admin/ops_admin hardcoded + per-user flags | already half per-user (`attendanceTestUser`); the two role branches need a home |
| 5 | `MobileShell:61` `navItems[0].href` | **the phone Home button is a side effect of array order** | `PAGE_NAV_MAP`'s comment at `lib/permissions.ts:60-76` documents this as behaviour, not cosmetics, and warns it must be re-derived against live grants — under per-user ticks it must be re-derived per user |
| 6 | `RoleSidebar` / `mobile-shell-context` role label | `ROLE_LABELS[role]` / `formatRoleLabel(role)` | survives as the label — but see the §3b defect |
| 7 | `components/admin/admin-sidebar.tsx:164,166` | a **separate** nav tree (`NAV_SECTIONS`); `userRole === "admin"` OR `allPerms[pageKey]?.canView` | same tick source as #1; note 22 of its ~31 items have **no** `pageKey` and are admin-only by construction |
| 8 | The `dedupedNavItems` filter | repeated verbatim in 7 files (`app/picking/page.tsx:56-61` and siblings) — dedupes because `ti_report` maps twice | unchanged, but 7 copies move together |

---

## 5. Things a per-user tick cannot express

### 5a. Role-scoped queries — "who is a picker / operator?"

| Site | Query | Would key on |
|---|---|---|
| `lib/picking/picker-roster.ts:21` | `users.findMany({ where: { role: { name: "picker" }, isActive: true } })` | a per-user "is a picker" attribute, or the surviving job-title label |
| `app/api/warehouse/pickers/route.ts:56` | `role: { name: "picker" }` + today's `pick_assignments` for load stats | same |
| `app/reports/page.tsx:60` | `users.findMany({ where: { isActive: true, userRoles: { some: { role: { name: "tint_operator" } } } } })` — the **operator filter dropdown** on the Reports hub | same; note it reads `user_roles`, which the change retires (§7) |

These three are the concrete answer to "role as a grouping key". They do not ask *may this person*,
they ask *which people are these* — and a tick table keyed on (user, page, action) has no column that
answers it. This is the same class as the FACE exception, and the picker roster is its clearest case:
`picker-roster.ts`'s own header (`:13-17`) already distinguishes it from the permission-gated route.

### 5b. Role in a notification recipient list

`lib/push/recipients.ts` — the file the prompt calls out.

```ts
export const PICKING_SUPERVISOR_ROLE_SLUGS: string[] = ["floor_supervisor", "operations", "admin"];  // :7

export async function getPickingSupervisorUserIds(): Promise<number[]> {          // :21
  const users = await prisma.users.findMany({
    where: { isActive: true, OR: [
      { role:      { name:  { in: PICKING_SUPERVISOR_ROLE_SLUGS } } },            // :26  primary role
      { userRoles: { some: { role: { name: { in: PICKING_SUPERVISOR_ROLE_SLUGS } } } } },  // :27 secondary
    ]},
    select: { id: true },
  });
  return users.map(u => u.id);
}
```

Called by the assign and done push triggers. **It already returns user ids** — the role names are
only the selector. Two things follow: it reads `user_roles` (retiring, §7), and its own header
(`:12-18`) notes it deliberately covers secondary roles where `getActivePickers()` does not.
**Would key on:** the tick that means "may act on Picking" — the closest live equivalent is
`picking.canEdit`, whose holders today are exactly `floor_supervisor`, `operations` and `admin`
(08-30 report §6). That is an exact match, but it is a coincidence of the current grid, not a rule.

### 5c. Role in stored data

**Swept and found: none.** A repo-wide search for a role slug written into a business or log row
returns exactly one hit — `lib/auth.ts:214`, `role: primaryRole`, which goes into the **JWT**, not the
database. Confirmed against the schema: of 85 models, only three carry a role-ish column:

| Model | Column | What it is |
|---|---|---|
| `users` | `roleId` → `role_master` | the primary-role pointer; survives as the label + starter-set key |
| `role_permissions` | `roleSlug` | the table being retired |
| `attendance_settings` | `roleSlug String?` | **a per-role settings scope**, `@@unique([scope, roleSlug])`. Every live read passes `roleSlug: null` (`app/attendance/page.tsx:26`, `history/page.tsx:35`, `consent/page.tsx:23`, `check-out/page.tsx:26`, `check-in/page.tsx:24`, `lib/auth.ts:40`) — the GLOBAL singleton. The per-role arm is **built but unused**. |
| `customer_sales_officers` | `role CustomerSalesOfficerRole` | PRIMARY/SECONDARY on a **sales officer**, unrelated to app roles. Noise in any `role` grep. |

**So no historical row anywhere records the actor's job title.** Nothing to migrate, and nothing that
would go stale — but also nothing that records what someone was doing when they acted.

### 5d. Seed

`prisma/seed.ts` seeds `role_master` (10 rows, `:33-53`) and `role_permissions` (24 rows,
`:56-155`), all by `upsert`, with **no `deleteMany`**. Live holds 13 roles and 115 permission rows.
The drift is itemised in `code-discovery-2026-08-28-admin-panel.md §5f`; the `role_permissions` half
becomes moot on retirement, the `role_master` half becomes the **starter-set catalogue**.

### 5e. Cron

**Two cron routes, neither reads a role.** `app/api/cron/attendance-rollover` and
`app/api/cron/attendance-purge`, both bearer-authenticated via `lib/cron-auth.ts`. Nothing to change.

---

## 6. "Who did what" — the logging story

### 6a. Every audit/log table

| Table | Actor column | FK | Notes |
|---|---|---|---|
| `order_status_logs` | `changedById` | `users` **NOT NULL** | the main order trail; `fromStage`/`toStage`/`note` |
| `split_status_logs` | `changedById` | `users` NOT NULL | split stage trail |
| `tint_logs` | `performedById` | `users` NOT NULL | tint actions |
| `tint_skip_events` | `skippedById` | `users` NOT NULL | operator skips |
| `tint_pause_events` | `operatorId` + `resumedById` | `users` | **two** actors — pauser and resumer |
| `attendance_ot_audit` | `userId` (subject) + `performedById` (actor) | both `users` | the only table that separates subject from actor by design |
| `sampling_usage_log` | `operatorId` **nullable** + `operatorNameRaw String?` | `users?` | id is optional; a raw name string can stand in |
| `import_shadow_log` | **none** | — | machine-vs-machine parser comparison; no person involved |
| `pick_findings` | `reportedById` + `recordedById` | `users` | two actors |
| `mo_line_status` | `updatedBy` **nullable** | `users?` | mail-order line resolution |

`import_shadow_log` is the only one with no actor, and correctly so.

### 6b. Per-route actor recording

Of **134** mutating route files: **5** perform no write at all, **58** record an actor on the row or
in a log row, **70** write with **no actor recorded anywhere**, and **1** is a machine path.

Two signals were used and reconciled: (A) an actor column inside the write's argument; (B) an actor
token anywhere in the mutating handler body. Where they disagreed (5 files) each was opened by hand,
and three further classes of false result were found and corrected — shorthand properties
(`changedById,` not `changedById:`), `data` objects built into a variable before the call
(`attendance/settings:361`), and writes issued through `tx.` inside `$transaction` rather than
`prisma.` (the four Tint Manager split routes).

**YES — records an actor (58).** Named column in brackets.

`admin/attendance/ot-pending/[recordId]` PATCH `[otApprovedById, performedById]` ·
`admin/attendance/settings` PATCH `[updatedById]` · `admin/hide/orders/[id]/hide` POST `[changedById]` ·
`admin/hide/orders/[id]/unhide` POST `[changedById]` · `admin/hide/rules` POST `[createdById]` ·
`admin/hide/rules/[id]` **PATCH** `[updatedById]` · `admin/removed-orders/[id]/restore` POST
`[restoredById, changedById]` · `admin/tag-settings` PATCH `[updatedById]` ·
`attendance/check-in` POST `[userId, createdById]` · `attendance/check-out` POST
`[userId, createdById, performedById]` · `attendance/consent` POST `[userId]` ·
`billing/picking/mark-done` POST `[invoicedById]` · `billing/picking/undo` POST `[invoicedById]` ·
`floor/actions` POST `[changedById]` · `floor/release` POST `[changedById]` · `floor/ship-to` POST
`[changedById]` · `import/obd` POST `[userId` on `import_batches`] · `mail-orders/[id]/punch` PATCH
`[punchedById]` · `mail-orders/[id]/so-number` PATCH `[punchedById]` · `mail-orders/learn-customer`
POST `[operatorId]` · `mail-orders/lines/[lineId]/status` PATCH `[updatedBy]` ·
`mrn/create` POST `[createdById]` · `mrn/[mrnId]/start` POST `[unloadingStartById]` ·
`mrn/[mrnId]/end` POST `[unloadingEndById]` · `mrn/[mrnId]/line/[lineId]` PUT `[checkedById]` ·
`mrn/[mrnId]/delete` POST `[removedById]` · `picking/approve` POST `[checkedById, changedById]` ·
`picking/assign` POST `[pickerId, assignedById, changedById]` · `picking/cancel` POST `[changedById]` ·
`picking/done` POST `[changedById, pickerId]` · `picking/findings/confirm` POST `[recordedById]` ·
`picking/findings/report` POST `[reportedById, recordedById]` · `picking/release` POST
`[pickEarlyReleasedById, changedById]` · `picking/unassign` POST `[changedById]` ·
`push/subscribe` POST `[userId]` · `push/unsubscribe` POST `[userId]` · `sampling-library` POST
`[createdById]` · `tint/manager/assign` POST `[assignedById, performedById, changedById]` ·
`tint/manager/cancel-assignment` POST `[performedById, changedById]` (via `tx.`) ·
`tint/manager/manual-entry` POST `[changedById, performedById]` ·
`tint/manager/manual-entry/revert` POST `[changedById, performedById]` ·
`tint/manager/orders/[id]/remove` POST `[removedById, changedById]` ·
`tint/manager/orders/[id]/status` PATCH `[changedById]` ·
`tint/manager/splits/[id]/status` PATCH `[changedById]` ·
`tint/manager/splits/create` POST `[assignedById, changedById, performedById]` (via `tx.`) ·
`tint/manager/splits/cancel` POST `[changedById, performedById]` (via `tx.`) ·
`tint/manager/splits/reassign` POST `[changedById, performedById]` (via `tx.`) ·
`tint/operator/start` POST `[performedById, changedById]` · `tint/operator/done` POST
`[performedById, changedById]` · `tint/operator/split/start` POST `[performedById, changedById]` ·
`tint/operator/split/done` POST `[changedById]` · `tint/operator/pause` POST
`[operatorId, changedById]` · `tint/operator/resume` POST `[resumedById, changedById]` ·
`tint/operator/skip` POST `[skippedById, changedById]` · `tint/operator/shades` POST `[createdById]` ·
`tint/operator/tinter-issue` POST `[submittedById]` · `tint/operator/tinter-issue-b` POST
`[submittedById]` · `user/notes-font-size` POST `[userId]`.

**N-A (5 + 1).** `mrn/resolve-skus` POST, `sampling-library/formula-match` POST,
`picking/push-test` POST, `push/test-saved` POST — read-only or notification-only POSTs, nothing
written. `admin/skus/[id]/sub-skus` POST — returns 410, inert.
`mail-orders/backfill-enrich` POST — HMAC machine path, no person to record.

### 6c. 🔴 THE GAP LIST — write paths with no recorded actor (70)

**A. Admin master data — 48 files.** Not one master-data write in the app records who made it.

`admin/areas` POST · `admin/areas/[id]` PATCH · `admin/areas/import` POST ·
`admin/base-colours` POST · `admin/base-colours/[id]` PATCH · `admin/base-colours/import` POST ·
`admin/contact-roles` POST · `admin/contact-roles/[id]` PATCH · `admin/customer-types` POST ·
`admin/customers` POST · `admin/customers/[id]` PATCH · `admin/customers/import` POST ·
`admin/dispatch-cutoffs/[id]` PATCH · `admin/permissions` POST · `admin/premises-types` POST ·
`admin/product-categories` POST · `admin/product-categories/[id]` PATCH ·
`admin/product-categories/import` POST · `admin/product-names` POST · `admin/product-names/[id]`
PATCH · `admin/product-names/import` POST · `admin/routes` POST · `admin/routes/[id]` PATCH ·
`admin/routes/import` POST · `admin/sales-officers` POST · `admin/sales-officers/[id]` PATCH ·
`admin/sales-officers/import` POST · `admin/shades/[id]` PATCH · `admin/skus` POST ·
`admin/skus/[id]` PATCH · `admin/skus/import` POST · `admin/slot-rules` POST ·
`admin/slot-rules/[id]` PATCH · `admin/slots` POST · `admin/slots/[id]` PATCH ·
`admin/so-groups` POST · `admin/so-groups/[id]` PATCH · `admin/sub-areas` POST ·
`admin/sub-areas/[id]` PATCH · `admin/sub-areas/import` POST · `admin/system-config` PATCH ·
`admin/transporters` POST · `admin/transporters/[id]` PATCH · `admin/transporters/import` POST ·
`admin/users` POST · `admin/users/[id]` PATCH · `admin/vehicles` POST · `admin/vehicles/[id]` PATCH ·
`admin/vehicles/import` POST.

Three deserve naming individually:
- 🔴 **`admin/permissions` POST** — the route that **writes the permission grid itself** records
  nobody. Whoever changed who-can-do-what is unrecoverable.
- 🔴 **`admin/users` POST / `admin/users/[id]` PATCH** — user creation and role changes, including
  password resets, record no actor. `users` has `createdAt`/`updatedAt` but no `createdById`.
- 🔴 **`admin/hide/rules/[id]` DELETE** — the PATCH arm records `updatedById`; the DELETE arm is a
  **hard delete**, so the row and its actor both vanish. The one split-verdict route in the sweep.

**B. Mail Orders — 8 files.** The same set the 08-30 report found gating on session only, so they are
doubly unattributed: anyone logged in may call them, and nothing records who did.

`mail-orders/[id]/customer` PATCH · `mail-orders/[id]/lock` PATCH · `mail-orders/[id]/note` PATCH ·
`mail-orders/[id]/split` POST · `mail-orders/lines/[lineId]/resolve` POST ·
`mail-orders/re-enrich` POST · `mail-orders/backfill-customers` POST · `mail-orders/ingest` POST
(HMAC machine path — arguably N-A, listed for completeness).

**C. Sampling Library — 3 files.** Creation records `createdById`; **every subsequent edit does not.**

`sampling-library/[samplingNo]` PATCH · `sampling-library/[samplingNo]/review` POST ·
`sampling-library/[samplingNo]/variants` POST (updateMany + create + update on `sampling_recipes`).

**D. MRN — 2 files.** Create/start/end/delete/line-check all record an actor; these two do not.

`mrn/[mrnId]/header` PATCH · `mrn/[mrnId]/lines` PUT (deleteMany + createMany on `mrn_lines`).

**E. Tint — 5 files.**

`tint/manager/reorder` PATCH (the `assignedToId` in this file is **read and copied**, not the actor) ·
`tint/manager/challans/[orderId]` PATCH (challan save + formula upsert) ·
`tint/operator/shades/[id]` PUT · `tint/operator/tinter-issue/[id]` PATCH ·
`tint/operator/tinter-issue-b/[id]` PATCH — for the last two, `userId` **is** in scope but is used
only for an ownership comparison (`entry.submittedById !== userId`, `:98`), never written. Creation
records `submittedById`; **resolution records nobody.**

**F. Billing — 1 file.** `billing/mail-order/actions` POST (`mo_orders.update` +
`orders.updateMany`). Its siblings `mark-done` and `undo` both record `invoicedById`.

**G. Backfill — 2 files.** `admin/fix-challans` POST, `admin/fix-slots` POST.

**Of the 70, only 9 already have `session.user.id` in scope** — the other 61 would need the id
threaded in as well as a column to put it in.

**Why this matters more under the change, stated as fact not opinion:** today an unattributed
master-data write is narrowed by the role gate — `admin/permissions` POST can only have been the one
active admin. Once one person can hold several jobs, the set of people who could have made any given
unattributed write is the set of people holding that tick, and the role gate no longer narrows it.

---

## 7. Secondary roles — what `user_roles` is delivering

Read-only SELECT, 2026-08-31. **29 rows across 20 users** — not 21 as
`code-discovery-2026-08-28-admin-panel.md §5a` states. `role_master` holds **13** rows, not 12.
Both figures re-verified; the 08-28 draft should be corrected.

**9 of the 29 rows are genuine secondary grants** (`isPrimary = false`). The other 20 are
self-referential rows duplicating `users.roleId`.

### 7a. The 9 secondary grants — what each delivers

| User | Primary | Secondary role | Pages that grant delivers |
|---|---|---|---|
| u20 Operations User | `operations` | `logistics` | `trip_report` (V) |
| u21 Chandresh Kolgha | `tint_manager` | `tint_operator` | `tint_operator` (V,E) — `sampling_library` he already holds |
| u29 Ajay Vansiya | `dispatcher` | `logistics` | `trip_report` (V) |
| u29 Ajay Vansiya | `dispatcher` | **`floor_access`** | **`floor` (V,E)** |
| u30 Dhanraj Shah | `dispatcher` | `logistics` | `trip_report` (V) |
| u30 Dhanraj Shah | `dispatcher` | **`floor_access`** | **`floor` (V,E)** |
| u31 Priya Chaudhari | `support` | `logistics` | `trip_report` (V) |
| u31 Priya Chaudhari | `support` | **`floor_access`** | **`floor` (V,E)** |
| u32 Prakash | `operation_manager` | **`floor_access`** | **`floor` (V,E)** |

**Nothing else is delivered by a secondary row.** Every other page each of these users reaches comes
from their primary role's grants.

### 7b. The 20 self-referential rows

u1 Harsh (`admin`) · u2 Test Support · u3 Test Dispatcher · u6 Test Floor Supervisor · u8 Ramesh K. ·
u9 Sunil P. · u20 · u21 · u22 Deepak Vasava · u23 Chandrasing Valvi · u25 Deepanshu Thakur ·
u26 Bankim · u29 · u30 · u31 · u32 · u33 Praveen · u34 Test Supervisor 1 · u35 Test Picker 1 ·
u36 Test Picker 2 — each holds a row for their own primary role with `isPrimary = true`. These carry
no information `users.roleId` does not already hold. **6 of the 20 belong to inactive users**
(u2, u3, u6, u8, u9, u36).

### 7c. 🔴 `floor_access` — flagged as asked

`role_master` id **17**, description: *"Floor Control only - secondary role - added 2026-08-06 for
Ajay/Priya/Prakash/Dhanraj"*. It holds exactly **one** `role_permissions` row — `floor` V+E — and
exists for no other purpose.

It is a **role invented to work around the absence of per-user access**: four named people needed
Floor Control and there was no way to grant it to a person, so a role was created to carry it. Under
per-user ticks it has no reason to exist — it becomes four `floor` V+E ticks on u29, u30, u31, u32.

It is also **undocumented in every code-side inventory**: absent from `CLAUDE_CORE.md §5`,
`lib/rbac.ts` `ROLES`, `ROLE_REDIRECTS`, `prisma/seed.ts`, `permissions-manager.tsx` `ROLES_CONFIG`,
and `RoleSidebarRole`. Only the live DB knows about it.

### 7d. Two consumers read `user_roles` and must be re-pointed

1. `lib/auth.ts:191-208` — the login `include`, the only reason the table has any effect.
2. `lib/push/recipients.ts:27` — the secondary-role arm of the push recipient query (§5b).
3. `app/reports/page.tsx:60` — the tint-operator dropdown filter (§5a).

There is **no admin screen and no API route** for `user_roles` (08-28 draft §5a); all 29 rows were
written by hand in the database.

---

## 8. Size, in facts

| Measure | Count |
|---|---|
| Role-reading sites total | **422** |
| — PERMISSION (become a per-user tick) | **374** |
| — FACE (keep the job title) | **17** |
| — ROUTING (starter value; menu from ticks) | **31** |
| Files containing at least one site | **208** |
| Sites in files that **already have `session.user.id`** in scope | **118** (28%) |
| Sites in files with a session but **not** the id | **291** (69%) |
| Sites in files with neither (client components using `useSession`) | **13** (3%) |
| Files that already have `session.user.id` | **56** |
| Files with a session but not the id | **152** |

**Note on "must change to take a userId".** All 374 PERMISSION sites change source. Not all need the
id *threaded in*: 117 `requireRole` and 16 `hasRole` sites already receive the whole `session`, so
the id is one property access away. The 291-site figure above measures files where the id is not
currently *referenced*, not files where it is unreachable.

### 8a. Self-contained vs cutting across

**Self-contained** — one module owns every site, and the module has one page key:

| Module | Files | Sites | Page key |
|---|---:|---:|---|
| `app/api/mrn` + `app/mrn` | 14 | 31 | `mrn` |
| `app/api/picking` + `app/picking` | 15 | 35 | `picking` |
| `app/api/floor` + `app/(floor)` | 10 | 13 | `floor` |
| `app/api/sampling-library` + `app/(tint)/…/sampling-library` | 9 | 13 | `sampling_library` |
| `app/api/reports` + `app/reports` | 3 | 10 | `ti_report` (+ `tint_manager`) |
| `app/trips` | 1 | 4 | `trip_report` |

**Cutting across** — a change here lands in more than one module:

| Concern | Files | Why it cuts |
|---|---:|---|
| `app/api/admin` | **69 files / 128 sites** | biggest single block; `customers`/`skus`/`routes_areas`/`vehicles` page keys are **shared** with `/dispatcher/*` and `/tint/manager/*`, which render the same tables from the same `getPagePermissions` call |
| `app/api/tint` + `app/(tint)` + `components/tint` | **53 files / 108 sites** | `tint_manager` and `tint_operator` page keys, plus the 5 `canImportOBDs` client arrays, plus `import_obd` |
| Master data trio (`(admin)` / `(dispatcher)` / `(tint)/manager`) | 15 files / 49 sites | **three route groups, one page key each** — `customers` is checked in all three |
| The 11 layouts | 11 files / ~44 sites | identical four-step shape; a change to `buildNavItems`' source touches every one |
| `lib/permissions.ts` + `lib/rbac.ts` | 2 files | the definitions all 422 sites resolve to |

### 8b. The five biggest single files

| Sites | File | Breakdown | `session.user.id` in scope |
|---:|---|---|---|
| **9** | `app/picking/page.tsx` | `roles.includes` ×5, `checkAnyPermission`, `getAllPermissionsForRoles`, `buildNavItems`, `primaryRole ===` | **yes** |
| **8** | `app/api/admin/areas/route.ts` | `requireRole` ×2, `checkPermission` ×2, inline-role ×4 | no |
| **8** | `app/api/admin/routes/route.ts` | identical shape | no |
| **8** | `app/api/admin/sub-areas/route.ts` | identical shape | no |
| **6** | `app/api/admin/customers/route.ts` · `customers/[id]/route.ts` · `skus/route.ts` · `vehicles/route.ts` (four-way tie) | `requireRole` ×2, `checkPermission` ×2, inline-role ×2 | no |

The three 8-site files are the same file three times: a GET gated on `<key>`/`canView` and a POST on
`<key>`/`canEdit`, each preceded by a six-role `requireRole` and an `!== "admin"` bypass, plus a
three-clause inline role check at the top for the shared `routes_areas` key.

---

## 9. Could not settle — plain questions

1. **`ROLE_HREF_OVERRIDES` (`lib/permissions.ts:93-117`) — which screen does a tick point at?**
   One page key resolves to three different URLs depending on job title: `customers` →
   `/admin/customers` (the richer split view), `/tint/manager/customers`, or `/dispatcher/customers`.
   A tick says whether you may see Customers. It does not say which of the three you get. Is the href
   part of the starter set (copied per user), part of the FACE exception, or does the change collapse
   the three screens into one?

2. **`lib/permissions.ts:130-141` — where does the Attendance nav special case live?**
   Today: `admin` → always shown; `ops_admin` → always suppressed (they reach it via
   `attendance_admin` instead); everyone else → per-user flags. The last arm is already per-user; the
   first two are role literals. Do they become two ticks, or does the suppression rule survive as
   something else?

3. **`lib/auth.ts:65-72` `gateAppliesTo` — `if (role === "admin") return flags.attendanceTestUser`.**
   This decides whether the attendance check-in gate applies at all. It is neither an allow/deny on a
   page nor a screen version. Which pile?

4. **What is `attendance_settings.roleSlug` for?** The column and its `@@unique([scope, roleSlug])`
   exist; every live read passes `roleSlug: null`. Was per-role attendance policy intended and never
   built, or is it dead? If it was intended, the change removes the key it was designed around.

5. **`PICKING_SUPERVISOR_ROLE_SLUGS` — is `picking.canEdit` the intended rule?** Its three slugs
   (`floor_supervisor`, `operations`, `admin`) are today an exact match for the `picking.canEdit`
   holder set. Whether that is the rule or a coincidence of the current grid is not recoverable from
   the code.

6. **The three `tint` `canView`-gated writes carry no comment** (`operator/pause`, `operator/resume`,
   `manager/orders/[id]/remove` — 08-30 report §3b rows 3-5). They are harmless today because the
   canView and canEdit holder sets are identical for those page keys. Under per-user ticks those sets
   diverge by construction. Deliberate or copy-paste is still unrecoverable.

7. **`RoleSidebarRole` (§3b) — is the missing-label defect known?** Six live roles are absent from the
   union and every call site is a cast, so `admin`, `dispatcher`, `floor_supervisor`, `picker`,
   `logistics` and `floor_access` render an empty sidebar heading today. Not caused by this change,
   but it sits on the exact sites the change touches. Flagged, not fixed.

8. **`code-discovery-2026-08-28-admin-panel.md §5a` says "29 rows across 21 users" and "12 roles".**
   Live on 2026-08-31: 29 rows, **20** users, **13** roles. Either the data moved between 08-28 and
   today, or the earlier counts were off. Not settled — only re-measured.

---

*Discovery only. No application code was written, edited, archived or moved. One read-only query
script was added at `scripts/_chk-role-census-20260831.ts` (underscore-prefixed, outside the `tsc`
gate per `tsconfig.json`'s `exclude`). Parsers used for the sweeps live in the session scratchpad and
are not part of the repo.*
