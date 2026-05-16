# Code update — 2026-05-13 — OT (overtime) workflow, backend

**Scope:** Backend foundation for the OT claim-and-approval workflow on
the attendance check-out flow. No frontend changes this session.

**Status:** Shipped to production. Five Claude Code prompts, four
commits, ~3 hours total execution time. Frontend integration deferred
to a later session.

---

## What was built

### New schema (Prompt 1 — commit d1f6643d, schema only)

Run via Supabase SQL Editor; Prisma synced via hand-edit (db pull
hit P1001 due to Supabase's IPv6-only direct-host policy + IPv4-only
ISP — see "Engineering notes" below).

**`attendance_records` — 8 new columns (all nullable except defaults):**

- `otClaimed BOOLEAN`
- `otClaimReason TEXT`
- `otTotalLessThan95 BOOLEAN`
- `otApprovalStatus TEXT` — enum-string:
  `NOT_CLAIMED | AUTO_CREDITED | AUTO_CREDITED_GRACE | PENDING | APPROVED | REJECTED`
- `otMinutesCredited INTEGER DEFAULT 0`
- `otApprovedById INTEGER` FK users(id) ON DELETE SET NULL
- `otApprovedAt TIMESTAMPTZ(6)`
- `otAdminNote TEXT`
- Index on `(otApprovalStatus, attendanceDate)` for admin pending-queue
  filter.

**`attendance_summary` — 2 new columns:**

- `otMinutesCredited INTEGER NOT NULL DEFAULT 0` — sum of credited OT
  across all of the day's CHECK_OUT records.
- `otApprovalState TEXT` — day-level rollup status, same enum-string
  values as on records. Null when no OT was claimed that day.

**`attendance_settings` — 4 new columns:**

- `depotWorkingMinutes INTEGER NOT NULL DEFAULT 570` (9.5h × 60).
- `otTriggerTime TEXT NOT NULL DEFAULT '19:00'`.
- `otMonthlyGraceLimit INTEGER NOT NULL DEFAULT 3`.
- `otPromptEnabled BOOLEAN NOT NULL DEFAULT true` — kill switch.

**Two new tables:**

`attendance_ot_grace` — per-user-per-month flag counter:

```
id          SERIAL PK
userId      INTEGER FK users(id) ON DELETE CASCADE
yearMonth   TEXT      -- 'YYYY-MM', e.g. '2026-05'
flagCount   INTEGER DEFAULT 0
createdAt   TIMESTAMPTZ(6) DEFAULT now()
updatedAt   TIMESTAMPTZ(6) DEFAULT now()   -- Prisma @updatedAt
UNIQUE (userId, yearMonth)
INDEX (yearMonth)
```

`attendance_ot_audit` — every OT-related state change:

```
id              SERIAL PK
recordId        INTEGER FK attendance_records(id) ON DELETE CASCADE
userId          INTEGER FK users(id) ON DELETE CASCADE       -- audited user
action          TEXT   -- 'CLAIM_YES' | 'CLAIM_NO' | 'CONFIRMED_UNDER_95'
                       --   | 'ADMIN_APPROVE' | 'ADMIN_REJECT' | 'ADMIN_OVERRIDE'
performedById   INTEGER FK users(id) ON DELETE RESTRICT       -- who did it
performedAt     TIMESTAMPTZ(6) DEFAULT now()
fromStatus      TEXT
toStatus        TEXT
note            TEXT
INDEX (recordId)
INDEX (userId, performedAt DESC)
```

**User back-relations on `users` model (Prisma) — explicitly named to
avoid auto-naming clashes:**

- `attendanceOtApprovals` → `attendance_records[]` via `@relation("AttendanceOtApprover")`
- `attendanceOtGraceCounters` → `attendance_ot_grace[]` via `@relation("AttendanceOtGraceUser")`
- `attendanceOtAudits` → `attendance_ot_audit[]` via `@relation("AttendanceOtAuditUser")`
- `attendanceOtAuditsPerformed` → `attendance_ot_audit[]` via `@relation("AttendanceOtAuditPerformer")`

`ADMIN_OVERRIDE` is in the audit `action` enum but no endpoint emits it
yet — reserved for a future "admin edits a closed record" flow.

---

### New helper: `lib/attendance/ot-logic.ts` (Prompt 2 — commit d1f6643d)

Pure function `decideOtOutcome(input)`. No Prisma, no I/O, no clock
reads. Edge-safe; sibling to `state.ts`, `geofence.ts`, `admin-status.ts`.

**Input contract:**

```ts
interface OtDecisionInput {
  checkOutTimestamp: Date;
  totalMinutesWorked: number;
  otClaimed: "yes" | "no" | null;
  otClaimReason: string | null;
  settings: {
    otTriggerTime: string;
    depotWorkingMinutes: number;
    otMonthlyGraceLimit: number;
    otPromptEnabled: boolean;
  };
  currentGraceFlagCount: number;
}
```

**Output contract:**

```ts
interface OtDecisionOutput {
  otMinutesRaw: number;              // not persisted, response-body only
  otMinutesCredited: number;
  otTotalLessThan95: boolean;
  otApprovalStatus: "NOT_CLAIMED" | "AUTO_CREDITED"
    | "AUTO_CREDITED_GRACE" | "PENDING";
  incrementGraceCounter: boolean;
  auditAction: "CLAIM_YES" | "CLAIM_NO" | "CONFIRMED_UNDER_95";
}
```

**Decision tree (first match wins):**

1. Kill switch first — `!otPromptEnabled` → flat-zero NOT_CLAIMED.
2. Before trigger time → flat-zero NOT_CLAIMED.
3. Past trigger, declined or null → `NOT_CLAIMED` with raw minutes computed
   for response-body context but `credited = 0`.
4. Past trigger, claimed, total ≥ 9.5h → `AUTO_CREDITED`, no grace bump.
5. Past trigger, claimed, total < 9.5h, grace available → `AUTO_CREDITED_GRACE`,
   grace bump, audit `CONFIRMED_UNDER_95`.
6. Past trigger, claimed, total < 9.5h, grace exhausted → `PENDING`,
   credited = 0, grace bump (per Q4 policy — rejected/pending days
   still consume grace so abuse can't game the limit by claiming after
   exhaustion).

**`otMinutesRaw` is in-memory only.** Not persisted. Recomputed by the
admin approve endpoint if needed — same formula in both places.

---

### Check-out route rewrite (Prompt 2 — commit d1f6643d)

`app/api/attendance/check-out/route.ts` now accepts two new form fields:

- `otClaimed: "yes" | "no"` — required when check-out is past
  `otTriggerTime` AND `otPromptEnabled` is true. 400 with
  `"OT claim required for check-out past {otTriggerTime}"` if missing.
- `otClaimReason: string` (optional, ≤200 chars, trimmed).

**Order of operations (all sequential awaits, never `$transaction`):**

1. Auth + multipart parse.
2. Load settings (now also reads `otTriggerTime`, `depotWorkingMinutes`,
   `otMonthlyGraceLimit`, `otPromptEnabled`).
3. Validate photo + OT-claim-required-if-past-trigger.
4. Verify open CHECK_IN session.
5. Compute photo/geofence (unchanged).
6. Insert CHECK_OUT record (without OT columns — decision needs total
   worked first).
7. Re-derive `totalMinutesWorked` via `deriveAttendanceState`.
8. Read this month's grace counter (`attendance_ot_grace` find).
9. Call `decideOtOutcome` — single decision.
10. Update CHECK_OUT record with OT columns from decision.
11. Insert audit row (always — even for `NOT_CLAIMED`).
12. Upsert `attendance_ot_grace` with atomic `{ increment: 1 }` if
    `decision.incrementGraceCounter`.
13. Roll up today's `attendance_summary` — priority:
    `PENDING > AUTO_CREDITED_GRACE > AUTO_CREDITED > null`.

**Response field rename — `overtimeMinutes` now sourced from
`decision.otMinutesCredited`.** Same field name kept for backward compat
with `check-out-flow.tsx` and the day-summary screen. The legacy
clock-past-end formula (`Math.max(0, istNowMin - workEndMin)`) is still
written to `attendance_summary.overtimeMinutes` so historical exports
keep working — but the API response uses the approval-aware credited
value. **This is a deliberate dual-source.**

**Response now also includes `otOutcome` object:**

```json
{
  "claimed": boolean,
  "status": "NOT_CLAIMED" | "AUTO_CREDITED" | ...,
  "minutesCredited": number,
  "totalLessThan95": boolean,
  "graceUsedThisMonth": number,   // post-bump
  "graceLimit": number
}
```

---

### Admin OT-pending endpoints (Prompt 3 — commit 502ea96f)

**`GET /api/admin/attendance/ot-pending`**

Returns every `attendance_records` row where `otApprovalStatus = "PENDING"`,
joined with user info and the day's first check-in time. Ordered
oldest-first (fairness — aging requests surface first).

Three sequential Prisma queries (records, users, summaries) joined via
in-memory Maps. `otMinutesRaw` recomputed per row using the live
`otTriggerTime`. Orphan filter (`console.warn + continue`) for records
whose user row is missing.

**`PATCH /api/admin/attendance/ot-pending/[recordId]`**

Body: `{ action: "approve" | "reject", note?: string (≤500 chars) }`.

Pre-flight:
- Auth + admin.
- Validate `recordId` + body.
- Load record, idempotency check (`409 "Record not pending approval"`
  if status ≠ PENDING).
- Load settings for `otTriggerTime`.

**Approve branch:**
- Recompute `otMinutesRaw` from `record.timestamp` and live
  `otTriggerTime` (same formula as ot-logic.ts).
- **422 guard:** if recomputed `otMinutesRaw === 0` (admin moved
  `otTriggerTime` past the check-out clock between submission and
  approval), refuse to approve with explicit error message. Prevents
  silent zero-credit approvals.
- Update record: status APPROVED, credited = raw, set `otApprovedById`,
  `otApprovedAt`, `otAdminNote`.
- Audit row: `ADMIN_APPROVE`, `fromStatus=PENDING`, `toStatus=APPROVED`.

**Reject branch:**
- Update record: status REJECTED, credited stays 0, set approver/note.
- Audit row: `ADMIN_REJECT`, `fromStatus=PENDING`, `toStatus=REJECTED`.
- **Grace counter NOT refunded** (Q4 policy — rejected days still
  consume grace).

**After either action:**
- Re-roll the day's `attendance_summary` with the extended priority list:
  `PENDING > AUTO_CREDITED_GRACE > AUTO_CREDITED > APPROVED > REJECTED > null`.
- The day-level state shows the "highest-effort" status. Lossy by design
  — e.g. `AUTO_CREDITED + APPROVED` rolls up to `AUTO_CREDITED`, not a
  breakdown. Full per-record history is in `attendance_ot_audit`.

Response: `{ ok: true, recordId, newStatus, minutesCredited,
summaryOtApprovalState, summaryOtMinutesCredited }`.

---

### Admin OT-audit query (Prompt 4 — commit cd8d40d6)

**`GET /api/admin/attendance/ot-audit?month=YYYY-MM&userId=N`**

Read-only audit-log report for the monthly "trust + flag" review.

**Query parameters:**

- `month` — defaults to current IST month; required `YYYY-MM` format
  (regex + year/month bounds). 400 on future months; 400 if older than
  24 months past (`MAX_MONTHS_BACK = 24`, prevents accidental scans).
- `userId` — optional integer. 404 if user row doesn't exist. Inactive
  users still allowed (historical audits are legitimate).

**Filter semantics — Option 2:** filters by underlying
`record.attendanceDate`, NOT by `audit.performedAt`. So an admin approval
of a 28-May claim done on 3-June shows under May. Aligns with the
monthly grace counter, which is anchored to attendance month.

Range filter `[gte: 'YYYY-MM-01', lt: 'YYYY-(MM+1)-01']` on the
attendanceDate column hits the existing index cleanly.

**Three sequential queries:** audits with relation filter, records by
ID set, users by ID set (audited + performer, deduped). Map-based joins.

**Response shape:**

```ts
{
  month: "YYYY-MM",
  userId: number | null,
  rows: AuditRow[],            // ordered by performedAt ASC
  summary: {
    totalAudits: number,         // == rows.length post-orphan-filter
    claimsYes: number,           // CLAIM_YES + CONFIRMED_UNDER_95
    claimsNo: number,            // CLAIM_NO
    adminApproves: number,
    adminRejects: number,
    flaggedDays: number,         // distinct (auditedUserId, attendanceDate)
                                 // where toStatus was GRACE or PENDING
    totalMinutesCredited: number // sum across DISTINCT recordIds
  }
}
```

**Dedup invariants:**
- `flaggedDays` keys `${auditedUser.id}|${record.attendanceDate}` to
  avoid collapsing across users.
- `totalMinutesCredited` uses `seenRecordIdsForCredit` Set to avoid
  double-counting multi-audit records (record commonly has claim +
  admin action audit rows).
- Orphan-skipped audits do NOT increment any summary counter — invariant
  `summary.totalAudits === rows.length` always holds.

---

### Admin settings GET + PATCH (Prompt 5 — commit fb0f3b08)

**`GET /api/admin/attendance/settings`**

Returns the full settings shape with `geofenceLat`/`geofenceLng`
Decimals converted to plain numbers, `updatedByName` joined from the
users back-relation. 500 if settings row missing.

**`PATCH /api/admin/attendance/settings`**

Partial update. Body: any subset of the 20 editable columns. Per-field
validation accumulates ALL errors before responding (single 400 with
`errors: [{ field, message }]` array, not first-failure 400 chain).

**Field categories:**

- **Rollout:** `rolloutStage` enum.
- **Time strings (HH:MM 24h):** `workStartTime`, `workEndTime`,
  `checkInWindowStart`, `checkInWindowEnd`, `otTriggerTime`.
- **Integers:** `lateGraceMinutes (0–120)`, `halfDayThresholdMinutes
  (60–480)`, `geofenceRadiusMeters (10–5000)`, `photoRetentionDays
  (7–730)`, `photoMaxWidthPx (240–1920)`, `photoJpegQuality (30–95)`,
  `depotWorkingMinutes (60–720)`, `otMonthlyGraceLimit (0–30)`.
- **Decimals:** `geofenceLat (-90 to 90)`, `geofenceLng (-180 to 180)`.
- **Booleans:** `requirePhoto`, `requireLocation`, `otPromptEnabled`
  (strict `typeof === "boolean"` check; rejects string "true").
- **DPDP version:** `dpdpConsentVersion` matches `/^v\d+\.\d+$/`,
  1–32 chars.

**Cross-field invariants** (skipped if either involved field was
attempted-but-failed in per-field validation — `fieldUsable()` helper):

- `workEndTime > workStartTime`
- `checkInWindowEnd > checkInWindowStart`
- `otTriggerTime ≥ workStartTime`

**Response special flags (only present when true):**

- `willForceReconsent: true` — when `dpdpConsentVersion` is changed,
  signals frontend that all users will redirect to consent flow.
- `rolloutActivated: true` — only on `OFF → TEST_USERS_ONLY` (first
  activation event). Other rollout transitions (TU → ALL, ALL → OFF)
  are unflagged — frontend handles those with their own confirmation
  dialogs.
- `otPromptEnabled` toggle emits `console.info` to Vercel logs (no
  response flag).

**Forward-compat behaviour:**

- Unknown keys silently dropped + `console.warn` listing them.
- Known-but-immutable keys (`scope`, `roleSlug`, `updatedAt`,
  `updatedById`, `updatedBy`, `updatedByName`, `id`) silently
  dropped (no warning) — supports round-tripping the full GET shape
  back as a PATCH body.
- All-unchanged patches still write — deliberate "admin reviewed the
  row" audit trail signal. Documented in route header comment so a
  future maintainer doesn't optimize it away.

---

## Engineering notes / decisions

**The `prisma db pull` failed with P1001 (Supabase IPv6-only direct host
vs IPv4 ISP).** Resolved by hand-editing `schema.prisma` to mirror the
SQL exactly, then running `prisma generate` only. **This is now the
canonical workaround for any future schema change.** Worth adding a
note to `CLAUDE_CORE.md §3` — see separate follow-up draft.

**Photo-then-DB-write orphan risk in check-out route.** If photo upload
to Supabase Storage succeeds but any subsequent DB write fails, we get
a photo in storage with no record. Pre-existing fragility (the old
check-out route had the same issue). Not introduced this session.
Cannot fix with `$transaction` per CORE §3. Acknowledged, deferred.

**Grace counter atomicity.** Prisma's `{ increment: 1 }` compiles to
SQL `UPDATE … SET flagCount = flagCount + 1` — race-safe at DB level.
Two simultaneous check-outs by the same user cannot both end up at
the same value.

**Legacy `overtimeMinutes` column still populated.** The clock-past-end
formula (`Math.max(0, istNowMin - workEndMin)`) is still written to
`attendance_summary.overtimeMinutes`. The new credited value goes to
`attendance_summary.otMinutesCredited`. Existing reports/exports
reading the legacy column continue to work; new code should read
`otMinutesCredited`.

**`ADMIN_OVERRIDE` audit action exists in schema but no endpoint emits
it.** Reserved for a future "admin edits an already-resolved record"
flow. The audit query route handles it gracefully (counted under no
summary bucket, still appears in rows).

**The 5-min JWT stale window** for rollout flags (`STALE_MS` in
`lib/auth.ts`) means a `rolloutStage` change in admin settings won't
propagate to existing user sessions for up to 5 min. Documented; not
changed this session.

---

## Frontend cutover behaviour

**The check-out screen is now in a partial state.** Check-outs before
`otTriggerTime` (default 7:00 PM IST) work normally. Check-outs at or
after the trigger time **will return 400** ("OT claim required for
check-out past 19:00") because the frontend doesn't yet send the
`otClaimed` field.

Smart Flow confirmed nobody is using the app right now, so no
operational impact. Frontend will be built in the next session(s).

If a soft cutover is ever needed (e.g. pilot users would be affected),
flip the kill switch via PATCH:

```
PATCH /api/admin/attendance/settings
{ "otPromptEnabled": false }
```

This makes the check-out route treat all check-outs as "no OT" and
return 0 credited regardless of clock time. Re-enable when frontend
ships.

---

## Pending frontend work (next sessions)

- Check-out OT prompt UI (Yes/No + reason field).
- Follow-up "Total under 9.5h — confirm OT?" dialog.
- Admin pending-approvals page (consumes
  `GET /api/admin/attendance/ot-pending` + PATCH per record).
- Admin settings configuration page (consumes GET + PATCH
  `/api/admin/attendance/settings`).
- Admin OT-audit report page (consumes
  `GET /api/admin/attendance/ot-audit`).
- In-app notification banner + admin count badge (architecture TBD —
  no notification system exists in OrbitOMS today).

Estimated 8–10 prompts across 2–3 future sessions.

---

## Files touched this session

**New files:**
- `lib/attendance/ot-logic.ts`
- `app/api/admin/attendance/ot-pending/route.ts`
- `app/api/admin/attendance/ot-pending/[recordId]/route.ts`
- `app/api/admin/attendance/ot-audit/route.ts`
- `app/api/admin/attendance/settings/route.ts`

**Modified:**
- `prisma/schema.prisma` (10 column additions, 2 new models, 4
  back-relations on `users`)
- `app/api/attendance/check-out/route.ts` (full rewrite of the OT
  logic path; existing photo/location/session-pairing logic
  preserved)

**Unchanged (verified):**
- All component files under `components/attendance/`
- All page files under `app/(attendance)/`
- `lib/auth.ts`, `auth.config.ts`, `middleware.ts`
- All other API routes

---

## Commit log

| # | Commit   | Description                                         |
|---|----------|-----------------------------------------------------|
| 1 | d1f6643d | OT schema + ot-logic.ts + check-out route rewrite   |
| 2 | 502ea96f | GET/PATCH /admin/attendance/ot-pending              |
| 3 | cd8d40d6 | GET /admin/attendance/ot-audit                      |
| 4 | fb0f3b08 | GET/PATCH /admin/attendance/settings                |

All Vercel deploys green.

---

## Schema version note

The attendance schema additions in Prompt 1 push us past v27.x.
Recommend bumping CORE schema version to **v27.2** (v27.0 = original
attendance tables, v27.1 = rollout flag, v27.2 = OT workflow).
Update `CLAUDE_CORE.md` schema-version field accordingly during next
consolidation pass.
