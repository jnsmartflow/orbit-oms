# Context Update v74 — Attendance feature complete (Prompts 1-11)
Session date: 2026-05-08
Target files: CLAUDE.md (router §3), CLAUDE_CORE.md (§3, §7, §10, §14), CLAUDE_UI.md (mobile patterns), NEW CLAUDE_ATTENDANCE.md

## SCHEMA CHANGES

Schema bumped **v26.6 → v27.0 → v27.1**. Both increments shipped via Supabase SQL Editor (no `prisma db push`).

### v27.0 — Foundation tables (P1)

```sql
-- 3 new columns on users
ALTER TABLE "users"
  ADD COLUMN "attendanceConsentAt"      TIMESTAMPTZ,
  ADD COLUMN "attendanceConsentVersion" TEXT,
  ADD COLUMN "attendanceExempt"         BOOLEAN NOT NULL DEFAULT FALSE;

-- 3 new tables
CREATE TABLE "attendance_records" (...);    -- per-event log; CHECK_IN | CHECK_OUT
CREATE TABLE "attendance_summary" (...);    -- one per (userId, attendanceDate)
CREATE TABLE "attendance_settings" (...);   -- GLOBAL row seeded with depot defaults

-- All FKs to users(id) ON DELETE RESTRICT.
-- All TIMESTAMPTZ; latitude/longitude DECIMAL(10,7); camelCase columns (no @map).
```

### v27.1 — Rollout flags (P2.5)

```sql
ALTER TABLE "users"
  ADD COLUMN "attendanceTestUser" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "attendance_settings"
  ADD COLUMN "rolloutStage" TEXT NOT NULL DEFAULT 'OFF';
-- Values: 'OFF' | 'TEST_USERS_ONLY' | 'ALL_USERS'
```

## NEW/MODIFIED FILES

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | 3 attendance models + 4 user columns + rolloutStage |
| `auth.config.ts` | Edge-safe JWT/Session augmentation with attendance claims |
| `lib/auth.ts` | Node JWT callback overrides — Prisma-aware refresh of rollout flags + lastCheckInDate (5-min stale window); `trigger==='update'` branch refreshes consent + check-in on demand |
| `middleware.ts` | Attendance gate (Edge); `/api/cron/*` bypass; Permissions-Policy via `next.config.mjs` |
| `lib/permissions.ts` | Added `attendance` PageKey; `buildNavItems(allPerms, roleSlug?, userFlags?)` — userFlags-driven visibility |
| `lib/attendance/date.ts` | `istDateString` / `istNow` (Edge-safe) |
| `lib/attendance/format.ts` | IST clock/date/duration formatters; `parseTimeToMin`, `istMinutesSinceMidnight`, `shiftCalendarDate` |
| `lib/attendance/state.ts` | `deriveAttendanceState(records)` pure session-pairing |
| `lib/attendance/geofence.ts` | `haversineDistance` / `isWithinGeofence` (Edge-safe) |
| `lib/attendance/photo.ts` | Client canvas capture + JPEG compression |
| `lib/attendance/calendar.ts` | `getMonthGrid`, `parseMonthParam`, `clampMonth`, `addMonths`, `formatMonthLabel` |
| `lib/attendance/admin-status.ts` | `deriveAdminUserStatus` for roster (NOT_IN_YET/EXEMPT etc.) |
| `lib/supabase.ts` | Lazy singleton service-role client; fail-fast on missing env vars |
| `lib/cron-auth.ts` | Bearer-token check (fail-closed on missing CRON_SECRET) |
| `app/attendance/layout.tsx` | Full-screen 480px column wrapper |
| `app/attendance/page.tsx` | Home: NOT_CHECKED_IN / WORKING / re-entry states |
| `app/attendance/consent/page.tsx` + `consent-form.tsx` | DPDP consent flow (3 cards + checkbox + decline-confirm dialog) |
| `app/attendance/check-in/page.tsx` + `check-in-flow.tsx` | Camera→Confirm→Success state machine |
| `app/attendance/check-out/page.tsx` + `check-out-flow.tsx` | Same flow + DaySummaryView |
| `app/attendance/history/page.tsx` | Calendar (Mon-first, status-shaded cells) |
| `components/attendance/*.tsx` (14 files) | Status card, live timer, status chip, bottom nav, attendance home, camera/confirm/success views, day summary, history calendar/grid, day detail card |
| `app/(admin)/admin/attendance/page.tsx` | Admin roster page (server: 4-5 sequential queries) |
| `components/admin/attendance/*.tsx` (5 files) | Dashboard shell, roster table (UI §40 fixed-layout), user detail panel, photo viewer (lazy signed URL), export button |
| `components/admin/admin-sidebar.tsx` | Added `Personal > Attendance` (ClipboardCheck) and `Operations > Attendance` (CalendarCheck) entries; per-item icon override |
| `next.config.mjs` | `Permissions-Policy` changed `camera=()` / `geolocation=()` → `(self)` |
| `app/layout.tsx` | PWA Metadata + Viewport (manifest, theme-color, apple-web-app, icons) |
| `public/manifest.json` | PWA manifest, `start_url=/attendance`, `display=standalone`, theme `#0d9488` |
| `public/icon-source.svg` + 3 generated PNGs | OrbitOMS orbit logo on teal-600, sizes 192/512/180 |
| `scripts/generate-icons.mjs` | One-time icon generator using `@resvg/resvg-js` |
| `vercel.json` | Cron schedules: 35 18 * * * (rollover) and 30 20 * * * (purge) |
| `docs/cron-notes.md` | Schedule docs + 2-cron Hobby cap note |

## NEW API ENDPOINTS

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/attendance/consent` | session | Record DPDP consent for current user |
| POST | `/api/attendance/check-in` | session | Open new attendance session (photo + GPS) |
| POST | `/api/attendance/check-out` | session | Close open session, recompute summary |
| GET | `/api/admin/attendance/photo` | admin role | 5-min signed Supabase URL by recordId |
| GET | `/api/admin/attendance/export` | admin role | CSV per date (12 columns) |
| GET | `/api/cron/attendance-rollover` | Bearer CRON_SECRET | Insert ABSENT for missing users; flag yesterday INCOMPLETE |
| GET | `/api/cron/attendance-purge` | Bearer CRON_SECRET | Delete photos older than `photoRetentionDays`; clear photoPath |

## BUSINESS RULES ADDED

- **3-stage rollout** controlled by `attendance_settings.rolloutStage`: `OFF` (invisible) → `TEST_USERS_ONLY` (gated iff user.attendanceTestUser=TRUE) → `ALL_USERS` (gated unless attendanceExempt=TRUE).
- **Admin gating rule:** admin gated iff `attendanceTestUser=TRUE`, regardless of stage. Recovery escape hatch.
- **Attendance gate** (Edge middleware): when applicable, redirect to `/attendance` unless `lastCheckInDate === todayIST`. `/attendance/*` and `/api/attendance/*` always bypass the gate.
- **JWT 5-min staleness window** for rollout flags + lastCheckInDate. Plus explicit `trigger==='update'` refresh on consent + check-in for immediate JWT propagation.
- **Geofence verification:** Haversine vs settings center (default 21.1702, 72.8311 = Surat city centre placeholder). 150m radius default. Outside-geofence is **warn-and-allow** at submit; flagged on summary as `hasGeofenceViolation`.
- **Photo retention:** default 90 days. Service-role-only Supabase Storage bucket `attendance-photos`. Daily cron purges expired records + clears `photoPath`. Idempotent.
- **CRON_SECRET fail-closed:** `/api/cron/*` returns 401 when env var missing — never auth as `Bearer undefined`.
- **Photo path convention:** `${YYYY}/${MM}/${DD}/${userId}_${tsMs}_${CHECKIN|CHECKOUT}.jpg` using IST date parts.
- **Cross-midnight sessions = accepted limitation.** A CHECK_IN at 11:55 PM IST stays under yesterday's `attendanceDate`; CHECK_OUT at 00:30 IST gets today's date and 409s the open-session lookup. Admin reconciles via P9 (Phase 2 manual entry).
- **Sequential awaits, no `$transaction`** across all attendance code (Vercel pooler timeout rule per CORE §3).
- **Status derivation precedence (admin):** EXEMPT → known summary status → INCOMPLETE (records-without-summary) → today before-grace `NOT_IN_YET` → today after-grace `ABSENT` → past-day `ABSENT`.
- **Status mapping → colors:** PRESENT emerald, LATE/HALF_DAY amber, INCOMPLETE/ABSENT red, HOLIDAY/ON_LEAVE blue, NOT_IN_YET/EXEMPT gray.
- **Flags meta-filter excludes LATE** (LATE has its own segment): `Flags = GEO | MANUAL | Y'DAY`.
- **Cron jitter defense:** rollover anchors yesterdayIST on `now + 1 hour` to absorb ±60min jitter (IST has no DST).
- **PWA `start_url=/attendance`** with `display: standalone`; PWA installs jump straight to gate destination.

## BUSINESS RULES CHANGED / SUPERSEDED

- **Permissions-Policy header** (`next.config.mjs:11`) changed: `camera=()` → `camera=(self)`, `geolocation=()` → `geolocation=(self)`. Microphone unchanged at `(self)`. Cross-origin embeds still blocked.
- **Middleware `/api/cron/*` bypass added** between PUBLIC_PATHS check and HMAC bypasses. Pattern: same as existing HMAC routes — request authenticates at the route handler, not at the middleware layer.
- **`buildNavItems` signature extended** with optional `userFlags?: { attendanceTestUser, rolloutStage }`. All 8 layout call sites updated; admin sidebar uses per-item icon override (new optional `icon` field on `NavItem`).
- **`StatusChip` enum extended** with `NOT_IN_YET` and `EXEMPT` (admin-roster only).

## PENDING ITEMS

**New, deferred to Phase 2:**
- Admin manual-entry / record-edit / mark-exception writes (UI buttons stubbed with "Coming in Phase 2" modals).
- Real depot geofence coordinates — currently Surat city centre placeholder. Admin updates via `UPDATE attendance_settings SET "geofenceLat"=..., "geofenceLng"=... WHERE scope='GLOBAL';`
- PWA service worker for offline support.
- PWA push notifications.
- Multi-session day breakdown in P8 day-detail-card (currently shows first-IN + last-OUT only).
- Email/Sentry alerting for cron failures (currently console.error only — visible in Vercel logs).

**Pre-deploy operational:**
- Add `CRON_SECRET` env var to Vercel (Production + Preview + Development) before merging the PR. Without it, all cron requests 401 and ABSENT rows never get inserted.

**Now done — remove from any pending lists:**
- Schema v27.0 / v27.1 (was pending in P1/P2.5 prompts).
- Supabase Storage bucket `attendance-photos` (manual P2 step done).
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars confirmed in Vercel.

## CHECKLIST UPDATES

Add to CLAUDE_CORE.md §14 session-start checklist:

- Schema version is now **v27.1**. If user mentions a table you don't see in §7, check if it's in §7.7 (attendance — to be added) before asking.
- Attendance feature is **dormant by default** — `attendance_settings.rolloutStage='OFF'` keeps it invisible to all users. Production rollout requires explicit SQL update on the GLOBAL settings row.
- Cron endpoints under `/api/cron/*` bypass middleware auth and authenticate via `CRON_SECRET` Bearer token (fail-closed). Two slots used (Hobby cap reached) — see `docs/cron-notes.md` for consolidation strategy.
- All attendance code uses **sequential awaits** for Prisma + Supabase ops. No `$transaction`.

## CONSOLIDATION NOTES

This feature is large enough to warrant its own domain file per CLAUDE.md §6 extraction trigger ("Module reaches production-live status → gets own file"). Recommended at next consolidation:

- **NEW: `docs/CLAUDE_ATTENDANCE.md`** (~300 lines) — schema (§7.7-equivalent), 3-stage rollout flow, gate logic, IST date conventions, photo retention, geofence rules, cron schedules, JWT staleness model, all 7 screens (consent, home, check-in, check-out, history, admin roster, admin detail panel).
- **`CLAUDE.md` (router) §3** — add new domain mapping: rows touching `/attendance/*`, `/admin/attendance`, `/api/attendance/*`, `/api/cron/attendance-*`, `attendance_*` tables → load `docs/CLAUDE_ATTENDANCE.md`.
- **`CLAUDE_CORE.md` §3** — add `CRON_SECRET` to env vars list. Note `Permissions-Policy: camera=(self), microphone=(self), geolocation=(self)` shipped (deltas from prior `camera=()` / `geolocation=()`).
- **`CLAUDE_CORE.md` §7** — bump schema version to v27.1; add §7.7 attendance tables (or reference CLAUDE_ATTENDANCE.md for detail).
- **`CLAUDE_CORE.md` §10** — add screens to index: `/attendance` family + `/admin/attendance`.
- **`CLAUDE_CORE.md` §14** — schema v27.1.
- **`CLAUDE_UI.md`** — additions for mobile-first patterns:
  - Status chip 9-variant mapping (PRESENT/LATE/HALF_DAY/INCOMPLETE/ABSENT/HOLIDAY/ON_LEAVE/NOT_IN_YET/EXEMPT — emerald/amber/red/blue/gray).
  - Bottom nav pattern (fixed 80px with `env(safe-area-inset-bottom)`).
  - Full-screen camera modal pattern (`fixed inset-0 z-50 bg-black`, dashed face oval, 88px capture button).
  - PWA + viewport-fit: cover requirements; status bar = black-translucent.
  - 480px max-width column for mobile-feel-on-desktop user flows (consent, attendance home, check-in confirm).
- **Possible future split (?)** — `CLAUDE_PWA.md` if PWA grows beyond manifest (service worker + push). For now, manifest belongs in CLAUDE_UI.md or CLAUDE_CORE.md §4 infra.

## OPS NOTES

- Foundation commit (P1+P2.5+P3) on main: `5c42288b` (squashed PR #1).
- Feature commit (P4-P11): `ed3a482a` on branch `feat/attendance-feature-complete` — PR pending review.
- Two batched commits, not 11 — kept history scannable.
