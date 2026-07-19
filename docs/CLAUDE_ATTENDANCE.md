# CLAUDE_ATTENDANCE.md — Attendance + OT Module
# v1.1 · Schema v27.11
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Daily check-in/out with selfie + geofence + OT workflow. PWA UX on `/attendance` (end users) and admin dashboard at `/admin/attendance` (admin, ops_admin) with three sub-pages: OT pending queue, settings, OT audit.

Roles gated per rollout stage (see §3). Settings-driven thresholds. Pure decision helpers separated from DB-touching APIs.

---

## 1. What this module is

Two pipelines:

- **End user** (`/attendance`) — PWA-ish flow. Consent → check-in (camera + GPS) → check-out (camera + GPS + optional OT claim) → day summary.
- **Admin** (`/admin/attendance` + sub-pages) — daily roster, OT pending queue, settings (replaces SQL edits), OT audit.

Photo storage in Supabase private bucket. Signed URLs only.

---

## 2. Database

### attendance_records (per CHECK_IN | CHECK_OUT event)

```
id                        SERIAL PK
userId                    FK → users.id (RESTRICT)
type                      'CHECK_IN' | 'CHECK_OUT'
eventAt                   TIMESTAMPTZ (UTC)
attendanceDate            TEXT (IST YYYY-MM-DD)
latitude, longitude       DECIMAL(10,7)
accuracyMeters            DECIMAL
isOutsideGeofence         BOOLEAN
photoPath                 TEXT (Supabase Storage path)
deviceInfo                TEXT (UA snippet)
ipAddress                 TEXT
linkedCheckInId           FK → attendance_records.id (CHECK_OUT only)
createdById               FK → users.id
createdAt                 TIMESTAMPTZ

-- OT columns
otClaimed                 BOOLEAN
otClaimReason             TEXT
otTotalLessThan95         BOOLEAN
otApprovalStatus          TEXT (pending|approved|rejected|auto-approved)
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
attendanceDate            TEXT (IST YYYY-MM-DD)
firstCheckInAt            TIMESTAMPTZ
lastCheckOutAt            TIMESTAMPTZ
totalWorkedMinutes        INT
otClaimedMinutes          INT (sum of approved + auto-approved OT)
status                    'PRESENT' | 'LATE' | 'HALF_DAY' | 'INCOMPLETE' | 'ABSENT'
                          | 'HOLIDAY' | 'ON_LEAVE' | 'NOT_IN_YET' | 'EXEMPT'
hasMissingCheckout        BOOLEAN
sessionsCount             INT
updatedAt                 TIMESTAMPTZ

@@unique([userId, attendanceDate])
@@index([attendanceDate])
@@index([status, attendanceDate])
```

### attendance_settings (GLOBAL row, seeded with depot defaults)

```
id                              SERIAL PK (always 1)
rolloutStage                    'OFF' | 'TEST_USERS_ONLY' | 'ALL_USERS'
dpdpConsentVersion              TEXT (bump to force re-consent)

workStartTime                   TEXT 'HH:mm'
workEndTime                     TEXT 'HH:mm'
checkInWindowStart              TEXT 'HH:mm'
checkInWindowEnd                TEXT 'HH:mm'

geofenceLatitude                DECIMAL(10,7)
geofenceLongitude               DECIMAL(10,7)
geofenceRadiusMeters            INT
lateGraceMinutes                INT
halfDayThresholdMinutes         INT (default 240)

requirePhoto                    BOOLEAN
requireLocation                 BOOLEAN
photoMaxWidthPx                 INT
photoJpegQuality                INT
photoRetentionDays              INT (default 90)

-- OT settings
otPromptEnabled                 BOOLEAN
otCutoffHourIST                 INT (e.g. 19 = 7 PM) — legacy field, still used in some paths
otTriggerTime                   TEXT 'HH:mm'   — modern field, used by check-out page settings fetch
otRequiresApproval              BOOLEAN
otAutoApproveThresholdMinutes   INT
otMonthlyGraceLimit             INT
depotWorkingMinutes             INT (used as denominator for OT calc)

updatedAt                       TIMESTAMPTZ
updatedById                     FK → users.id
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

`attendance_settings.rolloutStage` controls who is gated.

| Stage | Gate behaviour |
|---|---|
| OFF | No user gated. `/attendance` accessible to no one operationally. |
| TEST_USERS_ONLY | Gated iff `user.attendanceTestUser === true`. |
| ALL_USERS | Gated for everyone EXCEPT `user.attendanceExempt === true`. |

**Admin recovery:** admin role is gated only if `attendanceTestUser === true`. This allows admins to bypass attendance during ALL_USERS rollout.

**Stale window:** middleware reads `rolloutStage` from JWT with a 5-min stale window. After 5 min, next request re-reads from DB and refreshes JWT.

**Kill switch:** `PATCH /api/admin/attendance/settings { otPromptEnabled: false }` disables the OT prompt without affecting check-in/out.

---

## 4. Gate logic (middleware.ts)

Paths starting with `/api/cron/` skip session auth entirely — route handlers do bearer-token check via `lib/cron-auth.ts` (fail-closed if `CRON_SECRET` missing).

For `/attendance` and `/api/attendance/*`:
1. Resolve user from session
2. Check gate per rollout stage
3. If ungated → 404
4. If gated and consent stale → redirect to `/attendance/consent`
5. Otherwise → continue

JWT update trigger (`lib/auth.ts`): when client calls `useSession().update()`, jwt callback re-reads `attendanceConsentVersion` + `lastCheckInDate` from DB.

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
2. If current IST >= `otTriggerTime` AND `otPromptEnabled === true`:
   - **OT choice screen** appears (CLAUDE_UI.md §40)
   - "Yes, claim OT" → reason screen
   - "No, just clocking out" → `submit("no")`
   - "Cancel and go back" → camera (photo discarded)
3. Reason screen: textarea + amber callout "N min overtime so far". Submit enabled when reason has any non-whitespace content (1+ char). Back returns to choice.
4. Submit sends FormData with `otClaimed: "yes"|"no"` + `otClaimReason` when yes.
5. Success screen (`DaySummaryView`) shows OT outcome banner based on `otOutcome.status` (CLAUDE_UI.md §3 OT outcome banners).

If `otPromptEnabled === false` OR current IST < trigger → prompt skipped silently, submit sends `otClaimed: "no"`.

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

`app/(admin)/admin/attendance/page.tsx`. Server-side roster derivation.

**Layout:** roster table left + 340px sticky right detail panel.

**Roster table:** fixed-layout per `CLAUDE_UI.md §27`. Columns: User · Role · Check In · Out · Worked · OT · Late · Status · Geo OK · Sessions · Device · IP.

**Right panel:** selfie viewer + detail rows. Photo lazy-loaded via signed URL.

**Photo viewer:** `GET /api/admin/attendance/photo?recordId=N` returns signed URL (5-min expiry). Never exposes the bucket publicly.

**CSV export:** `GET /api/admin/attendance/export?date=YYYY-MM-DD` returns CSV with 12 columns.

### 9.1 Sub-page: OT pending queue (`/admin/attendance/ot-pending`)

Visual: `CLAUDE_UI.md §49`.

UniversalHeader title "OT Pending Approvals". Roster table-style layout (fixed-layout per UI §27).

Per row: user · date · claim reason · total worked · OT minutes raw · `[Approve]` · `[Reject]`.

**Approve modal:** optional adjusted-minutes input + confirm.

**Reject modal:** user/date/reason quote · amber warning "Rejected days still consume monthly grace" · optional admin note textarea (500-char limit, counter "{n} / 500").

**On 409 (already actioned by other admin):** inline error "Already actioned. Closing…" + parent refetches list.

**Empty state:** lucide CheckCircle2 in emerald circle, "Nothing pending" headline.

Backend:
- `GET /api/admin/attendance/ot-pending` (list)
- `PATCH /api/admin/attendance/ot-pending/[recordId]` body `{ action: "approve" | "reject", note?: string | null, adjustedMinutes?: number }`

### 9.2 Sub-page: Settings (`/admin/attendance/settings`)

Visual: `CLAUDE_UI.md §50`.

UniversalHeader title "Attendance Settings" + subtitle "Last updated {date} by {updatedByName}".

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
- 200 with `rolloutActivated: true` → teal toast "Rollout activated"
- 200 (neither flag) → gray-900 toast "Settings saved"
- 400 with `errors[]` → distribute to field/section errors, scroll to first, red toast
- 403 / 401 → "Session expired — refresh and re-login" (NOTE: 403 permission-denied also fires this — known mis-label)
- 500 → red toast "Server error — try again"

Backend: `GET /api/admin/attendance/settings`, `PATCH /api/admin/attendance/settings` (510 lines with full validation + cross-field rules + `willForceReconsent` / `rolloutActivated` flags).

### 9.3 Sub-page: OT audit (`/admin/attendance/ot-audit`)

Visual: `CLAUDE_UI.md §51`.

Server component reads `?month=YYYY-MM` query param. UniversalHeader title "OT Audit" + month picker on right (`{Month} {YYYY} ▾`).

**6-tile stats strip:**
- Total OT credited (with "≈ Xh Ym" subtext)
- Auto credited
- Grace credited
- Admin approved
- Pending (amber when > 0)
- Rejected (count of claims, not minutes)

**User table:** # · User · Days · Total OT · Auto · Grace · Approved · Pending · Rejected · expand chevron. Sort Total OT DESC. Row click toggles expand (full row hit target).

**Expand panel:** day-by-day rows with per-day breakdown (`ot-audit-day-breakdown.tsx`).

Backend: `GET /api/admin/attendance/ot-audit?month=YYYY-MM` (289 lines).

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

`vercel.json` configures 2 schedules (Hobby tier cap):

| Path | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/attendance-rollover` | 18:35 daily | Inserts ABSENT rows + flags INCOMPLETE summaries with `hasMissingCheckout` |
| `/api/cron/attendance-purge` | 20:30 daily | Deletes photos older than `photoRetentionDays` from Supabase Storage + clears `photoPath` in DB |

**Auth:** Bearer token via `CRON_SECRET`. Bypasses middleware session auth. `lib/cron-auth.ts` fails closed if env var missing.

**Photo retention:** DPDP-compliant default 90 days. Settings-driven via `attendance_settings.photoRetentionDays`. Purge keys off the `photoPath` date prefix `${YYYY}/${MM}/${DD}/...`.

---

## 12. API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/attendance/consent` | Session | Record consent, bump `attendanceConsentVersion` |
| POST | `/api/attendance/check-in` | Session (gated) | Multipart (photo + lat/lng/accuracy) → upload + insert + upsert summary |
| POST | `/api/attendance/check-out` | Session (gated) | Multipart + `otClaimed?` + `otClaimReason?` → close CHECK_IN + recompute summary |
| GET | `/api/admin/attendance/photo?recordId=N` | Session + admin | Returns signed URL (5min) for the photo |
| GET | `/api/admin/attendance/export?date=YYYY-MM-DD` | Session + admin | CSV download |
| GET | `/api/admin/attendance/settings` | Session + admin | Read settings |
| PATCH | `/api/admin/attendance/settings` | Session + admin | Update settings — replaces all SQL-edits |
| GET | `/api/admin/attendance/ot-pending` | Session + admin | List records with `otApprovalStatus = pending` |
| PATCH | `/api/admin/attendance/ot-pending/[recordId]` | Session + admin | Approve or reject (action in body) |
| GET | `/api/admin/attendance/ot-audit?month=YYYY-MM` | Session + admin | Read-only monthly audit |
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
  check-out-flow.tsx                  FlowStep state machine, OT prompt screens
  day-summary-view.tsx                success screen + OT outcome banner
  day-detail-card.tsx                 detail rows for selected day

app/(admin)/admin/attendance/
  page.tsx                            roster dashboard
  ot-pending/page.tsx                 OT approval queue
  settings/page.tsx                   settings form
  ot-audit/page.tsx                   monthly audit

components/admin/attendance/
  attendance-dashboard.tsx            roster + detail layout
  roster-table.tsx                    fixed-layout per UI §27
  user-detail-panel.tsx               340px sticky right panel
  photo-viewer.tsx                    lazy signed-URL fetch
  export-button.tsx                   CSV trigger
  ot-pending-view.tsx                 ot-pending list shell
  ot-pending-row.tsx                  approve/reject row
  approve-modal.tsx, reject-modal.tsx
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
  photo.ts                            client canvas compression (640px Q70)
  ot-logic.ts                         pure OT decision helper (no Prisma)
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

`public/manifest.json` — start_url `/attendance` (end-user primary task).

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

- Y/M/D from IST date parts
- Enables retention purge by path date prefix
- TYPE = `IN` or `OUT`

Bucket is PRIVATE. Access only via signed URLs from admin photo endpoint.

---

## 16. OT workflow

**OT prompt** triggers in check-out flow when current IST hour >= `otCutoffHourIST` (or `otTriggerTime`) AND `otPromptEnabled === true`.

### Claim shape on attendance_records

- `otClaimed: boolean`
- `otClaimReason: TEXT` (free text, e.g. "Late delivery to S5 yard")
- `otTotalLessThan95: BOOLEAN` (analytics flag)
- `otApprovalStatus: pending | approved | rejected | auto-approved`
- `otApprovedById, otApprovedAt, otApprovedAdjustedMinutes` (set on approval)

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

### Auto-approval

OT shorter than `otAutoApproveThresholdMinutes` auto-approves on insert (skips admin queue).

### Manual approval

Longer OT enters admin queue at `GET /api/admin/attendance/ot-pending`. Admin approves/rejects (action in PATCH body) with optional `adjustedMinutes` (approve) or `note` (reject).

**attendance_summary.otClaimedMinutes** sums approved + auto-approved OT per day.

### Pure helper

`lib/attendance/ot-logic.ts` — no Prisma, no side effects. Inputs: claim, reason, total worked minutes, settings. Output: `{ approvalStatus, adjustedMinutes }`.

### Reason minimum: 1 character

Originally specced at 10 chars trimmed. Lowered after first depot test — too strict for fast check-out. Empty/whitespace still blocked via `.trim()`.

---

## 17. Landmines

- **OT prompt UI shipped 2026-05-14.** `check-out-flow.tsx` reads `otTriggerTime` + `otPromptEnabled` from page settings fetch. Kill switch via `otPromptEnabled = false` works as soft-cutover.
- **Admin trio (ot-pending, settings, ot-audit) shipped 2026-05-14.** No SQL editing needed for normal config changes.
- **Phase 2 admin writes NOT built:** Manual entry, edit existing record, mark exception — backend + frontend both missing.
- **Holidays management NOT built:** No `holidays` table. Rollover cron treats every weekday as working day.
- **Depot geofence coords are placeholder** — currently Surat city centre `21.1702, 72.8311` with ±150m radius. Needs physical measurement.
- **CRON_SECRET in production** — required, in Vercel env vars (all 3 environments).
- **No offline support.** PWA service worker not present. Requires network for check-in/out.
- **No push notifications.** Settings/OT decisions don't notify users.
- **Photo bucket private.** Direct `<img src>` to Supabase Storage URL will 403. Always use signed URL endpoint.
- **Submitting state polish** on OT screen — after Submit OT claim is tapped, screen briefly renders ConfirmView ("Submitting…") instead of staying on OT screen. Reason text preserved in error state but invisible during submit moment. Minor — a dedicated "submitting OT claim" state on the OT screen itself would smooth this.
- **Settings 403 toast mis-label** — permission-denied responses (403) currently toast "Session expired — refresh and re-login" instead of "Permission denied". Cosmetic.
- **`otCutoffHourIST` vs `otTriggerTime`** — both fields exist on `attendance_settings`. `otCutoffHourIST` is the legacy integer hour; `otTriggerTime` is the modern `HH:mm` string. Some code paths still read `otCutoffHourIST`. Treat them as alternate views of the same threshold for now.

---

*Attendance v1.1 · Schema v27.11 · OrbitOMS*
