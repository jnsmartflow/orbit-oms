# Session-end context update — Tint orders in Support + pending-from-earlier board
# Draft for canonical-doc consolidation (Step 7)
# Date: 2026-06-29 · Commit: c901d6 (10 files, +289 / −22) · Pushed to main, live on orbitoms.in

This draft records everything from the build session that must land in the canonical
context files. Grouped by TARGET FILE so consolidation is copy-and-place.
Discovery source-of-truth for this work: docs/prompts/drafts/code-discovery-2026-06-27-tint-in-support.md

---

## WHAT SHIPPED (one-paragraph summary)

Tint orders now appear on the Support board from the moment they arrive (stamped with an
arrival slot at import, like any other order), wearing a locked read-only status pill that
mirrors their tint stage. They can be held/cancelled only before mixing starts. An operator
can pre-set a dispatch slot on a tint order while it's still mixing; when tinting completes,
the order auto-flips to Dispatch using that slot (no slot pre-set → lands in pending_support
as normal). Separately, a "pending from earlier" header badge surfaces unhandled pending
orders from past days in a flat list, toggled in/out by the badge alone. The carry-over
behaviour the docs described never actually existed in code — the board was already
date-fenced to today.

---

## TARGET: CLAUDE_CORE.md  (§9 — tint import slot rule)

OLD rule (now WRONG — replace):
> "Tint orders: slotId=null at import. Slot assigned at tinting completion based on IST time.
>  Splits: parent slot set when last split completes."

NEW rule (current behaviour after this build):
- `arrivalSlotId` is now stamped AT IMPORT for tint orders, using `resolveArrivalSlotId`
  (the 5-slot ruler in lib/slots/slot-ruler.ts), exactly like non-tint orders. Arrival slot =
  when the order arrived, not when paint finished.
- `slotId` / `originalSlotId` remain null at import for tint orders and are still set at
  tinting completion (unchanged — still based on IST completion time).
- So the split is: arrivalSlotId = import-time (NEW); slotId/originalSlotId = completion-time
  (unchanged).
- No backfill was run — this applies to NEW orders only. Old tint orders keep arrivalSlotId=null.

---

## TARGET: CLAUDE_IMPORT.md  (§12 — arrival slot stamping)

- `arrivalSlotId` is now set for tint orders at import in BOTH import paths in
  app/api/import/obd/route.ts: the manual-SAP confirm path (~line 1021) and the auto-import
  path (~line 2822).
- The change: the old `orderType !== "tint" && emailDateTime ? resolveArrivalSlotId(...) : null`
  ternary had its tint guard removed → now `emailDateTime ? resolveArrivalSlotId(...) : null`.
- Note (pre-existing, worth recording): enrichment (applyMailOrderEnrichment) ALREADY stamped
  arrivalSlotId for mail-matched orders, tint included — only slotId/originalSlotId were
  tint-guarded there. So before this build, mail-matched tint orders already landed in slot
  tabs; only no-match tint orders were the orphans. The import-time stamp now covers both.

---

## TARGET: CLAUDE_TINT.md  (§2 — completion behaviour)

Tint completion (app/api/tint/operator/done/route.ts and split/done/route.ts) now branches on
a pre-set dispatch slot:
- `hasPresetSlot = order.dispatchWindowId != null && order.dispatchTargetDate != null`
- If TRUE  → completion writes `workflowStage:"closed"`, `dispatchStatus:"dispatch"` (+ slotId/
  originalSlotId as before). Order auto-flips to Dispatch using the pre-set slot and leaves the
  pending list.
- If FALSE → unchanged behaviour: `workflowStage:"pending_support"` (operator decides slot later).
- The whole-order fetch at done/route.ts ~line 49 is a no-select findFirst, so dispatchWindowId
  + dispatchTargetDate are already present — no query change needed.

LANDMINE recorded (split/done/route.ts):
- The parent-bubble advance (parent → pending_support / now closed+dispatch) runs OUTSIDE the
  $transaction at ~line 50, and always has. The pre-set conditional was added there, consistent
  with existing structure.
- Failure mode if the parent-bubble update throws after the transaction commits: parent stuck at
  tinting_in_progress while all splits show tinting_done. It is RE-RUNNABLE — the bubble's entry
  condition re-triggers on the next attempt. Known retry case, NOT a bug. (Operator symptom: all
  splits green but parent still "mixing" → re-trigger.)
- The $transaction itself remains a pre-existing CORE §3 violation. Not refactored here — flagged
  for a dedicated job.

---

## TARGET: CLAUDE_SUPPORT.md  (multiple sections)

### §4.1 / §6 — CARRY-OVER CLAIMS ARE WRONG (correct them)
- The docs state pending/tinting tiles are "unfenced" and carry-over "happens naturally."
  This is FALSE in the actual code. Both list arms in orders/route.ts and all per-slot counts in
  slots/route.ts are date-fenced (`obdEmailDate gte istStart / lt istEnd`). Today's board already
  shows today's arrivals only. There is no carry-over arm. Update the docs to match reality.

### NEW — pending_tint_assignment visible + locked status pills
- `pending_tint_assignment` was removed from the today-list and history notIn exclusions in
  orders/route.ts → tint orders now show from arrival.
- getRowType (support-orders-table.tsx) now returns "tinting" for all three tint stages:
  pending_tint_assignment, tint_assigned, tinting_in_progress → rows are read-only (no
  checkbox/dispatch/priority actions).
- Status pill labels (purple, locked), per stage:
    pending_tint_assignment → "Tint · Pending"
    tint_assigned           → "Tint · Assigned"
    tinting_in_progress     → "Tint · Mixing"
- slots/route.ts today tintingCount now includes pending_tint_assignment so the slot-tab badge
  counts these rows.

### NEW — hold/cancel gating for tint orders (Support side only)
- app/api/support/orders/[id]/hold/route.ts and cancel/route.ts now reject a tint order at the
  mid-tint stages: `orderType==="tint" && workflowStage in ["tint_assigned","tinting_in_progress"]`
  → 409 with a clear message. All other cases pass (non-tint any stage; tint at
  pending_tint_assignment / tinting_done / pending_support).
- Effect: Support can hold/cancel a tint order only before mixing starts. Tint Manager side NOT
  touched this build — cross-screen sync is deferred (see Deferred).

### NEW — pre-set dispatch slot on tint rows
- New route: app/api/support/orders/[id]/preset-slot/route.ts (POST). Writes ONLY
  dispatchTargetDate + dispatchWindowId; does NOT change workflowStage/dispatchStatus (order
  stays in its tint stage). Guarded to orderType==="tint" at the three tint stages.
- The dispatch-slot picker now renders on tinting rows (the column's `isTinting` hide-gate was
  removed for that column only; checkbox + priority columns still hidden on tint rows). Its
  onChange calls a new `onPresetSlot` handler (NOT onSingleDispatch).
- DISPLAY FIX: the pending-row picker previously had `value={null}` hardcoded, so a saved slot
  never displayed once an order reached pending_support. Now derives value from
  order.dispatchTargetDate/dispatchWindowId, mirroring the tinting-row picker.

### NEW — "pending from earlier" badge + flat list + toggle
- slots/route.ts: new `earlierPendingCount` (obdEmailDate < today IST start; pending stages;
  dispatchStatus null; isRemoved false; same hide exclusion). Strictly non-overlapping with the
  today tiles (today = >= todayStart). NOT added to todayTotal — no double-count.
- orders/route.ts: new `section === "earlier"` arm (same where; oldest-grouped). No existing
  query/section changed — purely additive.
- support-page-content.tsx: header badge "⚠ N pending from earlier", shown only when count > 0.
- TOGGLE behaviour (approved mockup: docs/mockups/support/earlier-toggle.html):
  - The badge is the ONLY toggle: tap in → earlier list; tap again → back to today (lands on
    Morning via handleMainTabChange).
  - While in earlier view, slot tabs grey out AND are unclickable — reuses the existing Hold-tab
    disable pattern (segmentsDisabled + onSegmentChange early-return).
  - Banner stays the SAME soft cream in both states; only the right-side hint flips
    ("tap to view" ⇄ "← back to today"). No solid-colour fill (an earlier loud-orange version was
    rejected).

---

## KEY LEARNINGS (worth adding to CORE learnings / a debugging note)

1. **Local DB and live DB are separate.** The big red herring this session: a slot pre-set on
   LOCAL while the operator marked the order Done on the LIVE app → completion read live's DB,
   found no slot, dropped to pending_support. Looked like an auto-dispatch bug; was actually two
   different databases. Rule: a set-slot and its mark-done must happen on the SAME app/DB. Now
   that the build is live, everyone shares one DB and this confusion disappears.

2. **Reasoning about runtime ≠ runtime.** Two static code-reads concluded done/route.ts "should
   work"; only an instrumented console.log + a clean same-DB test proved the feature was fine.
   When DB state and code logic seem to contradict, instrument and run — don't keep re-reading.

3. **Prisma P2024 pool timeout on local** (`connection_limit:1`): slow local→Supabase queries
   stacked and starved the single connection (slots/route.ts count). Local-only infra symptom,
   not from this build. Parked for a separate look.

---

## DEFERRED / PARKED (not in this build)

- Tint Manager cross-screen sync: TM hold/cancel reflecting on Support, and the TM `heldAt`
  stamp fix (TM status route sets dispatchStatus="hold" but never stamps heldAt → history
  hold-footprint silently fails for TM-held orders). Build AFTER Support is solid — this was the
  agreed sequence.
- Auto-dispatch "brain" (Task 2): system auto-deciding the slot with no human input, and the
  no-pre-set-window edge cases. Separate future build.
- Split tint orders: deeper edge cases beyond the parent-bubble conditional added here.
- Prisma pool timeout (P2024) investigation.
- A7 sort decision: the earlier-pending flat list currently sorts priority-then-age (module-level
  ORDER_BY), not pure oldest-first. Pending a call on whether to force pure oldest-first.

---

## FILES TOUCHED (commit c901d6)
- app/api/import/obd/route.ts
- app/api/support/orders/route.ts
- app/api/support/slots/route.ts
- app/api/support/orders/[id]/hold/route.ts
- app/api/support/orders/[id]/cancel/route.ts
- app/api/support/orders/[id]/preset-slot/route.ts  (NEW)
- app/api/tint/operator/done/route.ts
- app/api/tint/operator/split/done/route.ts
- components/support/support-orders-table.tsx
- components/support/support-page-content.tsx

## MOCKUP
- docs/mockups/support/earlier-toggle.html  (approved 2026-06-28, clean-banner version)
