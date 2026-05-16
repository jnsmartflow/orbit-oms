# Context Update v1 — ops_admin pilot role + JSW Dulux logo on delivery challan
Session date: 2026-05-10
Target files: CLAUDE_CORE.md §5, §7, §10, §11; CLAUDE_TINT.md §4.4; CLAUDE_UI.md §46

## SCHEMA CHANGES

No DDL. Schema version unchanged at **v27.1**. Data-only INSERTs / DELETEs via Supabase SQL Editor:

```sql
-- Prompt 2 (committed in 92c5f84e's predecessor ca5a07ef)
INSERT INTO role_master (name, description)
VALUES ('ops_admin', 'Operations Admin (attendance supervision)')
RETURNING id;  -- id=14

INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete", "updatedAt")
VALUES ('ops_admin', 'attendance', true, false, true, false, false, NOW());  -- id=1317 (later DELETED)

INSERT INTO users (email, password, name, "roleId", "isActive", "attendanceTestUser", "attendanceExempt", "createdAt", "updatedAt")
VALUES
  ('dhruv@orbitoms.com',   '<bcrypt $2a$10$… of OpsAdmin@2026>', 'Dhruv',   14, true, true, false, NOW(), NOW()),  -- id=27
  ('kuldeep@orbitoms.com', '<bcrypt $2a$10$… of OpsAdmin@2026>', 'Kuldeep', 14, true, true, false, NOW(), NOW()); -- id=28

-- Prompt 3 (committed in 92c5f84e)
INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete", "updatedAt")
VALUES ('ops_admin', 'attendance_admin', true, false, true, false, false, NOW());  -- id=1319

DELETE FROM role_permissions WHERE id = 1317;  -- the wrong (ops_admin, attendance) row
```

Final ops_admin DB state: one role row (id=14), one permission row id=1319 `(ops_admin, attendance_admin, canView=true, canExport=true)`, two user rows (Dhruv id=27, Kuldeep id=28, both `attendanceTestUser=true`, `isActive=true`).

## NEW/MODIFIED FILES

| File | Purpose |
|---|---|
| `lib/rbac.ts` | Added `OPS_ADMIN: "ops_admin"` to `ROLES` const. Added new `ROLE_REDIRECTS` exported map (10 roles, single source of truth — replaces 4 previously-drifting maps across `app/page.tsx`, `app/login/page.tsx`, `app/unauthorized/page.tsx`). |
| `lib/permissions.ts` | Added `attendance_admin` to `PageKey` union, `ALL_PAGE_KEYS` array, and `PAGE_NAV_MAP` (href `/admin/attendance`). Added `"attendance"` to `ALL_PAGE_KEYS` (pre-existing minor bug — was in type but not array). Added ops_admin suppression in `buildNavItems` attendance branch so ops_admin sidebar shows ONE Attendance nav item, not two. |
| `components/shared/role-sidebar.tsx` | Added `"ops_admin"` to `RoleSidebarRole` union and `ROLE_LABELS` map (label "Operations Admin"). |
| `prisma/seed.ts` | Refreshed role_master block to include all 10 production roles (was 7), with descriptions, idempotent upsert that refreshes `description` on existing rows. |
| `app/page.tsx` | Replaced local `ROLE_REDIRECTS` const with import from `@/lib/rbac`. |
| `app/login/page.tsx` | Replaced local `ROLE_REDIRECTS` const with import from `@/lib/rbac`. |
| `app/unauthorized/page.tsx` | Replaced local `ROLE_HOME` const with import of `ROLE_REDIRECTS` from `@/lib/rbac`. |
| `app/(ops)/layout.tsx` | NEW route-group layout. Allows admin + ops_admin. Branches: admin → `AdminLayoutClient` (preserves admin UX); ops_admin → `RoleLayoutClient` with permissions-driven nav. |
| `app/(ops)/admin/attendance/page.tsx` | Moved here from `app/(admin)/admin/attendance/page.tsx` via `git mv` (history preserved). URL `/admin/attendance` unchanged because route groups are URL-invisible. |
| `components/tint/challan-document.tsx` | Replaced AkzoNobel logo `<img>` with JSW Dulux. Logo height 34px, container `paddingRight: 24`, no inline grayscale filter. Right column `minWidth: 165` to centre the title. Footer footer entity string `"JSW Dulux Limited (formerly Akzo Nobel India Limited)"` appended beside `systemConfig.website`. |
| `app/globals.css` | `@media print` rule for `#challan-print-area .ch-header img` now applies `filter: grayscale(100%) brightness(0)` (B&W on print) and `height: 34px`. |
| `public/jsw-dulux-logo.png` | NEW transparent PNG, 800×193, ~101 KB. Old `public/akzonobel-logo.png` retained, not deleted. |

## BUSINESS RULES ADDED

- **`ops_admin` role exists** (id=14). Pilot members: Dhruv (id=27) and Kuldeep (id=28). Both have `attendanceTestUser=true`. Login redirects to `/admin/attendance`. Initial password `OpsAdmin@2026` (rotate after first login).
- **Single source of truth for role → landing route** is `ROLE_REDIRECTS` in `lib/rbac.ts`. Any new role must add a row here. Importers: `app/page.tsx` (post-login `/`), `app/login/page.tsx` (already-authenticated guard), `app/unauthorized/page.tsx` ("Go to my dashboard" link).
- **Two attendance pageKeys exist**, with intentionally different hrefs:
  - `attendance` → `/attendance` — user-facing check-in flow (camera + GPS).
  - `attendance_admin` → `/admin/attendance` — supervisor dashboard for admin + ops_admin.
- **`buildNavItems` rule for `roleSlug === "ops_admin"`**: the `attendance` pageKey returns false (suppressed), so the sidebar shows the supervisor link only and not a duplicate user-facing one. ops_admin still reaches `/attendance` via the gate redirect (when applicable) or direct URL.
- **Route-group convention `(ops)` introduced.** Sibling to `(admin)`. Use it for any future route that admin-or-other-role share at `/admin/*` URLs without exposing the rest of the (admin) tree to the other role. Layout dispatches by role: admin keeps `AdminLayoutClient`, others get `RoleLayoutClient` with permissions-driven nav.
- **`prisma/seed.ts` is now authoritative for the full 10-role production set.** Re-running the seed refreshes `role_master.description` on existing rows (idempotent upsert with explicit `update` payload, not the previous empty `update: {}`).
- **Delivery challan branding is JSW Dulux** (formerly Akzo Nobel India Limited). Logo renders in full colour on web (`/admin/tint/manager/challan`), pure black on print/PDF (via `@media print` filter). Logo height 34px. Footer text appends the legal entity string beside the website.

## BUSINESS RULES CHANGED / SUPERSEDED

- **`ROLE_REDIRECTS` maps consolidated.** Previously 3 separate maps in `app/page.tsx`, `app/login/page.tsx`, `app/unauthorized/page.tsx` (named `ROLE_HOME` in the third). Maps disagreed on routes for `dispatcher`/`floor_supervisor`/`picker`, and the `/login` map missed `billing_operator` while `/page.tsx` missed `operations`. Single map in `lib/rbac.ts` reconciles all of them. New canonical landings:
  - `dispatcher` → `/dispatcher` (was `/planning` from `/login`).
  - `floor_supervisor` → `/warehouse/supervisor` (was `/warehouse` from `/login`).
  - `picker` → `/warehouse/picker` (was `/warehouse` from `/login`).
  - `operations` → `/operations/support` (was `/unauthorized` falling through from `/`).
  - `billing_operator` → `/mail-orders` (was `/unauthorized` falling through from `/login`).
  - `ops_admin` → `/admin/attendance` (new).
- **`/admin/attendance` is no longer admin-only.** Was gated by `app/(admin)/admin/layout.tsx requireRole([ADMIN])`. Now lives under `app/(ops)/admin/attendance/page.tsx` with a layout that allows admin + ops_admin. URL unchanged (route groups are URL-invisible). Admin's UX at this URL preserved exactly via the role branch in `(ops)/layout.tsx` that still renders `AdminLayoutClient`.
- **Delivery challan logo source switched** from `/akzonobel-logo.png` to `/jsw-dulux-logo.png`. Old asset retained in `public/` but not referenced.
- **Inline filter on challan logo `<img>` removed.** Used to be `filter: "grayscale(100%) brightness(0)"`. Now no inline filter; print rule in `globals.css @media print` handles B&W. Web view shows full brand colours.

## BUSINESS RULES REMOVED / DEPRECATED

None.

## PENDING ITEMS

**New pendings from this session:**

- ⚠ **MDF discrepancy:** `attendance_settings.rolloutStage` is currently `'TEST_USERS_ONLY'` in production. The MDF (`mdf-attendance-rollout-2026-05-09.md`) said this should be `'OFF'` until Prompt 6 explicitly flipped it. Gate has been silently active for any user with `attendanceTestUser=true` (which appears to include admin) since whenever this was set. Reconcile in next session.
- **`RoleSidebarRole` union still missing `"admin"`.** Latent bug: when admin is rendered through `RoleSidebar` (e.g. layouts in `(tint)`, `(operations)`, etc., or hypothetically `(ops)` if admin somehow took the non-admin branch), `ROLE_LABELS["admin"]` is undefined → label renders "undefined". Benign today because the `(ops)` layout's admin branch uses `AdminLayoutClient`, but the broader fix (add `"admin"` to union + `ROLE_LABELS`) belongs in a hygiene pass.
- **Hardcoded `=== "admin"` literals across 50+ files.** Mostly API routes that read `session.user.role` (single primary role) and bypass when admin. Pattern often mixes literal `"admin"` with `ROLES.OPERATIONS` constant on the same line. Future hygiene: replace literals with `ROLES.ADMIN` or use a `hasRole(session, [ROLES.ADMIN])` helper.
- **Admin's `role_permissions` rows are stale.** Admin has 15 rows but `ALL_PAGE_KEYS` has more. Admin operates correctly via the 6 admin-bypass short-circuits in `lib/permissions.ts` (lines 76, 169, 184, 199, 219, 251). Stale rows are harmless but make permission audits less useful. Optional cleanup.
- **`PageKey` is hand-typed** as a union in `lib/permissions.ts:93-120`. Could be derived from `ALL_PAGE_KEYS` as `typeof ALL_PAGE_KEYS[number] as const` to prevent the array/type drift seen this session (caught at `attendance` and `attendance_admin`).
- **`feat/attendance-feature-complete` branch is accumulating ghost commits** content-equivalent to landed main commits with different SHAs (`8cb2906b` → `ca5a07ef`, `ae57e959` → `92c5f84e`). Tomorrow: rebase onto main, or retire the branch entirely.
- **`requireRole()` in `lib/rbac.ts` is role-string allowlist driven.** Could become permissions-table-aware (`checkAnyPermission` style) for cleaner audits. Not urgent.
- **The `(ops)` layout's `dedupedNavItems` block** is defensive coding that wouldn't be needed if `buildNavItems` always returned unique pageKeys. Other RoleSidebar layouts have the same dedupe block. Worth checking whether `buildNavItems` can guarantee uniqueness, then dropping the dedupe.

**Done pendings (closed this session):**

- ops_admin role + pilot user accounts (Dhruv, Kuldeep) created.
- ROLE_REDIRECTS centralization (was flagged in Prompt 1's diagnosis).
- `attendance` pageKey added to `ALL_PAGE_KEYS` array (was a pre-existing minor bug — type vs array drift).
- JSW Dulux logo replacement on delivery challan.

## CHECKLIST UPDATES

New lines to add to `CLAUDE_CORE.md §14` session-start checklist:

- **When adding a new role**, in this order: (1) insert `role_master` row via Supabase SQL Editor; (2) `ROLES.X` const in `lib/rbac.ts`; (3) `ROLE_REDIRECTS["x"]` entry; (4) `RoleSidebarRole` union + `ROLE_LABELS["x"]`; (5) decide route group (existing or new `(group)`); (6) `role_permissions` rows; (7) refresh `prisma/seed.ts` for fresh-install reproducibility.
- **Don't gate `/admin/*` sub-routes via `app/(admin)/admin/layout.tsx requireRole([ADMIN])`** without considering whether non-admin roles need the sub-route. If yes, move the sub-route to a sibling route group (`(ops)`, etc.) with its own permissive layout.
- **Permission rows over code-level role bypass.** Don't add new role slugs to the 6 admin-bypass short-circuits in `lib/permissions.ts`. Use real `role_permissions` rows for auditability.

## CONSOLIDATION NOTES

- **CLAUDE_CORE.md §5 (Roles and users)** — add `ops_admin` (id=14) row; pilot users Dhruv + Kuldeep; landing `/admin/attendance`. Update the role redirect table to match `lib/rbac.ts ROLE_REDIRECTS` exactly (note: dispatcher → /dispatcher, not /planning; floor_supervisor → /warehouse/supervisor; picker → /warehouse/picker; operations → /operations/support; billing_operator → /mail-orders; ops_admin → /admin/attendance).
- **CLAUDE_CORE.md §3 (Engineering rules)** — add: "Role landing routes live in `lib/rbac.ts ROLE_REDIRECTS`. Don't create a second copy in `app/page.tsx`, `app/login/page.tsx`, `app/unauthorized/page.tsx`, or anywhere else — they will drift. Single source."
- **CLAUDE_CORE.md §7 (Database schema)** — note `ops_admin` (id=14) under `role_master`. Note `attendance_admin` pageKey alongside `attendance`. Schema version stays v27.1 (data-only changes).
- **CLAUDE_CORE.md §10 (Screens index)** — add: "**Attendance dashboard** (`/admin/attendance`). admin + ops_admin. Lives under `app/(ops)/`, NOT `app/(admin)/`. Sidebar dispatches by role: admin → `AdminLayoutClient`, ops_admin → `RoleLayoutClient`."
- **CLAUDE_CORE.md §11 (route group conventions)** — new short paragraph: "`(ops)` route group exists for routes shared between admin and non-admin operations roles. URL-invisible. Layout allows admin + role-list, branches sidebar by role to preserve admin's UX."
- **CLAUDE_TINT.md §4.4 (Delivery Challan document)** — update logo description: "JSW Dulux logo (`/jsw-dulux-logo.png`, 800×193). Web: full colour. Print: B&W via `@media print` filter. Height 34px. Footer text includes 'JSW Dulux Limited (formerly Akzo Nobel India Limited)' beside the website."
- **CLAUDE_UI.md §46 (Delivery Challan document — B&W print)** — update: "Logo height 34px, natural ~140px width. Inline `<img>` carries no filter (full colour on web). `@media print` rule applies `grayscale(100%) brightness(0) !important` for pure black print."
- **? CLAUDE_CORE.md §11 / new section** — document the legacy `RoleSidebarRole` mismatch (union has 4 UI-derived strings + omits 4 actual DB roles). Should this be flagged as a known non-conformance, or fixed? Decide at merge.
- **? CLAUDE_CORE.md §15 (Cross-module pending items)** — add the `attendance_settings.rolloutStage` MDF discrepancy as a pending reconciliation item. Or leave it as session-private until reconciled.

---

*v1 · Session 2026-05-10 · 1 production deploy (`92c5f84e`) + 2 prior commits in same session (`441b82c3` JSW logo + `03afbc5c` polish, both already on main via earlier PRs)*
