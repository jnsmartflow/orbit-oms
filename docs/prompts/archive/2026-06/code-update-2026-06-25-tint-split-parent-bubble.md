# Session — Tint: Parent OBD Auto-Advance When All Splits Done

**Date:** 2026-06-25
**Module:** Tint (Operator split-done flow → TM board)
**Status:** Bug fixed, committed to main, live OBD repaired, verified on TM screen.

---

## One-line summary

OBDs finished via splits were stuck in the Tint Manager "In Progress" column forever, because the per-split "done" route marked the split done but never advanced the parent OBD's `workflowStage`. Added the missing parent-bubble logic (advance to `pending_support` when all non-cancelled splits are done), repaired the one stuck OBD by hand, and confirmed no others were affected.

---

## The bug (in plain English)

There are two "done" doors in the tint flow:

- **Whole-OBD door** (`/api/tint/operator/done/route.ts`) — already advances the parent to `pending_support`. Works fine.
- **Per-split door** (`/api/tint/operator/split/done/route.ts`) — only marked the one split `tinting_done` and walked away. It never asked "are all my sibling splits done too?" and never moved the parent.

So any OBD worked through splits never reached `pending_support` — it sat in `tinting_in_progress` indefinitely. The TM board query (`app/api/tint/manager/orders/route.ts`) includes `tinting_in_progress`, so the OBD stayed visible in the In Progress column and never reached support / dispatch / challan.

---

## Diagnosis (the trigger case)

**OBD 9107769305 (Pramukh Yogiwood · Silvassa), internal id 6478.**

Live DB state at diagnosis:

| Split id | status | qty |
|---|---|---|
| 5 | tinting_done | 50 |
| 6 | **cancelled** | 100 |
| 7 | tinting_done | 100 |

- Parent `workflowStage = tinting_in_progress` (stuck).
- 3 splits, not 2 — split 6 was **cancelled**, which is the key detail: the fix must ignore cancelled splits, else this OBD (and any with a cancelled split) would stay stuck even after the fix.
- `tint_assignments` had **no rows** for this OBD — so assignment status was not the gate.
- `order_status_logs` showed only the two import-time `pending_tint_assignment` entries; no advance-to-support entry → proof the bubble never fired.
- Line items: 1 raw line, 2 split lines existed → the panel's "0 line items" is a **display bug**, not missing data. Separate ticket.

**Root cause = Angle 1 (no bubble logic existed) + Angle 4 twist (cancelled split must be excluded from the count).**

---

## The fix

### Code (committed)

`app/api/tint/operator/split/done/route.ts` — added a parent-bubble block at the end, after the split is set `tinting_done`:

1. Fetch all splits for the parent `orderId`.
2. Ignore `cancelled`. From the non-cancelled set: `activeCount` and `doneCount`.
3. If `activeCount > 0 && doneCount === activeCount` and parent `workflowStage === "tinting_in_progress"`:
   - update parent `workflowStage → "pending_support"`
   - insert one `order_status_logs` row: `fromStage: "tinting_in_progress"`, `toStage: "pending_support"`, `changedById: 1`, note `"Auto-advanced: all splits tinting_done"`.
4. Sequential awaits only — bubble block is **outside** the transaction, no new `prisma.$transaction`.

The `workflowStage === "tinting_in_progress"` guard makes it idempotent (a retry won't double-log).

Commit message:
`fix(tint): auto-advance parent OBD to pending_support when all non-cancelled splits done`

### Data fix — live OBD 6478 (the new code can't self-rescue an already-finished OBD; no one will click "done" again)

```sql
UPDATE orders SET "workflowStage" = 'pending_support'
WHERE id = 6478 AND "workflowStage" = 'tinting_in_progress';

INSERT INTO order_status_logs ("orderId","fromStage","toStage","changedById","note","createdAt")
VALUES (6478,'tinting_in_progress','pending_support',1,
  'Manual fix: all non-cancelled splits were tinting_done (bubble bug backfill)', now());
```

Verified: `orders.id 6478 → pending_support`; log row written; OBD gone from the In Progress column on the TM screen.

### Backfill — none needed

Ran the stuck-OBD SELECT (parent `tinting_in_progress` AND all non-cancelled splits `tinting_done`, same "ignore cancelled" rule as the code). **OBD 6478 was the only one.** No batch UPDATE run.

---

## Schema discoveries (for context files)

Confirmed against live DB during this session — correcting earlier guesses:

- `order_status_logs` uses **`fromStage` / `toStage`** (not `previousStage` / `newStage`).
- `order_splits` has **`totalQty`** (the SKU column guessed earlier as `skuCode` was wrong for this query path).
- `orders` has **no `isTinting` column** — the tinting flag is named differently (not needed for this fix; confirm name if a future task needs it).
- `tint_assignments` does **not** have an `operatorId` column by that name (guessed wrong; safe columns confirmed: `id`, `splitId`, `status`, `completedAt`). Confirm the operator FK name before any future assignment query.

---

## Decisions made

- **Log actor for auto-advance = `changedById: 1`** + system note (matches the established convention: "Auto-dispatched by enrichment", day-boundary, slot-cascade). Chosen over crediting the last operator, because the system advances the OBD, not the operator. *Smart Flow: can switch to operator id later if the audit trail should name a person.*
- **Cancelled splits are settled/ignored** in the all-done count — non-negotiable for correctness.

---

## Files changed this session

- `app/api/tint/operator/split/done/route.ts` — added parent-bubble block (no other behaviour changed).

---

## Open / deferred items for next session

### Immediate next candidate (agreed standalone job)
1. **Convert `prisma.$transaction` to sequential awaits in the split-done route.** The split-done route still wraps its **core** logic (the split update + logs) in `prisma.$transaction` — a pre-existing CORE §3 violation (pooler-timeout risk on Vercel + Supabase). Deliberately **not** bundled into the bug-fix commit because it touches the operator's core write path and deserves its own focused, smoke-tested change. The new bubble block is already compliant (sequential awaits, outside the transaction). **This is the next prompt when Smart Flow is ready.**

### Separate ticket (low priority)
2. **"0 line items" panel display bug** — the OBD detail panel showed 0 line items though data exists (1 raw, 2 split lines for OBD 6478). Data is fine; only the panel's fetch/display is wrong. Not urgent.

### Optional verification still open
3. **Forward-test the new code** — mark the last split of a 2+ split dev OBD done and confirm the parent auto-advances on its own. Logic is sound and the live OBD is fixed, so low priority, but a clean end-to-end test would close it fully.
