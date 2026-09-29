# Code plan — 2026-09-29 — the access notebook (supersedes the 60 s-only plan)

**Supersedes** `docs/prompts/drafts/code-plan-2026-09-29-auth-request-cost.md` (kept on disk). That plan cached only the jwt refresh data for 60 s and left the page-tick read per request; it was **replaced because it kept ~1 query per request, kept tick changes immediate only by paying that read, and could not make deactivation take effect mid-session** — the owner wants all three solved together with a single "access changed" signal.

**Mode:** PLAN ONLY. No code changed, no commit, no database query.
**All files read:** the superseded plan (whole) · `code-discovery-2026-09-29-disk-io.md` §C · CORE v113 §3, §5 (whole), §7.13, §7.14, §7.15, §13 · ATTENDANCE v1.4 §3–§4 · `lib/auth.ts`, `auth.config.ts`, `middleware.ts`, `lib/permissions.ts`, `lib/rbac.ts`, `lib/access/source.ts`, `lib/access/role-baseline.ts`, `lib/audit/log.ts` · `app/api/admin/access/[userId]/route.ts`, `app/(admin)/admin/access/page.tsx`, `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`, `app/api/admin/permissions/route.ts`, `app/api/admin/system-config/route.ts`, `components/admin/system-config-form.tsx`, `app/api/admin/attendance/settings/route.ts`, `app/api/attendance/consent/route.ts`, `app/api/user/notes-font-size/route.ts` · `node_modules/next-auth/lib/index.js` (5.0.0-beta.30), `node_modules/@auth/core/lib/actions/session.js` (0.41.1), `node_modules/next/dist/compiled/react/cjs/react.react-server.development.js`.
✅ = re-read in code for this plan.

---

## The design in one paragraph

Each server instance keeps a small **notebook**: per user, one **bundle** (their flags + all their page ticks), plus one global copy of `attendance_settings` and (for role mode) the role-permission rows. Every `auth()` and every permission check reads the notebook instead of the database. A single shared **access version** number, stored in `system_config` and **bumped by database triggers on every access table** (so the app, the SQL Editor and any future writer are all covered in the same transaction), is re-read with the existing 30 s `ACCESS_SOURCE` read; when it moves, the instance throws its notebook away. Entries also expire after 12 h. When a bundle says `isActive = false`, the jwt callback returns `null` and the user is signed out on their next request. A `system_config` switch `ACCESS_CACHE` turns it all off without a deploy.

### Validation of the owner's design — what I changed
1. **The bump is a database trigger, not app code** (the owner's list of writers stays as the checklist it must cover). An app-side bump can fail *after* the write succeeds and the change would then wait up to 12 h; a trigger commits in the same transaction as the write, catches SQL-Editor edits automatically, and catches writers nobody has written yet. The manual lever stays, for anything else.
2. **The bundle tag is the version known BEFORE the bundle read**, never after (§E race). Otherwise an entry can carry new-version tag and old data.
3. **Missing version / failed version read → entries trusted for 30 s only**, never the 12 h backstop (§C).
4. **`ACCESS_CACHE` is ON only for the exact string `on`**, mirroring `ACCESS_SOURCE`; missing/invalid → OFF (today's code path) (§F.6).
5. **Roles are NOT refreshed mid-session** (they are frozen at sign-in today — `lib/auth.ts:217-221` ✅ and nothing re-reads them) — unless the owner decides otherwise (decision 5). Keeps the admin role arm exactly as it is.

---

## A. Every place access is decided

| Decider | File | Today's DB reads | Reads the notebook after? |
|---|---|---|---|
| jwt callback, refresh branch | `lib/auth.ts:149-181` ✅ | `users` flags + `attendance_settings` (+ `attendance_records`) whenever `rolloutStageStaleAt` has passed — i.e. every call after minute 5 (superseded plan §A) | **yes** — flags, `isActive` (new), global settings |
| jwt callback, sign-in branch | `lib/auth.ts:122-147` | fresh reads | no — stays fresh; **seeds** the notebook |
| jwt callback, `update()` branch | `lib/auth.ts:100-119` | consent version + last check-in | no — stays fresh; **invalidates** that user's entry on this instance |
| `authorize` (Credentials) | `lib/auth.ts:191-231` | user + roles + `isActive` + bcrypt | no — unchanged |
| `sessionAccess()` (second `auth()`) | `lib/permissions.ts:669-686` | = a full refresh branch run | via `auth()` → notebook → 0 queries |
| `userModeId` → `getAccessSource()` | `lib/permissions.ts:691-697`, `lib/access/source.ts:50-73` | `system_config` ≤ 1 / 30 s / instance | **same read, now three keys** (§C) |
| `userPagePerms` / `userAllPerms` (user mode) | `lib/permissions.ts:700-740` | `user_page_access` 1 per check | **yes** — bundle page map |
| role path of `checkPermission` / `checkAnyPermission` / `getPagePermissions` / `getAllPermissionsForRole(s)` (`ACCESS_SOURCE ≠ user`) | `lib/permissions.ts:815`, `:843`, `:866`, `:899`, `mergeRolePerms :747` | `role_permissions` 1 per check | **yes** — global role-rows cache in the notebook |
| `getRolePermissionsForRoles` (the `/admin/access` baseline, switch-independent) | `lib/permissions.ts:786-795` | `role_permissions` | **no** — admin screen, keep it live |
| `requireRole`, `isSuperuser`, `requireSuperuser` | `lib/rbac.ts:58-66`, `:104-111`, `:125` | none (read the session) | unchanged; they see the refreshed `isSuperuser` claim |

**Call sites that change outside `lib/`: none of the existing ones.** The 238 resolver call sites (189 files) and 337 `await auth()` sites are untouched. New files outside `lib/` are only the manual lever (one new route, one button) — §F.

---

## B. Writers that must bump the version

Swept ✅ with a Prisma write pattern across `app lib scripts prisma` + SQL files. **Mechanism for every row below: a statement-level AFTER trigger on the table** (§F.2) — no edit to these routes is needed for the bump itself. The "where the bump goes" column records what the trigger covers, so the list doubles as the test checklist.

| # | Table | Writer (file:line) | What it writes | Access effect | Covered by |
|---|---|---|---|---|---|
| 1 | `user_page_access` | `app/api/admin/access/[userId]/route.ts:141` ✅ (upsert per moved page; audit `:163`) | ticks | direct | trigger on `user_page_access` |
| 2 | `user_page_access` | SQL grant files (`sql/2026-09-04-user-page-access.sql:169`, `2026-09-11-billing-action-ticks:75`, `2026-09-15-slice9-print-tab:141`, `2026-09-17-tint-panel-tabs:31`, `2026-09-17-report-ticks:31`, `2026-09-22-billing-telephonic:174`, `2026-09-24-billing-hand-ci-grants:85,102`) | bulk ticks | direct | same trigger (SQL Editor) |
| 3 | `users` | `app/api/admin/users/[id]/route.ts:71` ✅ PATCH (name, email, **roleId**, **isActive**, password) | flags | isActive → deactivation; roleId → only at next sign-in (roles frozen) | trigger on `users` **column list** (§F.2) |
| 4 | `users` | `app/api/admin/users/route.ts:56` ✅ POST create | new user | none until sign-in (first request reads fresh anyway) | trigger (INSERT) — harmless |
| 5 | `users` | `app/api/attendance/consent/route.ts:30` ✅ (`attendanceConsentVersion`, self) | consent claim | claim read by no page (ATTENDANCE §4) | trigger column list includes it (keeps bundles honest) |
| 6 | `users` | `app/api/user/notes-font-size/route.ts:63` (display preference) | none | none | **excluded** by the column list |
| 7 | `users` | `isSuperuser` / `attendanceTestUser` / `attendanceExempt` — **no app writer** (SQL Editor only; the PATCH schema `:11-17` ✅ has none of them) | flags | superuser arm; sidebar link | trigger column list |
| 8 | `users` | `scripts/fix-admin-password.ts:17`, `prisma/seed.ts:593` | password / seed | none / reseed | trigger fires; harmless |
| 9 | `role_permissions` | `app/api/admin/permissions/route.ts:85` ✅ (upsert batch inside `$transaction`) | role grants | role mode only (`ACCESS_SOURCE='role'`) + the `/admin/access` baseline | trigger on `role_permissions` |
| 10 | `role_permissions` | SQL files (`db/migrations/operation_manager_role.sql:37`, `sql/2026-08-31-ci-module.sql:354`, `2026-09-15-slice9:109`, `2026-09-17-tint-panel-tabs:49`, `2026-09-17-report-ticks:51`), `prisma/seed.ts:280` | role grants | role mode | same trigger |
| 11 | `user_roles` | **no in-repo writer** — SQL Editor only | extra roles | at next sign-in (frozen roles) | trigger on `user_roles` (cheap; future-proof for decision 5) |
| 12 | `attendance_settings` | `app/api/admin/attendance/settings/route.ts:362` ✅ (always writes, even unchanged) | `rolloutStage` etc. | sidebar Attendance link | trigger on `attendance_settings` |
| 13 | `system_config` | `app/api/admin/system-config/route.ts:58` ✅ (whitelisted keys only — the form sends `CONFIG_META` keys, `system-config-form.tsx:136-142,167` ✅) | timing/planning keys | none for access; `ACCESS_SOURCE`/`ACCESS_CACHE` are picked up by the 30 s read itself | **no trigger** (would recurse on the version row); hardening: refuse `ACCESS_*` keys in this route (decision 7) |
| 14 | `role_master` | seed only | role names (slug derivation at sign-in) | next sign-in | not bumped (frozen roles) |

**Bypassing Next.js:** rows 2, 7, 10, 11 and every hand edit in the SQL Editor — all covered because the bump is a trigger. The documented one-line SQL (§F.4) remains for a change made *outside* these tables that should still reset caches (e.g. a data fix to a joined table).
**Audit interaction:** triggers do not touch `admin_audit_log`; `logAdminAction` stays where it is, after the write. The manual lever writes its own audit line (entity `access_version`, action `bump`).

---

## C. The version read

- **Storage: `system_config` key `ACCESS_VERSION`** (text holding an integer). Reasons: `getAccessSource()` already reads `system_config` every 30 s, so one `findMany({ where: { key: { in: ["ACCESS_SOURCE","ACCESS_VERSION","ACCESS_CACHE"] } } })` replaces the existing single-key read at no extra cost; no schema change; the System Config form cannot overwrite it (whitelist, ✅ above). A new table would add a second read and a migration for no gain.
- **Bump (trigger body):** `UPDATE system_config SET value = (CASE WHEN value ~ '^[0-9]+$' THEN value::bigint + 1 ELSE 1 END)::text WHERE key = 'ACCESS_VERSION';` — atomic, monotonic, tolerant of a hand-mangled value. Missing row → updates 0 rows, no error.
- **Combined with `getAccessSource`:** `lib/access/source.ts` gains `getAccessState()` returning `{ source, version, cacheOn, readAt, ok }` from the one read; `getAccessSource()` becomes `(await getAccessState()).source` with **byte-identical semantics** (only exact `user` → user mode; missing row / error → `role`; an error caches the safe answer for the TTL). TTL stays 30 s.
- **Validity rule for a notebook entry:** valid iff `state.ok && state.version !== null && entry.version === state.version && age < 12 h`, **or** (version unknown — row missing or read failed) `age < 30 s`. Unknown version never extends trust beyond 30 s.
- **On version change** (`state.version !== notebook.version`): drop every entry on this instance (users, settings, role rows) before answering.
- **Read failure:** source → `role` (today's rule); version → unknown (30 s trust); cache switch → **keep this instance's last successfully read value**; if none ever read → OFF. Rationale: flipping to OFF on a DB error would multiply DB reads at the worst moment; keeping the last value is neither widening access (entries still expire in 30 s) nor surprising.
- **First-time missing row** (deploy before the §K SQL): `ACCESS_CACHE` missing → OFF → today's behaviour exactly. Safe deploy order either way.

---

## D. Deactivation mid-session

**Mechanism (✅ from source):** in the refresh branch, when the notebook bundle reports `isActive === false` (or the user row is gone), the Node jwt callback **returns `null`**. `@auth/core/lib/actions/session.js:33-54` then leaves `response.body = null` and pushes cookie-clearing headers; a bare `auth()` returns that body (`next-auth/lib/index.js:89-91`) → **`auth()` returns `null`**.

**What the user sees:** every layout does `if (!session?.user) redirect("/login")` → their next page navigation lands on `/login`; API calls return 401 (routes' existing `if (!session?.user)` checks) → open boards show the offline chip and actions fail; signing in again is refused by `authorize` (`lib/auth.ts:210` ✅, unchanged).

**Edge middleware:** still sees a structurally valid cookie (its jwt callback does not know `isActive`) and lets requests through to Node, where `auth()` is `null`. The cookie itself is not cleared by a bare `auth()` (the clearing headers are discarded, same mechanism as §A of the superseded plan); it is harmless and is replaced at the next successful sign-in or expiry. Optional later: a client-side "401 → go to /login" handler.

**Timing:** within ≤ 30 s of the save (version poll) + the user's next request.
**Safety:** self-deactivation is already refused (`users/[id]/route.ts` ✅ "You cannot deactivate your own account"). A failed bundle read never deactivates anyone (§E). The two-arm superuser rule is untouched, but note: deactivation ends the session of **anyone**, admin role included — that is the intent of `isActive`.

**Residual (pre-existing, not widened):** four API routes never call `auth()` and are reachable with any cookie — all read-only GETs: `app/api/admin/skus/[id]/sub-skus` (GET/POST stubs), `app/api/place-order/data`, `…/quick-tiles`, `…/last-order/[customerCode]`, `app/api/system-config/slot-cutoffs` ✅. A deactivated user's old cookie still reaches those, exactly as any stale cookie does today.

---

## E. Holes (adversarial)

| Hole | Closed? | How |
|---|---|---|
| Bump fails after the write | **closed** | trigger in the same transaction; decision 4 chooses whether a failing bump fails the access write (recommended) or is swallowed |
| SQL Editor edits | **closed** | triggers |
| Race: bundle read overlaps an admin save | **closed** | tag = version known *before* the read; bump happens *after* the write commits → an entry can only be older-tagged than its data, never newer |
| Version read during a Supabase slowdown | closed | 30 s cache; on error, 30 s trust window; source falls to `role` exactly as today |
| **Flags read fails in the jwt callback** | **decision 3** | today a thrown DB error inside the jwt callback makes `auth()` return `null` (`session.js:56-59` ✅) — **users are bounced to /login during DB trouble** (the 2026-09-29 log's `/login` and `/api/auth/callback` errors fit this). Recommended: on a failed bundle read, keep the token's own claims (as the first 5 minutes of a session do today), log, and do not cache; never deactivate on a failure |
| Page-tick read fails (user mode) | closed | propagate the error exactly as today (route 500) — no trust extended, no silent all-true |
| Owner lockout | **closed** | admin role arm is checked before any notebook read (`lib/permissions.ts:803/829/856/885/927` ✅) and comes from the token, not the bundle; `ACCESS_CACHE=off` restores today; the owner's own `isActive` cannot be cleared by himself |
| Absent `user_page_access` row ≡ all false | closed | bundle map built from `findMany({ where: { userId } })`; lookups default to `ALL_FALSE`; `userAllPerms` shape stays undensified |
| Role mode (`ACCESS_SOURCE='role'`) | closed | role rows cached per sorted slug set in the notebook; `role_permissions` trigger bumps |
| Multi-role users | closed | user mode: one row per page (no merge), as today; role mode: OR-merge unchanged, cached by slug set |
| User with no rows | closed | empty map → all false |
| User created mid-day | closed | no entry → first request builds it |
| Two admins saving at once | closed | each statement bumps; atomic increment; any change drops notebooks |
| Clock skew | closed | only same-instance `Date.now()` differences; the version is a counter |
| Memory | closed | ~39 users × ~40 rows; cap at 1,000 entries, drop oldest |
| Cold starts | closed | empty notebook → reads on demand |
| Version goes backwards (hand reset) | closed | comparison is `!==`, not `>` |
| `ACCESS_*` written via the System Config API directly | decision 7 | route accepts any existing key; harden to refuse `ACCESS_*` |
| Role change mid-session | **open by design** | roles stay frozen until sign-in (today's behaviour); decision 5 |
| Password reset does not end other sessions | open (today's behaviour) | out of scope; decision 6 |
| Deactivated user reaching the 4 auth-less read-only routes | open (pre-existing) | §D residual |
| Instance that never serves a request keeps an old notebook | harmless | validity is checked at use; a waking instance reads the version first |

---

## F. The plan

### F.1 New: `lib/access/notebook.ts` (Node-only; imported by `lib/auth.ts` and `lib/permissions.ts`, never by `auth.config.ts` / `middleware.ts`)
- Module-scope state: `version`, `users: Map<userId, { flags, pages: Map<pageKey, PagePermissions>, tag, at }>`, `settings: { rolloutStage, tag, at } | null`, `rolePerms: Map<slugKey, { rows, tag, at }>`; in-flight de-dupe `Map<userId, Promise>`.
- `getUserBundle(userId)`: validity per §C → else read **`users.findUnique`** (`isActive`, `isSuperuser`, `attendanceTestUser`, `attendanceExempt`, `attendanceConsentVersion`) + **`user_page_access.findMany({ where: { userId } })`** (all keys) — sequential awaits, no `$transaction`; tag with the version known before the reads.
- `getGlobalSettings()`, `getRolePerms(slugs)`: same validity.
- `invalidateUser(userId)`, `dropAll()`; `MAX_AGE_MS = 12 h`, `UNKNOWN_VERSION_TTL_MS = 30 s`, `MAX_ENTRIES = 1000`.
- Injected clock + fetchers for tests.

### F.2 SQL (Smart Flow, §K): the bump trigger
One function `bump_access_version()` (statement-level, `RETURNS trigger`, the §C UPDATE) and triggers:
- `user_page_access` AFTER INSERT OR UPDATE OR DELETE FOR EACH STATEMENT
- `role_permissions`, `user_roles`, `attendance_settings` — same
- `users` AFTER INSERT OR DELETE FOR EACH STATEMENT, and AFTER UPDATE **OF** `"isActive","isSuperuser","roleId","attendanceTestUser","attendanceExempt","attendanceConsentVersion"` FOR EACH STATEMENT (excludes name/email/password/notes-font-size)
(Statement-level with no transition tables, so multi-event and column lists are both allowed — confirm on the live PG version, §K.)

### F.3 `lib/access/source.ts`
Add `getAccessState()` (one 3-key read, 30 s) and keep `getAccessSource()` as a thin wrapper with identical semantics; `clearAccessSourceCache()` also clears the state. Export `ACCESS_STATE_TTL_MS`.

### F.4 `lib/auth.ts`
- Refresh branch: if `state.cacheOn` → **skip the `rolloutStageStaleAt` gate** (the check is now a memory read, and deactivation must not wait for minute 5) → `getUserBundle` + `getGlobalSettings` → apply the same claims as today (`rolloutStage`, `attendanceTestUser`, `attendanceExempt`, `attendanceConsentVersion`, `isSuperuser`) → **if `isActive === false` or no user row → `return null`**. `lastCheckInDate`: in notebook mode, do not re-read on refresh (claim is read by nothing — ATTENDANCE §3; it keeps its sign-in/`update()` value) — decision 8. On a thrown bundle read → decision 3 behaviour.
- If `cacheOn` is false → **today's code path, unchanged byte for byte.**
- `update()` branch: unchanged reads + `invalidateUser(userId)`.
- Sign-in branch: unchanged fresh reads; seed the notebook.
- Comment fixes: `:17-20` (stale-window description), `:70` ("Mirror of the middleware gate" — no such gate since `236f9743`).

### F.5 `lib/permissions.ts`
- `userPagePerms` / `userAllPerms`: when `cacheOn`, read the bundle map (absent key → `ALL_FALSE`; `userAllPerms` returns only stored keys, as today); else today's queries.
- Role path in `checkPermission`, `checkAnyPermission`, `getPagePermissions`, `getAllPermissionsForRole`, `mergeRolePerms`: when `cacheOn`, `getRolePerms(slugs)`; else today's queries.
- **Untouched:** every role-arm `if (… "admin") return …` line, `sessionAccess`, `userModeId`'s logic, `getRolePermissionsForRoles` (baseline stays live), all signatures.

### F.6 Kill switch `ACCESS_CACHE`
Exact `on` (trimmed, lower-cased) → notebook on. Missing / anything else → **off** = today's per-request reads. Read error → last known value for this instance, else off (§C). Justification: the same "only the exact new value turns the new thing on" rule as `ACCESS_SOURCE` (CORE §5); a deploy before the SQL is a no-op; and switching off is one `UPDATE` that lands within 30 s.

### F.7 Manual lever
- `POST /api/admin/access/apply` — `requireSuperuser`; runs the same bump UPDATE via `$executeRaw`; `logAdminAction({ entity: "access_version", action: "bump", summary: "Apply access changes now" })`; returns the new version. `dynamic = "force-dynamic"`.
- UI: one secondary button **"Apply access changes now"** in the `/admin/access` header (the `access-manager` component), neutral/secondary style per `CLAUDE_UI.md` tokens (not the filled brand button), with a one-line helper "Changes reach every screen within about 30 seconds." and a toast "Access changes sent — every screen within 30 s."
- SQL Editor line (runbook): `UPDATE system_config SET value = (CASE WHEN value ~ '^[0-9]+$' THEN value::bigint + 1 ELSE 1 END)::text WHERE key = 'ACCESS_VERSION';`

### F.8 Order of edits
1. §K SQL (rows + trigger function + triggers) — safe before any deploy: nothing reads the version yet and `ACCESS_CACHE` can be inserted as `off` first.
2. `lib/access/notebook.ts` + tests.
3. `lib/access/source.ts` (`getAccessState`).
4. `lib/permissions.ts` resolvers.
5. `lib/auth.ts` refresh/update/sign-in branches + comments.
6. Manual lever route + button.
7. `tsc --noEmit`, build, unit tests → deploy with `ACCESS_CACHE='off'` → flip to `on` → hand tests (§I).

### F.9 Canon to update after it ships
CORE §5 ("A flag change lands within ~5 minutes" → ~30 s; "To cut access NOW, set `isActive = false` — checked at sign-in, not cached" → now ends sessions within ~30 s; the `ACCESS_VERSION` / `ACCESS_CACHE` keys and the panic lines next to `ACCESS_SOURCE`); CORE §13 (landmine: "an access table without the bump trigger is invisible for up to 12 h"); CORE §7.14 (triggers); ATTENDANCE §3 stale-window paragraph; `auth.config.ts:37-39` comment; the disk-io draft §H items 7–8 resolved.

---

## G. Timing — every access-related change

| Change | Today | After (notebook ON) |
|---|---|---|
| Tick added/removed on `/admin/access` | immediate (next request) | **≤ ~30 s** — slower |
| Tick change via SQL Editor | immediate | **≤ ~30 s** |
| `isActive = false` | **never mid-session**; blocks next sign-in | **≤ ~30 s mid-session** + blocks sign-in |
| `isActive = true` (reactivate) | next sign-in | next sign-in (unchanged) |
| `isSuperuser` grant/revoke (SQL) | immediate for sessions > 5 min old, ≤ 5 min otherwise | **≤ ~30 s** |
| Attendance `rolloutStage` / `attendanceTestUser` (sidebar link) | same as superuser | **≤ ~30 s** |
| `attendanceConsentVersion` claim | same (claim unread) | ≤ ~30 s (claim unread) |
| Primary role (`roleId`) / `user_roles` | next sign-in | next sign-in (unchanged; decision 5) |
| `role_permissions` (only matters in role mode / baseline view) | immediate | **≤ ~30 s** (baseline view stays immediate) |
| `ACCESS_SOURCE` flip | ≤ 30 s | ≤ 30 s (unchanged) |
| `ACCESS_CACHE` flip | — | ≤ 30 s |
| Password reset | does not end sessions | unchanged |
| Manual lever / SQL bump | — | ≤ ~30 s |
| Version row missing or unreadable | — | entries re-read every ≤ 30 s |

---

## H. Load (ESTIMATES — arithmetic shown)

**Per request (non-admin, user mode, warm instance):** today 5–7 queries (superseded plan §A.2) → **0** (both `auth()`s and the tick check are memory; the 3-key `system_config` read is the existing ≤ 1 per 30 s per instance).
**Per page render (`/floor`):** today ~15–22 → **0**.

**Per active user per day:** a desk user with one board open ≈ 720 API requests/h (Floor: marker 240 + 4 feeds × 120) + page loads, over 10 h ≈ **7,000 requests** → today 7,000 × 6 ≈ **42,000 queries**. After: bundle builds only on cold instance / version change / 12 h expiry — say ~10 warm instances × (1 + ~5 version bumps/day) ≈ 60 builds × 2 queries ≈ **~120 queries**, plus global settings/role rows once per instance per version (~60).
**Per company per day (~25 active users):** today ≈ 25 × 42,000 ≈ **~1,000,000** (consistent with the disk-io report's ~75,000/h auth share × 12 h ≈ 900,000). After ≈ 25 × 180 ≈ **~4,500** + the existing `system_config` read (≤ 1,200/instance/10 h serving, ~10 instances ≈ ≤ 12,000) ≈ **~16,500/day**. The `system_config` read already exists today; it only gains two keys.

---

## I. Tests

### I.1 Unit (`lib/access/notebook.test.ts`, `tsx --test`)
1. Hit with same version and age < 12 h → no fetch.
2. Version change → all entries dropped; next call fetches.
3. Age ≥ 12 h → refetch even with same version.
4. Version unknown (missing/error) → entry valid < 30 s, refetched after.
5. Tag uses the version known before the read (simulate a bump during the read → entry dropped at next check).
6. Concurrent calls share one fetch; a thrown fetch caches nothing.
7. Absent page key → `ALL_FALSE`; `userAllPerms` shape = stored keys only.
8. Role rows cached per sorted slug set; version change drops them.
9. Kill switch: `on` → notebook; `off`/missing/`ON `/garbage → today's path; read error keeps last value.
10. `isActive=false` bundle → jwt refresh returns `null`; thrown bundle read → token unchanged, not cached.
11. Cap at 1,000 entries.

### I.2 Build gates
`npx tsc --noEmit`; `npm run build` (proves nothing Node-only reached the middleware bundle); diff review: every role-arm line in `lib/permissions.ts` unchanged.

### I.3 Hand tests (Smart Flow; Claude Code cannot log in) — deploy with `ACCESS_CACHE='off'`, then flip to `on`
1. **Admin** (email): `/admin`, `/floor`, `/admin/access` load; sidebar complete.
2. **Admin phone login**: sign out, sign in with the 10-digit phone → home route.
3. **Normal user**: same pages/tabs/actions as before; a page without a tick → `/unauthorized`.
4. **Tick remove mid-session**: user 3 on a billing tab; remove that tick on `/admin/access`; note the time; reload user 3 every 10 s → tab disappears **within ~30 s**. Re-add → returns within ~30 s. (Today: immediate — expected slower.)
5. **Manual lever**: remove a tick via the SQL Editor *without* the trigger (only if testing the lever on a scratch key) — or simply press "Apply access changes now" and confirm a version bump in `system_config`; toast shows.
6. **Deactivate mid-session**: test user signed in on `/floor`; set `isActive=false` in `/admin/users`; within ~30 s their next click lands on `/login`; sign-in refused. Reactivate → can sign in.
7. **Superuser grant/revoke — TEST ACCOUNT ONLY, never the owner**: grant via SQL; within ~30 s the test user reaches a superuser page; revoke; within ~30 s refused.
8. **Attendance link**: under `TEST_USERS_ONLY`, toggle `attendanceTestUser` on a test user → sidebar link appears/disappears within ~30 s; consent + check-in still work.
9. **Kill switch**: set `ACCESS_CACHE='off'` → within 30 s tick changes are immediate again (test 4 repeats instantly); set `'on'` → back to ~30 s.
10. **Floor/Picking/Billing smoke**: markers keep working; connection chip online.

---

## J. Measurement and rollback

**Read-only, before the flip and 24 h after (compare deltas; do NOT run `pg_stat_statements_reset()` — it is a write and erases the evidence):**
```sql
-- read-only
SELECT calls, round(total_exec_time::numeric, 1) AS total_ms, left(query, 160) AS query
FROM pg_stat_statements
WHERE query ILIKE '%"attendanceTestUser"%'
   OR query ILIKE '%FROM "public"."attendance_settings"%'
   OR query ILIKE '%FROM "public"."attendance_records"%'
   OR query ILIKE '%FROM "public"."user_page_access"%'
   OR query ILIKE '%FROM "public"."role_permissions"%'
   OR query ILIKE '%FROM "public"."system_config"%'
ORDER BY calls DESC;
```
Expected: `users` flags, `attendance_settings`, `attendance_records`, `user_page_access` call growth falls by ~99 %; `system_config` unchanged.

**Rollback, in order of speed:**
1. `UPDATE system_config SET value = 'off' WHERE key = 'ACCESS_CACHE';` — today's behaviour within 30 s, no deploy.
2. `git revert` the code commit and push.
3. Triggers may stay (they only bump a number); to remove: `DROP TRIGGER … ON <table>;` per table, `DROP FUNCTION bump_access_version();`.
After any rollback: hand tests I.3 1, 3, 4 (expect immediate tick changes again).

---

## K. SQL for Smart Flow — before deploy (one block, no BEGIN/COMMIT)

```sql
-- 1. Keys (cache starts OFF; flip to 'on' after the deploy is verified)
INSERT INTO system_config (key, value) VALUES ('ACCESS_VERSION', '1')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO system_config (key, value) VALUES ('ACCESS_CACHE', 'off')
  ON CONFLICT (key) DO NOTHING;

-- 2. The bump function
CREATE OR REPLACE FUNCTION bump_access_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE system_config
     SET value = (CASE WHEN value ~ '^[0-9]+$' THEN value::bigint + 1 ELSE 1 END)::text
   WHERE key = 'ACCESS_VERSION';
  RETURN NULL;
END $$;

-- 3. Triggers (statement-level)
CREATE TRIGGER trg_access_version_upa   AFTER INSERT OR UPDATE OR DELETE ON user_page_access   FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();
CREATE TRIGGER trg_access_version_rp    AFTER INSERT OR UPDATE OR DELETE ON role_permissions   FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();
CREATE TRIGGER trg_access_version_ur    AFTER INSERT OR UPDATE OR DELETE ON user_roles         FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();
CREATE TRIGGER trg_access_version_as    AFTER INSERT OR UPDATE OR DELETE ON attendance_settings FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();
CREATE TRIGGER trg_access_version_u_id  AFTER INSERT OR DELETE ON users FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();
CREATE TRIGGER trg_access_version_u_upd AFTER UPDATE OF "isActive","isSuperuser","roleId","attendanceTestUser","attendanceExempt","attendanceConsentVersion" ON users FOR EACH STATEMENT EXECUTE FUNCTION bump_access_version();

-- 4. Verify (read-only)
SELECT key, value FROM system_config WHERE key IN ('ACCESS_SOURCE','ACCESS_VERSION','ACCESS_CACHE');
SELECT tgrelid::regclass, tgname, tgenabled FROM pg_trigger WHERE tgname LIKE 'trg_access_version_%' ORDER BY 1;
```
- ⚠ Column names are camelCase per CORE §3 — confirm `system_config` has a UNIQUE on `key` (the `ON CONFLICT (key)` target) and that `users."roleId"` is the live column name before running; run step 4 first if unsure (read-only).
- The function deliberately does **not** swallow errors (decision 4 recommended): a failed bump fails the access write rather than letting it go unannounced.
- **`prisma/seed.ts`:** add `ACCESS_VERSION='1'` and `ACCESS_CACHE='off'` to its `system_config` upserts (`:22`) so a reseed recreates the keys in the safe state; the triggers are not seed material (they live in the schema, like `trg_mo_orders_updated_at`) — record them in CORE §7 with the next schema version.

---

## Decisions for the owner

1. **Replace the 60 s-only plan with the access notebook?** — *Recommend yes*, with the changes listed under "Validation".
2. **Bump by database trigger (recommended) or by app code after each write?** — *Recommend triggers*: same transaction, SQL Editor covered, future writers covered; the manual lever stays as a backstop.
3. **When a bundle read fails in the jwt callback: keep the token's claims (recommended) or keep today's behaviour (auth() → null → user bounced to /login)?** — *Recommend keep the claims*: today's behaviour logs everyone out during DB trouble and adds login traffic to an overloaded database. It never deactivates anyone and never grants anything new.
4. **Should a failed bump fail the access write?** — *Recommend yes* for these six tables (an admin sees an error and retries, rather than a change silently waiting up to 12 h).
5. **Refresh roles mid-session too** (roleId / user_roles land within ~30 s instead of next sign-in)? — *Recommend not in this change.* It touches the role arm's input and every `requireRole` gate; do it later, on its own, if wanted.
6. **End a user's sessions on password reset?** — *Recommend later, separate.*
7. **Harden `/api/admin/system-config` to refuse `ACCESS_*` keys?** — *Recommend yes* (one line; those keys belong to the SQL Editor and the lever).
8. **Stop re-reading `lastCheckInDate` on refresh in notebook mode** (read by nothing)? — *Recommend yes* — it removes the `attendance_records` read with no visible effect.
9. **`ACCESS_CACHE` default when missing/invalid: OFF** (recommended, mirrors `ACCESS_SOURCE`), with read errors keeping the instance's last known value.
10. **Tick changes become up to ~30 s instead of immediate** — *accept* (it is the price of zero per-request reads; the lever does not make it faster, it only covers writes the triggers cannot see).
11. **Max age 12 h** — *Recommend keep* (only matters if a bump is ever missed).
