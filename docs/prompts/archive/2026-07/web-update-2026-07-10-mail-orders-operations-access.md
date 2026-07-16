# web-update-2026-07-10-mail-orders-operations-access

Session type: web (planning + SQL, no code)
Target canonical files: `CLAUDE_CORE.md` (§5 roles, §13 landmines), `CLAUDE_MAIL_ORDERS.md` (access section)
Status: applied to production DB · no code deploy

---

## 1. What changed

Granted the `operations` role access to `/mail-orders` with the same rights as `billing_operator` (canView + canEdit).

Applied as a single row in `role_permissions`. **No code change, no Vercel deploy.**

```sql
-- roleSlug + pageKey has a real @@unique constraint, so ON CONFLICT is safe.
-- updatedAt has no DB-level default (@updatedAt is Prisma-side) — must set now().
INSERT INTO role_permissions
  ("roleSlug", "pageKey", "canView", "canEdit", "canImport", "canExport", "canDelete", "updatedAt")
SELECT 'operations', 'mail_orders',
       bo."canView", bo."canEdit", bo."canImport", bo."canExport", bo."canDelete", now()
FROM role_permissions bo
WHERE bo."roleSlug" = 'billing_operator' AND bo."pageKey" = 'mail_orders'
ON CONFLICT ("roleSlug", "pageKey") DO UPDATE
SET "canView" = EXCLUDED."canView", "canEdit" = EXCLUDED."canEdit",
    "canImport" = EXCLUDED."canImport", "canExport" = EXCLUDED."canExport",
    "canDelete" = EXCLUDED."canDelete", "updatedAt" = now();
```

Verified live: logged in as the operations account, Mail Orders appears in the sidebar and the page loads.

---

## 2. How Mail Orders access actually works (correcting a wrong assumption)

Access is **not** hardcoded to `billing_operator` anywhere. It is DB-driven:

| Layer | File | Mechanism |
|---|---|---|
| Sidebar | `lib/permissions.ts` — `PAGE_NAV_MAP` (line 36) + `buildNavItems()` (79-109) | filters nav entries by `allPerms[pageKey]?.canView === true` |
| Page guard | `app/(mail-orders)/mail-orders/layout.tsx` (19-28) | `checkAnyPermission(roles, "mail_orders", "canView")` → redirect `/unauthorized` |
| `middleware.ts` | — | **no role check at all** for `/mail-orders`; only "has a session" |
| API routes | `app/api/mail-orders/**` | **no role check at all**; only "has a session" |
| `role-sidebar.tsx` | — | dumb renderer, no gating |

`admin` bypasses the permission table entirely (hard-coded bypass in `lib/permissions.ts` at 194, 209, 224, 244, 276). **Testing access while logged in as admin proves nothing.**

**Pattern for granting any role access to any page:** one `role_permissions` row. No code, no deploy. Effective on next session refresh.

---

## 3. Current `mail_orders` grants (as of 2026-07-10)

| roleSlug | canView | canEdit |
|---|---|---|
| `billing_operator` | true | true |
| `operations` | true | true |
| `operation_manager` | true | true |
| `tint_manager` | true | false |

---

## 4. Corrections to CORE §5

- Operations account email is **`operations@orbitoms.in`**, not `operations@orbitoms.com`.
- A role slug **`operation_manager`** exists in `role_permissions` and is not listed in CORE §5's `role_master` table. Needs identification — legacy slug, or a real role missing from the docs.
- `tint_manager` holds view-only `mail_orders` access — undocumented.

---

## 5. Two pre-existing security gaps found (NOT introduced by this change)

Both are separate from this session's work and should get their own session.

### 5.1 Mail Orders API routes have no role check

Every session-gated route under `app/api/mail-orders/` checks only *"is there a valid session"* — never role, never permission:

`route.ts` (GET list) · `[id]/punch` · `[id]/so-number` · `[id]/customer` · `[id]/lock` · `[id]/split` · `[id]/original-lines` · `[id]/note` · `lines/[lineId]/resolve` · `lines/[lineId]/status` · `skus` · `customers/search` · `re-enrich` · `debug-enrich` · `learn-customer` · `backfill-customers`

(Intentionally exempt: `ingest` = HMAC, `keywords` = public parser fetch.)

**Consequence:** any logged-in user of any role — picker, tint operator, dispatcher — can PATCH/POST Mail Orders data by calling the API directly, bypassing the layout guard.

**Consequence for this feature:** a "read-only" grant (`canView` without `canEdit`) is currently a **UI illusion only**. `tint_manager`'s view-only row is not enforced server-side. Read-only cannot be trusted until API guards exist.

### 5.2 `backfill-enrich` GET is fully unauthenticated

`app/api/mail-orders/backfill-enrich/route.ts` exposes a `GET` handler with **no session, no HMAC** — marked `TEMPORARY — delete after backfill`. It performs a bulk write across `mo_order_lines`. Reachable by anyone with the URL.

---

## 6. Two authorization systems coexist

- `lib/rbac.ts` — `requireRole()` / `hasRole()`, the documented shared helper.
- `lib/permissions.ts` — `checkAnyPermission()` / `getAllPermissionsForRole(s)`, DB-backed.

Mail Orders uses **only** the second. `requireRole`/`hasRole` are unused by the module. Worth a decision on which one is canonical before adding API guards.

---

## 7. Seed-is-source-of-truth risk

`prisma/seed.ts` contains **zero** rows for `pageKey='mail_orders'` (grepped). Every existing grant — including `billing_operator`'s — lives only in the live DB. A wipe-and-reseed silently removes Mail Orders access for everyone except `admin`.

Per CORE §3 ("Seed is source of truth"), all four rows in §3 above should be added to `prisma/seed.ts`.

---

## 8. Follow-up items for ROADMAP

- [ ] Add `mail_orders` `role_permissions` rows to `prisma/seed.ts` (4 rows).
- [ ] Add role/permission guards to all `app/api/mail-orders/**` session-gated routes.
- [ ] Remove or HMAC-protect `backfill-enrich` GET handler.
- [ ] Identify the `operation_manager` slug — document or remove.
- [ ] Decide canonical auth helper: `lib/rbac.ts` vs `lib/permissions.ts`.
- [ ] Fix CORE §5 operations email → `operations@orbitoms.in`.
