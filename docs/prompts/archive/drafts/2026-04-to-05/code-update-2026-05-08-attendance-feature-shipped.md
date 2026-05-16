# Context Update v73 — Attendance Feature (P4-P11) Live in Production
Session date: 2026-05-08
Target files: CLAUDE_CORE.md §3, §4, §5, §13, §14 / CLAUDE_UI.md §6, §40 / new docs/CLAUDE_ATTENDANCE.md

## SCHEMA CHANGES

None this session (schema v27.1 already shipped via foundation PR #1 on previous session). All P4-P11 work used existing tables: `attendance_records`, `attendance_summary`, `attendance_settings`, plus the 4 user columns added in foundation.

## NEW/MODIFIED FILES

| File | Purpose |
|---|---|
| `app/attendance/layout.tsx` | Full-screen wrapper, no sidebar, 480px column |
| `app/attendance/page.tsx` | State derivation + dispatch (consent vs home) |
| `app/attendance/consent/page.tsx` | Server-side consent check + redirect |
| `app/attendance/consent/consent-form.tsx` | Client form with checkbox + accept/decline |
| `app/attendance/check-in/page.tsx` | Server: auth + settings, renders flow |
| `app/attendance/check-out/page.tsx` | Server: open-session validation + render flow |
| `app/attendance/history/page.tsx` | Server: month parse + summary/record fetch |
| `app/(admin)/admin/attendance/page.tsx` | Server: roster derivation + render dashboard |
| `app/api/attendance/consent/route.ts` | POST: record consent + bump version |
| `app/api/attendance/check-in/route.ts` | POST: validate + photo upload + record + summary upsert |
| `app/api/attendance/check-out/route.ts` | POST: validate + close session + recompute summary |
| `app/api/admin/attendance/photo/route.ts` | GET: signed URL (5min) for admin photo viewing |
| `app/api/admin/attendance/export/route.ts` | GET: CSV download per date |
| `app/api/cron/attendance-rollover/route.ts` | GET: nightly absent-row insertion |
| `app/api/cron/attendance-purge/route.ts` | GET: nightly photo deletion (90+ days) |
| `components/attendance/attendance-home.tsx` | Home shell with state-driven rendering |
| `components/attendance/status-card.tsx` | Slate/teal gradient cards by state |
| `components/attendance/status-chip.tsx` | Reusable status pill (PRESENT/LATE/HALF_DAY/ABSENT/etc.) |
| `components/attendance/live-timer.tsx` | useEffect-based 30s tick, hydration-safe |
| `components/attendance/bottom-nav.tsx` | 2-tab nav (Today / History) |
| `components/attendance/check-in-flow.tsx` | State machine: camera → confirm → submit → success |
| `components/attendance/check-out-flow.tsx` | Mirror of check-in, renders DaySummaryView on success |
| `components/attendance/camera-view.tsx` | getUserMedia + capture, full-screen black UI |
| `components/attendance/confirm-view.tsx` | Photo thumbnail + details + submit (reused by both flows) |
| `components/attendance/success-view.tsx` | Simple emerald check + auto-redirect (check-in only) |
| `components/attendance/day-summary-view.tsx` | Rich summary: total, stats, week chart (check-out only) |
| `components/attendance/history-calendar.tsx` | Calendar shell + month nav + detail card |
| `components/attendance/calendar-grid.tsx` | 42-cell Mon-Sun grid with status coloring |
| `components/attendance/day-detail-card.tsx` | Detail rows for selected day |
| `components/admin/attendance/attendance-dashboard.tsx` | Roster + detail panel layout |
| `components/admin/attendance/roster-table.tsx` | Fixed-layout table per UI v5.1 §40 |
| `components/admin/attendance/user-detail-panel.tsx` | 340px sticky right panel with selfie + details |
| `components/admin/attendance/photo-viewer.tsx` | Lazy signed-URL fetch + render |
| `components/admin/attendance/export-button.tsx` | CSV trigger via window.location.assign |
| `lib/attendance/state.ts` | Pure session pairing + derived state |
| `lib/attendance/format.ts` | IST clock, duration, weekday formatters |
| `lib/attendance/calendar.ts` | Month grid generation + parse/clamp helpers |
| `lib/attendance/admin-status.ts` | Derive display status for admin roster |
| `lib/attendance/geofence.ts` | Haversine distance, isWithinGeofence |
| `lib/attendance/photo.ts` | Client-side canvas compression (640px Q70) |
| `lib/supabase.ts` | Lazy singleton service-role client (server-only) |
| `lib/cron-auth.ts` | Bearer-token check (fail-closed if env missing) |
| `lib/auth.ts` | (modified) JWT trigger=update extended for consent + lastCheckInDate |
| `middleware.ts` | (modified) /api/cron/* bypass added before auth gate |
| `next.config.mjs` | (modified) Permissions-Policy: camera=(self), geolocation=(self) |
| `app/layout.tsx` | (modified) Manifest + Viewport metadata + apple-touch-icon |
| `components/admin/admin-sidebar.tsx` | (modified) Operations > Attendance link added |
| `vercel.json` | (NEW) 2 cron schedules: rollover 18:35 UTC, purge 20:30 UTC |
| `public/manifest.json` | PWA manifest with OrbitOMS branding |
| `public/icon-192.png` / `icon-512.png` / `apple-touch-icon.png` | Generated from canonical orbit logo |
| `public/icon-source.svg` | 512×512 source: teal bg + scaled orbit composition |
| `scripts/generate-icons.mjs` | @resvg/resvg-js icon generator (idempotent, devDep) |
| `docs/cron-notes.md` | Hobby tier 2-cron cap warning + consolidation strategy |

Total: 50 new files, 7 modified files. 6,203 insertions, 9 deletions in single commit `ed3a482a`.

## NEW API ENDPOINTS

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/attendance/consent` | Session (any role) | Record consent for current dpdpConsentVersion, bump user.attendanceConsentVersion |
| POST | `/api/attendance/check-in` | Session (gated user) | Multipart form (photo + lat/lng/accuracy) → upload to Storage + insert record + upsert summary |
| POST | `/api/attendance/check-out` | Session (gated user) | Multipart form → upload to Storage + insert CHECK_OUT linked to open CHECK_IN + recompute summary |
| GET | `/api/admin/attendance/photo?recordId=N` | Session + admin role | Returns signed URL (5min expiry) for the photo at record's photoPath |
| GET | `/api/admin/attendance/export?date=YYYY-MM-DD` | Session + admin role | Returns CSV with 12 columns: User, Role, Check In, Out, Worked, OT, Late, Status, Geo OK, Sessions, Device, IP |
| GET | `/api/cron/attendance-rollover` | Bearer (CRON_SECRET) | Inserts ABSENT rows for non-checked-in users yesterday + flags INCOMPLETE summaries with hasMissingCheckout |
| GET | `/api/cron/attendance-purge` | Bearer (CRON_SECRET) | Deletes photos older than photoRetentionDays from Supabase Storage + clears photoPath in DB |

## BUSINESS RULES ADDED

- **Attendance gate logic** (middleware.ts): rolloutStage='OFF' → no gate; 'TEST_USERS_ONLY' → gated iff user.attendanceTestUser=TRUE; 'ALL_USERS' → gated unless user.attendanceExempt=TRUE; admin role → gated only if attendanceTestUser=TRUE (recovery role).
- **JWT update trigger** (lib/auth.ts): when client calls `useSession().update()`, jwt callback re-reads attendanceConsentVersion + lastCheckInDate from DB. Doesn't disturb rolloutStageStaleAt (5-min stale window for rollout flags continues independently).
- **Cron auth bypass** (middleware.ts): paths starting with `/api/cron/` skip middleware auth; route handlers do their own bearer-token check via lib/cron-auth.ts (fail-closed if CRON_SECRET env var missing).
- **Photo path scheme**: `${YYYY}/${MM}/${DD}/${userId}_${timestampMs}_${TYPE}.jpg` where Y/M/D come from IST date parts. Enables P10 retention purge by path date prefix.
- **Status precedence on admin roster**: EXEMPT → known summary status → records-without-summary INCOMPLETE → today before-grace NOT_IN_YET → today after-grace ABSENT (provisional) → past-day ABSENT.
- **HALF_DAY threshold**: total worked < halfDayThresholdMinutes (default 240) regardless of late/on-time.
- **Geofence violations are warn-only**: API records `isOutsideGeofence=true` and admin sees flag, but check-in/out is allowed to proceed.
- **Photo retention is DPDP-compliant**: 90 days default, settings-driven via attendance_settings.photoRetentionDays.
- **Status chip color mapping**: PRESENT emerald, LATE/HALF_DAY amber, INCOMPLETE/ABSENT red, HOLIDAY/ON_LEAVE blue, NOT_IN_YET/EXEMPT gray.
- **PWA standalone mode**: start_url is `/attendance` (end-user primary task); app icon shows the canonical orbit logo on teal-600 background.
- **Bottom nav for end users**: only Today + History tabs (no Profile in v1).

## PENDING ITEMS

**Done this session (was pending in previous drafts):**
- ✅ P4 Consent screen + API
- ✅ P5 Home screen with all 3 states
- ✅ P6 Check-in flow + camera + GPS
- ✅ P7 Check-out flow + day summary
- ✅ P8 History calendar
- ✅ P9 Admin dashboard (read-only Phase 1)
- ✅ P10 Cron jobs (rollover + purge)
- ✅ P11 PWA manifest + icons
- ✅ Final batched commit + production deploy

**New pending (next session):**
- **Rollout planning (MDF)** | owner: me + Claude planning session | blocker: none — feature is live and dormant, waiting for rollout decision
- **Real depot geofence coords** | owner: me | blocker: need to physically measure/look up depot lat/lng (currently placeholder Surat city center 21.1702, 72.8311 with ±150m radius)
- **CRON_SECRET in production** | DONE — added to Vercel env vars, all 3 environments, sensitive badge
- **Phase 2 admin writes** (manual entry, edit record, mark exception) | owner: future prompt | blocker: scope decision (single prompt or split per write type)
- **PWA service worker for offline** | owner: future prompt | blocker: low priority, only needed if depot wifi is unreliable
- **PWA push notifications** | owner: future prompt | blocker: deferred to Phase 2

## CHECKLIST UPDATES

Add to CLAUDE_CORE.md §14 (session-start checklist):

- When working on attendance, always check current `rolloutStage` value before testing locally. If 'OFF', test the dormant path; if 'TEST_USERS_ONLY' or 'ALL_USERS', expect gate behaviour.
- Camera + GPS require HTTPS or localhost; verify Permissions-Policy in next.config.mjs has `camera=(self)` and `geolocation=(self)` before debugging permission errors.
- Photo upload uses service-role key (lib/supabase.ts); ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are in `.env.local` for local dev.
- Cron endpoints under `/api/cron/*` are bypassed by middleware; auth handled in route handlers via `isCronAuthorized()`. CRON_SECRET must be set or every request 401s.

## CONSOLIDATION NOTES

This is a major addition — recommend creating a dedicated `docs/CLAUDE_ATTENDANCE.md` rather than appending to existing files. Proposed sections:

- §1 Schema (3 tables + user columns + settings flags)
- §2 Architecture (gate logic, JWT claims, IST date handling)
- §3 User-facing screens (consent, home, check-in, check-out, history)
- §4 Admin dashboard (roster, detail panel, photo viewing, CSV export)
- §5 Cron jobs (rollover schedule + purge schedule + auth)
- §6 PWA (manifest + icons + standalone mode)
- §7 Known limitations (cross-midnight sessions, placeholder geofence, Phase 2 admin writes deferred)
- §8 Rollout (operational stages: OFF → TEST_USERS_ONLY → ALL_USERS)

Cross-references to update during consolidation:
- **CLAUDE_CORE.md §3** — add to engineering rules: cron endpoints have own auth, `/api/cron/*` bypassed by middleware
- **CLAUDE_CORE.md §4** — add to infra: `CRON_SECRET` env var required, photo bucket `attendance-photos` (private)
- **CLAUDE_CORE.md §5** — add Attendance to screens index pointing to CLAUDE_ATTENDANCE.md
- **CLAUDE_CORE.md §13** — admin sidebar has Operations > Attendance (CalendarCheck icon) AND Personal > Attendance (ClipboardCheck icon); two distinct entries
- **CLAUDE_UI.md §6** — UniversalHeader pattern reused on /admin/attendance with stats array, segments, search, date picker, download icon
- **CLAUDE_UI.md §40** — fixed-layout table pattern reused on roster-table.tsx (9 columns summing to 100%, 32px header, 36px rows)

Update schema version reference: foundation deployed schema v27.1, P4-P11 added no new schema. Latest is v27.1.

---

## ROLLOUT NOTES (FOR NEXT SESSION'S MDF)

This section is informational — not for canonical files. It captures the rollout context that the next planning session will turn into an actual MDF.

**Current production state:**
- Branch `main` includes everything through commit `ed3a482a`
- Vercel deployed successfully on 2026-05-08
- `attendance_settings.rolloutStage = 'OFF'` (dormant)
- All env vars set in Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (sensitive), CRON_SECRET (sensitive)
- Crons configured but no-op while feature dormant (rollover finds no users to process if rolloutStage=OFF — actually: crons run regardless of rolloutStage; rollover always processes yesterday's missing users for accountability, even if no one was gated. Verify behaviour in MDF.)

**Rollout stages:**
- **Stage 0 (current):** OFF — feature invisible, only admin sees sidebar entries
- **Stage 1 (pilot):** TEST_USERS_ONLY — admin + 2-3 selected users (Chandresh, Bankim, Deepanshu?) gated; full feature usage; collect feedback for ~1 week
- **Stage 2 (full):** ALL_USERS — every active user gated except `attendanceExempt=true` users; depot operates on attendance going forward

**Pre-rollout decisions for MDF:**
1. Which users for pilot? Recommend Chandresh (Tint Manager) + Bankim/Deepanshu (Billing Operators) — daily active users, willing to give feedback.
2. Real depot GPS coordinates — measure on-site or use Google Maps "what's here" at depot building. Update via SQL: `UPDATE attendance_settings SET geofenceCenterLatitude = ..., geofenceCenterLongitude = ...`
3. Comms plan — how/when to tell pilot users they're being added. Recommend Slack/WhatsApp message with screenshot of consent screen.
4. Feedback channel — dedicated chat thread? In-app feedback button (none built)? Verbal during morning standup?
5. Failure rollback procedure — what triggers reverting to OFF? Define thresholds (>3 users hitting errors, photo upload failures >5%, etc.)
6. Phase 2 trigger — when to build admin manual entry / edit / mark exception? Recommend after Stage 2 with at least 2 weeks of real data showing genuine need.

These belong in the MDF (Master Deployment File), not in canonical context. Drafted for reference.
