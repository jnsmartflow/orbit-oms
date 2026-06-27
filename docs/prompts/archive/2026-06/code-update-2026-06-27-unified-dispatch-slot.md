# code-update-2026-06-27-unified-dispatch-slot.md

# Unified dispatch-slot decision (Status + Dispatch Slot + bulk)
# Target canonical file: CLAUDE_SUPPORT.md
# Status: BUILT, smoke-tested clean, pushed to main 2026-06-27
# Schema: v27.7 (NO schema change — zero new columns)
# This is "Task 1" of a two-task effort. Task 2 (auto-assign dispatch slot
# at enrichment — the "brain") is NOT built yet — see "On the horizon".

---

## Where this goes in CLAUDE_SUPPORT.md

- New section **§4.13 Dispatch-slot decision (uniform single + bulk) [LIVE]** —
  after §4.12 (Cancel lifecycle).
- Update **§4.11 / footprintType** note: footprintType is now computed on the
  TODAY board too (was history-only) — see fix below.
- Update **§10 Key files index** — dispatch-slot-picker forceOpenGen, the new
  bulk/dispatch fields.
- Move the "assign date+slot to any order" item in §7 from DEFERRED → DONE for
  the MANUAL case (auto case still pending = Task 2).

---

## §4.13 Dispatch-slot decision [LIVE] — drop-in text

**The model:** Two separate slot concepts, never competing.
- **Arrival slot** (Morning/Afternoon/Evening/Late Evening/Night) = WHEN the
  order arrived. Drives the top slot tabs + history grouping. Unchanged by this
  work. Auto-assigned at import (see CORE resolveSlot; the richer Support 5-slot
  rule is locked-but-not-built, §7).
- **Dispatch slot** (date + window, e.g. "29 Jun · 10:30") = the DECISION of
  when to ship. NEW uniform control for all manual dispatch. Writes
  `dispatchTargetDate` + `dispatchWindowId`.

**Columns on the Support row (today board):**
`Status` (the decision pill) · `Dispatch Slot` (date+time, dispatch-only) ·
`Priority`. The old per-row arrival-slot dropdown was REMOVED from the row (the
tab already shows arrival; no manual re-slot — confirmed not a workflow).

**Status column:**
- Pending rows: a Status chooser → Dispatch / Hold / Cancel.
- Done rows: footprintType pill — green "Dispatch" / amber "Hold" / red
  "Cancelled" / grey "Done" (genuine uncategorized fallback only).

**Dispatch Slot column:**
- Dispatch (done) → "DD Mon · HH:MM" (e.g. "29 Jun · 10:30"), reading
  `dispatchTargetDate` + the joined `dispatchWindow.windowTime` (already in
  ORDER_INCLUDE).
- Hold / Cancel → "—". (Hold must show "—", NOT a greyed/half-active picker.)
- Pending choosing Dispatch → the DispatchSlotPicker (portal-rendered).

**The order ALWAYS stays on its ARRIVAL day/tab.** A 27-Jun order dispatched for
29 Jun still lives in 27 Jun's done group; "29 Jun · 10:30" is a label only. NO
cross-day movement on the today board. (History already handles multi-day
footprints separately — that logic was NOT changed.)

### Single-row dispatch flow (the "2-action" model)
1. Click **Dispatch** in the Status menu → green "Dispatch" intent badge shows
   IMMEDIATELY + the slot picker opens in the Dispatch Slot column.
2. The row STAYS IN PENDING (green badge, slot empty) until a slot is picked.
   Picking the slot is the COMMIT.
3. On pick: optimistic "DD Mon · HH:MM" + a small spinner render in the Dispatch
   Slot cell; the Status badge stays GREEN throughout the save (no "—" flip);
   then the row settles into done.
4. Choosing Hold / Cancel / Unset clears the green intent.
5. Click-away without picking: badge stays green, row stays pending; clicking
   Dispatch again reopens the picker (gen counter). No dead-end.
6. Refresh before committing: intent is client-only, resets to "—" (no data
   lost — nothing was committed).

**Mandatory slot:** every manual dispatch (single + bulk) requires a date+window.
No bare "dispatch now".

### Bulk bar (the "ghost row")
The sticky bottom bar mirrors a row: `[set status ▾]` + `[pick slot]` + Clear +
Submit. Both popovers open UPWARD (bottom bar).
- Status chooser: Dispatch · Hold only (NO bulk Cancel — cancel stays single-row
  with its reason dialog).
- Choose Dispatch → all selected rows PREVIEW green "Dispatch"; slot picker
  active; Submit DISABLED until a slot is picked.
- Choose Hold → all selected rows preview amber "Hold"; slot shows "—"; Submit
  ENABLED immediately.
- **Submit is the commit checkpoint** (UNLIKE single rows which fire on pick) —
  bulk = higher stakes = one deliberate confirm. Fires the existing
  onBulkDispatch (date+window) or onBulkHold for all selected.
- After Submit: selection + bar reset.

---

## The footprintType bug fix (important — root cause)

**Symptom:** dispatched + held orders showed grey "Done" on the TODAY board.
**Cause:** `footprintType="dispatch"` and `"hold"` were computed ONLY inside the
`else if (isHistoryView)` branch in `app/api/support/orders/route.ts`. On the
today board `isHistoryView=false`, so every non-cancel done row defaulted to
`"arrival"` → frontend grey "Done". (Cancel worked because its check sat OUTSIDE
the guard.)
**Fix:** added a today-board arm — when `!isHistoryView` (and not cancelled),
derive footprintType from `dispatchStatus` (`"dispatch"→dispatch`,
`"hold"→hold`, else `arrival`). History arm + cancel check untouched.
**Lesson:** footprintType is now computed on BOTH boards. The today arm is
simpler (no date-range maths); history keeps its date-range logic for multi-day
footprints.

---

## Key engineering decisions / landmines avoided

- **Dispatch intent is CLIENT-ONLY** (`dispatchIntentIds` Set), not a server
  stamp. Rationale: a server stamp would leave an orphaned
  `dispatchStatus="dispatch"` with no slot if the user walks away. Client-only
  means no DB half-state. The badge also reads `savingSlot` so it stays green
  through the save even after the intent is cleared.
- **isDone never reads `dispatchStatus="dispatch"`** — so a green-intent pending
  row provably STAYS in pending (only `workflowStage` closed/dispatched or
  `dispatchStatus="hold"` moves to done). This guard is what makes the "green but
  not committed" state safe.
- **No double-fire:** `handleSingleDispatch` synchronously removes the row from
  `selected`, clears `dispatchPickerTrigger` and `dispatchIntentIds` BEFORE the
  API call. `pendingDispatchCount` counts only still-pending rows. So a row can't
  be both immediately-dispatched and bulk-queued; Submit can't re-fire a closed
  row.
- **savingSlot above isDoneRow** in the Dispatch Slot cell branch order — the
  optimistic time+spinner wins during the save window (defensive; the row
  actually unmounts on success via synchronous `pendingOrders` recompute, but the
  ordering is structurally safe against future refactors).
- **Programmatic picker open:** `DispatchSlotPicker` gained a `forceOpenGen`
  number prop. Clicking Dispatch in the Status menu increments a per-row `gen` →
  the column's ONE picker opens (no second instance per row). gen handles
  re-clicks after dismissal.
- **No per-row vs bulk contradiction:** choosing a bulkStatus clears each
  selected row's per-row status localEdit, AND selected rows render the bulk
  status as a render-time preview (bulkStatus threaded into OrderRow; no fake
  localEdits). Deselect → row reverts to its own server status.
- **Grid preserved (NOT converted to a table):** the agent proposed a full
  CSS-Grid → `<table>` rewrite to satisfy UI §27. REJECTED as scope creep on a
  live board. Added one grid track instead. The grid→table §27 cleanup is a
  separate DEFERRED ROADMAP item.
- **Grey "Done" fallback left grey:** it fires for genuinely-uncategorized done
  rows (already-dispatched-on-arrival, ex-tint, other closed). Must NOT be
  painted green — that would mislabel them.

---

## §10 Key files index — add/update

| File | Role |
|---|---|
| `app/api/support/orders/[id]/dispatch/route.ts` | Manual dispatch → closed; now REQUIRES + persists dispatchTargetDate + dispatchWindowId |
| `app/api/support/bulk/route.ts` | Bulk dispatch (date+window) / hold for all selected |
| `app/api/support/orders/route.ts` | footprintType TODAY-arm added (reads dispatchStatus); doneCount cancelled arm |
| `components/support/dispatch-slot-picker.tsx` | `forceOpenGen` prop — programmatic open from Status menu |
| `components/support/support-orders-table.tsx` | Status/Dispatch-Slot columns, dispatch intent, savingSlot, bulk bar (status+slot+preview), elevation/polish/nav-alignment |
| `components/support/support-page-content.tsx` | onBulkDispatch/onBulkHold + dispatchWindows wired into table |

---

## Bulk-bar styling (final polish)

- Elevation: NO teal top line — hairline `1px rgba(17,24,39,0.06)` + layered
  shadow `0 -1px 1px rgba(17,24,39,0.04), 0 -8px 24px rgba(17,24,39,0.06)`
  (Option A / Linear-Stripe look).
- Empty "set status" + "pick slot" triggers: both grey `border-gray-200`
  (#e5e7eb) — set-status was gray-300, aligned to gray-200.
- Picked slot pill: green `bg-green-50 border-green-200 text-green-700`, format
  "DD Mon · HH:MM", with × clear.
- Nav alignment: bar `left-[72px]` (matches the content area's fixed marginLeft;
  nav expansion is OVERLAY-only so 72px is safe in both states). Bar inner
  `minHeight: 56px` + 1px top border = 57px, matching the nav bottom profile row.
  `pr-[22px]` right clearance.
- "STATUS" / "DISPATCH SLOT" labels removed (triggers are self-describing).

---

## On the horizon — Task 2 (NOT built)

**Auto-assign dispatch slot at enrichment ("the brain")** [NEXT]:
Currently, auto-dispatched OBDs (enrichment sets `dispatchStatus="dispatch"`,
`workflowStage="closed"`) get NO `dispatchTargetDate`/`dispatchWindowId` — they
show on their arrival day only, inconsistent with manual dispatches which now
carry a slot. Task 2 will assign a date+window automatically based on a
condition Smart Flow will define. This is interim-safe (no break, just
inconsistent until built). Smart Flow noted Task 2 is "the brain" with multiple
conditions and may require one or more prep changes FIRST before the auto-assign
logic is wired.

**Deferred / carried over:**
- CSS-Grid → `<table>` §27 cleanup for the Support table — own session.
- Support 5-slot arrival rule (Late Evening, ≤ cutoffs, carry-over by punch
  time, ⚠ dual-date card) — locked 06-24, NOT built; full draft on depot PC at
  `docs/prompts/drafts/code-update-2026-06-24-support-board-slot-rule.md`.
- Reason column for cancel — still parked.
- Bulk Cancel — intentionally out (single-row only for now).
- `$transaction` landmines in 2 Support PATCH routes — still pending dedicated
  session.

---

## Commit pushed to main (2026-06-27)

6 files: `bulk/route.ts`, `orders/route.ts`, `orders/[id]/dispatch/route.ts`,
`dispatch-slot-picker.tsx`, `support-orders-table.tsx`,
`support-page-content.tsx`. tsc --noEmit clean. (NOT committed: an unrelated
`tint/operator/split/done/route.ts` change appeared in git status — left out of
this commit, needs separate review.)
