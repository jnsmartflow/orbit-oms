# web-update 2026-08-02 · "Done = check date" — Billing Picking tab + Picking supervisor board (SHIPPED & live-verified)

**Type:** web-update (decision) + build record. **STATUS: SHIPPED to main and live-verified on the operations pilot, 2026-08-02.** UI polish of the info row deferred to a separate UI session. Canon documentation still to write (see Remaining).
**Session:** claude.ai planning (Smart Flow), 2026-08-02. Diagnosis confirmed against live code + live SELECT; both fixes eyeballed on the live pilot.
**Original goal:** the "done" event must be dated by WHEN THE SUPERVISOR CHECKS it (`pick_assignments.checkedAt`, IST), not the order/dispatch date — in BOTH the Billing Picking tab AND the Picking module. Both delivered.

## Shipped commits (all on main, pushed, tsc green, clean build)
- `b99a925d` — billing WHERE helpers (`buildBillingInvoicedInfoWhere`, `buildBillingMarkerWhere`).
- `71be9ff2` — billing list + marker routes date-aware; `BillingDoneRow` gains kind/checkedAt/checkedByName/sortAt.
- `e7a2d6e5` — billing tab UI (violet "Already invoiced" info rows) + date-stepper plumbing.
- `e37cbe74` — **Picking supervisor board fix** (the sibling half — see below).

## Part A — Billing Picking tab: already-invoiced checked bills
**Bug:** Pending required `invoiceNo IS NULL`; a bill SAP-invoiced BEFORE the supervisor checks it (same-day invoicing is the depot norm) failed Pending (invoiceNo set) AND Done (invoicedAt null) → vanished from both. Live proof: OBDs `9108242795` / `9108357546` — pick_checked, dispatch, not hidden, checkedAt=2 Aug, but invoiced 25 Jul; only `ok_invoice_no` false; `active_hide_rules=0`.
**Fix (design LOCKED + built):** a checked bill shows on the Picking tab for the day it was **checked** (`pick_assignments.checkedAt` IST), never hidden for having an invoice number.
- **Pending (actionable)** = pick_checked, no invoice yet, not marked done — UNCHANGED, all-dates backlog.
- **Done area, per selected day** = (a) operator marked-done that day (keyed on `invoicedAt`) PLUS (b) NEW **informational** rows: pick_checked + `invoiceNo IS NOT NULL` + `checkedAt` in the selected IST day. Info-only (not selectable/copyable/mark-done/undo), violet "Already invoiced" badge (`bg-violet-50 text-violet-700 border-violet-200`), invoiceNo + checker name shown.
- Billing **date stepper** now drives the Done area (was inert for this tab). Marker widened to `OR(pending, invoiced-info)`; **count stays pending-only**, `latest` over the union.
- Live-verified: the 5 already-invoiced bills render in Done ("0 invoiced · 5 already invoiced"); Picking badge stays 0; pending correct.

### Owner decisions (Smart Flow, 2026-08-02)
1. **Hide filters APPLY** to the informational arm (arm b AND-includes `getHideExclusion()`, so it is async). A hidden bill stays hidden everywhere.
2. **NO `dispatchStatus` pin** on the informational arm — only the hide filter removes a checked bill from the day's record.
3. **Hide the Undo button on past days** (server undo window stays today-only; client hides the button when not today).

### Write-path safety (holds)
`buildBillingPendingWhere` left byte-identical; mark-done + undo AND it into their `updateMany` (with `invoiceNo:null`), so an info row matches 0 rows. Selection derives from `pending` only.

## Part B — Picking supervisor board: same "done = check date" fix (`e37cbe74`)
**Bug (worse than mis-dating):** `lib/picking/queue.ts` `buildPickingWhere` openPending arm fenced the `pick_checked` branch on `dispatchTargetDate = todayDateOnly`. A bill checked today but dispatch-dated earlier matched NEITHER arm → **vanished at the instant of approval** from the supervisor Checked band AND (downstream) the picker's Done tab. Mirror defect: a bill dispatch-dated today but checked earlier wrongly showed today. The supervisor Checked band applied no client date test (`checkedRows = rows.filter(isChecked)`), so the whole fence was that server predicate. `checkedAt` was fetched/displayed but never used for attribution.
**Fix (Option a, matches Floor `lib/floor/queries.ts:140-143`):** replace the checked branch with `{ workflowStage: PICK_CHECKED, pickAssignment: { checkedAt: { gte, lt } } }` where `{gte,lt} = getISTDayRange()` (IST instant window; `checkedAt` is timestamptz, not a `@db.Date`). `buildPickingWhere` stays pure/sync — no signature change; the marker follows for free (shares the function). Fixes the picker Done tab at the same time (it already admits `isChecked`; the server had removed the row first).
- Dead `todayDateOnly` binding removed (its only consumer was the replaced predicate; zone/lock/ageDays anchor on `dateOnly`/`anchorMs`, untouched). `getISTTodayDate()` kept (still used by `resolveTargetDate`).
- `single` scope left UNCHANGED (caller-less but a public API contract — its own step if ever needed).
- No stale "overdue" badge risk: Checked band renders `variant="doneChecked"`, and `AgeBadge` only renders under `variant==="assign"`.
- Live-verified: checked bills now show by check date; carried-over bills stay visible on approve.

## Remaining (not done this session)
- **Canon documentation (Claude Code job).** No canon file documents the Billing v2 Picking tab today (only drafts). Decide: a `CLAUDE_MAIL_ORDERS.md` section vs a new `CLAUDE_BILLING.md` (+ router row). AND update `CLAUDE_PICKING.md` (§5.2 Checked band / §7) to record the `checkedAt` fix + cross-ref Floor §6(c); note the dead-`todayDateOnly` removal. Grep for any doc claiming the Checked band buckets by dispatch date. Start with a READ+PLAN that writes nothing.
- **UI polish of the info row** (the violet tag / Done column layout) — a separate UI session, explicitly deferred by Smart Flow.
- **Billing edge case parked:** bills invoiced a day or two before being checked — Smart Flow will flag if they need special handling; current simple rule shows them on the check day.
