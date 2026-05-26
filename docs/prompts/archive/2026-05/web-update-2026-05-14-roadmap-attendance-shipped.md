# Roadmap update — Attendance admin trio shipped

- Date: 2026-05-14
- Module: Attendance
- Canonical file affected: `ROADMAP.md` (Attendance + OT section)
- Trigger: 3 admin frontend pages shipped this session (OT Pending Queue, Attendance Settings, OT Audit) + shared sub-nav component + ops_admin RBAC fix

---

## What to remove from ROADMAP

Delete these 3 bullets from the "Next up — admin frontend trio (P1)" subsection (all done):

> - **Admin OT pending queue UI.** Page at `app/(ops)/admin/attendance/ot-pending/page.tsx` listing `otApprovalStatus = PENDING` records...
>
> - **Admin attendance settings UI.** Page at `app/(ops)/admin/attendance/settings/page.tsx` — full form replacing SQL edits...
>
> - **Admin OT audit report UI.** Page at `app/(ops)/admin/attendance/ot-audit/page.tsx` — monthly read-only audit...

The "Next up — admin frontend trio (P1)" subsection should be removed entirely since all 3 items are now in `CLAUDE_ATTENDANCE.md` as current state.

---

## What to add to ROADMAP

Add a new subsection at the top of "Attendance + OT" (carries forward open items from this session):

```
### Next up — admin trio polish + redesign (P1.5)

- **Admin attendance pages redesign.** Page nav (sub-nav), button placement on
  sticky save bar, empty Row 2 strip on Settings + OT Audit pages, toggle
  colours violating one-teal rule on Settings page — all flagged for a
  dedicated redesign session. Mockup-first workflow across all 4 admin
  attendance pages (Dashboard / OT Pending / Settings / OT Audit) to land
  on one coherent visual language before more admin work.

- **Error toast 401 vs 403 differentiation.** Settings PATCH currently treats
  both 401 and 403 as "Session expired — refresh and re-login". Should
  surface 403 as "Permission denied — your account can't make this change"
  with a distinct toast. Minor copy + branching fix in
  `components/admin/attendance/settings-form.tsx`.

- **Real depot geofence coordinates.** Current `attendance_settings` GLOBAL
  row has Surat city centre (21.1702, 72.8311, radius 150m). Physically
  measure actual depot location and update via the new Settings UI —
  admin can now do this without SQL.

- **Live test of approve/reject flow.** No PENDING records existed during
  the 2026-05-14 build session, so approve/reject + 422 trap +
  409 race-condition flows are untested in production. Will get tested
  organically with next organic OT claim. If anything breaks, surfaces
  here.
```

---

## What stays in ROADMAP (unchanged)

```
### Phase 2 admin writes

- **Manual entry record.** Admin adds a missed check-in/out after the fact
  with `isManualEntry = true` and `manualReason` text. Backend missing —
  needs new route at `app/api/admin/attendance/manual-entry/route.ts` and
  a modal in admin dashboard.
- **Edit existing record.** Correct a wrong timestamp, photo, or location
  after the fact. Audit field bump on every edit. Backend missing.
- **Mark exception.** Set summary `status` to `ON_LEAVE` or `EXEMPT` for
  a specific day with reason text. Backend missing.

### Phase 2 master-data writes

- **Holidays management.** CRUD on a `holidays` table — date + name +
  applies-to-all-roles. Rollover cron should treat holidays as
  non-attendance days (skip ABSENT insertion). Backend + frontend both
  missing.

### Quality / polish

- **In-app notification when admin acts on OT.** When admin approves or
  rejects a PENDING claim, the user sees a toast / badge / email on
  their next session.
- **Service worker for offline check-in/out.** PWA currently requires
  network. Queue events offline → flush on reconnect. Storage budget
  concern: photo blob in IndexedDB until upload succeeds.
- **Push notifications.** Web push for OT decisions and manager alerts.
- **Submitting state polish on OT screen.** Today, after Submit OT claim
  is tapped, the screen briefly renders ConfirmView ("Submitting…")
  instead of staying on the OT screen. Reason text preserved in error
  state but invisible during the submit moment. Minor — a dedicated
  "submitting OT claim" state on the OT screen itself would smooth this.
- **Auto-ticking clock on OT prompt screens.** Choice screen is static
  between mount and tap. Could add 30-second setInterval to refresh
  `formatIstClock(new Date())` and "N min overtime so far". Not deemed
  worth it yet.
- **ESLint bootstrap.** `npm run lint` currently prompts to set up. Worth
  a one-off to wire `eslint-config-next` strict, then add to CI /
  pre-commit.
```

---

## Net result

ROADMAP "Attendance + OT" section trims down — the 3 P1 admin items move out (shipped), and 4 new polish items move in (redesign + toast copy + real geofence + live testing). Phase 2 admin writes and Phase 2 master-data writes are untouched.

The big shift this session: with the Settings UI live, admins can now self-serve geofence coords, rollout stage, kill switch, OT trigger time, etc. without depot-side SQL. That removes Smart Flow from the critical path for most attendance config changes.

---

*End of roadmap update — 2026-05-14.*
