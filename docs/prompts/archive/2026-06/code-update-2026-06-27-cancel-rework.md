# code-update-2026-06-27-cancel-rework.md

# Cancel rework — red done-group footprint + undo-cancel
# Target canonical file: CLAUDE_SUPPORT.md
# Status: BUILT, smoke-tested clean, pushed to main 2026-06-27
# Schema: v27.7 (NO schema change — zero new columns)

---

## Where this goes in CLAUDE_SUPPORT.md

- New section **§4.12 Cancel lifecycle [LIVE]** — slot it after §4.11 (History).
- Add the new undo-cancel route to the **§10 Key files index** table.
- Update **§7 Open items**: the cancel gaps listed under discovery are now closed
  (no footprint, no audit visibility, no restore path → all fixed). Bulk cancel
  and structured reason column remain DEFERRED.

---

## §4.12 Cancel lifecycle [LIVE] — drop-in text

**Design (LOCKED 2026-06-27):** Cancel is the **third done-group colour** beside
green Dispatch and amber Hold. A cancelled order is a *decision taken*, so it
behaves like the other done actions — but it is **terminal** (never flows
downstream).

**Routes/files:**
- `app/api/support/orders/[id]/cancel/route.ts` — existing single-cancel (unchanged this rework)
- `app/api/support/orders/[id]/undo-cancel/route.ts` — **NEW**, mirrors undo-dispatch
- `app/api/support/orders/route.ts` — list + history query arms + footprintType + isDone
- `app/api/support/slots/route.ts` — doneCount arms (today + history)
- `components/support/support-orders-table.tsx` — red pill + undo-cancel button

**Rules:**

1. **Footprint = arrival day.** A cancelled order shows in the done group on its
   `obdEmailDate` (arrival day). Cancel has no target date — one day, one red pill.

2. **Priority is now `cancel > dispatch > hold > arrival`.** `footprintType` gains
   a `"cancel"` arm at the TOP. A held-then-cancelled order therefore shows ONCE as
   red Cancelled on its arrival day — it does NOT show stale amber Hold and does NOT
   vanish (this was the pre-rework gap). `footprintType="cancel"` is set in BOTH
   today and history views (not history-only) so the frontend reads ONE signal for
   the red pill everywhere.

3. **Counts toward % done.** Cancelled joins `doneCount` (today + history) because
   "% done" = a decision was taken, not "successfully dispatched". OBD total is
   unchanged by a cancel. `pendingCount` / `tintingCount` / `dispatchedCount` are
   untouched — cancel clears `dispatchStatus` to null and sits at
   `workflowStage="cancelled"`, so it cannot enter any of those buckets.

4. **`isDone` widened** to include `workflowStage="cancelled"` — cancelled rows land
   in the done group, never the active/pending list.

5. **Undo-cancel** (`app/api/support/orders/[id]/undo-cancel/route.ts`):
   - Guard: only if `workflowStage === "cancelled"` (else 409) — mirrors
     undo-dispatch's `=== "closed"` guard.
   - Resets: each `status="cancelled"` split → `status="tinting_done"`,
     `dispatchStatus=null` + split log; order → `workflowStage="pending_support"`,
     `dispatchStatus=null` + order log (`cancelled → pending_support`).
   - Available on today AND history rows.
   - Sequential awaits, no `$transaction`, `force-dynamic` present.

6. **Split-restore value = `"tinting_done"`.** That is the only status a tint split
   carries when its parent reaches `pending_support`. **Non-tint orders have ZERO
   splits** (split creation is gated to `tint/manager/splits/create` only), so the
   restore loop is a no-op for them. No edge case.

7. **Red pill styling** matches the P1 priority badge: pill `bg-red-50
   border-red-200 text-red-600`, dot `bg-red-500`, label `"Cancelled"`. Reads
   `footprintType === "cancel"` only — NOT `currentDs` (cancel clears dispatchStatus,
   so currentDs is empty for cancelled rows).

8. **Button isolation.** The undo-dispatch button condition gained
   `&& order.footprintType !== "cancel"` — without it a cancelled row (dispatchStatus
   null, so `!== "hold"` is true) would render the undo-DISPATCH button and fire a 409.
   The undo-cancel button renders only on `footprintType === "cancel"` rows.

---

## §10 Key files index — add this row

| File | Role |
|---|---|
| `app/api/support/orders/[id]/undo-cancel/route.ts` | Undo-cancel: guard on `cancelled`, resets to `pending_support` + un-cancels splits |

---

## §7 Open items — updates

**Now CLOSED by this rework** (remove from gap list / mark done):
- Cancelled orders no longer vanish — visible as red footprint on arrival day.
- Hold-then-cancel no longer leaves a silent trace — shows red on arrival day.
- Restore path now exists (undo-cancel route + button).
- Cancel auditable on the history board for its arrival day.

**Still DEFERRED:**
- **Structured reason column** [DEFERRED] — the 6 dialog reasons are still stored
  only in the log note string, not a queryable column / not mapped to the
  `removalReason` enum. "Show me all credit-hold cancels" is still a raw DB query.
  Reason column was explicitly parked this session.
- **Bulk cancel** [DEFERRED] — `bulk/route.ts` still accepts `dispatch | hold` only.
  Cancel remains single-order with mandatory confirm dialog.
- **`heldAt` not cleared on cancel** [DEFERRED, cosmetic] — stale column on a
  held-then-cancelled order. No bug (board anchors cancel to arrival day via
  obdEmailDate, not heldAt), but a future restore-to-hold path would need to handle it.

---

## Commit pushed to main (2026-06-27)

Files: `orders/route.ts`, `slots/route.ts`, `support-orders-table.tsx`,
new `orders/[id]/undo-cancel/route.ts`. `support-page-content.tsx` NOT touched
(undo-cancel handler lives in the table, same pattern as undo-dispatch).

tsc --noEmit clean. Smoke-tested: red pill renders, % done 86→91 on cancel +
OBD total held at 22, undo returns to pending, held-then-cancel shows red once,
history red pill + undo work, no stray undo-dispatch button on red rows.
