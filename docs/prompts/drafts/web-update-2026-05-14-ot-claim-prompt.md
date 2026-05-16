# Session update — OT claim prompt on check-out

- Date: 2026-05-14
- Module: Attendance
- Type: Frontend feature build (P0 production blocker resolved)
- Canonical file affected: `docs/CLAUDE_ATTENDANCE.md`
- Commits: `e2e88a604098b3ac08d55b7ae019126632572c9d` (main build) + 1 follow-up (threshold tweak)

---

## What shipped

The end-user OT (overtime) claim prompt screen on `/attendance/check-out`. Previously, every check-out past `otTriggerTime` returned HTTP 400 because the frontend never sent `otClaimed`. That's now fixed.

End-to-end flow now working:

1. User taps Check Out → camera → confirm selfie
2. If current IST > `otTriggerTime` AND `otPromptEnabled = true`:
   - **OT choice screen** appears: "Were you doing overtime work?" with amber callout showing current time + trigger time
   - Two buttons: "Yes, claim OT" (teal) / "No, just clocking out" (white outline)
   - "Cancel and go back" link returns to camera (photo discarded)
3. If user picks Yes:
   - **OT reason screen** appears with textarea, amber callout showing "N min overtime so far"
   - Submit enabled as soon as reason has any non-whitespace content
   - Back link returns to choice screen (reason discarded)
4. Submit sends FormData with `otClaimed: "yes"|"no"` and `otClaimReason` (when yes)
5. Success screen (`DaySummaryView`) shows OT outcome banner based on `otOutcome.status`:
   - `AUTO_CREDITED` → green banner "OT credited: N min"
   - `AUTO_CREDITED_GRACE` → amber banner "OT credited under grace · N of M used this month"
   - `PENDING` → amber banner "OT submitted for admin approval · grace limit reached"
   - `NOT_CLAIMED` → no banner

If `otPromptEnabled = false` OR current IST <= trigger → prompt skipped silently, submit sends `otClaimed: "no"`. Kill-switch path verified during testing.

---

## Files changed

| File | Type | Lines added |
|---|---|---|
| `components/attendance/check-out-flow.tsx` | Modified | +369 / −7 |
| `components/attendance/day-summary-view.tsx` | Modified | +55 / −1 |
| `app/attendance/check-out/page.tsx` | Modified | +4 / 0 |

No backend changes. No schema changes. No new files.

---

## State machine — `check-out-flow.tsx`

Added 2 new variants to `FlowStep` union, between `confirm` and `submitting`:

```ts
| { kind: "ot-prompt-choice";
    photoBlob: Blob; photoDataUrl: string; capturedAtISO: string }
| { kind: "ot-prompt-reason";
    photoBlob: Blob; photoDataUrl: string; capturedAtISO: string;
    reason: string }
```

`handleConfirm` was refactored: gate logic decides whether to show prompt or call new private `submit()` function with `otClaimed: "no"`. The choice-No handler calls `submit("no")`. The reason-submit handler calls `submit("yes", reason)`. Common submit logic deduplicated into one helper.

New handlers added:
- `handleOtChoiceYes` → choice → reason (empty reason string)
- `handleOtChoiceNo` → submit with "no"
- `handleOtReasonChange(text)` → update reason in step state
- `handleOtReasonSubmit` → submit with "yes" + reason
- `handleOtBack` → reason → choice (reason discarded, intentional)
- `handleOtCancel` → any prompt step → camera (photo discarded)

---

## API contract (already in place, unchanged)

`POST /api/attendance/check-out` multipart/form-data — new fields the frontend now sends:

| Field | Type | When sent |
|---|---|---|
| `otClaimed` | `"yes"` or `"no"` | Always |
| `otClaimReason` | string | Only when `otClaimed === "yes"` |

Response JSON gained `otOutcome` object (already returned by backend):

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

`CheckOutSuccessPayload` widened to include this. Passed through to `DaySummaryView` as an optional prop.

---

## New props

### `CheckOutFlow` component

```ts
otTriggerTime: string;       // "HH:MM" 24-hour, e.g. "19:00"
otPromptEnabled: boolean;
```

### `app/attendance/check-out/page.tsx` settings select

Added `otTriggerTime` and `otPromptEnabled` to the `prisma.attendance_settings.findFirst` select. Both already exist on the `attendance_settings` table — no schema migration needed.

### `DaySummaryView` component

```ts
otOutcome?: {
  status: "NOT_CLAIMED" | "AUTO_CREDITED" | "AUTO_CREDITED_GRACE" | "PENDING";
  minutesCredited: number;
  graceUsedThisMonth: number;
  graceLimit: number;
};
```

Optional. Banner renders only when defined AND status !== `NOT_CLAIMED`. Placement: between "Day complete" header and the slate gradient duration card.

---

## Design decisions made this session

1. **Reason minimum: 1 character (not 10).** Originally specced at 10 chars trimmed. Lowered after first depot test — Smart Flow found 10 chars too strict for fast check-out. Empty/whitespace still blocked via `.trim()`.

2. **Grace counter shown in `AUTO_CREDITED_GRACE` banner.** Format: "OT credited under grace · 1 of 3 used this month". Pre-empts confusion when user runs out of grace mid-month and a claim flips to PENDING.

3. **No history trap on back button.** Phone hardware back exits the route entirely (loses photo, user retakes on return). Documented in `handleOtCancel` comment. In-flow controls are the back arrow and "Cancel and go back" link.

4. **Lucide Clock icon everywhere.** Both the amber callout and PENDING banner use `<Clock />` from lucide-react. Originally specced as 🕐 emoji — switched for consistency with `<CheckCircle2 />` already on the screen.

5. **`otOutcome` typed required on wire, optional on prop.** Backend always returns it; component prop allows undefined for backward flexibility.

6. **Kill-switch UX confirmed.** `otPromptEnabled = false` → prompt silently skipped, submit sends `otClaimed: "no"`, success screen has no OT banner. Verified during testing.

---

## Edge cases verified end-to-end (depot test, 2026-05-14)

| # | Scenario | Result |
|---|---|---|
| 1 | `otPromptEnabled = false` past trigger | Prompt skipped, submit clean ✓ |
| 2 | `otPromptEnabled = true` past trigger, user picks "No" | Submit with `"no"`, no banner ✓ |
| 3 | User picks "Yes" → types short reason → submit | Green banner ✓ (also tested with grace path → amber banner with counter) |
| 4 | Reason empty → submit button disabled | ✓ |
| 5 | Reason 1+ chars → submit button enabled | ✓ |
| 6 | "Cancel and go back" from choice screen | Returns to camera, photo discarded ✓ |
| 7 | "Back" from reason screen | Returns to choice, reason discarded ✓ |
| 8 | OT claim with total worked < 9.5h, grace available | `AUTO_CREDITED_GRACE`, counter incremented ✓ |

Real production smoke test: trigger temporarily set to `01:45` IST via Supabase, restored to `19:00` after testing.

---

## Known follow-ups (not done this session)

1. **ESLint not configured in repo.** `npm run lint` prompts interactively to set up. Worth a separate one-off to bootstrap with strict Next config. Did not block this build.

2. **Submitting/error transition shows ConfirmView, not the OT screen.** When user taps "Submit OT claim", the screen briefly renders ConfirmView ("Submitting…") before success/error. Reason text preserved in error state, but invisible during the submit moment. Minor UX hop — future polish would be a dedicated "submitting OT claim" state on the OT screen itself.

3. **Prompt time displays don't auto-tick.** `formatIstClock(new Date())` and "N min overtime so far" computed at render time. Reason screen re-renders on every keystroke so the count updates organically. Choice screen is static between mount and tap. A 30-second setInterval could be added if needed — not deemed worth it for current UX.

---

## Updates needed in canonical context files

### `docs/CLAUDE_ATTENDANCE.md`

**§7 Check-out flow** — remove the implicit assumption that OT prompt is unbuilt. Update the bullet about OT prompt:

> 3. **OT prompt** if current IST time hour >= `otCutoffHourIST` (e.g. 19 = 7 PM):
>    - Modal: "Are you working overtime?" + reason text field
>    - **(built 2026-05-14, see `check-out-flow.tsx` state machine)**

**§17 Landmines** — remove this entry (no longer applicable):

> - **Check-outs past 7 PM IST** return HTTP 400 if frontend doesn't send `otClaimed`. End-user OT prompt UI is not yet present. Kill switch: `PATCH /api/admin/attendance/settings { otPromptEnabled: false }` soft-cutovers.

Replace with:

> - **OT prompt UI shipped 2026-05-14.** `check-out-flow.tsx` reads `otTriggerTime` + `otPromptEnabled` props from `check-out/page.tsx` settings fetch. Kill switch via `otPromptEnabled = false` still works as soft-cutover.

**§17 Landmines** — update Phase 1 admin entry:

> - **Phase 1 admin = read-only.** Manual entry, edit record, mark exception not built yet.

Leave as-is (still accurate after this session).

---

## P0 status: COMPLETE

Next session candidates (from gap audit):

- **P1a**: Admin OT pending queue page → `app/(ops)/admin/attendance/ot-pending/page.tsx` (backend ready: 143 + 252 lines)
- **P1b**: Admin attendance settings page → `app/(ops)/admin/attendance/settings/page.tsx` (backend ready: 510 lines)
- **P1c**: Admin OT audit page → `app/(ops)/admin/attendance/ot-audit/page.tsx` (backend ready: 289 lines)
- **P2**: Manual entry / edit record / mark exception (backend + frontend both missing)
- **P2**: Holidays management (backend + frontend both missing)

Recommendation: tackle P1a, b, c together next session — all share the same `(ops)` route group and admin RBAC pattern, similar table+form UI vocabulary.

---

*End of session update — 2026-05-14.*
