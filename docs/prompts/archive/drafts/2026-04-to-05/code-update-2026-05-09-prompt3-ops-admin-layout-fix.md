# Prompt 3 (REVISED) — Layout Authorization Fix for `ops_admin`

**Save to:** `docs/prompts/drafts/code-update-2026-05-09-prompt3-ops-admin-layout-fix.md`
**Type:** Code edits + 2 small SQL writes (replace one role_permissions row) · No schema migration
**Predecessor:** `code-update-2026-05-09-prompt2-ops-admin-role.md` (role + accounts shipped)
**Replaces:** earlier Prompt 3 draft `code-update-2026-05-09-prompt3-middleware-ops-admin.md` (premise was wrong — middleware was never the gatekeeper)
**Successor:** Prompt 4 — PC no-camera fallback on `/attendance`

---

## What this prompt does

Closes the production redirect loop that strands Dhruv + Kuldeep post-login.

**The actual bug (per Step 1 diagnosis):** `app/(admin)/admin/layout.tsx:15` calls `requireRole(session, [ROLES.ADMIN])` which rejects `ops_admin`. Middleware is not the gatekeeper here — it just lets authenticated requests through. The original Prompt 3 (middleware whitelist) would not have fixed this.

**Three fixes in one commit:**

1. **Route-group move:** relocate `/admin/attendance` from `app/(admin)/` to a new `app/(ops)/` group with its own layout that allows both `ADMIN` and `OPS_ADMIN`. URL stays `/admin/attendance` (route groups are URL-invisible).
2. **Sidebar nav fix:** add a new `attendance_admin` pageKey pointing to `/admin/attendance`. Replace the wrong `(ops_admin, attendance)` row from Prompt 2 with `(ops_admin, attendance_admin)`. The existing `attendance` pageKey (href `/attendance`) stays as-is for the user-facing check-in flow.
3. **ROLE_HOME centralize:** the fourth role-redirect map at `app/unauthorized/page.tsx:6-14` (missed in Prompt 1's grep) is replaced with an import from `lib/rbac.ts` `ROLE_REDIRECTS`. Adds `ops_admin`, `operations`, `billing_operator` for free.

---

## Decisions locked

| Decision | Value |
|---|---|
| Authorization fix approach | Option A — route-group move (cleanest, future-proof) |
| Sidebar nav approach | Option A — new `attendance_admin` pageKey (cleaner data model than conditional href) |
| Middleware whitelist | SKIP — layout fix is sufficient; middleware doesn't gate by role for any other role |
| ROLE_HOME map at unauthorized page | Centralize into `ROLE_REDIRECTS` import (4th map, missed in Prompt 1) |
| Urgency | Hotfix tonight — Dhruv/Kuldeep stranded in production |

---

## Constraints (engineering rules — non-negotiable)

- No `prisma.$transaction` (sequential awaits only).
- No `prisma db push`. SQL writes via Supabase Editor only.
- All API routes (none touched here): `export const dynamic = 'force-dynamic'`.
- `tsc --noEmit` must pass before commit.
- Don't add `ops_admin` to any of the 6 admin-bypass short-circuits in `lib/permissions.ts`.
- Don't refactor unrelated `role === 'admin'` literals across the codebase (~60 files) — separate hygiene prompt later.
- Universal Header pattern stays intact on `/admin/attendance`.
- No new npm dependencies.
- PowerShell on Windows: use `;` not `&&` for chained commands.

---

## Files to read first (confirm at top: "Files read: ...")

1. `app/(admin)/admin/layout.tsx` — current layout that's rejecting ops_admin
2. `app/(admin)/admin/attendance/` — full directory tree (page, sub-pages, any local layouts/loading/error files)
3. `app/unauthorized/page.tsx` — the fourth ROLE_HOME map
4. `lib/auth.ts` or wherever `requireRole()` is defined — to confirm signature and side effects
5. `lib/rbac.ts` — `ROLES` const + `ROLE_REDIRECTS`
6. `lib/permissions.ts` — `ALL_PAGE_KEYS`, `PAGE_NAV_MAP`, `PageKey` type, `buildNavItems()`
7. `components/shared/role-sidebar.tsx` — confirm sidebar still pulls from `buildNavItems()`
8. `middleware.ts` — confirm no edit needed (sanity check)

**Confirm at top of output:** "All files read. requireRole signature: [...]. PAGE_NAV_MAP['attendance'].href = '/attendance'. Layout-level rejection at app/(admin)/admin/layout.tsx:[line]."

---

## Step 1 — Database state inspection (READ-ONLY)

Before any writes, run these in Supabase SQL Editor (or via the temp `.mjs` Prisma script with the same safety dance as Step 0 of Prompt 2):

```sql
-- Confirm the wrong row from Prompt 2 still exists
SELECT id, "roleSlug", "pageKey", "canView", "canExport"
FROM role_permissions
WHERE "roleSlug" = 'ops_admin';

-- Confirm no attendance_admin row exists yet
SELECT id, "roleSlug", "pageKey"
FROM role_permissions
WHERE "pageKey" = 'attendance_admin';

-- Confirm Dhruv + Kuldeep accounts intact
SELECT id, email, name, "roleId", "isActive", "attendanceTestUser"
FROM users
WHERE id IN (27, 28);
```

**Expected:**
- One row in result 1: id=1317, (ops_admin, attendance, true, true)
- Zero rows in result 2
- Two rows in result 3: Dhruv + Kuldeep, both isActive=true, attendanceTestUser=true

If any unexpected state, STOP and ask.

---

## Step 2 — Add `attendance_admin` pageKey (code edits)

### 2.1 Add to `ALL_PAGE_KEYS` and `PageKey` type

In `lib/permissions.ts`:
- Add `"attendance_admin"` to the `ALL_PAGE_KEYS` array (alphabetical position, immediately after `"attendance"`).
- If `PageKey` is a hand-typed union (Step 0 of Prompt 2 confirmed this), add `"attendance_admin"` to the union.
- DO NOT add `attendance_admin` to any of the 6 admin-bypass short-circuits.

### 2.2 Add to `PAGE_NAV_MAP`

In the same file, add an entry to `PAGE_NAV_MAP`:

```ts
attendance_admin: {
  label: 'Attendance',
  href: '/admin/attendance',
  icon: <same icon as attendance entry — copy it>,
  category: <same category as attendance entry — copy it>,
}
```

The label is intentionally just "Attendance" (not "Admin Attendance" or "Attendance Dashboard") — ops_admin only sees this nav item, so plain "Attendance" reads correctly. Admin would never see it (admin uses bypass to see all nav).

If `PAGE_NAV_MAP['attendance']` has fields not listed above (e.g. `requiresFlag`, `description`), copy those too — except `href`, which must be `/admin/attendance` for the new entry.

### 2.3 No change to existing `attendance` entry

Leave `PAGE_NAV_MAP['attendance']` exactly as it is (href `/attendance`). User check-in flow continues to use it.

### 2.4 Verify

```bash
npx tsc --noEmit
```

Must exit 0.

---

## Step 3 — Route-group move

### 3.1 Verify directory contents first

```bash
# PowerShell on Windows — use ; not &&
ls "app/(admin)/admin/attendance/" -Recurse
```

List every file inside `app/(admin)/admin/attendance/`. Confirm what's there before moving. Expected: at minimum `page.tsx`. Possibly sub-routes (e.g. `[id]/page.tsx`, `users/page.tsx`), local layouts, loading.tsx, error.tsx.

If the directory contains a local `layout.tsx`, flag it and STOP. Local layouts may have their own `requireRole` calls that need separate handling.

### 3.2 Create new route group `(ops)`

Create directory: `app/(ops)/`

Create `app/(ops)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth'; // or wherever auth() comes from in this codebase
import { ROLES } from '@/lib/rbac';
import { requireRole } from '@/lib/auth'; // or wherever requireRole comes from

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }
  requireRole(session, [ROLES.ADMIN, ROLES.OPS_ADMIN]);
  return <>{children}</>;
}
```

**IMPORTANT:** copy the EXACT pattern from `app/(admin)/admin/layout.tsx` — auth call, redirect, requireRole signature, return type. The only difference should be the role list passed to `requireRole`. Match imports, match async/sync, match wrapper component (if `(admin)` layout returns a wrapper div with sidebar, do the same here — but check carefully, the sidebar may live one level deeper).

If `(admin)/admin/layout.tsx` does anything beyond `requireRole` (e.g. renders `AdminSidebar`, sets metadata, fetches data), DECIDE:
- Sidebar: ops_admin should use the standard `RoleSidebar` (already wired in `app/layout.tsx` or root), NOT `AdminSidebar`. So do NOT copy any `AdminSidebar` imports from the admin layout.
- Other side effects: copy if relevant, skip if admin-specific.

If unclear, STOP and ask.

### 3.3 Move the attendance directory

Use git-aware move so history follows:

```bash
git mv "app/(admin)/admin/attendance" "app/(ops)/admin/attendance"
```

Note: the new path is `app/(ops)/admin/attendance/` — the `admin` segment stays in the path because the URL stays `/admin/attendance`. Route group `(ops)` is invisible in URLs.

### 3.4 Verify URL still resolves

After the move:
- File path: `app/(ops)/admin/attendance/page.tsx`
- URL: `/admin/attendance` (unchanged)

Run `npx tsc --noEmit` — must exit 0.

If TypeScript errors due to relative imports broken by the move, fix them (`../../../lib/...` paths may need adjustment if anything in the moved tree uses relative imports — prefer `@/` alias if available).

### 3.5 Smoke check

```bash
npm run build
```

Confirm the build output lists `/admin/attendance` as a route. If it's missing or duplicated, STOP and report.

---

## Step 4 — Centralize ROLE_HOME at `/unauthorized`

### 4.1 Read current state

`app/unauthorized/page.tsx` lines 6-14 contain a local `ROLE_HOME` map. Quote it in your output before editing.

### 4.2 Replace with import

Edit `app/unauthorized/page.tsx`:
- Delete the local `ROLE_HOME` const (lines 6-14)
- Add `import { ROLE_REDIRECTS } from '@/lib/rbac';` at the top
- Replace usages of `ROLE_HOME[role]` with `ROLE_REDIRECTS[role]`
- If the local map had a fallback (e.g. `ROLE_HOME[role] ?? '/'`), preserve the fallback behaviour

### 4.3 Verify no other references

```bash
grep -rn "ROLE_HOME" app/ lib/ components/
```

Must return zero hits. If anything else references the old name, fix or flag.

### 4.4 TypeScript check

```bash
npx tsc --noEmit
```

Must exit 0.

---

## Step 5 — Database row swap (Supabase SQL Editor)

Smart Flow runs these manually, same as Step 4 of Prompt 2.

### 5.1 Insert the new permission row

```sql
INSERT INTO role_permissions ("roleSlug", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete", "updatedAt")
VALUES ('ops_admin', 'attendance_admin', true, false, true, false, false, NOW())
RETURNING id, "roleSlug", "pageKey", "canView", "canExport";
```

Expected: one row, canView=true, canExport=true.

### 5.2 Delete the wrong row from Prompt 2

```sql
DELETE FROM role_permissions
WHERE "roleSlug" = 'ops_admin' AND "pageKey" = 'attendance'
RETURNING id, "roleSlug", "pageKey";
```

Expected: one row deleted, id=1317 (the row from Prompt 2).

### 5.3 Verify final state

```sql
SELECT id, "roleSlug", "pageKey", "canView", "canExport"
FROM role_permissions
WHERE "roleSlug" = 'ops_admin';
```

Expected: exactly one row, (ops_admin, attendance_admin, true, true). The old (ops_admin, attendance) row is gone.

Smart Flow pastes the three RETURNING outputs back in chat for verification before the deploy.

---

## Step 6 — Local smoke test

Run dev server. Test in this exact order:

### 6.1 ops_admin happy path
1. Sign in as `dhruv@orbitoms.com` / `OpsAdmin@2026`.
2. Login redirects to `/admin/attendance`.
3. Page renders WITHOUT redirect to `/unauthorized`.
4. Sidebar shows label "Operations Admin" + one nav item labeled "Attendance" linking to `/admin/attendance`.

### 6.2 ops_admin denied path
1. While signed in as Dhruv, manually navigate to `/admin/users`.
2. Should redirect to `/unauthorized` (the `(admin)` layout still rejects non-admins — correct behaviour).
3. On `/unauthorized` page, click "Go to my dashboard".
4. Should land on `/admin/attendance` (because `ROLE_REDIRECTS['ops_admin'] === '/admin/attendance'`).
5. Confirm no loop — dashboard renders cleanly.

### 6.3 admin regression
1. Sign out. Sign in as `admin@orbitoms.com`.
2. Navigate to `/admin/attendance` — should render (admin is in the new `(ops)` layout's role list).
3. Navigate to `/admin/users`, `/admin/customers`, `/admin/skus` — all accessible (still in `(admin)` group).
4. Sidebar still shows full admin nav.

### 6.4 tint_manager regression (if creds available)
1. Sign in as a tint_manager.
2. Sidebar shows tint_manager nav.
3. Navigate to `/admin/attendance` — redirects to `/unauthorized` (tint_manager not in `(ops)` layout's role list).
4. From `/unauthorized` page, click "Go to my dashboard" — lands at `/tint/manager` (per `ROLE_REDIRECTS`).

### 6.5 unauthorized page for ops_admin
1. While signed in as Dhruv, manually visit `/unauthorized`.
2. Page renders without redirect.
3. "Go to my dashboard" button links to `/admin/attendance`.
4. No loop.

If any test fails, STOP and report. Do NOT push.

---

## Step 7 — Commit + deploy

```bash
git add app/ lib/permissions.ts
git commit -m "fix(roles): ops_admin layout authorization + nav routing

Production hotfix for redirect loop stranding Dhruv (id=27) + Kuldeep (id=28).

Root cause: app/(admin)/admin/layout.tsx calls requireRole([ADMIN]) which
rejects ops_admin. Middleware was never the gatekeeper. Original Prompt 3
plan (middleware whitelist) wouldn't have fixed this.

Changes:
- Route-group move: app/(admin)/admin/attendance -> app/(ops)/admin/attendance.
  New (ops) layout calls requireRole([ADMIN, OPS_ADMIN]). URL unchanged.
- New pageKey 'attendance_admin' (href /admin/attendance) added to
  ALL_PAGE_KEYS, PageKey type, and PAGE_NAV_MAP.
- DB: replaced (ops_admin, attendance) permission row with
  (ops_admin, attendance_admin) so sidebar nav links to supervisor
  dashboard, not user check-in flow.
- app/unauthorized/page.tsx local ROLE_HOME map (4th role-redirect map
  missed in Prompt 1's grep) replaced with import from lib/rbac
  ROLE_REDIRECTS. Adds ops_admin, operations, billing_operator coverage.

No middleware changes. No schema changes. requireRole(), buildNavItems(),
and admin-bypass short-circuits unchanged.

Predecessor: code-update-2026-05-09-prompt2-ops-admin-role.md
Replaces: code-update-2026-05-09-prompt3-middleware-ops-admin.md (wrong premise)
MDF: mdf-attendance-rollout-2026-05-09.md (prompt 3 of 6, hotfix variant)"
git push origin main
```

Vercel auto-deploys. Monitor.

---

## Step 8 — Production smoke test

After Vercel turns green:

### 8.1 Phone test (primary)
1. Open `orbitoms.in/login` on phone.
2. Sign in as Dhruv. Should NOT loop.
3. Either lands on `/admin/attendance` directly OR (more likely, since `attendanceTestUser=true`) goes through gate → consent → check-in → then `/admin/attendance`.
4. Sidebar shows "Operations Admin" + "Attendance" nav item.
5. Tap Attendance — stays on `/admin/attendance`.

### 8.2 PC regression (admin)
1. On PC, sign in as `admin@orbitoms.com`.
2. Navigate to `/admin/attendance` — renders.
3. Navigate to `/admin/users` — renders.
4. Navigate to `/admin` root — renders.

### 8.3 Forbidden-path test for ops_admin
1. On PC, sign in as Dhruv (or another ops_admin in incognito).
2. Manually type `orbitoms.in/mail-orders`.
3. Should redirect to `/unauthorized`. Click "Go to my dashboard". Lands on `/admin/attendance`. No loop.

If anything fails on production, STOP and alert Smart Flow before further changes. Rollback path: revert the commit (`git revert HEAD`, push) — DB row state can stay as-is since the new row is benign without the code.

---

## Stop conditions

Stop and ask Smart Flow if:
- Step 1 SQL shows unexpected DB state (extra rows, missing rows, wrong values)
- Step 3.1 finds local `layout.tsx` inside the attendance directory tree
- Step 3.2 — `(admin)/admin/layout.tsx` does anything beyond auth + sidebar (e.g. data fetching that ops_admin's layout shouldn't replicate)
- Step 3.5 — `npm run build` shows duplicate or missing `/admin/attendance` route
- Step 4 — `ROLE_HOME` is referenced in any other file
- Any local smoke test fails
- Vercel deploy fails or shows new errors
- Production phone test loops or shows a different error

---

## Out of scope

- PC no-camera fallback on `/attendance` → **Prompt 4**
- Mobile route guard → **Prompt 5**
- Pilot activation SQL → **Prompt 6**
- Phase 2 admin powers (manual entry, edit) → post-pilot
- Refactor of ~60 hardcoded `role === 'admin'` literals → future hygiene
- Centralization of `requireRole()` to consult `role_permissions` table → future hygiene
- Adding more pages under `(ops)` (e.g. `/admin/users-attendance`) → done as those features are built

---

## Acceptance criteria

- [ ] `app/(ops)/layout.tsx` exists, calls `requireRole(session, [ADMIN, OPS_ADMIN])`
- [ ] `app/(ops)/admin/attendance/page.tsx` exists (moved via `git mv`, history preserved)
- [ ] `app/(admin)/admin/attendance/` directory removed (no orphan files)
- [ ] `attendance_admin` in `ALL_PAGE_KEYS`, `PageKey` type, and `PAGE_NAV_MAP` with href `/admin/attendance`
- [ ] DB: exactly one row for `roleSlug='ops_admin'` — `(ops_admin, attendance_admin, canView=true, canExport=true)`
- [ ] DB: zero rows for `(ops_admin, attendance)` (deleted)
- [ ] `app/unauthorized/page.tsx` imports `ROLE_REDIRECTS` from `lib/rbac`, no local `ROLE_HOME` map
- [ ] Zero `ROLE_HOME` references project-wide
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] All 5 local smoke tests pass
- [ ] Vercel deploy green
- [ ] Production phone test for Dhruv: lands cleanly, no loop
- [ ] Production admin regression: still works

---

## Execution log

### Files-read confirmation

> All files read. requireRole signature: `(session: Session | null, allowed: string[]): void` from `@/lib/rbac`. PAGE_NAV_MAP['attendance'].href = '/attendance'. Layout-level rejection at `app/(admin)/admin/layout.tsx:15`.

Note for Step 3.2 implementation: the playbook's pseudocode imports `requireRole` from `@/lib/auth` — actual location is `@/lib/rbac` (lines 28-36). Will use the correct path.

### Step 1 — DB inspection · COMPLETE (read-only)

Method: temp `_tmp_p3_inspect.mjs` Prisma script with the same safety dance as Prompt 2 Step 0. Verified mutation-free, ran exit 0, deleted. Connection target `aws-1-ap-south-1.pooler.supabase.com:6543` (production pooler).

**1.1 — `ops_admin` role_permissions:**

```json
[ { "id": 1317, "roleSlug": "ops_admin", "pageKey": "attendance", "canView": true, "canExport": true } ]
```

✓ Single row, the wrong-pageKey row from Prompt 2 (will be replaced in Step 5).

**1.2 — pageKey `attendance_admin`:** `[]` ✓ Clean slate.

**1.3 — Dhruv + Kuldeep accounts:**

```json
[
  {"id": 27, "email": "dhruv@orbitoms.com",   "name": "Dhruv",   "roleId": 14, "isActive": true, "attendanceTestUser": true},
  {"id": 28, "email": "kuldeep@orbitoms.com", "name": "Kuldeep", "roleId": 14, "isActive": true, "attendanceTestUser": true}
]
```

✓ Both intact. Safe to proceed.

### Steps 2-4 — code changes · COMPLETE

**Files modified (4 paths, excluding pre-existing WIP):**

| Change | Path |
|---|---|
| Edit | `lib/permissions.ts` — added `attendance_admin` to `PageKey` union (line 120), `ALL_PAGE_KEYS` (line 153), and `PAGE_NAV_MAP` (line 40) with `href: "/admin/attendance"` |
| New file | `app/(ops)/layout.tsx` — mirrors the standard RoleSidebar layout pattern; gates with `roles.some(r => ["admin", "ops_admin"].includes(r))` |
| Rename | `app/(admin)/admin/attendance/page.tsx` → `app/(ops)/admin/attendance/page.tsx` (git-tracked rename, history preserved) |
| Edit | `app/unauthorized/page.tsx` — local `ROLE_HOME` map replaced by `import { ROLE_REDIRECTS } from "@/lib/rbac"`; usage changed from `ROLE_HOME[role]` to `ROLE_REDIRECTS[role]` (same fallback semantics) |

**Verification:**
- `npx tsc --noEmit` — exit 0 (clean)
- `npm run build` — exit 0 (clean). Build output lists `/admin/attendance` exactly once at `5.92 kB / 160 kB`. No duplicates, no missing route.
- `grep -rn ROLE_HOME` (excluding node_modules / .next / docs) — zero hits ✓

**Layout-architecture decision made (slight playbook deviation):**

The new `(ops)` layout uses `RoleSidebar` (not `AdminLayoutClient`) for **both** admin and ops_admin. The playbook's Step 3.2 was contradictory: it said "copy the EXACT pattern from `(admin)/admin/layout.tsx`" but then also said "ops_admin should use the standard RoleSidebar, NOT AdminSidebar." I picked the latter (RoleSidebar) since that was the explicit intent, and made it apply uniformly so admin doesn't get an asymmetric branched experience.

**Implication for admin visiting `/admin/attendance`:** they now see `RoleSidebar` instead of `AdminLayoutClient`. This means:
- Role label renders as `"undefined"` (because `RoleSidebarRole` union doesn't include `"admin"` — pre-existing latent bug from Prompt 1 §B.9).
- Full nav items show (admin gets `ALL_TRUE` permissions via the bypass, so every `PAGE_NAV_MAP` entry passes the canView filter).

This **is** a regression for admin's UX at this one route. The same broken-label behavior already exists if admin visits any of the 8 other RoleSidebar routes (`/tint/manager`, `/operations/support`, etc.), so it's consistent with existing behavior for admin. Filing as separate hygiene: add `"admin"` to `RoleSidebarRole` + `ROLE_LABELS["admin"] = "Admin"`. Out of scope for this hotfix.

### ⚠️ Duplicate-nav issue requires a Smart Flow decision

Step 6.1 of the playbook expects: *"Sidebar shows label 'Operations Admin' + one nav item labeled 'Attendance' linking to /admin/attendance."*

Tracing `buildNavItems(allPerms, "ops_admin", { attendanceTestUser: true, ... })` after Step 5 SQL is run:

1. `attendance` pageKey: the special branch in `buildNavItems` (lib/permissions.ts:75-81) returns `true` because `userFlags.attendanceTestUser === true`. → "Attendance" → `/attendance` shows.
2. `attendance_admin` pageKey: `allPerms.attendance_admin?.canView === true` (after Step 5). → "Attendance" → `/admin/attendance` shows.

Net: Dhruv sees **two** "Attendance" nav items with the same label, different hrefs. Smoke test 6.1 (one item) would fail.

Fix options (none in the playbook):
- (a) Add `if (roleSlug === "ops_admin") return false;` to the attendance pageKey branch in buildNavItems. Suppresses the user-facing /attendance link for ops_admin specifically. Minimal, role-scoped change.
- (b) Use a permission-based suppression: `if (allPerms.attendance_admin?.canView === true) return false;`. Cleaner architecturally, but admin gets `ALL_TRUE` so it'd hide /attendance from admin too (admin's attendance "self-test" link would disappear from RoleSidebar — though admin uses AdminLayoutClient anyway, so this only matters at /admin/attendance where admin now uses RoleSidebar per the layout decision above).
- (c) Differentiate labels (e.g. user-facing "My Check-In" vs supervisor "Attendance"). Bigger UX change, requires updating `PAGE_NAV_MAP`.
- (d) Accept the duplicate, update the smoke test expectation. Ugly UX.

**Recommended: (a)** — smallest surgical change, keeps all existing behavior for non-ops_admin users intact, exact ops_admin scope.

### Step 5 — DB row swap · COMPLETE (Smart Flow ran SQL)

- 5.1: inserted `id=1319, (ops_admin, attendance_admin, canView=true, canExport=true)`
- 5.2: deleted `id=1317, (ops_admin, attendance)`
- 5.3 verified: ops_admin has exactly one role_permissions row, the new `attendance_admin` one

### Step 6 — local smoke · PARTIAL (1 of 4 scriptable, 3 blocked by gate)

Method: Node fetch script (`_tmp_p3_smoke.mjs`, deleted after run) drove NextAuth credentials login + manual cookie/redirect chain.

| Check | Result | Note |
|---|---|---|
| Dhruv credentials login | ✅ session cookie set | |
| Admin credentials login | ✅ session cookie set | |
| 6.5 — `/unauthorized` for Dhruv → "Go to my dashboard" link href | ✅ PASS, points at `/admin/attendance` | Confirms the `ROLE_HOME` → `ROLE_REDIRECTS` centralization works end-to-end |
| 6.1 — Dhruv lands on `/admin/attendance` post-login | ⚠ blocked by attendance gate (see below) | |
| 6.2 — Dhruv → `/admin/users` denied to `/unauthorized` | ⚠ blocked by attendance gate (see below) | |
| 6.3 — Admin sees `AdminLayoutClient` at `/admin/attendance` | ⚠ blocked by attendance gate (see below) | |

**⚠ MDF discrepancy uncovered — flag for tomorrow's session reconciliation:**

Production `attendance_settings.rolloutStage = 'TEST_USERS_ONLY'`. The MDF (`mdf-attendance-rollout-2026-05-09.md`) said this should be `'OFF'` until Prompt 6 explicitly flipped it. Reality: it was already `'TEST_USERS_ONLY'` at the time of this Step 6 smoke, meaning the attendance gate has been **silently active for any user with `attendanceTestUser=true`** since whenever this was set. That includes admin (admin's `attendanceTestUser` appears to be `true` based on smoke behavior — admin login + `/admin/attendance` request gets redirected to `/attendance` for check-in).

Operational impact: scripted smoke can't reach `/admin/attendance` or `/admin/users` without first completing the camera + GPS + photo check-in flow, which a Node script can't simulate. **Hand-off path chosen** per Smart Flow decision: phone test against production after deploy. The phone naturally satisfies the camera/GPS check-in.

This finding does NOT change anything in this prompt's commit. To be reconciled in tomorrow's session.

### Independent structural verification (already done before smoke attempt)

- `tsc --noEmit` after all Step 2-4 edits + suppression + layout branch: ✅ exit 0
- `npm run build`: ✅ exit 0; `/admin/attendance` route registers exactly once
- Source review of `(ops)/layout.tsx` admin branch uses `AdminLayoutClient` (not `RoleSidebar`): ✅ confirmed
- `buildNavItems` ops_admin attendance suppression: ✅ confirmed at lib/permissions.ts:81
- `ROLE_HOME` → `ROLE_REDIRECTS` swap: ✅ zero `ROLE_HOME` refs project-wide
- Route move git-tracked: ✅ rename, history preserved

### Step 7 — commit + push · STAGED, awaiting Smart Flow "go push"

Dev server stopped. Port 3000 free. No DB writes. Working tree on `feat/attendance-feature-complete` with all Step 2-4 + Step 6 changes uncommitted, ready for stage + commit + push to main per the playbook's commit message.

### Step 8 — production smoke (phone)

Pending after push.

---

*Prompt 3 (REVISED) of 6 · Attendance pilot rollout · 2026-05-09 · Execution started 2026-05-10*
