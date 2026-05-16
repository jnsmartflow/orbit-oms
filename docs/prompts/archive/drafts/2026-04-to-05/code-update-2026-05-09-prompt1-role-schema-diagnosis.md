# Role Schema Diagnosis — 2026-05-09

**Prompt:** 1 of 6 · Attendance pilot rollout
**Predecessor:** `mdf-attendance-rollout-2026-05-09.md` (§5 prompt sequence)
**Successor:** Prompt 2 — Add `ops_admin` role + create Dhruv + Kuldeep accounts
**Mode:** READ-ONLY diagnosis · No code, SQL, or schema changes were made

---

## Files read

**Schema + auth core:**
- `prisma/schema.prisma` (§models `role_master`, `user_roles`, `role_permissions`, `users`, lines 66–161)
- `lib/auth.ts` (full)
- `auth.config.ts` (full)
- `middleware.ts` (full)
- `lib/permissions.ts` (full)
- `lib/rbac.ts` (full — central `ROLES` constant + guards)
- `prisma/seed.ts` (lines 1–110)

**Type augmentation:**
- `auth.config.ts:7-26` — Session/User module augmentation (no separate `types/next-auth.d.ts` exists; lives inline in auth.config.ts)

**Sidebar + layout:**
- `components/shared/role-sidebar.tsx` (full — `RoleSidebarRole` type + `ROLE_LABELS` map)
- `components/shared/role-sidebar-provider.tsx` (full)
- `components/shared/role-layout-client.tsx` (full)
- `components/shared/role-nav.tsx` (full — generic, no role logic)

**Layout files passing `as RoleSidebarRole`** — confirmed exactly 8:
1. `app/(import)/import/layout.tsx:44`
2. `app/(mail-orders)/mail-orders/layout.tsx:49`
3. `app/(operations)/operations/layout.tsx:46`
4. `app/(planning)/planning/layout.tsx:49`
5. `app/(support)/support/layout.tsx:49`
6. `app/(tint)/tint/manager/layout.tsx:49`
7. `app/(tint)/tint/operator/layout.tsx:53`
8. `app/(warehouse)/warehouse/layout.tsx:49`

`app/(admin)/admin/layout.tsx` does **not** use `RoleSidebarRole` — it uses a separate `AdminLayoutClient` + `components/admin/admin-sidebar.tsx` system. This is consistent with admin being absent from the `RoleSidebarRole` union (see §B.9 below).

**Login redirects:**
- `app/login/page.tsx` (full — server-side guard on the login screen)
- `app/login/login-form.tsx` (full — client form posts to `/`)
- `app/page.tsx` (full — root page that does the actual role redirect)

**Constants / role literals:**
- `lib/rbac.ts:5-15` — `ROLES` const (9 entries)
- Project-wide `Grep` for `["'](admin|tint_manager|...)["']` and `=== "admin"` style — see §B.8 inventory

---

## A. DB storage shape

### 1. `role_master.name` type

**Plain `String`** — not a Postgres enum. `prisma/schema.prisma:66-72`:

```prisma
model role_master {
  id          Int          @id @default(autoincrement())
  name        String       @unique
  description String?
  users       users[]
  userRoles   user_roles[]
}
```

No native Postgres enum is declared anywhere in the schema for roles. (StatusDomain enum exists for status_master, but that's unrelated.)

### 2. Constraints on `role_master.name`

- `@unique` (single-column)
- `NOT NULL` (Prisma `String` is non-optional unless marked `?`)
- No length cap declared in the schema (would be `text` in Postgres by default for unmarked Prisma `String`)
- No `CHECK` constraint visible in Prisma. Any DB-level CHECK added directly in Supabase wouldn't show here.

### 3. Current rows in `role_master`

**Cannot run SQL in this environment** (READ-ONLY constraint, and no `psql` / Prisma Studio session available from inside the harness without DB credentials). Best inferences from code + seed + CLAUDE_CORE.md §5:

| Source | Roles listed |
|---|---|
| `prisma/seed.ts:31-39` | `admin`, `dispatcher`, `support`, `tint_manager`, `tint_operator`, `floor_supervisor`, `picker` (7) |
| `lib/rbac.ts:5-15` `ROLES` | 7 above + `operations`, `billing_operator` (9 total) |
| `CLAUDE_CORE.md §5` | Same 9 as `lib/rbac.ts` |

**The seed file is out of date** — it does not include `operations` (id 12) or `billing_operator` (id 13) which CLAUDE_CORE.md §5 lists with explicit IDs. These rows exist in the DB only because someone added them manually via Supabase SQL Editor (per §3 "Never `prisma db push`" rule).

⚠️ **Recommendation later:** before Prompt 2 inserts `ops_admin`, refresh `prisma/seed.ts` so a fresh seed reproduces the production role set.

### 4. `users.roleId` FK behaviour

`prisma/schema.prisma:110-111`:

```prisma
roleId Int
role   role_master @relation(fields: [roleId], references: [id])
```

- Type: `Int` (NOT NULL — no `?`)
- FK: → `role_master.id`
- `onDelete` not declared → defaults to `Restrict` in Prisma (a role with users cannot be deleted without explicit cascade)
- No `@default(...)` value → every user **must** have a primary role at insert time

### 5. Is `user_roles` join table consumed?

**Only at sign-in.** Direct `prisma.user_roles.*` calls: **none** in app code. The only read of multi-role data is via the `users.findUnique` include chain in `lib/auth.ts:184-190`:

```ts
const user = await prisma.users.findUnique({
  where: { email },
  include: {
    role: true,
    userRoles: { include: { role: true } },
  },
});
```

The `userRoles` array is then mapped into `roles: string[]` (line 200-203) and frozen into the JWT. **Multi-role assignments only take effect after the user signs out and back in.** No live re-read happens per request, even on JWT refresh (the refresh path in `lib/auth.ts:140-168` re-reads attendance flags but **not** roles).

This means:
- Granting a user a new role via `user_roles` insert is invisible until next login.
- Revoking a role via `user_roles` delete leaves the JWT-cached role active until the JWT expires or `signOut` is called.

---

## B. Role slug source of truth

### 6. Canonical list of role slugs

`lib/rbac.ts:5-15`:

```ts
export const ROLES = {
  ADMIN: "admin",
  DISPATCHER: "dispatcher",
  SUPPORT: "support",
  TINT_MANAGER: "tint_manager",
  TINT_OPERATOR: "tint_operator",
  OPERATIONS: "operations",
  FLOOR_SUPERVISOR: "floor_supervisor",
  PICKER: "picker",
  BILLING_OPERATOR: "billing_operator",
} as const;
```

This is the only `ROLES` const-object in the codebase.

### 7. Canonical TypeScript type for role slugs

**There is no single canonical type** — the codebase has at least three competing types/usages, none of them complete:

| Type / location | Members | Used by |
|---|---|---|
| `ROLES` literal constant in `lib/rbac.ts` | 9 string slugs | API routes, `requireRole` / `hasRole` guards |
| `RoleSidebarRole` union in `components/shared/role-sidebar.tsx:16-25` | 9 members but a DIFFERENT SET — see §B.9 | 8 route-group layout files (cast `as RoleSidebarRole`) |
| `string` (raw) in `Session.user.role` and `Session.user.roles[]` (`auth.config.ts:8-26`) | Any string at runtime | All other consumers |

There is **no derived `RoleSlug` type** like `typeof ROLES[keyof typeof ROLES]` — even though that const-assertion would make it trivial to derive. Every consumer uses raw `string`.

### 8. Hardcoded role string literals (occurrences NOT going through `ROLES`)

**60 source files** contain bare role string literals (`"admin"`, `"tint_manager"`, etc.). Most are unavoidable because `session.user.role` is typed as `string`, so comparisons can't easily reference the const without an extra cast — but the most-common offender is `=== "admin"`.

Bare `"admin"` literal comparisons (50+ occurrences across these files; selected list, line numbers in parentheses):

- `middleware.ts` (57, 87) — Phase 1 guard + attendance gate
- `lib/auth.ts` (68) — `gateAppliesTo`
- `lib/permissions.ts` (76, 168, 198, 218, 250) — admin bypass in 5 functions
- `app/(admin)/admin/customers/page.tsx` (12), `app/(admin)/admin/skus/page.tsx` (18), `app/(admin)/admin/routes/page.tsx` (12), `app/(admin)/admin/areas/page.tsx` (12), `app/(admin)/admin/vehicles/page.tsx` (12) — all admin-page guards
- `app/(support)/support/customers/page.tsx` (12), `app/(dispatcher)/dispatcher/customers/page.tsx` (12)
- 30+ `app/api/admin/**/route.ts` files: `if (session!.user.role !== "admin")`
- `app/api/tint/manager/**/route.ts` files (10+) — pattern: `if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS)` — **inconsistent style mixing literal and constant on the same line**
- `components/admin/permissions-manager.tsx` (102, 106, 214, 300, 374, 388) — multiple `=== "admin"` comparisons
- `components/admin/admin-sidebar.tsx` (157, 159) — `userRole === "admin"`
- `components/admin/add-user-sheet.tsx` (44) — `r.name !== "admin"` filter
- `app/api/warehouse/assign/route.ts` (32) — `picker.role.name !== "picker"` (literal, not via `ROLES.PICKER`)

**Most of these single-literal checks consult only `session.user.role` (single primary role), not `session.user.roles[]` (multi-role array)** — so an admin who somehow has `admin` only in `userRoles` and a different name in `users.role` would fail these checks. In practice this matters less because `lib/auth.ts:199-203` always sets `primaryRole = user.role.name` from the legacy single-role FK, so `session.user.role` is the legacy role and `session.user.roles[]` is the union.

### 9. `RoleSidebarRole` vs `ROLES` mismatch ⚠️

`RoleSidebarRole` (`components/shared/role-sidebar.tsx:16`) declares:

```ts
export type RoleSidebarRole =
  | "support"
  | "tint_manager"
  | "tint_operator"
  | "import"
  | "support_import"
  | "planning"
  | "warehouse"
  | "operations"
  | "billing_operator";
```

Compared to `ROLES` (the actual DB role slugs):

| Member | In `ROLES`? | In `RoleSidebarRole`? |
|---|---|---|
| `admin` | ✅ | ❌ |
| `dispatcher` | ✅ | ❌ |
| `support` | ✅ | ✅ |
| `tint_manager` | ✅ | ✅ |
| `tint_operator` | ✅ | ✅ |
| `operations` | ✅ | ✅ |
| `floor_supervisor` | ✅ | ❌ |
| `picker` | ✅ | ❌ |
| `billing_operator` | ✅ | ✅ |
| `import` | ❌ | ✅ |
| `support_import` | ❌ | ✅ |
| `planning` | ❌ | ✅ |
| `warehouse` | ❌ | ✅ |

So `RoleSidebarRole` has **9 members like `ROLES`, but they're a different set**: it omits 4 actual DB roles (admin, dispatcher, floor_supervisor, picker) and adds 4 UI-derived sidebar identities (import, support_import, planning, warehouse). The 8 layout files use `primaryRole as RoleSidebarRole` casts that the TypeScript compiler can't refute (source is `string`), but at runtime `ROLE_LABELS[role]` (line 79) returns `undefined` for any role not in this hand-curated subset.

This is the kind of contradiction the prompt asks me to flag. The likely history: when this type was authored, dispatcher / floor_supervisor / picker were assumed to be served by separate `planning` / `warehouse` UI personas. Admin uses a different sidebar. But the type has drifted from the data.

---

## C. JWT + session shape

### 10. JWT payload for role

Both **single string and array**, in two distinct fields:

`lib/auth.ts:115-117`:
```ts
token.id = user.id;
token.role = user.role;     // single primary role string
token.roles = user.roles;   // string[] array
```

`auth.config.ts:53-60` (Edge JWT callback) — same pattern.

### 11. `session.user.role` runtime resolution

`auth.config.ts:62-65`:

```ts
session.user.id = (token.id as string | undefined) ?? "";
session.user.role = (token.role as string | undefined) ?? "";
session.user.roles = (token.roles as string[] | undefined) ?? [];
```

So at runtime:
- `session.user.role` — **single primary role string** (or empty string if missing)
- `session.user.roles` — **string array** of all assigned roles (could be empty array on legacy tokens before multi-role rollout)

`primaryRole` derivation (`lib/auth.ts:199`): `user.role.name.toLowerCase().replace(/\s+/g, "_")` — so even if a `role_master.name` row contains spaces or mixed case (e.g., "Tint Manager"), it normalizes to `tint_manager` before the JWT is signed. This is the only place this normalization happens; all downstream code assumes lower_snake_case.

### 12. Middleware role read

**Single-role only.** `middleware.ts:56`, `middleware.ts:78` — both read `req.auth.user?.role` (singular). The middleware never consults `roles[]`. This means:
- The Phase 1 guard (`role !== "admin"`) only checks the primary role.
- The attendance gate's `role === "admin"` branch only fires when admin is the primary role.

If a user has multiple roles where admin is non-primary, the Phase 1 guard would block them, and the attendance gate would treat them as a non-admin.

Currently `PHASE1_BLOCKED` is empty (`middleware.ts:20`), so this is a latent issue, not an active one.

### 13. Multi-role precedence

`lib/auth.ts:199-203`:
```ts
const primaryRole = user.role.name.toLowerCase().replace(/\s+/g, "_");
const allRoles = user.userRoles.map(...);
const roles = allRoles.length > 0 ? allRoles : [primaryRole];
```

Precedence rules:
- **Primary role** = `users.role.name` (the legacy single-role FK row). Always set.
- **`roles[]`** = list of `user_roles` rows; if none, falls back to `[primaryRole]`.
- `roles[]` is NOT guaranteed to include the primary role unless the multi-role assignment is consistent. (If user has `roleId → admin` and a `user_roles` row for `tint_manager` only, the JWT would carry `role: "admin"`, `roles: ["tint_manager"]`. Inconsistent.)

`isPrimary` flag exists on `user_roles` (line 78) but is **never consulted in app code**. The "primary" comes from the legacy `users.roleId` FK, not from the new flag.

`lib/rbac.ts:32` uses `userRoles ?? [session.user.role]` — falls back to the singular field if the array is missing/empty.

---

## D. Authorization checks

### 14. Middleware path decision style

Allowlist + per-feature override. `middleware.ts`:
- `PUBLIC_PATHS` (lines 9-19) — bypass auth entirely
- `/api/cron/*` — Bearer-token internal auth
- HMAC carve-outs for `/api/import/obd` and `/api/mail-orders/ingest`
- Public keyword endpoint
- `PHASE1_BLOCKED` array (currently empty) — would force non-admin to `/not-ready`
- Otherwise: any authenticated user passes; the per-route layout / API handler does role-specific work
- Attendance gate (lines 74-94) — orthogonal to role; redirects to `/attendance`

There's **no per-role redirect map at the middleware layer.** Role-specific landing happens at `app/page.tsx`.

### 15. Sidebar nav decision

**Two parallel systems**, depending on whether the user is admin:

(a) **Admin path:** `components/admin/admin-sidebar.tsx:157-159` has its own logic that checks `userRole === "admin"` and consults `allPerms[item.pageKey]`. Different file from the role-sidebar system.

(b) **Non-admin path:** `lib/permissions.ts buildNavItems(allPerms, roleSlug, userFlags)` — used by all 8 `RoleSidebar` consumers. Filters `PAGE_NAV_MAP` by `allPerms[item.pageKey]?.canView === true`, with one bypass: the `attendance` nav item (lines 75-81) is gated on user-level flags + rollout stage, NOT on `role_permissions` (no row exists for `attendance` — it's intentionally per-user).

There are no other bypass paths for nav rendering. `dedupedNavItems` filtering in each layout (e.g., `app/(tint)/tint/manager/layout.tsx:36-41`) is just deduplication-by-pageKey, not role logic.

### 16. API route role checks

**No central `requireRole` use in API handlers** — `lib/rbac.ts requireRole()` exists but is used only in `app/(admin)/admin/layout.tsx:15` and a couple of other server components. API routes mostly do inline:

```ts
if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

…or ALLOWED_ROLES arrays:
```ts
const ALLOWED_ROLES = [ROLES.TINT_OPERATOR, ROLES.TINT_MANAGER, ROLES.ADMIN];
```

(Pattern from `app/api/tint/operator/shades/route.ts:48` and `[id]/route.ts:48`.)

Inline-vs-helper inconsistency. Most checks read `session.user.role` (singular), not `roles[]`.

### 17. `role_permissions` runtime consultation

**Per-request DB hit, no caching.** `lib/permissions.ts` exposes:
- `getAllPermissionsForRole(roleSlug)` — `findMany({ where: { roleSlug } })` per call
- `getAllPermissionsForRoles(roleSlugs[])` — `findMany({ where: { roleSlug: { in: roleSlugs } } })` per call (multi-role union)
- `checkPermission(slug, pageKey, action)` — `findUnique` per call
- `checkAnyPermission(slugs[], pageKey, action)` — `findMany` per call

Every layout and API gate calls one of these on every request. No in-memory cache, no boot-time load, no React cache. Admin short-circuits to ALL_TRUE without a DB call.

(For 9 roles × 25 page keys, this is ~225 max rows — a `findMany` is cheap, but it's still a per-request roundtrip.)

---

## E. Login redirects

### 18. Where the role → landing route mapping lives

**Two files, two different maps. They disagree.** This is the second contradiction worth flagging.

The login flow in practice:
1. User submits the form (`app/login/login-form.tsx`).
2. `signIn("credentials", { redirect: false })` returns; on success, `router.push("/")`.
3. `app/page.tsx` (the root) reads `auth()` and redirects by role from its own map.

Separately, if a user navigates **directly** to `/login` while already authenticated, `app/login/page.tsx` runs and uses **its own different map**.

### 19. The two maps verbatim

`app/login/page.tsx:7-16` (8 entries — used only on direct GET to `/login` with active session):

```ts
const ROLE_REDIRECTS: Record<string, string> = {
  admin: "/admin",
  dispatcher: "/planning",
  support: "/support",
  tint_manager: "/tint/manager",
  tint_operator: "/tint/operator",
  operations: "/operations/support",
  floor_supervisor: "/warehouse",
  picker: "/warehouse",
};
```
(missing `billing_operator`)

`app/page.tsx:6-15` (8 entries — the **active** post-login redirect):

```ts
const ROLE_REDIRECTS: Record<string, string> = {
  admin: "/admin",
  dispatcher: "/dispatcher",
  support: "/support",
  tint_manager: "/tint/manager",
  tint_operator: "/tint/operator",
  floor_supervisor: "/warehouse/supervisor",
  picker: "/warehouse/picker",
  billing_operator: "/mail-orders",
};
```
(missing `operations`)

⚠️ **Differences:**
| Role | `app/login/page.tsx` | `app/page.tsx` |
|---|---|---|
| `dispatcher` | `/planning` | `/dispatcher` |
| `floor_supervisor` | `/warehouse` | `/warehouse/supervisor` |
| `picker` | `/warehouse` | `/warehouse/picker` |
| `operations` | `/operations/support` | (MISSING — falls to `/unauthorized`) |
| `billing_operator` | (MISSING — falls to `/unauthorized`) | `/mail-orders` |

Visiting `/login` while signed in as `billing_operator` → bounces to `/unauthorized`. Visiting `/` (or just signing in for the first time) as `operations` → bounces to `/unauthorized`.

The CLAUDE_CORE.md §5 reference listing is yet a third version that doesn't match either file exactly.

### 20. Fallback

Both files: `?? "/unauthorized"` (no role match → unauthorized page).

---

## F. Adding `ops_admin` — impact analysis

### Required changes by layer

**DB layer:**
- Insert one row in `role_master`: `{ name: "ops_admin", description: "..." }` via Supabase SQL Editor (per §3 rule).
- Insert N rows in `role_permissions` for the page keys `ops_admin` should see: presumably the operations `operations_*` keys plus `attendance` (though `attendance` is gated separately via user flags, not perms — see §D.15).
- Optionally update `prisma/seed.ts` to include `ops_admin` so a seed reproduces the production state going forward (and refresh the missing `operations` + `billing_operator` rows while doing so).
- New users (Dhruv, Kuldeep): `users` rows with `roleId` → the new role's id. Optionally `user_roles` rows (only matters at sign-in).

**TypeScript type layer:**
- Add `OPS_ADMIN: "ops_admin"` to `ROLES` in `lib/rbac.ts:5-15`.
- Add `"ops_admin"` to the `RoleSidebarRole` union in `components/shared/role-sidebar.tsx:16-25` (only needed if `ops_admin` users will pass through one of the 8 RoleSidebar layouts; if they get the admin sidebar, this is N/A).
- Add `ops_admin: "Ops Admin"` (or whatever label) to `ROLE_LABELS` in `components/shared/role-sidebar.tsx:61-71` — required if added to the union; otherwise the brand block and user block render `undefined` as the role label.

**Auth layer (`lib/auth.ts`, `auth.config.ts`):**
- **No code change needed** — sign-in normalizes `role_master.name` to lower_snake_case generically. As long as the master row name is `"ops_admin"` (or `"Ops Admin"` which normalizes to the same), it flows through.
- `gateAppliesTo` (`lib/auth.ts:65-72`) treats `role === "admin"` specially. If `ops_admin` should follow the same "test-users-only unless flagged" rule as admin, this branch needs a tweak. Otherwise `ops_admin` falls into the regular `TEST_USERS_ONLY` / `ALL_USERS` rollout flow.

**Middleware layer (`middleware.ts`):**
- The hardcoded `role === "admin"` check on line 87 (attendance gate) and line 57 (Phase 1 guard) decide admin-only carve-outs. If `ops_admin` should bypass Phase 1 like admin does, it needs an entry there. Currently `PHASE1_BLOCKED` is empty so the line-57 check is dormant.
- The attendance gate copy (line 87) mirrors `gateAppliesTo` from `lib/auth.ts` — keep them in sync if `gateAppliesTo` changes.

**Sidebar layer:**
- If `ops_admin` users will use the standard `RoleSidebar`, they need the type union update (above) plus a label. If they will use the admin sidebar (`AdminLayoutClient`), the `(admin)/admin/layout.tsx requireRole(session, [ROLES.ADMIN])` check on line 15 would block them — would need expansion to `[ROLES.ADMIN, ROLES.OPS_ADMIN]`.
- Pick which sidebar `ops_admin` should see and trace which layout's `requireRole` / `checkAnyPermission` gate they pass.

**Permissions layer:**
- Insert `role_permissions` rows for every page key `ops_admin` should view/edit. See `lib/permissions.ts:152-159` for the canonical `ALL_PAGE_KEYS` list (note: this list is missing `attendance` — see §F.Risks).
- If `ops_admin` should bypass permission checks like admin does, that means adding `roleSlug === "ops_admin"` to the 5 short-circuits in `lib/permissions.ts` (lines 76, 168, 198, 218, 250) AND the `permissions-manager.tsx` UI guards (lines 102, 106, 214, 300, 374, 388). Likely **don't** want this — `ops_admin` should have a real, auditable permission row set, not a code-level bypass.

**Login redirect:**
- Add `ops_admin: "/some-landing-route"` to BOTH `ROLE_REDIRECTS` maps (`app/page.tsx:6-15` AND `app/login/page.tsx:7-16`).
- Reconcile the two maps while you're there (see §E.19).

### Risks if we miss a layer

| Skipped layer | Symptom |
|---|---|
| `role_master` row not inserted | Sign-in fails: `users.findUnique` include of `role: true` returns the row, but if you forget to `roleId → newId`, the user can't be created. Lower risk — caught at INSERT time. |
| `role_permissions` rows omitted | User signs in successfully, JWT issued, but `buildNavItems` filter returns `[]` → empty sidebar with no nav links. User can navigate by typing URLs but every layout `checkAnyPermission` fails → `/unauthorized` everywhere. |
| `ROLES` const not updated | API route checks like `[ROLES.OPS_ADMIN, ROLES.ADMIN]` won't compile. But hardcoded `=== "ops_admin"` literals would still work. Minor — TypeScript catches at build time. |
| `RoleSidebarRole` union not updated | `as RoleSidebarRole` cast still compiles (source is `string`, no type narrowing). At runtime: `ROLE_LABELS[role]` returns `undefined`, sidebar shows `undefined` as the role label. **Silent UI break.** |
| `ROLE_LABELS` not updated | Same as above — sidebar brand block and user block render `undefined` as the role text. |
| `gateAppliesTo` not updated | Attendance gate behaves per the default `TEST_USERS_ONLY` / `ALL_USERS` rules. Likely fine for `ops_admin`. Skip unless `ops_admin` needs admin-style "test-users-only unless flagged" behavior. |
| Middleware `=== "admin"` not updated | Attendance gate treats `ops_admin` as a regular user (test-flag-or-rollout-driven). Phase 1 guard would treat them as non-admin. Acceptable if you want that. |
| `app/page.tsx` redirect missing entry | After login, `ops_admin` → `/unauthorized`. Hard fail visible immediately. |
| `app/login/page.tsx` redirect missing entry | Less visible — only fires if user navigates to `/login` while already signed in. Still bounces to `/unauthorized`. Easy to miss in QA. |
| `ALL_PAGE_KEYS` array (`lib/permissions.ts:152-159`) missing `attendance` already | Minor pre-existing bug: when admin's `getAllPermissionsForRole("admin")` is called, it returns ALL_TRUE for every key in `ALL_PAGE_KEYS` — but `attendance` isn't in the array. Doesn't matter because `buildNavItems` has a special `attendance` branch that bypasses `allPerms`. But if anyone adds new admin-default UI that consults `allPerms.attendance`, it would be `undefined` instead of `ALL_TRUE`. Worth flagging. |

---

## Recommendation

- **Reconcile the two `ROLE_REDIRECTS` maps before adding `ops_admin`.** Either centralize them in `lib/rbac.ts` next to `ROLES` (preferred), or pick one as the canonical and `import` it into the other. As-is, every new role requires editing two places that are guaranteed to drift.
- **Tighten `RoleSidebarRole` to match `ROLES`, or document that it's a separate UI persona type.** Right now the cast `as RoleSidebarRole` is silently load-bearing, and the type's drift from the actual role set is the most likely source of "user logged in, sidebar empty / role label says undefined" bugs. If we keep the persona model, derive `ROLE_LABELS` from a typed map and drop the cast.
- **Refresh `prisma/seed.ts`** to include all 9 production roles (`operations`, `billing_operator`) plus the new `ops_admin` once Prompt 2 lands. The seed is the only authoritative description of "what a fresh DB looks like" — drift here will bite anyone who runs `db seed` after a reset.
- **For `ops_admin` specifically:** strongly prefer real `role_permissions` rows over a code-level admin-style bypass. The 5 `roleSlug === "admin"` short-circuits in `lib/permissions.ts` are convenient for admin but make audits hard ("why does this user see this page?"). Adding `ops_admin` to that bypass list compounds the problem. Use real rows.
- **Decide whether `ops_admin` should attend.** The attendance gate's `role === "admin"` carve-out makes admin attendance opt-in via `attendanceTestUser`. If `ops_admin` is meant to be the "real attendees" pilot population, they should NOT inherit the admin carve-out — they should follow the rollout flag like every other role.

## Open questions for Smart Flow

1. **Sidebar shape for `ops_admin`:** which sidebar does Dhruv/Kuldeep see — admin sidebar or RoleSidebar? This decides whether we touch `RoleSidebarRole` or `requireRole([ROLES.ADMIN])` in `app/(admin)/admin/layout.tsx`.
2. **Landing route for `ops_admin`:** what does the `app/page.tsx` redirect map them to? `/admin`? `/operations/support`? A new dedicated route?
3. **Do you want me to fix the two `ROLE_REDIRECTS` maps in Prompt 2, or is that a separate cleanup prompt?** The contradiction is independent of `ops_admin`, but `ops_admin` is the trigger that surfaces it.
4. **`prisma/seed.ts` update:** if Prompt 2 should refresh seed.ts to include `operations`, `billing_operator`, and `ops_admin`, please confirm — or specify "seed is for fresh installs only, production rolls forward via SQL Editor."
5. **DB row inspection without SQL:** I had to infer the current `role_master` rows from code + seed + CLAUDE_CORE.md §5. If you can paste a `SELECT id, name FROM role_master ORDER BY id` from the Supabase Editor, that closes one of the few remaining gaps in this diagnosis.

---

*Prompt 1 of 6 · Attendance pilot rollout · 2026-05-09 · Diagnosis only — no code changes*
