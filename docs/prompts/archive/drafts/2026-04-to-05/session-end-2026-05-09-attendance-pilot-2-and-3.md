# Session End — 2026-05-09 — Attendance Pilot Prompts 2 & 3

**Save to:** `docs/prompts/drafts/session-end-2026-05-09-attendance-pilot-2-and-3.md`
**Session date:** 2026-05-09 (extended into 2026-05-10 ~01:30 AM IST)
**Predecessor:** `mdf-attendance-rollout-2026-05-09.md` (locked planning doc)
**Drafts produced this session:**
- `code-update-2026-05-09-prompt1-role-schema-diagnosis.md`
- `code-update-2026-05-09-prompt2-ops-admin-role.md`
- `code-update-2026-05-09-prompt3-middleware-ops-admin.md` (REPLACED — wrong premise)
- `code-update-2026-05-09-prompt3-ops-admin-layout-fix.md` (the one that actually shipped)

---

## What shipped tonight

### Prompt 2 — Production commit `ca5a07ef`
**Adds `ops_admin` role end-to-end:**
- `role_master.id=14` for `ops_admin`
- `RoleSidebarRole` union extended with `"ops_admin"`, label "Operations Admin"
- `ROLE_REDIRECTS` centralized in `lib/rbac.ts` (was duplicated in `app/page.tsx` + `app/login/page.tsx`)
- `attendance` added to `ALL_PAGE_KEYS` (pre-existing minor bug)
- `prisma/seed.ts` refreshed: 7 roles → 10 roles, idempotent upsert
- Users created: Dhruv (id=27), Kuldeep (id=28), both `attendanceTestUser=true`, `roleId=14`
- Initial password: `OpsAdmin@2026` (rotate after first login)

### Prompt 3 (revised, hotfix variant) — Production commit `92c5f84e`
**Closes redirect-loop crisis:**
- Root cause: `app/(admin)/admin/layout.tsx requireRole([ADMIN])` rejected `ops_admin`. Middleware was never the gatekeeper. Original Prompt 3 plan (middleware whitelist) was based on wrong premise — diagnosis caught it.
- Route-group move: `app/(admin)/admin/attendance` → `app/(ops)/admin/attendance`. URL unchanged.
- New `app/(ops)/layout.tsx` dispatches by role:
  - admin → AdminLayoutClient (preserves admin UX)
  - ops_admin → RoleLayoutClient with permissions-driven nav
- New pageKey `attendance_admin` (href `/admin/attendance`) added to `ALL_PAGE_KEYS`, `PageKey` type, `PAGE_NAV_MAP`
- `buildNavItems` ops_admin attendance suppression — prevents duplicate "Attendance" nav item
- `app/unauthorized/page.tsx` local `ROLE_HOME` map (4th role-redirect map, missed in Prompt 1's grep) replaced with import from `lib/rbac` `ROLE_REDIRECTS`
- DB row swap:
  - INSERTED `(ops_admin, attendance_admin, canView=true, canExport=true)` as id=1319
  - DELETED prior wrong row `(ops_admin, attendance)` id=1317

### Phone test on production (Dhruv, ~01:09 AM IST 2026-05-10)
- Login → consent → camera/GPS allow → selfie → check-in submit → landed on `/admin/attendance` ✓
- Sidebar shows "Operations Admin" label ✓
- Single "Attendance" nav item linking to `/admin/attendance` ✓
- Universal Header rendered correctly ✓
- No redirect loop ✓
- Geofence flag fired (2649m from depot) — expected per MDF §3.3 (placeholder coords)

---

## Bugs surfaced tonight (NOT fixed)

### 1. Photo display "Forbidden" in dashboard side panel — HIGH PRIORITY
- Bucket is private (correct, DPDP-compliant)
- Photo upload working — file is in Supabase Storage
- Display side trying public URL → HTTP 403
- Pre-existing since attendance feature shipped, only surfaced tonight because Dhruv was first non-admin to check in
- Draft prepared: `code-update-2026-05-10-prompt-attendance-photo-forbidden.md` (diagnosis-only first, then implementation)
- Blocks: pilot week — supervisor can't actually see selfies, defeats half the gate's purpose

### 2. MDF discrepancy — `attendance_settings.rolloutStage` — MEDIUM PRIORITY
- Production has `rolloutStage='TEST_USERS_ONLY'`, MDF said `OFF` until Prompt 6
- Gate has been silently active for `admin@orbitoms.com` (also has `attendanceTestUser=true`) since whenever this was set
- Decide tomorrow: update MDF to match reality, OR flip rolloutStage back to `OFF` until pilot day
- Affects: Prompt 6 design (the "flip the switch" prompt) — if it's already flipped, what does Prompt 6 do?

### 3. RoleSidebarRole union missing `"admin"` — LOW PRIORITY
- Latent label bug: if admin ever lands on a route that uses RoleSidebar (instead of AdminLayoutClient), label renders "undefined"
- Currently no production routes do this — admin always uses AdminLayoutClient
- Worth fixing in a hygiene pass; not urgent

### 4. Branch hygiene — LOW PRIORITY
- `feat/attendance-feature-complete` accumulating ghost commits (8cb2906b, ae57e959 from cherry-picks)
- Decide: rebase onto main / delete the branch / keep as scratch
- No functional impact, just cosmetic

### 5. Admin role_permissions has 10 missing rows — DOCS/HYGIENE
- Operationally harmless because of 6 admin-bypass short-circuits in `lib/permissions.ts`
- If anyone ever removes a bypass, admin loses access to half the app silently
- Future hygiene prompt to backfill admin's `role_permissions` rows for completeness

---

## Process learnings

### Layout-level authorization, not middleware
- This codebase enforces role authorization in route-group layouts via `requireRole(session, [ROLES.X])`, NOT in middleware
- Middleware just bypasses public paths and lets authenticated requests through
- ~60 files have hardcoded `role === 'admin'` literals — refactoring those is a separate hygiene effort
- For any future role addition: middleware/auth changes MUST ship in same commit as DB role inserts. Splitting across two prompts creates the redirect-loop trap we hit tonight.

### Diagnosis-first saved tonight
- Prompt 1 (read-only diagnosis) caught 5 issues that would have failed in Prompt 2 implementation
- Prompt 3 STEP 1 diagnosis caught the wrong-premise bug (middleware ≠ gatekeeper) BEFORE any code changes
- Without these stops, the redirect loop would have shipped twice

### Smart Flow's unilateral rollback authority worked as designed
- When phone showed `/unauthorized` loop, decision was made in <2 minutes to either fix tonight or disable accounts
- No approval chains, no waiting

---

## Decisions made tonight (logged)

| Decision | Value |
|---|---|
| ops_admin sidebar pattern | RoleSidebar (not AdminSidebar) |
| ops_admin sidebar label | "Operations Admin" |
| ops_admin landing route | `/admin/attendance` |
| Attendance nav for ops_admin | New `attendance_admin` pageKey (clean) |
| ROLE_REDIRECTS centralization | Done in Prompt 2, 4 maps now → 1 source |
| `seed.ts` refresh | All 10 roles, upsert |
| Authorization fix approach | Route-group `(ops)` (not "fold ops_admin into (admin)") |
| Sidebar nav for duplicate Attendance | Suppression in `buildNavItems` for `ops_admin` |
| Layout architecture | Branch in `(ops)/layout.tsx`: admin → AdminLayoutClient, else → RoleLayoutClient |
| Initial password | `OpsAdmin@2026` (rotate after first login) |

---

## Tomorrow's session — recommended order

### Priority 1 — Photo display fix
1. Open fresh planning session.
2. Use `code-update-2026-05-10-prompt-attendance-photo-forbidden.md` (already drafted) to run diagnosis in Claude Code.
3. After diagnosis, draft implementation prompt based on chosen fix approach (likely server-side signed URL generation OR API route proxy).
4. Ship before continuing the rollout.

### Priority 2 — MDF reconciliation
1. Decide: keep `rolloutStage='TEST_USERS_ONLY'` (MDF wrong) or flip back to `OFF` (MDF right).
2. If keeping: update MDF §2 "Current state" + §11 "Open risks" accordingly.
3. If flipping back: SQL `UPDATE attendance_settings SET "rolloutStage"='OFF';` — admin's gate goes off until Prompt 6.

### Priority 3 — Continue rollout per MDF §5
- Prompt 4 — PC no-camera fallback on `/attendance` (MDF §3.5)
- Prompt 5 — Mobile route guard (MDF §3.4) — only `/attendance` + `/order` accessible on phones
- Prompt 6 — Pilot activation SQL (only meaningful if Priority 2 flipped rolloutStage back to OFF)

### Priority 4 — Hygiene (when bandwidth allows)
- Branch cleanup (`feat/attendance-feature-complete`)
- RoleSidebarRole union add `"admin"`
- Admin `role_permissions` backfill

---

## Files for tomorrow's project context

When starting tomorrow's planning session, attach these to the project (in this order):

**Required (always):**
1. `CLAUDE.md` (router)
2. `docs/CLAUDE_CORE.md`
3. `docs/CLAUDE_UI.md`

**Required for tomorrow's specific task (photo Forbidden):**
4. `docs/CLAUDE_TINT.md` — covers attendance feature in current state (or wherever attendance lives in context files)
5. `mdf-attendance-rollout-2026-05-09.md` — MDF for ongoing pilot
6. `session-end-2026-05-09-attendance-pilot-2-and-3.md` — this file
7. `code-update-2026-05-10-prompt-attendance-photo-forbidden.md` — the prompt to run
8. `prisma/schema.prisma` — for reference
9. `code-update-2026-05-08-attendance-feature-shipped.md` — original attendance ship draft, has upload pipeline notes

**Skip (not needed for photo fix):**
- `CLAUDE_MAIL_ORDERS.md` — different domain
- `middleware.ts` — not the gatekeeper for this issue
- Other recent web/code-update drafts unless something specific points at them

---

## Production state at session end (2026-05-10 ~01:30 AM IST)

| Item | Value |
|---|---|
| Latest deploy | commit `92c5f84e` (Prompt 3 hotfix) |
| `attendance_settings.rolloutStage` | `TEST_USERS_ONLY` |
| `role_master` | 10 roles, including `ops_admin` (id=14) |
| Pilot users | Dhruv (id=27), Kuldeep (id=28), admin (existing) — all `attendanceTestUser=true` |
| Dhruv check-in record | exists for 2026-05-10 01:09 AM IST, photo uploaded but display 403 |
| Geofence | placeholder Surat city center (21.1702, 72.8311), 50m radius — pilot will produce `isOutsideGeofence=true` flags (expected) |
| Cron jobs | rollover 18:35 UTC, purge 20:30 UTC — verified configured |
| Branch hygiene | `feat/attendance-feature-complete` has 2 ghost commits (cosmetic only) |

---

*Session end · 2026-05-09 · Prompts 2 & 3 shipped, photo display fix queued for tomorrow*
