# CLAUDE_ATTENDANCE.md — Attendance + OT Module
# v1.0 · Schema v27.2
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Depot staff attendance with check-in/out, selfie capture, GPS, monthly history, admin dashboard, and OT (overtime) workflow.

End-user surface: `/attendance` (PWA, mobile-first, full-screen, no sidebar).
Admin surface: `/admin/attendance` (read-only Phase 1 dashboard).

---

## 1. Architecture

```
User opens /attendance (mobile PWA, installed to home screen)
  → middleware.ts checks attendance gate (rolloutStage + flags)
  → first-time: consent screen (DPDP)
  → home screen: derive state from open session + today's summary
  → check-in: camera + GPS → POST /api/attendance/check-in
  → check-out: camera + GPS → POST /api/attendance/check-out
  → OT prompt if past otCutoffHourIST: claim or skip
  → records persisted, summary upserted/recomputed
  → admin views via /admin/attendance (signed-URL photo viewer)

Daily cron:
  → /api/cron/attendance-rollover (18:35 UTC = 00:05 IST) — inserts ABSENT rows for non-checked-in users, flags incomplete summaries
  → /api/cron/attendance-purge (20:30 UTC) — deletes photos older than retention from Supabase Storage
```

---

## 2. Database

### attendance_records (per CHECK_IN | CHECK_OUT event)

```
id                        SERIAL PK
userId                    FK → users.id (RESTRICT)
type                      'CHECK_IN' | 'CHECK_OUT'
eventAt                   TIMESTAMPTZ (UTC)
attendanceDate            String (IST YYYY-MM-DD)
latitude                  DECIMAL(10,7)
longitude                 DECIMAL(10,7)
accuracyMeters            DECIMAL
isOutsideGeofence         BOOLEAN
photoPath                 TEXT (Supabase Storage path)
deviceInfo                TEXT (UA snippet)
ipAddress                 TEXT
linkedCheckInId           FK → attendance_records.id (for CHECK_OUT only)
createdById               FK → users.id
createdAt                 TIMESTAMPTZ

-- OT columns (added with attendance_records 2026-05-13)
otClaimed                 BOOLEAN
otClaimReason             TEXT
otTotalLessThan95         BOOLEAN
otApprovalStatus          TEXT (enum-string: pending|approved|rejected|auto-approved)
otApprovedById            FK → users.id (nullable)
otApprovedAt              TIMESTAMPTZ (nullable)
otApprovedAdjustedMinutes INT (nullable)

@@index([userId, attendanceDate])
@@index([attendanceDate])
@@index([type, attendanceDate])
```

### attendance_summary (one per user per IST date)

```
id                        SERIAL PK
userId                    FK → users.id
attendanceDate            String (IST YYYY-MM-DD)
firstCheckInAt            TIMESTAMPTZ
lastCheckOutAt            TIMESTAMPTZ
totalWorkedMinutes        INT
otClaimedMinutes          INT (sum of approved + auto-approved OT)
status                    'PRESENT' | 'LATE' | 'HALF_DAY' | 'INCOMPLETE' | 'ABSENT' | 'HOLIDAY' | 'ON_LEAVE' | 'NOT_IN_YET' | 'EXEMPT'
hasMissingCheckout        BOOLEAN
sessionsCount             INT
updatedAt                 TIMESTAMPTZ

@@unique([userId, attendanceDate])
@@index([attendanceDate])
@@index([status, attendanceDate])
```

### attendance_settings (GLOBAL row, seeded with depot defaults)

```
id                              SERIAL PK (always 1, single-row table)
rolloutStage                    'OFF' | 'TEST_USERS_ONLY' | 'ALL_USERS'
dpdpConsentVersion              TEXT (bump to force re-consent)
geofenceLatitude                DECIMAL(10,7)
geofenceLongitude               DECIMAL(10,7)
geofenceRadiusMeters            INT
lateGraceMinutes                INT
halfDayThresholdMinutes         INT (default 240)
photoRetentionDays              INT (default 90)

-- OT settings
otPromptEnabled                 BOOLEAN
otCutoffHourIST                 INT (e.g. 19 = 7 PM)
otRequiresApproval              BOOLEAN
otAutoApproveThresholdMinutes   INT (OT under this length auto-approves)

updatedAt                       TIMESTAMPTZ
updatedById                     FK → users.id
```

### users — added columns

```
attendanceConsentAt           TIMESTAMPTZ (nullable)
attendanceConsentVersion      TEXT (nullable, matched against settings.dpdpConsentVersion)
attendanceExempt              BOOLEAN DEFAULT FALSE (override gate)
attendanceTestUser            BOOLEAN DEFAULT FALSE (gate when rolloutStage=TEST_USERS_ONLY)
```

All FKs to `users(id)` use `ON DELETE RESTRICT`. All timestamps `TIMESTAMPTZ`. All columns camelCase (no `@map`).

---

## 3. Rollout stages

`attendance_settings.rolloutStage` controls who is gated.

| Stage | Gate behaviour |
|---|---|
| OFF | No user is gated. `/attendance` accessible to no one operationally. |
| TEST_USERS_ONLY | Gated iff `user.attendanceTestUser === true`. |
| ALL_USERS | Gated for everyone EXCEPT `user.attendanceExempt === true`. |

**Admin recovery:** admin role is gated only if `attendanceTestUser === true`. This allows admins to log in and bypass attendance even during ALL_USERS rollout.

**Stale window:** middleware reads `rolloutStage` from JWT with a 5-min stale window (`rolloutStageStaleAt` in JWT). After 5 min, next request re-reads from DB and refreshes the JWT.

**Kill switch:** `PATCH /api/admin/attendance/settings` → `otPromptEnabled: false` disables the OT prompt without affecting check-in/out behaviour.

---

## 4. Gate logic (middleware.ts)

Paths starting with `/api/cron/` skip session auth entirely — route handlers do bearer-token check via `lib/cron-auth.ts` (fail-closed if `CRON_SECRET` env var missing).

For `/attendance` and `/api/attendance/*`:
1. Resolve user from session
2. Check gate per rollout stage
3. If ungated → 404
4. If gated and consent stale → redirect to `/attendance/consent`
5. Otherwise → continue

JWT update trigger (`lib/auth.ts`): when client calls `useSession().update()`, jwt callback re-reads `attendanceConsentVersion` + `lastCheckInDate` from DB. Independent of the 5-min rollout stale window.

---

## 5. Consent flow (DPDP)

Single full-screen page at `/attendance/consent`. Checkbox + Accept/Decline.

Triggered when:
- User has never consented (`attendanceConsentAt IS NULL`), OR
- User's `attendanceConsentVersion !== settings.dpdpConsentVersion` (settings bumped)

On Accept:
1. `POST /api/attendance/consent` records `attendanceConsentAt = NOW()` and `attendanceConsentVersion = settings.dpdpConsentVersion`
2. `useSession().update()` refreshes JWT so new consent version is in token
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
7. API: insert `attendance_records` row with `type=CHECK_IN`, set `isOutsideGeofence` via haversine vs `attendance_settings.geofenceLatitude/Longitude/RadiusMeters`
8. API: upsert `attendance_summary` for today
9. Redirect home

**Geofence violations are warn-only.** `isOutsideGeofence=true` is recorded and admin sees flag, but check-in/out is allowed to proceed.

---

## 7. Check-out flow

Page: `app/attendance/check-out/page.tsx`.

1. Server: validate there's an open `CHECK_IN` session for this user today (no `CHECK_OUT` since)
2. Same camera + GPS capture as check-in
3. **OT prompt** if current IST time hour >= `otCutoffHourIST` (e.g. 19 = 7 PM):
   - Modal: "Are you working overtime?" + reason text field
   - User picks: "Yes, OT" → sends `otClaimed=true, otClaimReason=...`; "No, just leaving" → sends `otClaimed=false`
   - If `otPromptEnabled=false` → skip prompt, treat as no OT claim
4. Multipart POST `/api/attendance/check-out` with photo + lat/lng + `otClaimed` + `otClaimReason`
5. API: insert `attendance_records` row with `type=CHECK_OUT`, `linkedCheckInId=...`, OT fields
6. API: recompute `attendance_summary` via `lib/attendance/state.ts` (pure pairing function)
7. Redirect to day summary

**OT decision helper:** `lib/attendance/ot-logic.ts` is pure (no side effects). Inputs: claim, reason, total worked minutes, settings. Outputs: approval status (pending | auto-approved | rejected), adjusted minutes.

**Check-outs past `otCutoffHourIST` return HTTP 400 if `otClaimed` is missing from request body.** Frontend prompt is responsible for setting it.

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

Status chip colours: `CLAUDE_UI.md §3` (Attendance status chips).

---

## 9. Admin dashboard — /admin/attendance

`app/(admin)/admin/attendance/page.tsx`. Server-side roster derivation.

**Layout:** roster table left + 340px sticky right detail panel.

**Roster table:** fixed-layout per `CLAUDE_UI.md §28`. Columns: User · Role · Check In · Out · Worked · OT · Late · Status · Geo OK · Sessions · Device · IP.

**Right panel:** selfie viewer + detail rows for selected day. Photo loaded lazily via signed URL.

**Photo viewer:** `GET /api/admin/attendance/photo?recordId=N` returns signed URL (5-min expiry) from Supabase Storage. Never exposes the bucket publicly.

**CSV export:** `GET /api/admin/attendance/export?date=YYYY-MM-DD` returns CSV with 12 columns matching roster.

---

## 10. End-user history — /attendance/history

Monthly calendar grid. Each day cell shows status chip + worked hours.

Click day → opens detail card showing all sessions, photos (small thumb), OT claim.

Month parsing + clamping in `lib/attendance/calendar.ts`.

---

## 11. Cron jobs

`vercel.json` configures 2 schedules (Hobby tier cap):

| Path | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/attendance-rollover` | 18:35 daily | Inserts ABSENT rows for non-checked-in users yesterday + flags INCOMPLETE summaries with `hasMissingCheckout` |
| `/api/cron/attendance-purge` | 20:30 daily | Deletes photos older than `photoRetentionDays` from Supabase Storage + clears `photoPath` in DB |

**Auth:** Bearer token via `CRON_SECRET`. Bypasses middleware session auth. `lib/cron-auth.ts` fails closed if env var missing.

**Photo retention:** DPDP-compliant default 90 days. Settings-driven via `attendance_settings.photoRetentionDays`. Purge keys off the `photoPath` date prefix `${YYYY}/${MM}/${DD}/...`.

---

## 12. API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/attendance/consent` | Session (any role) | Record consent, bump `attendanceConsentVersion` |
| POST | `/api/attendance/check-in` | Session (gated user) | Multipart (photo + lat/lng/accuracy) → upload to Storage + insert record + upsert summary |
| POST | `/api/attendance/check-out` | Session (gated user) | Multipart + `otClaimed?` + `otClaimReason?` → close CHECK_IN + recompute summary |
| GET | `/api/admin/attendance/photo?recordId=N` | Session + admin role | Returns signed URL (5min expiry) for the photo |
| GET | `/api/admin/attendance/export?date=YYYY-MM-DD` | Session + admin role | CSV download |
| GET | `/api/admin/attendance/settings` | Session + admin role | Read settings |
| PATCH | `/api/admin/attendance/settings` | Session + admin role | Update rolloutStage, OT flags, thresholds, geofence — replaces all SQL-edits |
| GET | `/api/admin/attendance/ot-pending` | Session + admin role | List records with `otApprovalStatus = pending` |
| POST | `/api/admin/attendance/ot-approve` | Session + admin role | Approve OT claim, set `otApprovedById`, `otApprovedAt`, `otApprovedAdjustedMinutes` |
| POST | `/api/admin/attendance/ot-reject` | Session + admin role | Reject OT claim |
| GET | `/api/admin/attendance/ot-audit` | Session + admin role | Read-only monthly audit |
| GET | `/api/cron/attendance-rollover` | Bearer (CRON_SECRET) | Rollover ABSENT + INCOMPLETE flags |
| GET | `/api/cron/attendance-purge` | Bearer (CRON_SECRET) | Photo retention purge |

---

## 13. Files map

```
app/attendance/
  layout.tsx                          full-screen wrapper, no sidebar, 480px column
  page.tsx                            home, state derivation + dispatch (consent vs home)
  consent/page.tsx                    server-side consent check + redirect
  consent/consent-form.tsx            client form with checkbox
  check-in/page.tsx                   server: auth + settings, renders flow
  check-out/page.tsx                  server: open-session validation + render flow
  history/page.tsx                    server: month parse + summary/record fetch

app/(admin)/admin/attendance/
  page.tsx                            server: roster derivation + render dashboard

components/attendance/
  day-detail-card.tsx                 detail rows for selected day
components/admin/attendance/
  attendance-dashboard.tsx            roster + detail panel layout
  roster-table.tsx                    fixed-layout per UI §28
  user-detail-panel.tsx               340px sticky right panel with selfie
  photo-viewer.tsx                    lazy signed-URL fetch
  export-button.tsx                   CSV trigger

lib/attendance/
  state.ts                            pure session pairing + derived state
  format.ts                           IST clock, duration, weekday formatters
  calendar.ts                         month grid generation + parse/clamp helpers
  admin-status.ts                     derive display status for admin roster
  geofence.ts                         haversine distance, isWithinGeofence
  photo.ts                            client-side canvas compression (640px Q70)
  ot-logic.ts                         pure OT decision helper
  date.ts                             istDateString helper

lib/supabase.ts                       lazy singleton service-role client (server-only)
lib/cron-auth.ts                      bearer-token check (fail-closed if env missing)

api/attendance/consent/route.ts
api/attendance/check-in/route.ts
api/attendance/check-out/route.ts
api/admin/attendance/photo/route.ts
api/admin/attendance/export/route.ts
api/admin/attendance/settings/route.ts
api/admin/attendance/ot-pending/route.ts
api/admin/attendance/ot-approve/route.ts
api/admin/attendance/ot-reject/route.ts
api/admin/attendance/ot-audit/route.ts
api/cron/attendance-rollover/route.ts
api/cron/attendance-purge/route.ts
```

---

## 14. PWA setup

`public/manifest.json` — PWA manifest with OrbitOMS branding. `start_url: "/attendance"` (end-user primary task).

Icons generated from `public/icon-source.svg` (512×512 source: teal bg + scaled orbit composition):
- `public/icon-192.png`
- `public/icon-512.png`
- `public/apple-touch-icon.png`

Generator: `scripts/generate-icons.mjs` (@resvg/resvg-js, idempotent, devDep).

`app/layout.tsx` metadata: Manifest + Viewport + apple-touch-icon.

`next.config.mjs` Permissions-Policy: `camera=(self), geolocation=(self), microphone=(self)`.

**Bottom nav (end users):** Today + History tabs only. No Profile tab.

---

## 15. Photo path scheme

`${YYYY}/${MM}/${DD}/${userId}_${timestampMs}_${TYPE}.jpg`

- Y/M/D come from IST date parts
- Enables retention purge by path date prefix
- TYPE = `IN` or `OUT`

Storage bucket is PRIVATE. Access only via signed URLs from admin photo endpoint.

---

## 16. OT workflow

**OT prompt:** triggers in check-out flow when current IST hour >= `otCutoffHourIST` AND `otPromptEnabled=true`.

**Claim shape on `attendance_records`:**
- `otClaimed: true | false`
- `otClaimReason: TEXT` (free text, e.g. "Late delivery to S5 yard")
- `otTotalLessThan95: BOOLEAN` (set by helper, flag for analytics)
- `otApprovalStatus: pending | approved | rejected | auto-approved`
- `otApprovedById, otApprovedAt, otApprovedAdjustedMinutes` (set on approval)

**Auto-approval:** OT shorter than `otAutoApproveThresholdMinutes` auto-approves on insert (skips admin queue).

**Manual approval:** longer OT enters admin queue at `GET /api/admin/attendance/ot-pending`. Admin approves/rejects with optional adjusted minutes.

**`attendance_summary.otClaimedMinutes`** sums approved + auto-approved OT per day.

**Pure helper:** `lib/attendance/ot-logic.ts` — no Prisma calls, no side effects. Inputs: claim, reason, total worked minutes, settings. Output: `{ approvalStatus, adjustedMinutes }`.

---

## 17. Landmines

- **Check-outs past 7 PM IST** return HTTP 400 if frontend doesn't send `otClaimed`. End-user OT prompt UI is not yet present. Kill switch: `PATCH /api/admin/attendance/settings { otPromptEnabled: false }` soft-cutovers.
- **Depot geofence coords are placeholder** — currently Surat city centre `21.1702, 72.8311` with ±150m radius. Needs physical measurement of actual depot location.
- **CRON_SECRET in production** — required, in Vercel env vars (all 3 environments).
- **Phase 1 admin = read-only.** Manual entry, edit record, mark exception not built yet.
- **No offline support.** PWA service worker not present. Requires network for check-in/out.
- **No push notifications.** Settings/OT decisions don't notify users.
- **Photo bucket private.** Direct `<img src>` to Supabase Storage URL will 403. Always use signed URL endpoint.

---

*Attendance v1.0 · Schema v27.2 · OrbitOMS*
