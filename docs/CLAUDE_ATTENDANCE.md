# CLAUDE_ATTENDANCE.md — Attendance + OT Module
# v1.4 · Schema v27.24 · September 2026 · updated 2026-09-19
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Daily check-in/out with selfie + geofence + OT workflow. PWA UX on `/attendance` (end users — any logged-in user, §3/§4) and admin dashboard at `/admin/attendance` (roles admin + ops_admin, by a hardcoded role check in `app/(ops)/layout.tsx` — §4; the **`attendance_admin`** page key gates no page or API) with three sub-pages: OT pending queue, settings, OT audit.

Rollout stage drives sidebar visibility only (see §3). Settings-driven thresholds. Pure decision helpers separated from DB-touching APIs.

---

## 1. What this module is

Two pipelines:

- **End user** (`/attendance`) — PWA-ish flow. Consent → check-in (camera + GPS) → check-out (camera + GPS + optional OT claim) → day summary.
- **Admin** (`/admin/attendance` + sub-pages) — daily roster, OT pending queue, settings (replaces SQL edits), OT audit.

**Who reaches the admin side.** The four `/admin/attendance` pages sit under `app/(ops)/layout.tsx`, which redirects to `/unauthorized` unless the session's roles include `admin` or `ops_admin` (`if (!roles.some((r) => ["admin", "ops_admin"].includes(r)))`). That role check is the only gate. The PageKey `attendance_admin` is read only in `lib/permissions.ts` — its one effect is whether the sidebar shows the "Attendance" link (`PAGE_NAV_MAP` entry, filtered on `canView` by `buildNavItems`); it gates no page and no API. ⚠ The page comment `app/(ops)/admin/attendance/page.tsx:26-27` ("enforced by app/(admin)/admin/layout.tsx via requireSuperuser") is wrong on both file and mechanism.

**The admin APIs split by role** (`hasRole` from `lib/rbac.ts`, role arrays only — the `isSuperuser` flag is not consulted):
- `photo` (`app/api/admin/attendance/photo/route.ts:19`) and `export` (`export/route.ts:42`) accept **`[ADMIN]` only** — **ops_admin cannot view selfies or export the CSV**, although ops_admin can open the dashboard that offers both.
- `settings`, `ot-pending`, `ot-pending/[recordId]`, `ot-audit` accept `[ADMIN, OPS_ADMIN]`.

Photo storage in Supabase private bucket **`attendance-photos`** (`STORAGE_BUCKET` in the check-in, check-out, admin photo and purge routes, e.g. `app/api/cron/attendance-purge/route.ts:8`). Signed URLs only.

---

## 2. Database

> 🔴 **These three blocks were REWRITTEN 2026-08-04 against `information_schema` (live) +
> `schema.prisma` — the previous version carried wrong column names throughout** (`eventAt`,
> `accuracyMeters`, `deviceInfo`, `linkedCheckInId`, `otApprovedAdjustedMinutes`,
> `totalWorkedMinutes`, `otClaimedMinutes`, `sessionsCount`) **and three columns that DO NOT EXIST**
> (`otCutoffHourIST`, `otRequiresApproval`, `otAutoApproveThresholdMinutes`). Live and Prisma agree
> with each other; the doc was the outlier.

### attendance_records (per CHECK_IN | CHECK_OUT event) [live-verified 2026-08-04]

```
id, userId (FK RESTRICT), type ('CHECK_IN'|'CHECK_OUT')
timestamp                 TIMESTAMPTZ (the event instant — NOT "eventAt")
attendanceDate            TEXT (IST YYYY-MM-DD)
sessionId                 INT? (pairs OUT to IN — NOT "linkedCheckInId")
latitude, longitude       DECIMAL(10,7)
locationAccuracyMeters    INT?, locationVerified BOOL, locationDistanceMeters INT?
isOutsideGeofence         BOOLEAN
photoPath TEXT?, photoSizeBytes INT?
userAgent TEXT?, ipAddress TEXT?, deviceLabel TEXT?
isManualEntry BOOL, manualReason TEXT?, createdById FK?, createdAt
isLate, isOvertime, hasNoPhoto, hasNoLocation  BOOLEAN flags

-- OT columns
otClaimed BOOL?, otClaimReason TEXT?, otTotalLessThan95 BOOL?
otApprovalStatus TEXT? — UPPERCASE, six values: NOT_CLAIMED | AUTO_CREDITED |
                  AUTO_CREDITED_GRACE | PENDING (check-out route, via decideOtOutcome,
                  lib/attendance/ot-logic.ts:40-44) | APPROVED | REJECTED (the PATCH route,
                  app/api/admin/attendance/ot-pending/[recordId]/route.ts). No lowercase
                  value is written anywhere.
otMinutesCredited INT? (the credited figure — NOT "otApprovedAdjustedMinutes")
otApprovedById FK?, otApprovedAt TIMESTAMPTZ?, otAdminNote TEXT?

@@index([userId, attendanceDate]) · ([attendanceDate]) · ([type, attendanceDate])
· ([otApprovalStatus, attendanceDate])
```

### attendance_summary (one per user per IST date) [live-verified 2026-08-04]

```
id, userId, attendanceDate
firstCheckInAt, lastCheckOutAt          TIMESTAMPTZ?
sessionCount INT, totalMinutesWorked INT, overtimeMinutes INT, lateMinutes INT
status TEXT default 'ABSENT' (plain String — PRESENT/LATE/HALF_DAY/INCOMPLETE/ABSENT
  in data; HOLIDAY/ON_LEAVE/NOT_IN_YET/EXEMPT are DERIVED display statuses, §8,
  not necessarily stored)
exceptionReason TEXT?, hasMissingCheckout, hasGeofenceViolation, hasManualEntries
otMinutesCredited INT, otApprovalState TEXT?
updatedAt

@@unique([userId, attendanceDate]) · @@index([attendanceDate]) · ([status, attendanceDate])
```

### attendance_settings [live-verified 2026-08-04]

```
id, scope TEXT default 'GLOBAL', roleSlug TEXT?   — @@unique([scope, roleSlug]);
                                                    the singleton is BY CONVENTION (one GLOBAL row),
                                                    not "id always 1"
rolloutStage 'OFF'|'TEST_USERS_ONLY'|'ALL_USERS'
workStartTime, workEndTime, checkInWindowStart, checkInWindowEnd   TEXT 'HH:mm'
lateGraceMinutes, halfDayThresholdMinutes (default 240)
geofenceLat, geofenceLng  DECIMAL(10,7) — NOT "geofenceLatitude/Longitude"
geofenceRadiusMeters
requirePhoto, requireLocation, photoMaxWidthPx, photoJpegQuality, photoRetentionDays (default 90)
dpdpConsentVersion
depotWorkingMinutes (default 570 — the 9.5h OT denominator)
otTriggerTime 'HH:mm', otMonthlyGraceLimit (default 3), otPromptEnabled
updatedAt, updatedById
```

### OT support tables (were MISSING from this doc entirely)

```
attendance_ot_grace        per (userId, yearMonth) — flagCount (the monthly grace counter §16 reads)
attendance_ot_audit        per action on an OT record — recordId, userId, action, performedById,
                           performedAt, fromStatus, toStatus, note
```

### users — added columns

```
attendanceConsentAt           TIMESTAMPTZ (nullable)
attendanceConsentVersion      TEXT (nullable, matched against settings.dpdpConsentVersion)
attendanceExempt              BOOLEAN DEFAULT FALSE
attendanceTestUser            BOOLEAN DEFAULT FALSE
```

All FKs to `users(id)` use `ON DELETE RESTRICT`. All timestamps `TIMESTAMPTZ`. All columns camelCase (no `@map`).

---

## 3. Rollout stages

`attendance_settings.rolloutStage` does **NOT** gate the pages or the APIs. **Any logged-in user can open `/attendance` and check in at any stage, OFF included.** The pages require a session only (`app/attendance/page.tsx:12-16`), the APIs return 401 only when unauthenticated (`app/api/attendance/check-in/route.ts:28-35`, `check-out/route.ts:44-51`), and nothing under `app/attendance/**` or `app/api/attendance/**` reads `rolloutStage` (grep = 0).

The stage drives exactly two things:

1. **Sidebar visibility** of the end-user "Attendance" link — `buildNavItems` in `lib/permissions.ts:180-191`: admin always sees it; ops_admin never does (they get the `attendance_admin` link to `/admin/attendance` instead); everyone else sees it iff `attendanceTestUser === true` OR `rolloutStage === "ALL_USERS"`. (`attendanceExempt` is not consulted here.)
2. **The JWT `lastCheckInDate` fetch** — `gateAppliesTo` in `lib/auth.ts:73-79` decides whether the jwt callback queries today's CHECK_IN: OFF → never; `attendanceExempt` → never; admin → iff `attendanceTestUser`; TEST_USERS_ONLY → iff `attendanceTestUser`; ALL_USERS → yes. ⚠ **`lastCheckInDate` is computed but nothing reads it** — its only non-`lib/auth.ts` appearances are the type + pass-through in `auth.config.ts:25,47,90` and stale comments (`components/attendance/check-in-flow.tsx:151-152`, `lib/attendance/date.ts:15`). The comment `lib/auth.ts:70` "Mirror of the middleware gate logic" describes a gate that no longer exists.

**Stale window:** the **jwt callback** in `lib/auth.ts` (not middleware) re-reads `rolloutStage`, `attendanceTestUser`, `attendanceExempt` and `attendanceConsentVersion` from the DB once `rolloutStageStaleAt` has passed — `STALE_MS = 5 * 60 * 1000` (`lib/auth.ts:20`, refresh at `:151-167`).

**Kill switch:** `PATCH /api/admin/attendance/settings { otPromptEnabled: false }` disables the OT prompt without affecting check-in/out.

---

## 4. Access flow — pages, not middleware

`middleware.ts` has **no attendance logic** (`grep -n attendance middleware.ts` = 0). Its only attendance-adjacent rule: paths starting with `/api/cron/` skip session auth (`middleware.ts:42`) — the route handlers do the bearer-token check via `lib/cron-auth.ts` (fail-closed if `CRON_SECRET` missing). `/attendance` and `/api/attendance/*` get the ordinary logged-in check like every other route.

Was: a middleware gate redirecting gated users to `/attendance` until check-in, until 2026-07-04; now none (236f9743, 30 lines removed from `middleware.ts`; `CLAUDE_CORE.md §5` "Middleware — no forced attendance redirect"). Do not revert.

**End-user pages** (`app/attendance/page.tsx`, `check-in/page.tsx`, `check-out/page.tsx`, `history/page.tsx`), each server-side:
1. No session → `redirect("/login")`.
2. Read `users.attendanceConsentVersion` and the GLOBAL settings row **fresh from the DB** (not from the JWT, so a stale claim cannot trap a freshly-consented user — `app/attendance/page.tsx:18-24`).
3. `userVersion !== currentVersion` (settings `dpdpConsentVersion`, fallback `"v1.0"`) → `redirect("/attendance/consent")` (`page.tsx:37-38`, `check-in/page.tsx:40`, `check-out/page.tsx:45`, `history/page.tsx:42`).
4. Otherwise render. `check-out/page.tsx:58` additionally redirects to `/attendance` when there is no open session.

`consent/page.tsx:30-31` does the reverse: already on the current version → `redirect("/attendance")`.

⚠ **The APIs do not check consent.** `/api/attendance/check-in` and `check-out` require a session only (§3); the consent redirect is a page-level behaviour.

**Admin pages:** `app/(ops)/layout.tsx` role check (admin | ops_admin → else `/unauthorized`) — §1.

JWT update trigger (`lib/auth.ts:100-114`): when the client calls `useSession().update()` (`consent-form.tsx:42`, `check-in-flow.tsx:153`), the jwt callback re-reads `attendanceConsentVersion` + `lastCheckInDate` from DB.

---

## 5. Consent flow (DPDP)

Single full-screen page at `/attendance/consent`. Checkbox + Accept/Decline.

Triggered when:
- User has never consented (`attendanceConsentAt IS NULL`), OR
- User's `attendanceConsentVersion !== settings.dpdpConsentVersion`

On Accept:
1. `POST /api/attendance/consent` records `attendanceConsentAt = NOW()` and `attendanceConsentVersion = settings.dpdpConsentVersion`
2. `useSession().update()` refreshes JWT
3. Redirect to `/attendance` home

Decline shows informational screen (no auto-logout).

---

## 6. Check-in flow

Page: `app/attendance/check-in/page.tsx` (server-rendered).

1. Server: auth + settings fetch
2. Client: camera preview with 240×320 face frame guide overlay
3. Client: GPS request (`Permissions-Policy: geolocation=(self)` in `next.config.mjs`)
4. Capture photo → compress to 640px Q70 JPEG via `lib/attendance/photo.ts` canvas helper
5. Multipart POST `/api/attendance/check-in` with photo blob + lat/lng/accuracy + deviceInfo
6. API: upload photo to Supabase Storage (PRIVATE bucket) at `${YYYY}/${MM}/${DD}/${userId}_${timestampMs}_${TYPE}.jpg` (IST date parts)
7. API: insert `attendance_records` row, set `isOutsideGeofence` via haversine
8. API: upsert `attendance_summary` for today
9. Redirect home

**Geofence violations are warn-only.** `isOutsideGeofence=true` is recorded and admin sees flag, but check-in/out is allowed to proceed.

---

## 7. Check-out flow

Page: `app/attendance/check-out/page.tsx`. Settings fetch selects `otTriggerTime` + `otPromptEnabled` (plus standard fields).

End-user component: `components/attendance/check-out-flow.tsx` runs a FlowStep state machine.

**FlowStep state machine:**

```ts
type FlowStep =
  | { kind: "camera" }
  | { kind: "confirm"; photoBlob: Blob; photoDataUrl: string; capturedAtISO: string }
  | { kind: "ot-prompt-choice"; photoBlob; photoDataUrl; capturedAtISO }
  | { kind: "ot-prompt-reason"; photoBlob; photoDataUrl; capturedAtISO; reason: string }
  | { kind: "submitting" }
  | { kind: "success"; payload: CheckOutSuccessPayload }
  | { kind: "error"; message: string }
```

**Flow:**
1. User taps Check Out → camera → confirm selfie
2. If current IST is strictly after `otTriggerTime` (`check-out-flow.tsx:282` skips at `nowMin <= triggerMin`) AND `otPromptEnabled === true`:
   - **OT choice screen** appears (CLAUDE_UI.md §40)
   - "Yes, claim OT" → reason screen
   - "No, just clocking out" → `submit("no")`
   - "Cancel and go back" → camera (photo discarded)
3. Reason screen: textarea + amber callout "N min overtime so far". Submit enabled when reason has any non-whitespace content (1+ char). Back returns to choice.
4. Submit sends FormData with `otClaimed: "yes"|"no"` + `otClaimReason` when yes.
5. Success screen (`DaySummaryView`) shows OT outcome banner based on `otOutcome.status` (CLAUDE_UI.md §3 OT outcome banners).

If `otPromptEnabled === false` OR current IST <= trigger → prompt skipped silently, submit sends `otClaimed: "no"`.

Phone hardware back exits the route (photo discarded, user retakes on return). In-flow controls are the back arrow and "Cancel and go back" link.

**Auto-ticking clock NOT wired** on the OT screens. Choice screen is static between mount and tap. Reason screen re-renders on every keystroke so "N min overtime so far" updates organically.

---

## 8. Status computation

**Status precedence (admin roster):**
1. EXEMPT
2. Known summary status
3. Records-without-summary → INCOMPLETE
4. Today before grace → NOT_IN_YET
5. Today after grace → ABSENT (provisional)
6. Past-day → ABSENT (committed by rollover cron)

**HALF_DAY threshold:** `totalWorkedMinutes < halfDayThresholdMinutes` (default 240) regardless of late/on-time.

**LATE:** first check-in after grace window from depot opening (settings-driven).

Status chip colours: `CLAUDE_UI.md §3`.

---

## 9. Admin dashboard — /admin/attendance

`app/(ops)/admin/attendance/page.tsx` (⚠ the route group is **`(ops)`**, not `(admin)` — the files-map path was wrong until 2026-08-04). Server-side roster derivation.

### 9.0 The attendance admin header — NOT UniversalHeader [redesigned 2026-05-14, doc caught up 2026-08-04]

All four admin attendance pages render **`components/admin/attendance/attendance-page-header.tsx`** —
a two-strip header that *"replaces admin-sub-nav.tsx + the per-page UniversalHeader chrome"* (its own
comment), shipped in commit **`b9923b3e`** (2026-05-14, "redesign 4 admin pages — workflow switcher +
Reports dropdown") per the approved mockup **`docs/mockups/attendance/admin-redesign.html`** (siblings:
`ot-pending.html`, `settings.html`, `ot-audit.html`). Strip 1: the workflow switcher (Dashboard / OT
Pending / Settings / OT Audit) + title — `titleOverride` takes a `" · "`-separated breadcrumb (used on
Settings: "Attendance · Settings", first part gray, second bold) — + a Reports dropdown; Strip 2's
left/right content is owned by each caller (`showWorkflowSwitcher` defaults true). This file owns what
the pages render; `CLAUDE_UI.md §6/§49-51` own the roster fact and design rules. **The §9.1-9.3
"UniversalHeader title …" claims below were stale from 2026-05-14 until this correction.**

**Layout:** roster table left + 340px sticky right detail panel.

**Roster table:** fixed-layout per `CLAUDE_UI.md §27`. Columns (`components/admin/attendance/roster-table.tsx` `<thead>`): # · User · Role · In · Out · Worked · OT · Status · Flags.

**Right panel:** selfie viewer + detail rows. Photo lazy-loaded via signed URL.

**Photo viewer:** `GET /api/admin/attendance/photo?recordId=N` returns signed URL (5-min expiry). Never exposes the bucket publicly. Admin role only — ops_admin gets 403 (§1).

**CSV export:** `GET /api/admin/attendance/export?date=YYYY-MM-DD` returns CSV with 12 columns — `CSV_HEADERS` in `app/api/admin/attendance/export/route.ts:19-32`: User · Role · Check In · Check Out · Worked · Overtime · Late · Status · Geofence OK · Sessions · Device · IP. This is the export's header, not the on-screen roster. Admin role only (§1).

### 9.1 Sub-page: OT pending queue (`/admin/attendance/ot-pending`)

Visual: `CLAUDE_UI.md §49`.

Header: `attendance-page-header.tsx` (§9.0 — NOT UniversalHeader; corrected 2026-08-04), title "OT Pending Approvals". Roster table-style layout (fixed-layout per UI §27).

Per row: user · date · claim reason · total worked · OT minutes raw · `[Approve]` · `[Reject]`.

**Approve modal** (`ot-approve-modal.tsx`): confirm only — it sends `{ action: "approve" }` (`:48`) and has **no minutes input**. The backend recomputes the credit from the **live** `otTriggerTime` (check-out IST minutes − trigger) and applies exactly that; if the recomputed figure is 0 (trigger moved past the check-out clock) it refuses with **422** and the modal says "Trigger time moved past check-out. Reject this claim instead." (`app/api/admin/attendance/ot-pending/[recordId]/route.ts` approve branch; modal header comment `:14-24`).

**Reject modal:** user/date/reason quote · amber warning "Rejected days still consume monthly grace" · optional admin note textarea (500-char limit, counter "{n} / 500").

**On 409 (already actioned by other admin):** inline error "Already actioned. Closing…" + parent refetches list, showing the banner "Already actioned by another admin. Refreshing list…" (`ot-pending-table.tsx:88`).

**Empty state:** lucide CheckCircle2 in emerald circle, "Nothing pending" headline.

Backend:
- `GET /api/admin/attendance/ot-pending` (list)
- `PATCH /api/admin/attendance/ot-pending/[recordId]` body `{ action: "approve" | "reject", note?: string (≤500 chars) }` (route header comment `:34`). No minutes override exists. 409 if the record is no longer `PENDING`; writes `APPROVED`/`REJECTED` + an `ADMIN_APPROVE`/`ADMIN_REJECT` row in `attendance_ot_audit`.

### 9.2 Sub-page: Settings (`/admin/attendance/settings`)

Visual: `CLAUDE_UI.md §50`.

Header: `attendance-page-header.tsx` (§9.0 — NOT UniversalHeader; corrected 2026-08-04), breadcrumb "Attendance · Settings" + subtitle "Last updated {date} by {updatedByName}".

**6 sections (in form order):**

1. **Rollout** — `rolloutStage` radio (OFF / TEST_USERS_ONLY / ALL_USERS) · `dpdpConsentVersion` text input · "Force re-consent" button (opens confirm modal, increments minor version e.g. v1.0 → v1.1)
2. **Work hours** — `workStartTime`, `workEndTime`, `checkInWindowStart`, `checkInWindowEnd` · `lateGraceMinutes` (number 0-120)
3. **Geofence** — `geofenceLat` (number, step="0.0000001"), `geofenceLng`, `geofenceRadiusMeters` (10-5000) · "Use my current location" button (calls `navigator.geolocation.getCurrentPosition`, handles denial inline)
4. **Photo policy** — `requirePhoto` toggle, `requireLocation` toggle, `photoMaxWidthPx` (240-1920), `photoJpegQuality` (30-95), `photoRetentionDays` (7-730)
5. **OT policy** — `otPromptEnabled` toggle PROMINENT at top (toggling OFF opens killswitch confirm modal first), `otTriggerTime`, `depotWorkingMinutes` (60-720), `otMonthlyGraceLimit` (0-30)
6. **Thresholds** — `halfDayThresholdMinutes` (60-480)

**Sticky save bar (bottom):** `position: sticky bottom-0`, white bg with top border. Left: "Discard changes" link (only when dirty). Right: "{n} fields changed" text + "Save changes" button (`bg-gray-900 text-white`, disabled `bg-gray-200 text-gray-400` when not dirty).

**Dirty detection:** Compute `changedKeys` where `formValues[k] !== originalValues[k]`. Submit only sends changed keys.

**Client-side validation mirrors backend:**
- Per-field: range/regex on every field
- Cross-field: `workEndTime > workStartTime`, `checkInWindowEnd > checkInWindowStart`, `otTriggerTime >= workStartTime` — surfaced at section header level

**Submit response handling:**
- 200 with `willForceReconsent: true` → amber toast "Re-consent triggered"
- 200 with `rolloutActivated: true` → green `ok`-token toast "Rollout activated" (`settings-toast.tsx` `rollout` spec, `bg-ok-bg`)
- 200 (neither flag) → gray-900 toast "Settings saved"
- 400 with `errors[]` → distribute to field/section errors, scroll to first, red toast
- 403 / 401 → "Session expired — refresh and re-login" (NOTE: 403 permission-denied also fires this — known mis-label)
- 500 → red toast "Server error — try again"

Backend: `GET /api/admin/attendance/settings`, `PATCH /api/admin/attendance/settings` (547 lines with full validation + cross-field rules + `willForceReconsent` / `rolloutActivated` flags).

### 9.3 Sub-page: OT audit (`/admin/attendance/ot-audit`)

Visual: `CLAUDE_UI.md §51`.

Server component reads `?month=YYYY-MM` query param. Header: `attendance-page-header.tsx` (§9.0 — NOT UniversalHeader; corrected 2026-08-04), title "OT Audit" + month picker on right (`{Month} {YYYY} ▾`).

**6-tile stats strip:**
- Total OT credited (with "≈ Xh Ym" subtext)
- Auto credited
- Grace credited
- Admin approved
- Pending (amber when > 0)
- Rejected (count of claims, not minutes)

**User table:** # · User · Days · Total OT · Auto · Grace · Approved · Pending · Rejected · expand chevron. Sort Total OT DESC. Row click toggles expand (full row hit target).

**Expand panel:** day-by-day rows with per-day breakdown (`ot-audit-day-breakdown.tsx`).

Backend: `GET /api/admin/attendance/ot-audit?month=YYYY-MM` (309 lines).

Components:
- `components/admin/attendance/ot-audit-view.tsx` — client shell, owns expandedUserId state
- `components/admin/attendance/ot-audit-stats.tsx`
- `components/admin/attendance/ot-audit-table.tsx`
- `components/admin/attendance/ot-audit-day-breakdown.tsx`
- `components/admin/attendance/month-picker.tsx` — reusable

---

## 10. End-user history — /attendance/history

Monthly calendar grid. Each day cell shows status chip + worked hours.

Click day → opens detail card showing all sessions, photos (small thumb), OT claim.

Month parsing + clamping in `lib/attendance/calendar.ts`.

---

## 11. Cron jobs

`vercel.json` configures 2 **daily** schedules (the binding Hobby limit is CADENCE — crons run at most once/day; the old "tier cap"/count framing is stale — see `CLAUDE_CORE.md §4`):

| Path | Schedule (UTC) | IST | Purpose |
|---|---|---|---|
| `/api/cron/attendance-rollover` | `35 18 * * *` (18:35 UTC daily) | 00:05 | Inserts ABSENT rows + flags INCOMPLETE summaries with `hasMissingCheckout` |
| `/api/cron/attendance-purge` | `30 20 * * *` (20:30 UTC daily) | 02:00 | Deletes photos older than `photoRetentionDays` from Supabase Storage + clears `photoPath` in DB |

UTC + 5:30 = IST; India has no DST, so the mapping is stable year-round. (Schedule strings re-read from `vercel.json` 2026-09-19; the IST times match each route's own header comment.)

*(⚠ Hobby guarantees firing only **within the scheduled hour**, not at the exact minute — an 18:35 job
may fire any time before 19:35 UTC. Do not build anything minute-precise on these.)*

**This section supersedes `docs/cron-notes.md`** (kept on disk, not edited). One correction to it: its "Hobby tier 2-cron cap — we are at the cap" section is wrong — the Hobby limit is **cadence** (at most once per day), not a 2-job count (`CLAUDE_CORE.md §4`).

**Auth:** Bearer token via `CRON_SECRET`. Bypasses middleware session auth (`middleware.ts:42`). `lib/cron-auth.ts` `isCronAuthorized` fails closed if the env var is missing or empty — an undefined secret never authenticates as `Bearer undefined`. `CRON_SECRET` must be set in `.env.local` for dev and in Vercel env vars (§17).

**Local test:** crons only fire on Vercel. Locally, send `Authorization: Bearer <CRON_SECRET>` to `http://localhost:3000/api/cron/attendance-rollover` (or `-purge`). Both return `{ ok: true, … }` with per-job counts (`attendance-rollover/route.ts:96`, `attendance-purge/route.ts:103`).

**Failure handling:** per-item errors are `console.error`-logged and pushed to the response's `errors` array without aborting the run; a top-level failure returns 500 (`attendance-rollover/route.ts:106-109`, `attendance-purge/route.ts:112-113`). Vercel does not retry; there is no alerting layer — Vercel function logs are the record.

**Jitter:** rollover computes `yesterdayIST` from `now + 1 hour` to absorb ±60 min of firing jitter (`attendance-rollover/route.ts:28-34`). Purge is jitter-insensitive (absolute cutoff).

**Rollover scope:** every `isActive: true, attendanceExempt: false` user (`attendance-rollover/route.ts:38-40`) with no summary and no records for the IST day just ended gets an `ABSENT` summary — **every day including Sundays, regardless of `rolloutStage`** (no day-of-week or stage check in the route). Users with records but no summary are skipped as anomalies; existing INCOMPLETE summaries get `hasMissingCheckout = true`.

**Photo retention:** DPDP-compliant default 90 days. Settings-driven via `attendance_settings.photoRetentionDays`. Purge selects `attendance_records` with `photoPath` not null and **`createdAt` older than the cutoff** (`attendance-purge/route.ts:51-60`), cursor-paginated in batches of 100 — it does not parse the `photoPath` date prefix.

---

## 12. API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/attendance/consent` | Session | Record consent, bump `attendanceConsentVersion` |
| POST | `/api/attendance/check-in` | Session only (no rollout or consent check — §3/§4) | Multipart (photo + lat/lng/accuracy) → upload + insert + upsert summary |
| POST | `/api/attendance/check-out` | Session only (no rollout or consent check — §3/§4) | Multipart + `otClaimed?` + `otClaimReason?` → close CHECK_IN + recompute summary |
| GET | `/api/admin/attendance/photo?recordId=N` | Session + **admin only** | Returns signed URL (5min) for the photo |
| GET | `/api/admin/attendance/export?date=YYYY-MM-DD` | Session + **admin only** | CSV download |
| GET | `/api/admin/attendance/settings` | Session + admin \| ops_admin | Read settings |
| PATCH | `/api/admin/attendance/settings` | Session + admin \| ops_admin | Update settings — replaces all SQL-edits |
| GET | `/api/admin/attendance/ot-pending` | Session + admin \| ops_admin | List records with `otApprovalStatus = "PENDING"` (`ot-pending/route.ts:45`) |
| PATCH | `/api/admin/attendance/ot-pending/[recordId]` | Session + admin \| ops_admin | Approve or reject — body `{ action, note? }`, no minutes override (§9.1) |
| GET | `/api/admin/attendance/ot-audit?month=YYYY-MM` | Session + admin \| ops_admin | Read-only monthly audit |
| GET | `/api/cron/attendance-rollover` | Bearer (CRON_SECRET) | Rollover ABSENT + INCOMPLETE flags |
| GET | `/api/cron/attendance-purge` | Bearer (CRON_SECRET) | Photo retention purge |

---

## 13. Files map

```
app/attendance/
  layout.tsx                          full-screen wrapper, no sidebar, 480px column
  page.tsx                            home, state derivation
  consent/page.tsx                    server consent check
  consent/consent-form.tsx            client form
  check-in/page.tsx                   server: auth + settings
  check-out/page.tsx                  server: open-session validation + settings fetch
  history/page.tsx                    server: month parse + fetch

components/attendance/
  attendance-home.tsx                 home screen (rendered by app/attendance/page.tsx)
  bottom-nav.tsx                      Today + History tabs
  calendar-grid.tsx, history-calendar.tsx   history month grid
  camera-view.tsx                     camera preview + capture — ⚠ SHARED with MRN (§17)
  check-in-flow.tsx                   check-in flow (camera → confirm → submit)
  check-out-flow.tsx                  FlowStep state machine, OT prompt screens
  confirm-view.tsx                    photo confirm step (check-in + check-out)
  day-summary-view.tsx                success screen + OT outcome banner
  day-detail-card.tsx                 detail rows for selected day
  live-timer.tsx                      running worked-time clock
  status-card.tsx, status-chip.tsx    home status card + status chip
  success-view.tsx                    check-in success screen (check-out uses day-summary-view)

app/(ops)/layout.tsx                  the admin|ops_admin role gate (§1)
app/(ops)/admin/attendance/           ⚠ route group is (ops), NOT (admin) — corrected 2026-08-04
  page.tsx                            roster dashboard
  ot-pending/page.tsx                 OT approval queue
  settings/page.tsx                   settings form
  ot-audit/page.tsx                   monthly audit

components/admin/attendance/attendance-page-header.tsx   the two-strip admin header (§9.0)

components/admin/attendance/
  attendance-dashboard.tsx            roster + detail layout
  roster-table.tsx                    fixed-layout per UI §27
  user-detail-panel.tsx               340px sticky right panel
  photo-viewer.tsx                    lazy signed-URL fetch
  export-button.tsx                   CSV trigger
  ot-pending-table.tsx                ot-pending list + rows + 409 refetch banner
  ot-approve-modal.tsx, ot-reject-modal.tsx
  settings-form.tsx                   the big form
  settings-section.tsx                reusable card wrapper
  settings-toast.tsx                  top-right toast
  settings-confirm-modal.tsx          re-consent + kill switch
  ot-audit-view.tsx, ot-audit-stats.tsx, ot-audit-table.tsx
  ot-audit-day-breakdown.tsx
  month-picker.tsx                    reusable

lib/attendance/
  state.ts                            pure session pairing + derived state
  format.ts                           IST clock, duration, weekday formatters
  calendar.ts                         month grid + parse/clamp helpers
  admin-status.ts                     derive display status for admin roster
  geofence.ts                         haversine, isWithinGeofence
  photo.ts                            client canvas compression (640px Q70) — ⚠ reached by MRN via camera-view (§17)
  ot-logic.ts                         pure OT decision helper (no Prisma) — decideOtOutcome
  date.ts                             istDateString helper

lib/supabase.ts                       lazy singleton service-role client (server-only)
lib/cron-auth.ts                      bearer-token check (fail-closed)

api/attendance/consent/route.ts
api/attendance/check-in/route.ts
api/attendance/check-out/route.ts
api/admin/attendance/photo/route.ts
api/admin/attendance/export/route.ts
api/admin/attendance/settings/route.ts
api/admin/attendance/ot-pending/route.ts
api/admin/attendance/ot-pending/[recordId]/route.ts
api/admin/attendance/ot-audit/route.ts
api/cron/attendance-rollover/route.ts
api/cron/attendance-purge/route.ts
```

---

## 14. PWA setup

`public/manifest.json` — **start_url `/`** [CORRECTED 2026-07-22 — the real file says `/`, NOT `/attendance` (code wins)]. The installed app therefore launches at **root**, where the auth + role redirect takes over — it does **not** land straight on the punch screen. `name` and `short_name` are both **`"Orbit"`** — the name/short_name experiment is settled (4a2f763f, 2026-08-12, "match manifest short_name to name").

Icons: a two-step pipeline (`scripts/generate-wordmark.mjs:149` — `generate-wordmark.mjs → public/icon-source.svg → generate-icons.mjs → 3 PNGs`):
1. `public/icon-source.svg` is **itself generated** — its line 2 reads `GENERATED by scripts/generate-wordmark.mjs — do not edit by hand.` (written at `generate-wordmark.mjs:210`). 512×512, **violet** radial-gradient tile (rebrand 3b0490e6 + 67d734e2, 2026-09-09).
2. `scripts/generate-icons.mjs` (@resvg/resvg-js, idempotent, devDep) renders it to:
- `public/icon-192.png`
- `public/icon-512.png`
- `public/apple-touch-icon.png`

To change the mark, edit and re-run `generate-wordmark.mjs`, then `generate-icons.mjs` — never hand-edit the SVG.

`app/layout.tsx` metadata: Manifest + Viewport + apple-touch-icon.

`next.config.mjs` Permissions-Policy: `camera=(self), geolocation=(self), microphone=(self)`.

**Bottom nav (end users):** Today + History tabs only. No Profile tab.

---

## 15. Photo path scheme

`${YYYY}/${MM}/${DD}/${userId}_${timestampMs}_${TYPE}.jpg`

- Y/M/D from IST date parts
- The purge does not read this prefix — it selects by `createdAt` (§11)
- TYPE = `IN` or `OUT`

Bucket is PRIVATE. Access only via signed URLs from admin photo endpoint.

---

## 16. OT workflow

**OT prompt** triggers in check-out flow when current IST time is strictly after `otTriggerTime` AND `otPromptEnabled === true`. *(This line referenced an `otCutoffHourIST` column until 2026-08-04 — that column does not exist; `otTriggerTime` is the only threshold.)*

### Claim shape on attendance_records (column names corrected 2026-08-04 — §2)

- `otClaimed: boolean`
- `otClaimReason: TEXT` (free text, e.g. "Late delivery to S5 yard")
- `otTotalLessThan95: BOOLEAN` (analytics flag)
- `otApprovalStatus: NOT_CLAIMED | AUTO_CREDITED | AUTO_CREDITED_GRACE | PENDING | APPROVED | REJECTED` — UPPERCASE; the first four from `decideOtOutcome` at check-out (`ot-logic.ts:40-44`), the last two from the admin PATCH (§2)
- `otMinutesCredited` (the credited figure), `otApprovedById`, `otApprovedAt`, `otAdminNote` (set on action)

### otOutcome returned to client

Backend returns `otOutcome` object on check-out response:

```ts
otOutcome: {
  claimed: boolean;
  status: "NOT_CLAIMED" | "AUTO_CREDITED" | "AUTO_CREDITED_GRACE" | "PENDING";
  minutesCredited: number;
  totalLessThan95: boolean;
  graceUsedThisMonth: number;
  graceLimit: number;
}
```

`DaySummaryView` reads this and renders banner per `CLAUDE_UI.md §3` table.

### Grace policy

- Each calendar month a user gets `otMonthlyGraceLimit` (settings, default 3) auto-credited OTs without admin approval, even when the OT minutes look short
- Grace counter shown in `AUTO_CREDITED_GRACE` banner: "OT credited under grace · {graceUsedThisMonth} of {graceLimit} used this month"
- Once grace exhausted, further claims go to PENDING status awaiting admin

### Auto-approval (rule corrected 2026-08-04 — there is no threshold column)

The driver is **`depotWorkingMinutes`** (default 570 = 9.5h), per `lib/attendance/ot-logic.ts`: a claim
with `totalMinutesWorked >= depotWorkingMinutes` auto-credits; **below** 9.5h it credits **under grace**
while the month's `attendance_ot_grace.flagCount` is within `otMonthlyGraceLimit`, else goes PENDING
for admin. *(The previous "shorter than `otAutoApproveThresholdMinutes` auto-approves" claim described
a column that does not exist and inverted the shape of the rule.)*

### Manual approval

The admin queue (`GET /api/admin/attendance/ot-pending`, `otApprovalStatus = "PENDING"`) receives **claims made on days SHORTER than `depotWorkingMinutes`, once the month's grace is used up** (`decideOtOutcome` step 5f, `ot-logic.ts:151-162`). A claim on a full-length day never reaches it — it auto-credits (step 5d). Admin approves/rejects (action in PATCH body) with an optional `note`. **There is no minutes override:** approve recomputes the credit from the **live** `otTriggerTime` (check-out IST minutes − trigger, floored at 0) and refuses with 422 if that is 0; reject sets credit 0 and does not refund the grace counter (`app/api/admin/attendance/ot-pending/[recordId]/route.ts`, header comment + approve/reject branches).

**`attendance_summary.otMinutesCredited`** (`prisma/schema.prisma:2343`) is the sum of `otMinutesCredited` over the day's CHECK_OUT records, recomputed at check-out (`app/api/attendance/check-out/route.ts:354-361`). `attendance_summary.otApprovalState` is the worst case across those records — `PENDING` > `AUTO_CREDITED_GRACE` > `AUTO_CREDITED` > null (`:362-372`).

### Pure helper

`lib/attendance/ot-logic.ts` — no Prisma, no I/O, no clock reads.

```ts
export function decideOtOutcome(input: OtDecisionInput): OtDecisionOutput   // ot-logic.ts:78

OtDecisionInput  { checkOutTimestamp: Date; totalMinutesWorked: number;
                   otClaimed: "yes" | "no" | null; otClaimReason: string | null;
                   settings: { otTriggerTime; depotWorkingMinutes; otMonthlyGraceLimit; otPromptEnabled };
                   currentGraceFlagCount: number }
OtDecisionOutput { otMinutesRaw; otMinutesCredited; otTotalLessThan95;
                   otApprovalStatus: "NOT_CLAIMED" | "AUTO_CREDITED" | "AUTO_CREDITED_GRACE" | "PENDING";
                   incrementGraceCounter: boolean;
                   auditAction: "CLAIM_YES" | "CLAIM_NO" | "CONFIRMED_UNDER_95" }
```

Decision order: `otPromptEnabled` false → NOT_CLAIMED, 0 · check-out at or before `otTriggerTime` → NOT_CLAIMED, 0 · `otMinutesRaw` = check-out IST minutes − trigger · claim not "yes" → NOT_CLAIMED, 0 credited · `totalMinutesWorked >= depotWorkingMinutes` → AUTO_CREDITED (credit = raw) · `currentGraceFlagCount < otMonthlyGraceLimit` → AUTO_CREDITED_GRACE (credit = raw, counter +1) · else PENDING (credit 0, counter +1). `otMinutesRaw` is not persisted; the caller (check-out route) writes the rest.

### Reason minimum: 1 character

Originally specced at 10 chars trimmed. Lowered after first depot test — too strict for fast check-out. Empty/whitespace still blocked via `.trim()`.

---

## 17. Landmines

- **OT prompt UI shipped 2026-05-14.** `check-out-flow.tsx` reads `otTriggerTime` + `otPromptEnabled` from page settings fetch. Kill switch via `otPromptEnabled = false` works as soft-cutover.
- **Admin trio (ot-pending, settings, ot-audit) shipped 2026-05-14.** No SQL editing needed for normal config changes.
- **Phase 2 admin writes NOT built:** Manual entry, edit existing record, mark exception — backend + frontend both missing.
- **Holidays management NOT built:** No `holidays` table. The rollover cron writes `ABSENT` for **every** active non-exempt user with no activity on **every** day, Sundays included, **regardless of `rolloutStage`** — its only filter is `where: { isActive: true, attendanceExempt: false }` (`app/api/cron/attendance-rollover/route.ts:38-40`), with no day-of-week or stage check (§11).
- 🔴 **`components/attendance/camera-view.tsx` and `lib/attendance/photo.ts` are SHARED with MRN** (969d918f, 2026-09-01). `components/mrn/photo-capture.tsx:5` imports `CameraView`, which calls `captureFromVideo` from `lib/attendance/photo.ts` (`camera-view.tsx:5`). The optional props **`facingMode` (default `"user"`)**, **`showFaceGuide` (default `true`)** and `locationStatus` (default `null`, hides the pill) exist for MRN (`camera-view.tsx:26,42,48,54-59`); the defaults are what keep clock-in unchanged, and the selfie mirror is conditional on `facingMode === "user"` (`:174`). **Do not change the defaults.** `captureFromVideo`'s `jpegQuality` is **0–100, not 0–1** — it divides by 100 (`lib/attendance/photo.ts:45`; warned at `camera-view.tsx:29-30`), so passing 0.8 encodes at 0.008. MRN's side: `CLAUDE_MRN.md §10`.
- **Depot geofence coords are placeholder** — currently Surat city centre `21.1702, 72.8311` with ±150m radius. Needs physical measurement.
- **CRON_SECRET in production** — required, in Vercel env vars (all 3 environments).
- **No offline support.** The only service worker, `public/sw.js`, handles push only — no `fetch` handler, no Cache API (`sw.js:5`). Requires network for check-in/out.
- **No push notifications.** Settings/OT decisions don't notify users.
- **Photo bucket private.** Direct `<img src>` to Supabase Storage URL will 403. Always use signed URL endpoint.
- **Submitting state polish** on OT screen — after Submit OT claim is tapped, screen briefly renders ConfirmView ("Submitting…") instead of staying on OT screen. Reason text preserved in error state but invisible during submit moment. Minor — a dedicated "submitting OT claim" state on the OT screen itself would smooth this.
- **Settings 403 toast mis-label** — permission-denied responses (403) currently toast "Session expired — refresh and re-login" instead of "Permission denied". Cosmetic.
- **~~`otCutoffHourIST` vs `otTriggerTime`~~ — FALSE, retired 2026-08-04.** `otCutoffHourIST` does NOT exist on `attendance_settings` (live + Prisma agree); `otTriggerTime` is the only threshold. The "both fields exist / some paths still read the legacy one" claim survived at least one schema cleanup it never heard about.

---

## Change log — v1.4 (2026-09-19 canon sweep batch B2)

Evidence: code at HEAD 915f46f2 read directly (pages, APIs, `lib/auth.ts`, `lib/permissions.ts`, `app/(ops)/layout.tsx`, `ot-logic.ts`, both cron routes, `vercel.json`, `camera-view.tsx`, `photo.ts`, manifest + icon generators), git (`236f9743`, `969d918f`, `4a2f763f`, `3b0490e6`/`67d734e2`), sweep report `docs/prompts/drafts/code-discovery-2026-09-18-canon-sweep.md` (ATTENDANCE section). No live-DB fact changed (the 2026-09-18 live CSV has no attendance query).

- ATT-9 (header, §1, §3, §4, §12): §4 REPLACED — middleware has no attendance logic since 236f9743; consent redirects live in the four pages; the APIs check session only. `rolloutStage` gates no page or API — it drives sidebar visibility and the JWT `lastCheckInDate` fetch, and that claim is read by nothing. Stale window is the jwt callback, not middleware. Admin gate = hardcoded admin|ops_admin check in `app/(ops)/layout.tsx`; `attendance_admin` gates nothing; photo + export are admin-only. Bucket `attendance-photos` named.
- ATT-10 (§2, §12, §16): `otApprovalStatus` values are the six UPPERCASE tokens; `otClaimedMinutes` → `otMinutesCredited`; no `adjustedMinutes` override (approve recomputes from live `otTriggerTime`, 422 on 0); the manual queue gets SHORT days after grace (inversion fixed); `decideOtOutcome` signature + outputs corrected.
- ATT-11 (§9, §9.1-9.3): roster columns from `roster-table.tsx`; the 12-column list is the CSV header; 409 refetch banner; route line counts 547/309.
- ATT-12 (§11): `docs/cron-notes.md` folded in and superseded (IST times, auth, local test, failure handling, jitter, rollover scope); the Hobby "2-cron cap" corrected to cadence; purge selects by `createdAt`, not the path prefix (§15 bullet fixed too).
- ATT-13 (§14): manifest experiment settled (4a2f763f); icons violet; `icon-source.svg` generated by `generate-wordmark.mjs`.
- ATT-14 (§13, §17): files map fixed (ot-pending-table, ot-approve/reject-modal; 11 end-user components and `(ops)/layout.tsx` added); rollover-cron landmine corrected; NEW camera-view/photo.ts shared-with-MRN landmine; `sw.js` exists (push only).
- ATT-15 (§7, §9.2, §16): OT prompt fires strictly after `otTriggerTime` (`check-out-flow.tsx:282`, `ot-logic.ts:101`); the "Rollout activated" toast is the green `ok` token, not teal.
- Schema stamp v27.13 → v27.24.

## Change log — v1.3 (2026-08-04 reconciliation pass, method v1.1)

Evidence: `information_schema` SELECT on all three tables (live == Prisma; the doc was the outlier), `ot-logic.ts` + `vercel.json` + folder listing read directly, git (`b9923b3e`). Claim IDs from the session report.

- ATT-1 (§2): all three schema blocks REWRITTEN to live truth — 8 wrong column names fixed, 3 nonexistent columns removed (`otCutoffHourIST`, `otRequiresApproval`, `otAutoApproveThresholdMinutes`), ~14 missing columns added, and the `attendance_ot_grace`/`attendance_ot_audit` tables documented for the first time.
- ATT-2 (new §9.0 + §9.1-9.3): the admin header redesign documented — `attendance-page-header.tsx`, shipped `b9923b3e` (2026-05-14), mockups named; the three "UniversalHeader title" claims corrected (stale for 82 days).
- ATT-3 (§9/§13): the admin pages' route group is **`(ops)`**, not `(admin)` — files map fixed.
- ATT-4 (§16): OT auto-approval rule corrected (driver = `depotWorkingMinutes` + the grace counter; the threshold-column claim was inverted); claim-shape column names fixed; the prompt trigger is `otTriggerTime` only.
- ATT-5 (§17): the `otCutoffHourIST vs otTriggerTime` landmine retired as FALSE.
- ATT-6 (§11): cron schedule strings verified against `vercel.json`; the Hobby fires-within-the-hour caveat stated.
- ATT-7 (§1): `attendance_admin` page key cited (CORE §5); the end-user key's no-DB-row design noted.
- ATT-8 (header/footer): dates added at both ends (the file had none anywhere).
- Verified CORRECT, no change: rollout stages + JWT stale window, consent flow, check-in/out flows, photo path scheme + private bucket, §14 PWA facts (start_url `/`, the manifest-name experiment), grace policy, 1-char reason minimum.

- Schema stamp -> v27.13 (final-pass 12b, 2026-08-05).

---

*Attendance v1.4 · Schema v27.24 · OrbitOMS · updated 2026-09-19*
