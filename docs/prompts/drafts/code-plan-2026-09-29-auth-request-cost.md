# Code plan — 2026-09-29 — auth request cost (live change-feed step 0)

**Mode:** PLAN ONLY. No code changed, no commit, no database query.
**All files read:** `docs/prompts/drafts/code-discovery-2026-09-29-disk-io.md` (§C, §D, §H 7–8) · `docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md` (§F, §M step 0) · `docs/CLAUDE_CORE.md` v113 §3, §5 (whole), §7.14, §7.15, §13 · `docs/CLAUDE_ATTENDANCE.md` v1.4 §3–§4, §11 · `lib/auth.ts`, `auth.config.ts`, `middleware.ts`, `lib/permissions.ts`, `lib/rbac.ts`, `lib/access/source.ts`, `components/shared/session-provider.tsx`, `app/layout.tsx`, `app/(floor)/floor/layout.tsx` · `node_modules/next-auth/lib/index.js` (5.0.0-beta.30), `node_modules/@auth/core/lib/actions/session.js` (0.41.1), `node_modules/next/dist/compiled/react/cjs/react.react-server.development.js`.

---

## A. The diagnosis, confirmed from the code

### A.1 The mechanism (✅ each line re-read)
1. **Node jwt callback, refresh branch** (`lib/auth.ts:149-181`): `if (staleAt > now) return token;` — otherwise `fetchUserAttendanceFlags` = `users.findUnique` (`:36-44`) + `attendance_settings.findFirst` (`:45-48`), then, if `gateAppliesTo(role, flags)` and `token.lastCheckInDate !== todayIST`, `attendance_records.findFirst` (`:170-177` → `:63-66`). It then sets `token.rolloutStageStaleAt = now + 5 min` (`:167`).
2. **That new value is thrown away.** A bare `auth()` (every route handler, layout, page, and `lib/permissions.ts:671`) is `getSession(headers()).then(r => r.json())` (`node_modules/next-auth/lib/index.js:89-91`) — only the JSON body survives. `@auth/core/lib/actions/session.js:30-34` runs `callbacks.jwt({ token: payload })` with no trigger (the refresh path), and `:48-53` re-encodes the token into `response.cookies`, which no caller writes back.
3. **The paths that DO write the cookie never move the stamp.** Middleware (`middleware.ts:6`, `NextAuth(authConfig)`, matcher `:90` = every page and every `/api/*`) re-signs the cookie on each request, but with the Edge jwt callback (`auth.config.ts:64-71`), which returns the token unchanged — so it re-signs the OLD `rolloutStageStaleAt` and extends the cookie's life. The `update()` path deliberately leaves the stamp alone (`lib/auth.ts:96-99`). `/api/auth/session` would advance it, but the client never calls it: `refetchOnWindowFocus={false}`, no `refetchInterval` (`components/shared/session-provider.tsx:56`), session seeded from the root layout (`app/layout.tsx:84`).
4. **Session life:** no `session.maxAge` in `auth.config.ts` or `lib/auth.ts` → next-auth's default (30 days, UNVERIFIED default value), and middleware keeps extending it on activity. So `rolloutStageStaleAt` stays at **sign-in + 5 min for the whole life of the session**.

**Confirmed:** after minute 5 of every session, **every Node `auth()` runs the DB branch**.

### A.2 One API request — `GET /api/floor/marker`, non-admin, session > 5 min, `ACCESS_SOURCE = user` (live per CORE §5)

| # | Where | What | DB queries |
|---|---|---|---|
| 1 | Edge `middleware.ts:32` | `auth()` wrapper: decrypt JWE, Edge jwt (no-op), session callback, re-encrypt, Set-Cookie | 0 |
| 2 | `app/api/floor/marker/route.ts` | `await auth()` → Node jwt refresh branch | `users.findUnique` + `attendance_settings.findFirst` (+ `attendance_records.findFirst` when gated and no check-in stamped today in the cookie) = **2–3** |
| 3 | `lib/permissions.ts:832` `checkAnyPermission` → `sessionAccess()` `:669-671` | **second `auth()`** → same refresh branch | **2–3** |
| 4 | `lib/permissions.ts:692` `userModeId` → `getAccessSource()` | `system_config.findUnique`, cached 30 s per lambda (`lib/access/source.ts:41-52`) | **0–1** |
| 5 | `lib/permissions.ts:840` → `userPagePerms` `:700-713` | `user_page_access.findUnique` | **1** |
| 6 | route body | the marker's own work | (not auth) |

**Auth + permission overhead: 5–7 queries on top of the route's own work.** Correction/precision to the disk-io report: it is **5–7 for a non-admin, non-superuser user**; an **admin-role** user pays 2–3 (the role arm returns before `sessionAccess`); a **superuser-flag-only** user pays 4–6 (two `auth()`s, then the flag arm returns before steps 4–5). Everything else in §C of that report is confirmed. The "~25 % of all app queries" share remains an estimate for §E measurement to settle.

### A.3 One page render — `/floor`, same user

| # | Where | `auth()` runs | Permission/other queries |
|---|---|---|---|
| 1 | middleware | Edge only | 0 |
| 2 | `app/layout.tsx:84` root layout | 1 → 2–3 queries | — |
| 3 | `app/(floor)/floor/layout.tsx` | 1 → 2–3 | `checkAnyPermission(floor, canView)` (`:25`) → **+1 `auth()`** → 2–3, + ≤1 `system_config`, + 1 `user_page_access` |
| 4 | same layout | — | `getAllPermissionsForRoles(roles)` (`:28`) → **+1 `auth()`** → 2–3, + `user_page_access.findMany` (1) |
| 5 | `app/(floor)/floor/page.tsx` | 1 → 2–3 | `checkAnyPermission(floor, canEdit)` → **+1 `auth()`** → 2–3, + 1 |

**≈ 6 `auth()` evaluations ≈ 12–18 session queries + 3–4 permission queries per `/floor` render.** No data queries (the board loads client-side).

---

## B. Options

Figures are per ordinary API request for the common case (non-admin, user mode, session > 5 min).

| # | Option | Queries saved / request | What gets slower to take effect | Risk of stale / wrong access | Blast radius |
|---|---|---|---|---|---|
| **1** | **Per-lambda in-memory cache** of the refresh data, in `lib/auth.ts`, keyed by `userId`, TTL 60 s; the global `attendance_settings` row cached once per lambda | **4–6 of 5–7** (both `auth()`s become 0 on a warm lambda; one miss per user per lambda per 60 s costs 2) | superuser grant/revoke and the sidebar Attendance link: **today** effectively immediate for sessions older than 5 min (≤ 5 min for younger ones) → **after ≤ 60 s** on every lambda. Still inside the documented "~5 minutes" (CORE §5, `auth.config.ts:37-39`). Nothing else | Stale-by-≤60 s claims only. Per lambda, like `getAccessSource`. A revoke of superuser lands within 60 s everywhere; the role arm is untouched | 1 file (`lib/auth.ts`) + 1 new helper file; zero call sites |
| 2 | Dedupe `auth()` per request with React `cache()` | Server components/layouts only: 6 → 1 evaluation per render. **Route handlers: nothing** — ✅ `cache()` memoises only when a render dispatcher exists; with none it calls through (`react.react-server.development.js:2189-2197`), and route handlers have none | none | none | wrapping the exported `auth` changes every caller's function identity; small but touches the auth export |
| 3 | Pass the already-read session into `checkAnyPermission` & co. | 2–3 (the second `auth()`) — but after option 1 that `auth()` already costs 0 | none | none | **238 call sites in 189 files** (`checkAnyPermission` 196, `checkPermission` 14, `getPagePermissions` 9, `getAllPermissionsForRoles` 17, `getAllPermissionsForRole` 2). Can be backward-compatible (optional trailing `session?` argument), but the comment at `lib/permissions.ts:638-642` records why the signatures were kept, and the benefit after option 1 is CPU only |
| 4 | TTL cache of the `user_page_access` row | 1 | **a tick change on `/admin/access` — today immediate — would take up to the TTL** | a revoked tick keeps working for up to TTL | 1 file; changes a documented "immediate" |
| 5 | Make the cookie persist the new stale time | 4–6 | none | none | **Not achievable safely.** Server components cannot set cookies; route handlers could only by calling next-auth's handler form per route; middleware (Edge) cannot read the DB, so bumping the stamp there would stop the refresh from EVER running (flags would freeze for the session). Rejected |

**Recommendation: option 1 alone.** It removes 4–6 of the 5–7 hidden queries with one file changed and no call site touched, keeps every access decision identical, and keeps timing inside the promise canon already makes. Option 4 is **not** recommended (it would slow the one thing that is immediate today). Options 2 and 3 are optional later tidy-ups — CPU only after option 1.

**After option 1, per request:** `auth()` #1 = 0 · `auth()` #2 = 0 · `system_config` ≤ 1 per 30 s per lambda · `user_page_access` = 1 → **≈ 1 query** (admin role: 0; superuser flag: 0). Plus, once per user per lambda per 60 s, 2 (or 3) refresh queries.

---

## C. Behaviour that must stay the same — checklist

- [ ] **Superuser is two arms** — `isSuperuser === true` OR roles include `"admin"` (`lib/rbac.ts:104-111`, and each resolver's role arm first: `lib/permissions.ts:803`, `:829`, `:856`, `:885`, `:927`). No edit to `lib/rbac.ts` or the resolvers' arms.
- [ ] **Superuser grant/revoke lands without sign-out** — within ≤ 60 s after the change (was: immediate for sessions older than 5 min, ≤ 5 min otherwise). Canon's "~5 minutes" promise still holds.
- [ ] **`isActive = false` blocks at sign-in** (`lib/auth.ts:210`) — unchanged; existing sessions still run on until the cookie expires, exactly as today (see decision 4).
- [ ] **Sign-in path always reads the DB fresh** (`lib/auth.ts:122-147`) — never from the cache; it may *seed* the cache.
- [ ] **Phone or email login** (`authorize`, `:191-231`) — untouched.
- [ ] **`update()` path** (consent, check-in) still re-reads `attendanceConsentVersion` and `lastCheckInDate` from the DB and persists them (it goes through `/api/auth/session` POST, which does write the cookie) — and **invalidates this user's cache entry** on that lambda.
- [ ] **Attendance claims** — `rolloutStage` / `attendanceTestUser` still drive the sidebar Attendance link via `buildNavItems` (every group layout). `attendanceConsentVersion` in the token is not read by any page (the four attendance pages read it fresh from the DB — ATTENDANCE §4). `lastCheckInDate` is computed but **read by nothing** (ATTENDANCE §3 ✅: only `auth.config.ts` pass-through). The attendance-page consent redirects are untouched.
- [ ] **`gateAppliesTo`** logic unchanged.
- [ ] **ACCESS_SOURCE** — `lib/access/source.ts` untouched: 30 s per-lambda cache, only exact `user` enables user mode, errors fall back to `role`.
- [ ] **`requireRole` / `requireSuperuser` / `isSuperuser` call sites** — untouched; they read the session object, whose shape is unchanged.
- [ ] **`/admin/access` "differs from role" view** — uses `getRolePermissionsForRoles` (switch-independent), untouched.
- [ ] **Tick changes on `/admin/access` apply immediately** — no permission-row caching.
- [ ] **Edge/Node split** — `auth.config.ts` and `middleware.ts` untouched; the new cache lives in Node-only code.
- [ ] **Session JSON shape** seen by the client and by every `session.user.*` reader is byte-identical.
- [ ] **Old tokens** (no `isSuperuser` claim, no attendance claims) still resolve to "not a superuser" and default-off attendance until the first refresh — unchanged.
- [ ] **SO OTP login** (`lib/so-auth/staff-gate.ts:14`) — just another `auth()` caller; unaffected.

---

## D. The plan

### D.1 New helper — `lib/auth/refresh-cache.ts` (Node-only; never imported by `auth.config.ts` or `middleware.ts`)
- `const REFRESH_TTL_MS = 60_000;` with a header comment in the style of `lib/access/source.ts`: per-lambda, not global; worst case a flag change takes 60 s to land on every instance; why 60 s.
- `getRefreshFlags(userId, fetch)` → returns `UserAttendanceFlags` from a module-scope `Map<number, { flags, at }>` if younger than TTL, else awaits `fetch(userId)` (today's `fetchUserAttendanceFlags`), stores and returns it. **In-flight de-duplication** (a `Map<number, Promise>`) so concurrent requests on one instance share one read. **Never throws past the caller** — if the fetch throws, nothing is cached and the error propagates exactly as today (today a DB error in the jwt callback already fails `auth()`; this plan does not change that direction).
- `attendance_settings` (global row) held as its own single cache entry with the same TTL — one read per lambda per 60 s regardless of user count.
- `getLastCheckIn(userId, todayIST, fetch)`: cache **positive** results for the rest of that IST day (a check-in never un-happens); cache a `null` result for the TTL. The claim is read by nothing today, so this is purely cost.
- `invalidateRefreshCache(userId)` — called by the `update()` path.
- Bounded: cap the map (e.g. 500 entries, drop oldest) — ~39 users today; defensive only.
- Pure and testable: the clock and the fetchers are injected.

### D.2 `lib/auth.ts` edits (the only existing file touched)
1. Refresh branch (`:149-181`): keep the `staleAt > now` early return exactly as is (it is harmless and still saves work in a session's first 5 minutes). Replace the direct `fetchUserAttendanceFlags(userId)` call at `:158` with `getRefreshFlags(userId, fetchUserAttendanceFlags)`, and the `fetchLastCheckInForToday` call at `:173-176` with `getLastCheckIn(userId, todayIST, fetchLastCheckInForToday)`. Everything else in the branch — the assignments, `gateAppliesTo`, setting `rolloutStageStaleAt` — unchanged.
2. `fetchUserAttendanceFlags` (`:34-57`): split so the `attendance_settings` read goes through the global-row cache; the `users` read stays per user. Return shape identical.
3. Update branch (`:100-119`): unchanged reads; add `invalidateRefreshCache(userId)` after them.
4. Sign-in branch (`:122-147`): unchanged reads (always fresh); optionally seed the cache with the flags just read (saves one read on the next request).
5. Comment fixes in the same edit: `:17-19` (describe the real behaviour: the cookie stamp never advances; the cache is what bounds the cost), `:70` ("Mirror of the middleware gate logic" — no such gate since `236f9743`).

### D.3 Not touched
`auth.config.ts`, `middleware.ts`, `lib/permissions.ts`, `lib/rbac.ts`, `lib/access/source.ts`, `components/shared/session-provider.tsx`, `app/layout.tsx`, every route and page (0 of the 238 resolver call sites and 0 of the 337 `auth()` call sites change), the database.

### D.4 Order of edits
1. Add `lib/auth/refresh-cache.ts` + its unit test (`lib/auth/refresh-cache.test.ts`, run with `tsx --test`, like `test:load-plan`).
2. Wire it into `lib/auth.ts` (D.2 1–4) and fix the two comments.
3. `npx tsc --noEmit`, `npm run build`, the unit test.
4. Record the change (not a schema version): CORE §5 "A flag change lands within ~5 minutes" → "within ~60 seconds (per-instance cache, `lib/auth/refresh-cache.ts`)"; `auth.config.ts:37-39` and `lib/auth.ts` comments to match; ATTENDANCE §3 "Stale window" paragraph; the disk-io draft §H items 7–8 marked resolved.

### D.5 Timing changes users could notice
- **Superuser grant/revoke:** lands in **≤ 60 s** (today: immediately for sessions older than 5 min, up to 5 min for newer ones).
- **Attendance rollout stage / test-user flag** (sidebar Attendance link): **≤ 60 s** (same as above).
- **Everything else:** unchanged — ticks immediate, ACCESS_SOURCE ≤ 30 s, deactivation at next sign-in.

---

## E. Test and measure

### E.1 Local checks (Claude Code)
1. `npx tsc --noEmit` clean.
2. `npm run build` clean (confirms no Node-only import reached the Edge bundle — `middleware.ts` must not pull `lib/auth/refresh-cache.ts`).
3. Unit test `refresh-cache.test.ts`: hit within TTL makes no fetch; miss after TTL refetches; concurrent calls share one fetch; a thrown fetch caches nothing; `invalidate` forces the next read; positive check-in cached across TTL within the day, not across IST midnight; `null` check-in re-read after TTL; `attendance_settings` read once per TTL across several users.
4. Reasoned walk-through of A.2/A.3 with the new code: auth #1 and #2 hit the cache; resolver arms and order unchanged (diff of `lib/permissions.ts` must be empty).

### E.2 Hand tests for Smart Flow (Claude Code cannot log in)
Run on production after deploy, each with a note of the time.
1. **Admin (owner):** sign in with email; open `/admin`, `/floor`, `/admin/access` — all load, sidebar complete.
2. **Admin phone login:** sign out; sign in with the 10-digit phone — lands on the role's home route.
3. **Normal user** (e.g. a billing operator): sign in; open `/mail-orders` billing tabs; confirm the same tabs/pills/actions as yesterday; open a page they lack → `/unauthorized` as before.
4. **Tick change mid-session:** with user 3 logged in, remove one tick on `/admin/access` (e.g. a billing tab); in user 3's browser reload → the tab is gone **immediately**; restore the tick → back immediately.
5. **Superuser flag change mid-session** (only if a test account can safely carry it — otherwise skip): grant `isSuperuser` via Smart Flow; within 60 s the user sees admin-gated pages; revoke; within 60 s they are refused. The owner's own access must never be the test subject (two-arm rule).
6. **Deactivated user:** set `isActive = false` on a test user → sign-in refused; (an existing session continues, exactly as today).
7. **Attendance:** a gated test user opens `/attendance` → consent/check-in flow works; after check-in, the page shows the session; the sidebar Attendance link matches the rollout stage; flip `attendanceTestUser` on a test user under `TEST_USERS_ONLY` → the link appears/disappears within 60 s.
8. **Floor / Picking / Billing smoke:** each screen's markers keep working (the connection chip stays online).

### E.3 Measurement (read-only; Smart Flow, before deploy and 24 h after)
```sql
-- read-only
SELECT calls, round(total_exec_time::numeric, 1) AS total_ms, left(query, 160) AS query
FROM pg_stat_statements
WHERE query ILIKE '%"attendanceTestUser"%'                    -- the per-user flags read
   OR query ILIKE '%FROM "public"."attendance_settings"%'
   OR query ILIKE '%FROM "public"."attendance_records"%'
   OR query ILIKE '%FROM "public"."user_page_access"%'
   OR query ILIKE '%FROM "public"."system_config"%'
ORDER BY calls DESC;
```
Record `calls` for each row before the deploy and again 24 h later (or `SELECT pg_stat_statements_reset();` is **not** to be run — it is a write and wipes the evidence; compare deltas instead). Expected: the `users` flags read and `attendance_settings` drop by ~95 %+ per request; `user_page_access` unchanged per request (it falls only because the app makes fewer requests overall once the change feed lands).

### E.4 Rollback
- `git revert <commit>` and push — the change is two files (one new, one edited) with no schema and no data change, so a revert restores today's behaviour exactly.
- After a revert: nothing to clean in the database; sessions carry on (no token shape changed). Re-run E.2 steps 1, 3 and 4 to confirm.

---

## Decisions for the owner

1. **Option 1 (per-lambda cache of the refresh data) alone as step 0?** — *Recommend yes.* One file changed, no call site touched, 4–6 queries saved per request.
2. **Cache TTL** — *Recommend 60 s.* Superuser and attendance-flag changes land within a minute, well inside canon's "~5 minutes"; longer saves little (one read per user per lambda per minute).
3. **Cache `user_page_access` rows too (option 4)?** — *Recommend no.* It would make tick changes on `/admin/access` take up to the TTL, where today they are immediate; it saves one small indexed read.
4. **Make deactivation effective within 60 s** (read `isActive` in the same cached user read and end the session when false)? — *Recommend a separate, later change.* It is a free tightening of access, but it alters sign-out behaviour and deserves its own test; this step should change timing only.
5. **Stop computing `lastCheckInDate` on refresh** (read by nothing — ATTENDANCE §3)? — *Recommend keep it for now, cached* (positive results for the day). Removing a claim is a separate tidy-up.
6. **Options 2/3 (React `cache()` for renders, passing the session into resolvers)** — *Recommend not now.* After option 1 they save CPU only; option 3 touches 238 call sites in 189 files.
