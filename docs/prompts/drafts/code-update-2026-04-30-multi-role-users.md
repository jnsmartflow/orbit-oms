# Multi-Role User Model

Schema v26.5 → **v26.6** · April 30, 2026

Users can now hold multiple roles. Primary role drives login redirect and href overrides; additional roles add nav items and unlock APIs.

---

## Database

**New table: `user_roles`** (created in Supabase SQL Editor, backfilled, trigger live)

```
user_roles
├── id            SERIAL PK
├── userId        INT FK → users.id (CASCADE)
├── roleId        INT FK → role_master.id (RESTRICT)
├── isPrimary     BOOLEAN
├── createdAt     TIMESTAMPTZ
└── createdById   INT FK → users.id (nullable)

UNIQUE (userId, roleId)
UNIQUE (userId) WHERE isPrimary = true   — exactly one primary per user
```

**Trigger `trg_sync_users_primary_role`** keeps `users.roleId` synced to whichever `user_roles` row has `isPrimary = true`. App code never writes `users.roleId` directly anymore — only via `user_roles` upserts.

**`users.roleId` retained** as denormalised primary pointer. Drop later in cleanup pass once everything reads from `user_roles`.

**Backfill state:** every existing user has exactly one `user_roles` row, mirroring their original `users.roleId`, marked primary.

---

## Schema (Prisma)

`user_roles` model added with relations on `users` (back-relations `userRoles`, `userRolesCreated`) and `role_master` (back-relation `userRoles`).

`users.roleId` and `users.role` left untouched.

---

## Auth / Session

`session.user` now carries:
- `role: string` — primary role slug (unchanged, still drives login redirect and href overrides)
- `roles: string[]` — all role slugs the user holds (NEW)

`lib/auth.ts` `authorize()` fetches `userRoles: { include: { role: true } }`, computes both. Defensive fallback: if `userRoles` empty, `roles = [primary]`.

`auth.config.ts` JWT and session callbacks copy `roles` through.

Type augmentation lives in `auth.config.ts` (no separate `next-auth.d.ts`). NextAuth v5 `next-auth/jwt` module didn't resolve cleanly — JWT roles use bracket-cast access pattern (matches existing `token.role` pattern).

---

## RBAC helpers

`lib/rbac.ts`:
- `requireRole(session, allowed[])` — body now reads `session.user.roles ?? [session.user.role]`. Pattern: `userRoles.some(r => allowed.includes(r))`. **All ~140 call sites became multi-role aware automatically — no per-route changes.**
- `hasRole(session, allowed[])` — same pattern.

`lib/permissions.ts`:
- `checkAnyPermission(roleSlugs[], pageKey, action)` — NEW. Multi-role variant. Admin short-circuits, empty array returns false, otherwise queries `role_permissions` with `roleSlug IN (...)` and ORs the action across rows.
- `getAllPermissionsForRoles(roleSlugs[])` — NEW. Returns the UNION of permissions across all roles passed in. Used by layouts to build merged sidebar.
- `checkPermission` and `getAllPermissionsForRole` — UNCHANGED. Kept for back-compat.

---

## Layouts (sidebar nav)

All 8 nav-rendering layouts updated to consume the multi-role helpers:
- `app/(tint)/tint/manager/layout.tsx`
- `app/(tint)/tint/operator/layout.tsx`
- `app/(support)/support/layout.tsx`
- `app/(planning)/planning/layout.tsx`
- `app/(warehouse)/warehouse/layout.tsx`
- `app/(mail-orders)/mail-orders/layout.tsx`
- `app/(operations)/operations/layout.tsx`
- `app/(import)/import/layout.tsx`

**Pattern:**
```typescript
const roles       = session.user.roles ?? [session.user.role];
const primaryRole = session.user.role;

// Guard
if (!roles.includes("admin")) {
  const allowed = await checkAnyPermission(roles, "<page>", "canView");
  if (!allowed) redirect("/unauthorized");
}

// Nav build
const allPerms = await getAllPermissionsForRoles(roles);
const navItems = buildNavItems(allPerms, primaryRole);  // primary used for href overrides

// Manual append (operator layout only) — preserved
// navItems.push({ pageKey: "shade_master", ... });

// Dedup by pageKey (cheap insurance, kills operator-layout duplicate for multi-role users)
const seen = new Set<string>();
const dedupedNavItems = navItems.filter(item => {
  if (seen.has(item.pageKey)) return false;
  seen.add(item.pageKey);
  return true;
});

<RoleLayoutClient role={primaryRole as RoleSidebarRole} navItems={dedupedNavItems} ... />
```

**Operations layout** uses inline guard `roles.some(r => ["operations","admin"].includes(r))` instead of `checkAnyPermission`.

**Import layout** keeps `requireRole(session, [...])` guard (already multi-role aware via Phase 3) and calls `buildNavItems(allPerms)` with no `roleSlug` (no href overrides for import users).

**Order rule:** `PAGE_NAV_MAP` source order, NOT primary-first. Items appear in their natural sidebar position regardless of which role granted them.

**RoleSidebar component:** UNTOUCHED. Still receives a flat `NavItemConfig[]` and uses `role` prop only for the display label.

---

## TM Operators endpoint

`app/api/tint/manager/operators/route.ts` query updated:

```typescript
// BEFORE — single FK only
where: { role: { name: "tint_operator" }, isActive: true }

// AFTER — userRoles join, matches primary OR additional
where: {
  isActive: true,
  userRoles: { some: { role: { name: "tint_operator" } } },
}
```

This is the single endpoint that queried users by role. Pill counts on TM screen flow through `assignedTo` joins on `tint_assignments` / `order_splits`, no role filter — they auto-update once a user has assignments.

---

## Smoke test (local dev)

Verified on `npm run dev` with Chandresh granted `tint_operator` as additional role (manual SQL insert into `user_roles` — id 22, isPrimary=false).

- Sidebar shows "Tint Operator" link below "Tint Manager" ✓
- TM Assign Operator modal lists Chandresh alongside Deepak and Chandrasing ✓
- Assignment lands in `tint_assignments` with Chandresh's userId ✓
- Operator screen `/tint/operator` renders his queue, shows the assigned OBD, full operator UI ✓
- TM pill row picks up Chandresh's pill once first assignment is made ✓
- Deepak / Chandrasing experience unchanged ✓

---

## Pending — must do before/after deploy

### Before production deploy

- [ ] Commit all changes with a descriptive message
- [ ] Push to main → Vercel auto-deploy
- [ ] After deploy: log in as Chandresh in production, verify same smoke test passes
- [ ] If anything fails: rollback by removing his `user_roles` additional row (`DELETE FROM user_roles WHERE id = 22;`)

### Phase 5 — Admin UI (deferred, but planned)

- [ ] `GET /api/admin/users/[id]/roles` — return primary + additional
- [ ] `PUT /api/admin/users/[id]/roles` — sequential awaits, no `$transaction`
- [ ] Admin user-edit screen — primary role radio + additional roles checkboxes
- [ ] Replaces SQL Editor for role management

Until Phase 5 lands, role grants happen via Supabase SQL Editor:
```sql
INSERT INTO user_roles ("userId", "roleId", "isPrimary")
VALUES (<userId>, <roleId>, false);
```

### Cleanup pass — when stable

- [ ] Migrate the 43 remaining `checkPermission` call sites to `checkAnyPermission` (currently work because all those users are single-role; will start failing as multi-role spreads)
- [ ] Drop `users.roleId` column once all reads come from `user_roles` (denormalised pointer kept for safety; trigger maintains it)
- [ ] Validate target user has the required role in `assign` and `splits/reassign` endpoints (current behaviour: any user id accepted, latent looseness flagged in diagnostic)

---

## Engineering notes / footguns

- **Trigger writes only on insert/update where `isPrimary = true`.** Removing primary status from one row without setting another row to primary will leave `users.roleId` stale. Admin UI must enforce: every user always has exactly one primary.
- **`requireRole` is the chokepoint.** Updating its body covered ~140 call sites. Same model recommended for any future cross-cutting auth helper.
- **Layout outliers preserved:**
  - `tint/operator/layout.tsx` manually appends `shade_master` — kept. Dedup logic drops the duplicate for multi-role users.
  - `import/layout.tsx` calls `buildNavItems(allPerms)` with no `roleSlug` — kept. Import users get default hrefs, no overrides.
- **Order rule:** `PAGE_NAV_MAP` source order. New roles added later auto-slot into the right place. Don't override per-user.
- **Override resolution:** primary role's `ROLE_HREF_OVERRIDES` only. A multi-role TM+Operator sees `/tint/manager/customers` (TM override), not `/tint/operator/customers` (which doesn't exist anyway). Avoids ambiguity.
- **Dedup is by `pageKey`, not `href`.** Two roles granting the same page produce one nav item. PAGE_NAV_MAP keys are stable; hrefs vary by override.

---

## Files touched in this rollout

**Phase 1 (DB + schema):**
- `prisma/schema.prisma` — added `user_roles` model + relations on `users` and `role_master`

**Phase 2 (auth):**
- `lib/auth.ts` — `authorize()` fetches userRoles, returns `roles: string[]`
- `auth.config.ts` — JWT + session callbacks carry `roles`; type augmentation extended

**Phase 3 (RBAC):**
- `lib/rbac.ts` — `requireRole`, `hasRole` bodies updated
- `lib/permissions.ts` — added `checkAnyPermission`
- `app/api/tint/operator/start/route.ts` — migrated to `checkAnyPermission`
- `app/api/tint/operator/done/route.ts` — same
- `app/api/tint/operator/my-orders/route.ts` — same
- `app/api/tint/operator/split/start/route.ts` — same
- `app/api/tint/operator/split/done/route.ts` — same

**Phase 4 (sidebar):**
- `lib/permissions.ts` — added `getAllPermissionsForRoles`
- All 8 layouts (paths above) — multi-role aware nav build + guard upgrade
- 6 standard layouts dropped `checkPermission` import (no longer used)

**TM operators endpoint:**
- `app/api/tint/manager/operators/route.ts` — query swapped to userRoles join

**Total files:** 1 SQL migration (Supabase) + 1 Prisma schema + 2 auth + 7 RBAC/operator + 9 layouts + 1 operators endpoint = **20 files** + 1 DB table + 1 trigger.

---

*Draft for `docs/prompts/drafts/`. Promote to `CLAUDE_CORE.md` §5 (Roles section) and `CLAUDE_CORE.md` §7.1 (schema table list) at next consolidation pass.*
