# Roadmap update — Attendance + OT module

- Date: 2026-05-14
- Module: Attendance
- Canonical file affected: `ROADMAP.md` (Attendance + OT section)
- Trigger: P0 shipped this session — OT claim prompt is no longer pending

---

## What to remove from ROADMAP

Delete this line from the Attendance + OT section (P0 is done):

> - **Frontend OT prompt UI.** Sessions A–F (14 Claude Code prompts, est. 12–16 hrs). Adds the missing client-side prompt during check-out so check-outs past `otCutoffHourIST` stop returning HTTP 400. Until shipped, kill switch `PATCH /api/admin/attendance/settings { otPromptEnabled: false }` is the soft-cutover.

---

## What stays / gets re-prioritised

Replace the rest of the Attendance + OT section with this updated list (most-likely-next at top):

```
## Attendance + OT

### Next up — admin frontend trio (P1)

- **Admin OT pending queue UI.** Page at `app/(ops)/admin/attendance/ot-pending/page.tsx` listing `otApprovalStatus = PENDING` records. Each row: user, date, claim reason, total worked, OT minutes raw. Actions: one-tap Approve (with optional adjusted-minutes input) or Reject. Backend ready: `app/api/admin/attendance/ot-pending/route.ts` (143 lines) + `app/api/admin/attendance/ot-pending/[recordId]/route.ts` (252 lines, handles approve + reject inside one dynamic route by method). HTML mockup to be designed.

- **Admin attendance settings UI.** Page at `app/(ops)/admin/attendance/settings/page.tsx` — full form replacing SQL edits. Sections: Rollout (`rolloutStage`, `dpdpConsentVersion` re-consent button), Work hours (`workStartTime`, `workEndTime`, `checkInWindowStart`, `checkInWindowEnd`, `lateGraceMinutes`), Geofence (`geofenceLat`, `geofenceLng`, `geofenceRadiusMeters` + a "test with my current location" button), Photo policy (`requirePhoto`, `requireLocation`, `photoMaxWidthPx`, `photoJpegQuality`, `photoRetentionDays`), OT policy (`otPromptEnabled` kill switch, `otTriggerTime`, `depotWorkingMinutes`, `otMonthlyGraceLimit`), Thresholds (`halfDayThresholdMinutes`). Backend ready: `app/api/admin/attendance/settings/route.ts` (510 lines with full validation + cross-field rules + `willForceReconsent` / `rolloutActivated` flags in response). HTML mockup to be designed.

- **Admin OT audit report UI.** Page at `app/(ops)/admin/attendance/ot-audit/page.tsx` — monthly read-only audit. Per-user grace usage, total OT credited (auto vs grace vs admin-approved), grace flag counts. Backend ready: `app/api/admin/attendance/ot-audit/route.ts` (289 lines). HTML mockup to be designed.

### Phase 2 admin writes

- **Manual entry record.** Admin adds a missed check-in/out after the fact with `isManualEntry = true` and `manualReason` text. Backend missing — needs new route at `app/api/admin/attendance/manual-entry/route.ts` and a modal in admin dashboard.
- **Edit existing record.** Correct a wrong timestamp, photo, or location after the fact. Audit field bump on every edit. Backend missing.
- **Mark exception.** Set summary `status` to `ON_LEAVE` or `EXEMPT` for a specific day with reason text. Backend missing.

### Phase 2 master-data writes

- **Holidays management.** CRUD on a `holidays` table — date + name + applies-to-all-roles. Rollover cron should treat holidays as non-attendance days (skip ABSENT insertion). Backend + frontend both missing.

### Quality / polish

- **Real depot geofence coords.** Current value is Surat city centre `21.1702, 72.8311 ±150m`. Physically measure actual depot lat/long and update `attendance_settings`. Can be done via admin settings UI once shipped (P1b above).
- **In-app notification when admin acts on OT.** When admin approves or rejects a PENDING claim, the user sees a toast / badge / email on their next session.
- **Service worker for offline check-in/out.** PWA currently requires network. Queue events offline → flush on reconnect. Storage budget concern: photo blob in IndexedDB until upload succeeds.
- **Push notifications.** Web push for OT decisions and manager alerts.
- **Submitting state polish on OT screen.** Today, after Submit OT claim is tapped, the screen briefly renders ConfirmView ("Submitting…") instead of staying on the OT screen. Reason text preserved in error state but invisible during the submit moment. Minor — a dedicated "submitting OT claim" state on the OT screen itself would smooth this.
- **Auto-ticking clock on OT prompt screens.** Choice screen is static between mount and tap. Could add 30-second setInterval to refresh `formatIstClock(new Date())` and "N min overtime so far". Not deemed worth it yet.
- **ESLint bootstrap.** `npm run lint` currently prompts to set up. Worth a one-off to wire `eslint-config-next` strict, then add to CI / pre-commit.
```

---

## Net result

ROADMAP "Attendance + OT" section grows from 9 bullets to ~14 (more granular now that admin frontend is broken into 3 distinct pages and Phase 2 is split into "writes" + "master-data writes"). The big shift: P0 (the production blocker) is gone from the list because it's now in `CLAUDE_ATTENDANCE.md` as current state.

---

*End of roadmap update — 2026-05-14.*
