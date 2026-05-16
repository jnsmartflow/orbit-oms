# OT Workflow Roadmap — Remaining Work

**Created:** 2026-05-13
**Status:** Backend complete (shipped 2026-05-13). Frontend pending.
**Owner:** Smart Flow
**Anchor doc:** `code-update-2026-05-13-ot-workflow-backend.md`

---

## Where we are right now

**Done — backend ships:**

- OT schema migration (10 columns, 2 tables, 4 back-relations)
- Pure decision helper (`lib/attendance/ot-logic.ts`)
- Check-out API rewritten to apply the OT rules
- Admin pending-approval list + approve/reject endpoints
- Admin audit query (read-only, monthly)
- Admin settings GET + PATCH (replaces all SQL-edits)

**Not done — frontend + supporting infrastructure:**

- User-facing OT prompt on check-out screen
- Admin pending-approvals UI
- Admin settings UI
- Admin audit report UI
- In-app notification system (none exists in OrbitOMS today)
- A few small backend tidies (see Session F)

**Critical state right now:**

Check-outs past 7 PM IST return 400 because the frontend doesn't send
`otClaimed` yet. Smart Flow confirmed nobody is using the app today,
so no operational impact. The kill switch
(`PATCH /api/admin/attendance/settings` → `otPromptEnabled: false`)
can soft-cutover at any time if needed.

---

## Roadmap overview

5 sessions. Estimated 14 Claude Code prompts total. Roughly 12-16 hours
of execution if everything runs clean.

| Session | Topic                                          | Prompts |
|---------|------------------------------------------------|---------|
| **A**   | Check-out OT prompt UI (user-facing)           | 3       |
| **B**   | Admin settings UI                              | 3       |
| **C**   | Admin pending-approvals UI                     | 3       |
| **D**   | Admin OT-audit report UI                       | 2       |
| **E**   | In-app notification system (banner + badge)    | 2       |
| **F**   | Backend tidies + session-end consolidation     | 1       |

**Recommended order:** A → B → C → D → E → F.

Why this order:
- **A first** because check-out is broken past 7 PM until A ships.
- **B before C/D** because admin settings UI gives Smart Flow control
  over the rollout knobs (`rolloutStage`, `otPromptEnabled`) before
  any depot user is gated.
- **C and D in either order**, but C handles the urgent queue (pending
  approvals) and D is monthly review — so C first.
- **E last among feature work** because A through D can render banners
  using simple per-page DB reads; the notification system is the
  productionizing step.
- **F last** to consolidate everything into context files.

---

# SESSION A — Check-out OT prompt UI

**Why it's urgent:** Check-outs past 7 PM return 400 today. Until this
ships, the depot can't operate past 7 PM without the kill switch on.

**Estimated:** 3 prompts, ~3 hours.

## Prerequisites before starting Session A

- [ ] Mockup HTML created at `docs/mockups/attendance-ot-prompt/`
      showing: (1) the Yes/No card before camera, (2) the reason
      text field when Yes is picked, (3) the "under 9.5h confirm"
      dialog. Mobile 480px column.
- [ ] Review mockup against `CLAUDE_UI.md §6` one-teal-rule (CTAs
      stay gray-900 / green-600 / amber per existing patterns)
- [ ] Decide: does the prompt appear before camera or after photo
      confirmation? **Recommendation:** before. User mentally
      commits to OT or not before submitting, can back out cleanly.

## Prompt A1 — OT prompt component (no integration yet)

**Tool:** Sonnet 4.6
**Goal:** Build the `OtClaimPrompt` component as a standalone UI
piece. No wiring to the flow yet. Mock the user actions in Storybook-
style props.

Build:
- `components/attendance/ot-claim-prompt.tsx` — Yes/No card with
  optional reason text field (visible when Yes is selected). Max
  200 chars with live counter. Submit button disabled until a
  choice is picked.
- `components/attendance/ot-confirm-under-95.tsx` — modal-style
  follow-up dialog. "Total work today was under 9.5h. Confirm OT?"
  with Confirm / Back buttons.

Constraints:
- Both components are pure (props in, callbacks out, no fetches).
- One teal element per screen per `CLAUDE_UI.md §6`.
- Match existing attendance design system (slate gradients, dot
  pattern, gray-900 CTAs).
- No SKILL.md reads needed for a pure UI prompt.

Verification:
- `npx tsc --noEmit` clean.
- Components have no side effects, can be mounted in isolation.

## Prompt A2 — Integrate prompt into check-out-flow

**Tool:** Opus
**Goal:** Wire the two new components into `check-out-flow.tsx`'s
state machine.

State machine becomes:

```
camera → confirm → [if past 7 PM]:
  otClaimPrompt → [if Yes + under 9.5h]:
    otConfirmUnder95 → submit
  → submit
```

Edge cases to handle in the prompt:
- User picks No → skip directly to submit (no reason field).
- User picks Yes + over 9.5h → skip confirm dialog, go direct submit.
- User picks Yes + under 9.5h → confirm dialog.
- User cancels confirm dialog → back to OT prompt with state preserved.
- User backs out at OT prompt → back to confirm view (retake or cancel
  available).

Server contract reminder:
- Form data fields: `otClaimed: "yes" | "no"`, `otClaimReason: string`.
- Only send if check-out is past 7 PM (use `workEndTime` from settings
  prop, already piped through from page).
- Settings prop additions needed: `otTriggerTime`, `depotWorkingMinutes`,
  `otPromptEnabled`. Update `app/(attendance)/attendance/check-out/page.tsx`
  to select and pass these.

Verification:
- `npx tsc --noEmit` clean.
- Smoke test: check out before 7 PM (no prompt), past 7 PM with Yes,
  past 7 PM with No, past 7 PM with Yes + under-9.5h confirm,
  past 7 PM with Yes + under-9.5h cancel.

## Prompt A3 — Day summary screen updates

**Tool:** Sonnet 4.6
**Goal:** Update `day-summary-view.tsx` to reflect the new OT outcome.

Changes:
- Show OT status badge below the total worked figure when applicable:
  - `AUTO_CREDITED` → emerald "+1h 30m OT"
  - `AUTO_CREDITED_GRACE` → amber "+1h OT · grace 1/3 used this month"
  - `PENDING` → amber "OT pending admin approval"
  - `NOT_CLAIMED` → no badge
- New response field `otOutcome.graceUsedThisMonth` should drive the
  "grace 1/3" caption.
- If grace is fully consumed (3/3), show soft note: "Next under-hours
  OT will need admin approval."

Verification:
- `npx tsc --noEmit` clean.
- Manual trace of each of the 4 status values against the design.

## Session A exit criteria

- [ ] Check-out past 7 PM works end-to-end with the OT prompt
- [ ] All 4 OT outcomes render correctly on the day summary
- [ ] No regression in pre-7 PM check-outs
- [ ] Session-end draft: `code-update-2026-MM-DD-ot-prompt-frontend.md`

---

# SESSION B — Admin settings UI

**Why first among admin sessions:** Gives Smart Flow control over
`rolloutStage`, `otPromptEnabled`, and all other knobs without SQL.

**Estimated:** 3 prompts, ~3 hours.

## Prerequisites

- [ ] Mockup HTML at `docs/mockups/admin-attendance-settings/`
      showing: section groupings, save flow, validation error
      surface. Desktop ~1200px (admin only uses desktop).
- [ ] Decide section layout. **Recommendation:** 6 cards —
      Rollout / Schedule / Geofence / Photo / OT Policy / Consent.
- [ ] Decide: single Save button (PATCH whole form) vs per-section
      save. **Recommendation:** single Save for v1. Multi-section
      save adds state complexity for little gain.

## Prompt B1 — Settings page shell + GET

**Tool:** Sonnet 4.6
**Goal:** Create the admin attendance settings page that loads
current settings and displays them read-only.

Build:
- `app/admin/attendance/settings/page.tsx` — server component, auth
  guard, calls `GET /api/admin/attendance/settings` server-side,
  passes data to client component.
- `components/admin/attendance-settings-form.tsx` — client component,
  read-only display first (no edit yet). Six sections.

Verification:
- `npx tsc --noEmit` clean.
- All 20 editable fields visible, formatted appropriately (times
  as HH:MM, decimals as numbers, booleans as Yes/No badges).

## Prompt B2 — Edit + validation surface

**Tool:** Opus
**Goal:** Make every field editable with inline validation surface
that mirrors the server's `errors[]` array.

Build:
- Form fields with controlled state for each editable column.
- Client-side validation that mirrors server-side rules (so admin
  gets immediate feedback). Server is still source of truth on
  submit.
- Validation error display: server returns `{ errors: [{ field,
  message }] }` on 400 — render each error inline under its field
  AND in a summary at the top.

Special cases:
- `dpdpConsentVersion` field shows a warning "This will force all
  users back through the consent flow" when value changes.
- `rolloutStage` OFF → TEST_USERS_ONLY shows a confirmation dialog
  before save: "This will gate test users on next request. Continue?"
- `otPromptEnabled` toggle is a kill switch — confirm dialog on
  disable: "Disabling means check-outs past 7 PM will not be
  prompted for OT. Confirm?"

Verification:
- `npx tsc --noEmit` clean.
- All cross-field invariants trigger correctly client-side and on
  server fallback.

## Prompt B3 — Save flow + success/error UX

**Tool:** Sonnet 4.6
**Goal:** Wire up `PATCH /api/admin/attendance/settings` with success
toast, error surface, and post-save refresh.

Behavior:
- Save button disabled when no dirty fields.
- On success: green toast "Settings saved", form re-renders with
  fresh data + `willForceReconsent` / `rolloutActivated` flags shown
  as informational banners if returned.
- On 400 validation error: render errors inline + summary at top.
  Don't clear form state — admin fixes and retries.
- On 500: red toast "Save failed: <message>".

Verification:
- `npx tsc --noEmit` clean.
- Smoke test all the response flags.

## Session B exit criteria

- [ ] Admin can view and edit every setting in the GLOBAL row
- [ ] Validation errors surface inline + at top
- [ ] DPDP version change and rollout activation prompts work
- [ ] No SQL needed for any settings change going forward
- [ ] Session-end draft created

---

# SESSION C — Admin pending-approvals UI

**Why:** Translates the backend's PENDING queue into actionable admin
work. Without this, PENDING records pile up.

**Estimated:** 3 prompts, ~3 hours.

## Prerequisites

- [ ] Mockup HTML at `docs/mockups/admin-ot-pending/` showing list
      layout + approve/reject action area. Each row needs: user,
      date, check-in/out times, total worked, raw OT claim, reason,
      submit time.
- [ ] Decide: approve/reject inline on the row, or click-through to
      a detail panel. **Recommendation:** detail panel — admin
      should see the full context (claim reason, other OT history
      for the user this month, etc.) before deciding.

## Prompt C1 — Pending queue list page

**Tool:** Sonnet 4.6
**Goal:** Admin sees the list of all PENDING OT claims.

Build:
- `app/admin/attendance/ot-pending/page.tsx` — server component,
  auth guard, calls `GET /api/admin/attendance/ot-pending`.
- List shows: user name + role, attendance date, check-in/out
  times, total worked, raw OT claim, reason snippet (truncated),
  submitted-at relative time.
- Empty state: "No OT claims pending approval."
- Sort: oldest first (already from API).

Verification:
- `npx tsc --noEmit` clean.

## Prompt C2 — Detail panel + approve/reject

**Tool:** Opus
**Goal:** Click a row → opens a side panel with full claim context
and approve/reject actions.

Build:
- Detail panel showing:
  - User name + role
  - Date + check-in/out + total worked
  - Raw OT claim + reason (full text)
  - Optional: that user's OT history this month
    (would need a new API endpoint OR reuse audit query with
    `userId` filter — recommend reuse)
- Approve button: opens a confirm dialog with optional admin note
  textarea (≤500 chars). On confirm, calls
  `PATCH /api/admin/attendance/ot-pending/[recordId]` with
  `{ action: "approve", note }`.
- Reject button: same flow with `action: "reject"`. Reject confirm
  dialog should mention "Grace counter is NOT refunded."
- 422 error handling: if trigger time moved and approve returns
  422, show explicit error to admin with the route's message.

Verification:
- `npx tsc --noEmit` clean.
- Smoke test approve, reject, and the 422 edge case.

## Prompt C3 — Real-time queue refresh after action

**Tool:** Sonnet 4.6
**Goal:** After approve or reject, the queue list reflects the new
state without a hard refresh.

Behavior:
- On approve/reject success: remove the row from the queue, close
  the detail panel, show success toast with the new status.
- If the user has multiple PENDING records same day: only the
  acted-on record is removed; others stay (correct per backend
  behavior).
- Update the summary count at the top of the page ("3 pending"
  → "2 pending").

Verification:
- `npx tsc --noEmit` clean.

## Session C exit criteria

- [ ] Admin can view the full PENDING queue
- [ ] Approve/reject works with optional notes
- [ ] 422 trigger-time-changed error handled gracefully
- [ ] Queue updates without reload after action
- [ ] Session-end draft created

---

# SESSION D — Admin OT-audit report UI

**Why:** Closes the trust-and-flag loop. Admin can run monthly
reviews to spot abuse patterns.

**Estimated:** 2 prompts, ~2 hours.

## Prerequisites

- [ ] Mockup HTML at `docs/mockups/admin-ot-audit/` showing the
      report table + summary block at top.
- [ ] Decide: include the summary block above the table (default)
      or as a sidebar. **Recommendation:** above. Vertical scroll
      is fine.

## Prompt D1 — Audit report page with filters

**Tool:** Sonnet 4.6
**Goal:** Admin views OT audit log filtered by month (default
current) and optionally user.

Build:
- `app/admin/attendance/ot-audit/page.tsx` — server component,
  auth, reads `?month=YYYY-MM&userId=N` from search params, calls
  `GET /api/admin/attendance/ot-audit`.
- Month nav: arrows (prev / current) + dropdown (last 24 months).
  Reuse calendar nav pattern from history calendar.
- User filter: searchable dropdown of all active users + "All
  users" option.
- Summary block at top: 6 KPIs (totalAudits, claimsYes, claimsNo,
  adminApproves, adminRejects, flaggedDays, totalMinutesCredited).
- Table: chronological list, columns User / Date / Action /
  Performed By / Status (from→to) / Reason or Note / Credit.
- Empty state per filter combination.

Verification:
- `npx tsc --noEmit` clean.

## Prompt D2 — CSV export + per-user drill-down

**Tool:** Sonnet 4.6
**Goal:** Two small additions to the audit page.

Build:
- "Download CSV" button — generates client-side CSV from the
  current filtered result set. (Alternative: add a server-side
  CSV export route — but the existing data is bounded by 24 months
  and one user, so client-side is fine for now.)
- Clicking a user name in the table → re-runs the query with
  `userId` filter on that user. Same month preserved.

Verification:
- `npx tsc --noEmit` clean.
- CSV downloads with correct headers + data.

## Session D exit criteria

- [ ] Monthly audit report viewable with filters
- [ ] CSV export works
- [ ] Per-user drill-down works
- [ ] Session-end draft created

---

# SESSION E — In-app notification system

**Why:** Trust-and-flag depends on admins being notified of pending
work. Without notifications, admins forget to check the queue.

**Estimated:** 2 prompts, ~2 hours.

## Prerequisites

- [ ] Architecture decision: pull-based (server component reads count
      on every page render) vs push-based (websocket or polling).
      **Recommendation:** pull-based for v1. OrbitOMS has no
      websocket infrastructure. Polling every 30s from admin pages
      is fine for depot-scale usage (~50 users).
- [ ] Decide what notifications surface:
      1. Admin: "X OT approvals pending" badge on every admin page.
      2. User: "Your OT for [date] is pending HR approval" banner
         on home screen.
      3. User: "Admin approved your OT for [date]" banner after
         admin action.

## Prompt E1 — Admin pending count badge

**Tool:** Sonnet 4.6
**Goal:** Every admin page shows a count badge for pending OT
approvals.

Build:
- New API: `GET /api/admin/attendance/ot-pending/count` — returns
  `{ count: number }`. Fast query (just `count` on records where
  `otApprovalStatus = "PENDING"`).
- Admin layout component (or shared admin header) reads this count
  server-side on render.
- Badge shown next to the OT Pending nav link (when count > 0).
- Optional: polling refresh every 30s on the pending queue page
  itself.

Verification:
- `npx tsc --noEmit` clean.

## Prompt E2 — User OT status banners on home

**Tool:** Sonnet 4.6
**Goal:** User home screen shows banners for OT-related state.

Build:
- Add to the home page server fetch: most recent CHECK_OUT record
  with `otApprovalStatus` in `["PENDING", "APPROVED", "REJECTED"]`
  in the last 7 days.
- Banner component renders:
  - PENDING → amber banner "Your OT for [date] is pending HR
    approval"
  - APPROVED (within 3 days of admin action) → emerald banner
    "Admin approved your OT for [date] — [N]m credited"
  - REJECTED (within 3 days) → red banner "Admin rejected your OT
    for [date]" with optional admin note
- Banners dismissible per session (state in `useState`, not
  persisted — re-appear on next login).

Verification:
- `npx tsc --noEmit` clean.

## Session E exit criteria

- [ ] Admin sees count badge on relevant pages
- [ ] Users see status banners on home
- [ ] Polling refresh works without hammering the API
- [ ] Session-end draft created

---

# SESSION F — Backend tidies + consolidation

**Why:** Small loose ends + canonical context update.

**Estimated:** 1 prompt + manual consolidation, ~2 hours.

## Items to address

### F1 — Persist `otMinutesRaw` (deferred from Prompt 2)

Currently `otMinutesRaw` is computed in-memory and discarded after the
response. This means:

- Admin approve path has to recompute it (already does).
- Future analytics ("how much did users claim vs decline?") can't
  answer the question without recomputing across the whole record set.

**Decision needed:** Do we add a persisted `otMinutesRaw` column to
`attendance_records`?

Pros: cleaner analytics, audit log shows what user claimed even if
trigger time has moved.
Cons: another column, another sync point, slight schema bloat.

**Recommendation:** Add it. Trigger-time edits are rare but possible,
and audit clarity matters. One SQL migration in F1.

### F2 — Document the legacy `overtimeMinutes` field

The `attendance_summary.overtimeMinutes` column is now legacy (still
populated for historical export compatibility, but new code should
read `otMinutesCredited`).

Action: add a deprecation comment in `schema.prisma` and document the
dual-source decision in `CLAUDE_CORE.md`.

### F3 — Photo retention enforcement (long-standing gap)

The consent form promises "Stored 90 days, then auto-deleted" but
no cron job exists.

Add:
- `app/api/cron/attendance-photo-retention/route.ts` — Vercel Cron,
  daily. Queries records older than `photoRetentionDays` with
  non-null `photoPath`, deletes from Supabase Storage, nulls the
  `photoPath` column.
- Uses `isCronAuthorized` from `lib/cron-auth.ts`.
- Configure cron in `vercel.json` (one new entry).

This is outside the OT scope but is now ripe — we've already touched
adjacent code and the gap was flagged in the original audit.

### F4 — Update CLAUDE_CORE.md

Apply the IPv4 fallback note from
`web-update-2026-05-13-prisma-db-pull-fallback.md`. Bump schema
version to v27.2.

### F5 — Create CLAUDE_ATTENDANCE.md

Attendance content has grown large enough to deserve its own domain
file (matching the MO and TINT pattern). Move attendance-related
sections out of CORE into the new file:

- Schema (records, summary, settings, ot_grace, ot_audit, users
  attendance fields)
- Engineering rules specific to attendance (sequential awaits, no
  $transaction reminder, JWT gate behavior)
- OT workflow rules summary
- Photo handling rules
- Geofence + location handling
- Consent flow + DPDP version bumps

Update `CLAUDE.md` router to point attendance tasks at this new file.

### F6 — Consolidate session-end drafts

Five session-end drafts will exist by the time F runs:

- `code-update-2026-05-13-ot-workflow-backend.md`
- `web-update-2026-05-13-prisma-db-pull-fallback.md`
- Plus 4 more from sessions A through E

Consolidate into canonical context files. Archive originals to
`docs/archive/`.

## Session F exit criteria

- [ ] `otMinutesRaw` persisted (or explicit decision not to)
- [ ] Photo retention cron live
- [ ] CLAUDE_CORE.md updated with IPv4 fallback + schema v27.2
- [ ] CLAUDE_ATTENDANCE.md created
- [ ] All session-end drafts consolidated and archived
- [ ] OT workflow officially complete; no open items

---

# Out-of-scope items (deferred indefinitely)

These came up during analysis but were explicitly deferred:

- **Leave system** (sick / casual / paid). Schema supports `ON_LEAVE`
  status; no workflow, table, or UI exists. Big scope, separate
  project.
- **Holiday calendar.** Same shape — `HOLIDAY` status renders, no
  table or admin UI.
- **Auto check-out for forgotten check-outs.** Currently INCOMPLETE
  rows persist forever. Could add a nightly job that closes them at
  workEndTime, but the OT workflow makes this trickier (auto-closing
  at 7:00 PM means no OT claim possible — which is correct, but
  loses the actual departure time).
- **Per-role or per-user shifts.** Schema supports the `scope` +
  `roleSlug` columns; no code reads them. Single global shift for
  the foreseeable future.
- **Face match / liveness on the selfie.** Out of scope; product
  decision pending.
- **Manual entry / admin override** for closed records. Schema has
  `isManualEntry`, `manualReason`, `createdById`, `ADMIN_OVERRIDE`
  audit action — nothing writes them. Future feature.
- **Background-job-based monthly grace reset.** Currently the reset
  happens implicitly because the grace lookup queries by yearMonth
  string — May's row is independent of June's, so June 1 just
  "starts fresh" without any explicit reset job. Working as designed.
- **WhatsApp / email notifications.** Deferred per CORE §11. In-app
  only for now.

---

# Risks and watch-items

**Trigger-time edits between submission and approval.** The 422 guard
catches the worst case (recomputed raw = 0), but a small trigger-time
edit (e.g. 19:00 → 19:15) could silently reduce the credit by 15 min
without flagging. Once F1 ships (`otMinutesRaw` persisted), this
becomes auditable.

**JWT 5-min stale window on rollout flag changes.** A
`rolloutStage` change in admin settings won't propagate to existing
sessions for up to 5 min. If Smart Flow flips OFF → ALL_USERS in a
rush, expect a 5-min lag before all users are gated. Document in
admin settings UI as informational text.

**Race on grace counter under high concurrency.** Atomic
`{ increment: 1 }` is race-safe at DB level, but if a single user
submits two check-outs simultaneously (impossible in practice — they
can't be in two places — but theoretically), both could read the
same `currentGraceFlagCount` and the decision could mismatch the
post-increment value. Not a practical concern for depot-scale.

**No notification persistence.** Session E builds banners that are
dismissed per session (not persisted). If user logs in on phone, sees
the banner, dismisses, then logs in on desktop later — banner
reappears. Acceptable for v1.

**Consent text mismatch with reality.** The consent form still says
"Stored 90 days, then auto-deleted." Until F3 ships, this is
technically false. Fix in F3.

---

# Definition of done

The OT workflow is fully complete when:

1. Depot users check out past 7 PM and see the OT prompt, can say
   Yes (with reason) or No, and Yes claims under 9.5h trigger the
   confirm dialog and either credit-under-grace or enter pending.
2. Admins can see pending claims, approve or reject them with notes,
   and the user is notified.
3. Admins can run monthly audit reports filtered by user.
4. Admins can change any settings from a web UI (no SQL).
5. Photos older than 90 days are automatically deleted.
6. Context files (CORE, ATTENDANCE) reflect the final state.
7. No open follow-ups or known bugs.

---

# Suggested session cadence

The above is 5 sessions plus consolidation. At ~1 session per week
that's 6 weeks. If Smart Flow can do 2 per week, 3 weeks. Realistic
calendar estimate: **3-5 weeks** depending on review cycles and
mockup turnaround.

Session A is urgent (unblocks 7 PM+ check-outs). The rest can be
sequenced at a comfortable pace.
