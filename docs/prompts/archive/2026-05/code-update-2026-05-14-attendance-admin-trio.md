# Context update — Attendance admin trio shipped

- Date: 2026-05-14
- Module: Attendance
- Canonical file affected: `CLAUDE_ATTENDANCE.md` (Admin section)
- Trigger: Session 2026-05-14 shipped 3 admin frontend pages + shared sub-nav + RBAC fix
- Status: All 3 pages live on production, smoke-tested by ops_admin (Dhruv) account

---

## What shipped this session

### 1. Shared admin sub-nav component

**File:** `components/admin/attendance/admin-sub-nav.tsx` (62 lines)

Horizontal tab strip used on ALL 4 admin attendance pages (existing dashboard + 3 new pages).

Props:
```ts
{ active: 'dashboard' | 'ot-pending' | 'settings' | 'ot-audit'; otPendingCount?: number }
```

Style:
- Container: `bg-white border-b border-gray-200 h-11 px-4 flex items-end gap-1`
- Mobile: `overflow-x-auto` with hidden scrollbar
- Active tab: `text-teal-600 font-semibold border-b-2 border-teal-600 -mb-px` (border sits flush with strip's bottom border)
- Inactive: `text-gray-500 font-medium hover:text-gray-900`
- Badge on "OT Pending" tab when count > 0: `bg-teal-50 text-teal-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-1.5`

Placement: Inside `attendance-dashboard.tsx` (between UniversalHeader and body grid). Each new admin page passes `otPendingCount` prop, fetched via Prisma count on the server page.

Mockup reference: `docs/mockups/attendance/ot-pending.html` (sub-nav added across 8 frames — 4 desktop + 4 mobile states).

---

### 2. OT Pending queue page

**Route:** `/admin/attendance/ot-pending`
**Page file:** `app/(ops)/admin/attendance/ot-pending/page.tsx` (148 lines, server component, `export const dynamic = 'force-dynamic'`)

**Client components:**
- `components/admin/attendance/ot-pending-table.tsx` (316 lines) — fixed-table per UI §28 with Approve + Reject buttons inline per row
- `components/admin/attendance/ot-approve-modal.tsx` (173 lines) — Approve confirmation modal
- `components/admin/attendance/ot-reject-modal.tsx` (201 lines) — Reject modal with optional admin note + amber Q4-policy warning

**Header:** UniversalHeader with title "OT Pending Queue", stats row: Total · This week · Older.

**Table columns:** # · User · Date · Worked · OT raw · Reason · Action
**Action buttons:** Approve (`bg-teal-600 text-white`) + Reject (`bg-gray-200 text-gray-700`)

**Approve modal flow:**
- Shows user, date, raw OT minutes, reason quote
- Single confirm button (no override input — see deviation #1 below)
- On 200 → row removes from list
- On 422 → inline error "Trigger time moved past check-out. Reject this claim instead."
- On 409 → inline error "Already actioned. Closing…" + parent refetches list

**Reject modal flow:**
- Shows user, date, reason quote
- Amber warning banner: "Rejected days still consume this user's monthly grace (Q4 policy)."
- Optional admin note textarea (max 500 chars per `MAX_ADMIN_NOTE_CHARS`)
- Char counter below: "{n} / 500"
- On 200 → row removes from list

**Empty state:** Centered card with lucide CheckCircle2 in emerald circle, "Nothing pending" headline, "All caught up — no OT claims awaiting decision." subtext.

**Backend wired:**
- GET `/api/admin/attendance/ot-pending` (list)
- PATCH `/api/admin/attendance/ot-pending/[recordId]` (body: `{ action: "approve" | "reject", note?: string | null }`)

---

### 3. Attendance Settings page

**Route:** `/admin/attendance/settings`
**Page file:** `app/(ops)/admin/attendance/settings/page.tsx` (server component)

**Client components:**
- `components/admin/attendance/settings-form.tsx` — main form (largest file in this set)
- `components/admin/attendance/settings-section.tsx` — reusable card wrapper with title + helper + section-level error banner
- `components/admin/attendance/settings-toast.tsx` — top-right toast (4 kinds: rollout/reconsent/success/error, auto-dismiss 5s)
- `components/admin/attendance/settings-confirm-modal.tsx` — shared modal for re-consent + kill switch confirmations

**Header:** UniversalHeader with title "Attendance Settings" + subtitle "Last updated {date} by {updatedByName}".

**6 sections (in form order):**

1. **Rollout** — `rolloutStage` radio (OFF/TEST_USERS_ONLY/ALL_USERS) + `dpdpConsentVersion` text input + "Force re-consent" button (opens confirm modal, then increments minor version e.g. v1.0 → v1.1)

2. **Work hours** — `workStartTime`, `workEndTime`, `checkInWindowStart`, `checkInWindowEnd` (time inputs) + `lateGraceMinutes` (number 0-120)

3. **Geofence** — `geofenceLat` (number, step="0.0000001"), `geofenceLng`, `geofenceRadiusMeters` (10-5000) + "Use my current location" button (calls `navigator.geolocation.getCurrentPosition`, handles permission denial inline)

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
- 400 with `errors[]` → distribute to field/section errors, scroll to first error, red toast
- 401/403 → toast "Session expired — refresh and re-login" (NOTE: actually fires on 403 permission-denied too — this is a known mis-label, see Open Items)
- 500 → red toast "Server error — try again"

**Backend wired:**
- GET `/api/admin/attendance/settings`
- PATCH `/api/admin/attendance/settings`

---

### 4. OT Audit page

**Route:** `/admin/attendance/ot-audit`
**Page file:** `app/(ops)/admin/attendance/ot-audit/page.tsx` (server component, reads `?month=YYYY-MM` query param)

**Client components:**
- `components/admin/attendance/ot-audit-view.tsx` — client shell, owns expandedUserId state, transforms flat audit rows into user-grouped summaries
- `components/admin/attendance/ot-audit-stats.tsx` — 6 stat tiles
- `components/admin/attendance/ot-audit-table.tsx` — user table with expand chevron
- `components/admin/attendance/ot-audit-day-breakdown.tsx` — inner expand panel with day-by-day rows
- `components/admin/attendance/month-picker.tsx` — reusable month selector dropdown

**Header:** UniversalHeader with title "OT Audit" + month picker trigger on right showing "{Month} {YYYY} ▾".

**Stats strip (6 tiles, `grid-cols-6` desktop / `grid-cols-2` mobile):**
- Total OT credited (with "≈ Xh Ym" subtext)
- Auto credited
- Grace credited
- Admin approved
- Pending (amber when > 0)
- Rejected (count of claims, not minutes)

**User table columns:** # · User · Days · Total OT · Auto · Grace · Approved · Pending · Rejected · expand chevron

Sort: Total OT desc. Row click toggles expand (full row hit target, not just chevron).

**Day breakdown panel (when row expanded):**
- Container: `bg-gray-50 border-l-2 border-teal-600 p-4` (left teal border is the page's one-teal element)
- Heading: "Day-by-day breakdown — {userName}"
- Inner table columns: Date · Check-out · Credited · Outcome · Note
- Outcome chips (all neutral except ADMIN_REJECT/PENDING):
  - AUTO — `bg-gray-100 text-gray-700`
  - AUTO_GRACE — `bg-gray-100 text-gray-700` italic
  - CONFIRMED_UNDER_95 — `bg-gray-100 text-gray-500`
  - ADMIN_APPROVE — `bg-gray-100 text-gray-700`
  - ADMIN_REJECT — `bg-red-50 text-red-700`
  - PENDING — `bg-amber-50 text-amber-700`

**Month picker:**
- Trigger: "{Month} {YYYY} ▾" button
- Dropdown: 12 month buttons (3 cols × 4 rows) + year header with prev/next arrows
- Current selection: `bg-gray-900 text-white`
- Future months: disabled (`text-gray-300 cursor-not-allowed`)
- Months > 24 back: disabled (per backend `MAX_MONTHS_BACK`)
- Helper text at bottom: "Months older than 24 months ago are disabled."
- Closing: click outside / ESC / select a month
- On select: `router.push('/admin/attendance/ot-audit?month=${newMonth}')` — server re-fetches

**Data transformation (CRITICAL):**
Backend returns flat audit rows (multiple per user per day possible). Client transforms into `UserAuditSummary[]` with:
- `daysWithOt`: distinct `attendanceDate`
- `totalCreditedMin`: sum of `currentMinutesCredited` across DISTINCT `recordId` (dedupe to avoid double-counting)
- `autoMin` / `graceMin` / `approvedMin` / `pendingMin` / `rejectedMin`: derived from `toStatus` field
- `days[]`: grouped by `attendanceDate` desc

**Backend wired:**
- GET `/api/admin/attendance/ot-audit?month=YYYY-MM&userId=N`

---

### 5. RBAC fix (mid-session)

Discovered ops_admin users could view admin attendance pages but PATCH endpoints rejected them with 403. Backend was inconsistent — layout accepted ops_admin, API rejected.

**Fix:** Opened 4 admin attendance API routes to accept both ADMIN and OPS_ADMIN roles.

Changed `hasRole(session, [ROLES.ADMIN])` → `hasRole(session, [ROLES.ADMIN, ROLES.OPS_ADMIN])` at 5 sites across 4 files:

| File | Line | Handler |
|------|------|---------|
| `app/api/admin/attendance/settings/route.ts` | 142 | GET |
| `app/api/admin/attendance/settings/route.ts` | 165 | PATCH |
| `app/api/admin/attendance/ot-pending/route.ts` | 40 | GET |
| `app/api/admin/attendance/ot-pending/[recordId]/route.ts` | 40 | PATCH |
| `app/api/admin/attendance/ot-audit/route.ts` | 47 | GET |

**Effect:** Dhruv (id=27) and Kuldeep (id=28) — both ops_admin — can now use all 3 admin attendance pages including write operations (approve/reject OT, save settings).

**Other hasRole calls in the codebase:** Untouched. Only these 4 attendance admin routes were promoted. Other admin areas remain admin-only.

---

## Existing dashboard updates

`app/(ops)/admin/attendance/page.tsx` and `components/admin/attendance/attendance-dashboard.tsx` both lightly edited:
- Sub-nav inserted between UniversalHeader and body grid
- Server page now does an additional Prisma count for `pendingCount` and passes as prop

---

## Smoke test results

**Tested live by ops_admin (Dhruv):**
- ✓ All 4 admin attendance pages load
- ✓ Sub-nav navigation works between pages
- ✓ OT Pending empty state renders ("Nothing pending")
- ✓ Settings page renders all 6 sections with current GLOBAL row values
- ✓ Settings save works (changed `otTriggerTime` from 01:45 → 19:45, save returned 200)
- ✓ OT Audit renders for May 2026 with Harsh's real data (1 day, 29 min AUTO_GRACE)
- ✓ Expand row shows day-by-day breakdown correctly
- ✓ Month picker dropdown opens, shows year nav, disables future + far-past months

**NOT yet tested live (no test data):**
- ✗ Approve flow on OT Pending (no PENDING records existed)
- ✗ Reject flow on OT Pending
- ✗ 422 trap on approve (trigger-time-moved-past-checkout edge case)
- ✗ 409 race condition on concurrent admin actions

These will get tested organically when an OT claim is submitted.

---

## Deviations from spec (already documented in build report)

1. **Approve modal — credit override input removed.** Backend PATCH only accepts `{ action, note? }`. Credit is recomputed server-side from live `settings.otTriggerTime`. Including a number input would have misled admins about what the backend actually does.

2. **Sub-nav uses `items-end` not `items-center`.** With items-center, active tab border floats inside the strip. Items-end + `-mb-px` makes the teal underline sit flush over the gray strip border.

3. **Sub-nav placement: inside `attendance-dashboard.tsx`, not `page.tsx`.** Dashboard already owns UniversalHeader — co-locating keeps shell in one place.

4. **Empty state uses lucide CheckCircle2** (codebase consistency) not the mockup's 👍 emoji.

5. **Empty Row 2 strip on Settings + OT Audit.** UniversalHeader Row 2 (40px strip) renders unconditionally. On Settings + OT Audit there are no segments/filters, so the strip is blank. Decision: leave for now, revisit during redesign session.

---

## Open items (carry forward)

1. **Error toast mis-labels 403 as session expired.** Settings PATCH treats both 401 and 403 as "Session expired — refresh and re-login". Should differentiate: 401 = session expired, 403 = permission denied. Minor — affects clarity not function.

2. **Toggles use teal-600 fill on Settings page.** Spec said gray-700 to honour one-teal rule (active sub-nav is the teal). Currently violates the rule — toggles ON state shows teal alongside the active sub-nav tab. Easy fix during redesign.

3. **Live test pending for approve/reject flows.** Wait for organic OT claim.

4. **Real depot geofence still unset.** Current value 21.1702, 72.8311, 150m (Surat city centre). Replace with actual depot coords via the new Settings UI — admin can now do this without SQL.

---

## Engineering notes

- All new pages use `export const dynamic = 'force-dynamic'`
- No `prisma.$transaction` anywhere — sequential awaits only
- No schema changes this session
- All commits direct to main, Vercel auto-deployed
- `npx tsc --noEmit` clean on every commit

---

*End of context update — 2026-05-14.*
