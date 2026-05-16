# Prompt 3 — Middleware Whitelist + Filtered Sidebar for `ops_admin`

**Predecessor:** `code-update-2026-05-09-prompt2-ops-admin-role.md`
**Successor:** Prompt 4 — PC no-camera fallback on `/attendance`
**Status:** Step 1 diagnosis complete · STOPPED for Smart Flow review · ⚠️ DIAGNOSIS CONTRADICTS PROMPT PREMISE — see §"Findings" below

---

## Files read

- `middleware.ts` — full re-read on current branch (`feat/attendance-feature-complete`)
- `lib/permissions.ts` — `buildNavItems`, `PAGE_NAV_MAP`, `ALL_PAGE_KEYS` (already had `attendance` row from Prompt 2)
- `components/shared/role-sidebar.tsx` — `RoleSidebarRole` union, `ROLE_LABELS` (both have `ops_admin` from Prompt 2)
- `auth.config.ts` — JWT shape (no edit expected)
- `lib/rbac.ts` — `ROLES.OPS_ADMIN`, `ROLE_REDIRECTS["ops_admin"] = "/admin/attendance"` (centralized in Prompt 2)
- `app/unauthorized/page.tsx` — confirmed it does NOT auto-redirect; renders an "Access Denied" page with a "Go to my dashboard" link
- `app/(admin)/layout.tsx` — passthrough only (`return <>{children}</>`)
- `app/(admin)/admin/layout.tsx` — **the actual gate** (`requireRole(session, [ROLES.ADMIN])`)
- `app/(admin)/admin/attendance/page.tsx` — comment confirms reliance on parent admin layout's `requireRole`
- `app/attendance/layout.tsx` + `app/attendance/page.tsx` — no role guard, any authenticated user passes

> All files read. Middleware routing identified at lines 22-97 of `middleware.ts`. **Important correction to the prompt's confirmation template:** ops_admin does NOT fall through to a default unauthorized branch *in middleware*, because **middleware doesn't gate by role at all** (other than the dormant `PHASE1_BLOCKED` array and a single inline `role === "admin"` carve-out for the attendance gate). The unauthorized redirect happens **at the layout level**, in `app/(admin)/admin/layout.tsx`. See §"Findings" below.

---

## Step 1 — Diagnosis

### 1.1 Role-routing logic in `middleware.ts`

The full middleware execution order (verbatim from the file, ranges noted):

```ts
// Lines 9-19 — PUBLIC_PATHS bypass
const PUBLIC_PATHS = [
  "/login", "/unauthorized", "/not-ready",
  "/api/auth", "/api/health",
  "/order", "/api/order", "/demo", "/order-demo.html",
];

// Line 20 — Phase 1 guard list (currently empty, dormant)
const PHASE1_BLOCKED: string[] = [];

// Lines 22-97 — middleware function, in order:
// 26-28 — public path bypass
// 32-34 — /api/cron/* bypass (Bearer auth)
// 37-42 — /api/import/obd HMAC carve-out
// 45-47 — /api/mail-orders/ingest HMAC carve-out
// 50-52 — /api/mail-orders/keywords public read
// 55-60 — PHASE1_BLOCKED guard (only redirects non-admin to /not-ready)
// 63-65 — auth check: !req.auth → redirect /login
// 74-94 — attendance gate (orthogonal to role; redirects to /attendance)
// 96    — return NextResponse.next();   ← default fall-through
```

**There is no per-role allowlist or per-role redirect in `middleware.ts`.** The only inline role check anywhere in the file is line 87 — `else if (role === "admin") gateApplies = isTest;` — which is purely about whether the **attendance gate** applies, not whether the role can reach the path.

### 1.2 Default branch when role has no rule

`return NextResponse.next();` at line 96 — every authenticated request that survives the public-path / cron / HMAC / phase-1-guard / auth-check / attendance-gate stack just **passes through**. No 4xx, no `/unauthorized` redirect, nothing. The decision of "is this user allowed on this URL" is delegated entirely to the route's layout / page.

### 1.3 How `ops_admin` flows today (Dhruv visiting `/mail-orders`)

Step-by-step trace, current production code (`ca5a07ef` on `main`):

1. Browser `GET /mail-orders` with valid session cookie (Dhruv, role=`ops_admin`).
2. **Middleware**: not in `PUBLIC_PATHS`, not a cron/HMAC carve-out, `PHASE1_BLOCKED` is empty, `req.auth` is truthy, attendance gate: `rolloutStage` defaults to `"OFF"` so `gateApplies=false`. Falls through to `NextResponse.next()` at line 96. **Middleware passes the request unmodified.**
3. **Route layout** `app/(mail-orders)/mail-orders/layout.tsx` runs server-side. The relevant block (line ~25 from earlier read):
   ```ts
   if (!roles.includes("admin")) {
     const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
     if (!allowed) redirect("/unauthorized");
   }
   ```
4. `roles = ["ops_admin"]` (the multi-role array). `roles.includes("admin")` → false. `checkAnyPermission(["ops_admin"], "mail_orders", "canView")` → DB lookup in `role_permissions` for `(roleSlug='ops_admin', pageKey='mail_orders')`. **No such row.** Returns false.
5. `redirect("/unauthorized")` fires.
6. Browser `GET /unauthorized` → middleware: PUBLIC_PATHS hit at line 11, `NextResponse.next()`.
7. `app/unauthorized/page.tsx` renders an "Access Denied" page with a "Go to my dashboard" link.

The same trace for **`/admin/attendance`** (Dhruv's home route) is more painful:

1-2. Browser `GET /admin/attendance`, middleware passes.
3. `app/(admin)/admin/layout.tsx` runs:
   ```ts
   const session = await auth();
   requireRole(session, [ROLES.ADMIN]);   // ← line 15
   ```
   `requireRole` (from `lib/rbac.ts:28-36`) checks `session.user.roles` for `"admin"`. Dhruv has `["ops_admin"]`. **Rejects.** `redirect("/unauthorized")`.
4-7. Same as above — Dhruv lands on `/unauthorized`.

So Dhruv's **post-login redirect chain in production right now**:

```
POST /api/auth/credentials → JWT issued (role='ops_admin')
  ↓
Browser → /
  ↓ app/page.tsx: ROLE_REDIRECTS['ops_admin'] = '/admin/attendance'
  ↓ redirect('/admin/attendance')
Browser → /admin/attendance
  ↓ middleware: passes (no role gate)
  ↓ app/(admin)/admin/layout.tsx: requireRole([ADMIN]) → reject
  ↓ redirect('/unauthorized')
Browser → /unauthorized
  ↓ static "Access Denied" page renders
```

**Net effect:** Dhruv signs in successfully and lands on `/unauthorized`. Not stranded, not looping server-side, but functionally locked out.

### 1.4 Where the loop actually lives

The prompt says: *"the redirect from `/unauthorized` back to a path the role can't access creates a loop."*

I do not see an automatic server-side loop. `app/unauthorized/page.tsx` lines 16-43 render a static page; no `redirect(...)` call, no client-side navigation on mount. The page contains an `<Link>` to a "home" route resolved via a **third local map**:

```ts
// app/unauthorized/page.tsx:6-14
const ROLE_HOME: Record<string, string> = {
  admin: "/admin",
  dispatcher: "/dispatcher",
  support: "/support",
  tint_manager: "/tint/manager",
  tint_operator: "/tint/operator",
  floor_supervisor: "/warehouse/supervisor",
  picker: "/warehouse/picker",
};
// line 19: const homeHref = role ? (ROLE_HOME[role] ?? "/") : "/login";
```

For `role='ops_admin'`, `ROLE_HOME['ops_admin']` is `undefined` → `homeHref = "/"`. **If the user clicks the link**, they go to `/` → `app/page.tsx` redirects to `/admin/attendance` → `app/(admin)/admin/layout.tsx` rejects → `/unauthorized` again. So there *is* a loop, but it's **user-driven by clicking the dashboard link**, not server-driven.

⚠️ **This is the third role-redirect map I should have caught in Prompt 1 but missed** — my grep was specifically `ROLE_REDIRECTS`; this one is named `ROLE_HOME`. Apologies. It's also missing `operations` and `billing_operator` (separate latent issue from before Dhruv existed).

### 1.5 Path-checking helpers in middleware

All path checks use `pathname.startsWith(...)`. No regex matching, no exact equality comparisons except `pathname === "/api/import/obd"` and `pathname === "/api/mail-orders/ingest"` and `pathname === "/api/mail-orders/keywords"` (specific HMAC/public endpoints — unrelated to role gating). Path patterns used are bare strings like `"/login"`, `"/api/cron/"`, `"/attendance"`, `"/api/attendance"`. Adding a new ops_admin block would naturally use the same `pathname.startsWith()` style.

---

## Findings — ⚠️ Prompt 3's premise needs correction before edits

### Finding 1: Middleware is not the bug site.

The prompt says *"middleware doesn't recognize `ops_admin` so every authenticated path bounces to `/unauthorized`."* That description matches the symptom (Dhruv ends up on `/unauthorized`) but **misidentifies the file responsible**.

- Middleware doesn't gate by role at all — every authenticated request to a non-public, non-carve-out path returns `NextResponse.next()`.
- The `/unauthorized` redirect for Dhruv comes from **`app/(admin)/admin/layout.tsx:15`** (`requireRole(session, [ROLES.ADMIN])`), or from the per-role layouts under `app/(tint)`, `app/(operations)`, `app/(mail-orders)`, etc. that call `checkAnyPermission(roles, <pageKey>, "canView")`.
- Adding the proposed middleware whitelist `if (role === 'ops_admin') { ... return NextResponse.next() }` will **not let Dhruv reach `/admin/attendance`**. Middleware already lets the request through; the layout still rejects. Net: same `/unauthorized` outcome, just via a slightly different code path.

### Finding 2: The actual fix needs to happen in `app/(admin)/admin/layout.tsx`.

Possible approaches (recommendations only — no edits made):

**Option A — Conditional in `app/(admin)/admin/layout.tsx` (smallest change):**

```ts
// Pseudocode, not committed
const session = await auth();
const roles = session?.user?.roles ?? [session?.user?.role].filter(Boolean);
const isAdmin = roles.includes("admin");
const isOpsAdminOnAttendance =
  roles.includes("ops_admin") &&
  pathname.startsWith("/admin/attendance");   // requires pathname access in layout — see headers().get('x-pathname') or middleware passthrough

if (!isAdmin && !isOpsAdminOnAttendance) redirect("/unauthorized");
```

Trade-off: pathname isn't trivially available in a Next.js layout. Has to come via `headers()` after a middleware-set rewrite header, or by checking `next/navigation`'s `usePathname()` in a child server-component. Workable but slightly hacky.

**Option B — Restructure routes (cleaner):**

Move `app/(admin)/admin/attendance/` into a separate route group, e.g. `app/(attendance-admin)/admin/attendance/`. The (admin) parent layout's strict `requireRole([ADMIN])` only protects everything under `(admin)`. The new group has its own layout that allows `[ADMIN, OPS_ADMIN]`. URLs stay identical because route groups are URL-invisible.

Trade-off: file move + a new layout file. Slightly more disruptive but architecturally clean and matches how the rest of the codebase scopes access (per-route-group layouts).

**Option C — Replace `requireRole` with `checkAnyPermission`:**

Introduce a `pageKey="admin_attendance"` (or reuse `attendance`) and gate `app/(admin)/admin/attendance/page.tsx` on it; ensure both `admin` and `ops_admin` have the row. Doesn't help with the parent `(admin)` layout's `requireRole` though — would still need to weaken it to allow ops_admin OR move the page out of the (admin) group.

**My recommendation: Option B.** It's the most consistent with the rest of the codebase and avoids the headers-pathname hack.

### Finding 3: The middleware whitelist the prompt proposes IS still useful — for a different purpose.

The prompt's middleware change has independent value: **defending against ops_admin accidentally landing on a path the layout would reject and getting stuck on `/unauthorized`.** A middleware-level "if role is ops_admin and the path isn't in `[/admin/attendance, /attendance]`, redirect to `/admin/attendance`" rule short-circuits the user-driven loop in §1.4 and gives a clean "go home" UX.

So the proposed middleware change is good belt-and-suspenders — but it is **not sufficient by itself**. The layout fix is the load-bearing piece.

### Finding 4: Sidebar verification (Step 3 of the prompt, doing it inline since it's read-only)

`buildNavItems(allPerms, "ops_admin", userFlags)` (lib/permissions.ts:64-89) trace:

- It iterates `PAGE_NAV_MAP` (the array of nav config objects).
- For each item, if `item.pageKey === "attendance"`, it returns `true` for admin or for users where `userFlags.attendanceTestUser === true || userFlags.rolloutStage === "ALL_USERS"` (lines 74-81). Dhruv has `attendanceTestUser=true`, so this branch returns `true`.
- For all other items, it checks `allPerms[item.pageKey]?.canView === true`. Dhruv's `allPerms` only has the `attendance` row, so every other key is `false` → filtered out.

Now, `PAGE_NAV_MAP` (lib/permissions.ts:17-40) entry for attendance:

```ts
{ pageKey: "attendance", label: "Attendance", href: "/attendance" },
```

⚠️ **The href is `/attendance`** (the user-facing check-in flow), **not `/admin/attendance`** (the supervisor dashboard).

This means: Dhruv's sidebar nav item "Attendance" links to `/attendance` — the user-facing check-in screen — **not the supervisor view at `/admin/attendance`**. Per the prompt's Step 3.3, this is exactly the situation that says "STOP and ask. This may need a new nav key (`attendance_admin`) or a conditional href."

So sidebar wiring needs Smart Flow's call before any code change. Two options:
- (a) Add a new `pageKey: "attendance_admin"` to `PAGE_NAV_MAP` with `href: "/admin/attendance"`, label "Attendance", and gate visibility on the role being `ops_admin` or `admin`.
- (b) Make the existing `attendance` nav item's href conditional on role: `/admin/attendance` for ops_admin/admin, `/attendance` for everyone else. Less clean — leaks role logic into nav config.

### Finding 5: Recap of the redirect-map count (now four maps)

| File | Map name | Has ops_admin? | Notes |
|---|---|---|---|
| `lib/rbac.ts:21` | `ROLE_REDIRECTS` | ✅ | Centralized in Prompt 2 |
| `app/page.tsx` | (imports above) | ✅ | |
| `app/login/page.tsx` | (imports above) | ✅ | |
| `app/unauthorized/page.tsx:6-14` | `ROLE_HOME` | ❌ | Local, also missing `operations`, `billing_operator` |

This is the third map I missed in Prompt 1's grep. Centralizing it (point it at the same `ROLE_REDIRECTS` from `lib/rbac.ts`) is a small additional fix worth folding into Prompt 3 or doing as a one-line follow-up.

---

## Recommended path forward (no edits made — for Smart Flow's call)

1. **Layout-level fix (mandatory)**: implement Option B — move `app/(admin)/admin/attendance/` into a new route group `app/(attendance-admin)/admin/attendance/` with a layout that allows `[ROLES.ADMIN, ROLES.OPS_ADMIN]`. URL stays `/admin/attendance`. This is the actual unblock for Dhruv + Kuldeep.
2. **Sidebar fix (mandatory)**: decide between Option (a) new `attendance_admin` pageKey vs Option (b) conditional href. Insert a `role_permissions` row for ops_admin on the new key (if Option a) or just rely on existing infrastructure (if Option b).
3. **Middleware whitelist (defense-in-depth, lower priority)**: still worth adding — short-circuits the user-driven loop on `/unauthorized`. Implement as the prompt describes once the layout fix is in.
4. **`app/unauthorized/page.tsx` `ROLE_HOME` map**: fold into the centralized `ROLE_REDIRECTS` from `lib/rbac.ts` (one-line import swap, mirror Prompt 2 Step 1). Closes the "Go to my dashboard" loop for any role missing from this map.

---

## STOPPED — awaiting Smart Flow review

No edits to any source file in this turn. Working tree on `feat/attendance-feature-complete` is unchanged apart from this draft markdown.

Specifically need your call on:
1. **Layout fix approach**: Option A (conditional in (admin)/admin/layout.tsx using headers()-pathname), Option B (route group move), or Option C (permission-table extension)?
2. **Sidebar nav**: new `attendance_admin` pageKey (Option a) or conditional href (Option b)?
3. **Middleware whitelist**: still want it as defense-in-depth on top of the layout fix, or skip since the layout fix renders it redundant?
4. **`ROLE_HOME` cleanup**: fold into this prompt's commit, or defer to a separate hygiene PR?
5. **Production urgency**: do you want a hotfix to land tonight (Dhruv + Kuldeep are stranded right now), or can this wait for the morning when you'll have more time to verify on phone?

---

*Prompt 3 of 6 · Attendance pilot rollout · 2026-05-09 · Step 1 complete · Diagnosis contradicts prompt premise — awaiting decisions before edit*
