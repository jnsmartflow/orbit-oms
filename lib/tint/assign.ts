// lib/tint/assign.ts
//
// THE operator assign — give a tint bill to an operator. Extracted 2026-10-24
// from app/api/tint/manager/assign/route.ts, UNCHANGED IN BEHAVIOUR, so the
// manual tint pull (lib/tint/manual-pull.ts — "+ Add to Tint" with an operator
// chosen) assigns by the SAME checks and the SAME writes, never a second
// spelling of them.
//
//   - app/api/tint/manager/assign/route.ts — the Tint Manager's Assign
//   - lib/tint/manual-pull.ts              — a pull that names an operator
//
// The pieces are separate functions, not one "assign" call, because the two
// callers wrap them differently and the route's per-step 500 messages must not
// change: the route still owns its try/catch around every write, its stage
// write and its order_status_logs row; the pull folds the stage into its own
// ONE orders.update and writes its own ONE order_status_logs row.
//
// The route's order, which every caller keeps:
//   1. planTintAssign            — READS ONLY: the bill rules, the operator,
//                                  an existing "assigned" row (re-assign)
//   2. writeTintAssignmentRow    — tint_assignments update-or-create
//   3. nextTintSequenceOrder     — read the operator's queue tail (AFTER 2, as
//                                  the route always did — on a re-assign the
//                                  bill's own row is part of the tail)
//      … the caller's orders.update (stage tint_assigned + sequenceOrder)
//   4. writeTintAssignLog        — tint_logs (INSERT-ONLY)
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { TINT_ASSIGNMENT_ACTIVE_STATUSES } from "@/lib/tint/assignment-status";

/** What planTintAssign needs to know about the bill. */
export interface TintAssignOrder {
  id: number;
  orderType: string;
  workflowStage: string;
  obdNumber: string;
  customerMissing: boolean;
}

export type TintAssignPlan =
  | {
      ok: true;
      operatorName: string;
      /** The bill's live "assigned" row — set means this is a RE-assign. */
      existingAssignmentId: number | null;
    }
  | { ok: false; status: 400 | 404; error: string };

/** The customer-missing refusal, word for word — the pull quotes it too. */
export const TINT_ASSIGN_CUSTOMER_MISSING =
  "Customer master data is missing for this order. Resolve in the Missing Customers sheet before assigning.";

// Recognised business-rule errors map to 400 instead of 500.
class AssignValidationError extends Error {}
const validationError = (msg: string): never => { throw new AssignValidationError(msg); };

/**
 * May this bill go to `assignedToId`? READS ONLY — nothing is written, so a
 * caller can plan before its first write. A database failure inside is
 * rethrown, exactly as the route always let it escape (an unhandled 500).
 */
export async function planTintAssign(order: TintAssignOrder, assignedToId: number): Promise<TintAssignPlan> {
  const orderId = order.id;
  try {
    if (order.orderType !== "tint") validationError("Order is not a tint order");

    // Phase 4 (step 13d): block assignment until customer master data exists.
    // Defence-in-depth — frontend intercepts the click and chains through
    // CustomerMissingSheet, but this guard refuses direct API calls too.
    if (order.customerMissing) {
      validationError(TINT_ASSIGN_CUSTOMER_MISSING);
    }

    // ── Stage guard: assign/re-assign only while the job is still WAITING ─────
    // Same shape as the customer-missing backstop above — a 400 with a message
    // the frontend can surface verbatim.
    //
    // WHY THIS IS A HARD REJECT, not a warning. The row write upserts on
    // `where: { orderId, status: "assigned" }`. A job that is being tinted or is
    // paused has its row at `tinting_in_progress` / `paused`, so that lookup
    // MISSES and the branch falls through to `create` — minting a SECOND
    // tint_assignments row for the same OBD while `workflowStage` is reset to
    // `tint_assigned`. The original row is then orphaned, taking `startedAt`,
    // `accumulatedMinutes`, `pauseCount`, `lastPausedAt` and `currentProgress`
    // with it: the elapsed timer restarts from zero, the 3-pause cap resets, and
    // the per-SKU progress snapshot the operator built is unreachable. None of
    // that is recoverable from the UI.
    //
    // It also enforces a rule the module already relies on but never asserted:
    // a paused job belongs to its operator until resume or done
    // (CLAUDE_TINT.md §5). Until now that was UI-only — the Kanban simply never
    // rendered a Re-assign item outside `tint_assigned` — so a direct API call,
    // or any new screen with its own selection model, could walk straight past
    // it. The new Tint Manager board reassigns waiting work only.
    //
    // `tinting_in_progress` was accepted by the stage ladder below before this
    // guard landed (2026-09-05); nothing in the live UI ever reached it.
    if (
      order.workflowStage !== "pending_tint_assignment" &&
      order.workflowStage !== "tint_assigned"
    ) {
      validationError(
        `This job can no longer be re-assigned — it is already at "${order.workflowStage}". Only a job still waiting to be tinted can be moved to another operator.`,
      );
    }

    if (order.workflowStage === "pending_tint_assignment") {
      // Case 1 — fresh order, no splits ever created → always allow
      // Case 2 — all splits were cancelled, stage reset to pending → always allow
    } else if (order.workflowStage === "tint_assigned") {
      // `|| order.workflowStage === "tinting_in_progress"` removed 2026-09-05 —
      // the guard above now rejects that stage outright, so keeping it here
      // would describe a branch that can never be entered.
      const activeSplits = await prisma.order_splits.findMany({
        where:   { orderId, status: { not: "cancelled" } },
        include: { lineItems: { where: { lineStatus: "active" }, select: { rawLineItemId: true, assignedQty: true } } },
      });

      if (activeSplits.length === 0) {
        // Case 2 (old stage not yet reset) — all splits cancelled → allow
      } else {
        // Case 3 / Case 4 — has active splits, compute remaining qty
        const rawLines = await prisma.import_raw_line_items.findMany({
          where:  { obdNumber: order.obdNumber, lineStatus: "active" },
          select: { id: true, unitQty: true },
        });
        const assignedQtyByLine = new Map<number, number>();
        for (const split of activeSplits) {
          for (const item of split.lineItems) {
            assignedQtyByLine.set(
              item.rawLineItemId,
              (assignedQtyByLine.get(item.rawLineItemId) ?? 0) + item.assignedQty,
            );
          }
        }
        const remainingQty = rawLines.reduce((sum, line) => {
          const assigned = assignedQtyByLine.get(line.id) ?? 0;
          return sum + Math.max(0, line.unitQty - assigned);
        }, 0);
        if (remainingQty <= 0) {
          // Case 4 — fully assigned through splits, nothing left → block
          validationError("Order has no remaining unassigned quantity");
        }
        // Case 3 — remainingQty > 0 → allow
      }
    } else {
      // Any other stage (pending_support, dispatched, etc.) → block
      validationError("Order is not in a state that allows assignment");
    }
  } catch (err) {
    if (err instanceof AssignValidationError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }

  // Load operator name for log note
  const operator = await prisma.users.findUnique({
    where:  { id: assignedToId },
    select: { name: true },
  });
  if (!operator) {
    return { ok: false, status: 404, error: "Operator not found" };
  }

  // An existing live row makes this a re-assign (allowed from the Assigned column).
  const existing = await prisma.tint_assignments.findFirst({
    where: { orderId, status: "assigned" },
  });

  return { ok: true, operatorName: operator.name, existingAssignmentId: existing?.id ?? null };
}

/**
 * The tint_assignments row: the existing "assigned" row re-pointed, or a new
 * one. Returns its id; throws on a failed write (the caller reports it).
 */
export async function writeTintAssignmentRow(opts: {
  orderId: number;
  assignedToId: number;
  managerId: number;
  existingAssignmentId: number | null;
}): Promise<number> {
  const { orderId, assignedToId, managerId, existingAssignmentId } = opts;
  if (existingAssignmentId !== null) {
    const updated = await prisma.tint_assignments.update({
      where: { id: existingAssignmentId },
      data: {
        assignedToId,
        assignedById: managerId,
        status:       "assigned",
        updatedAt:    new Date(),
      },
      select: { id: true },
    });
    return updated.id;
  }
  const created = await prisma.tint_assignments.create({
    data: {
      orderId,
      assignedToId,
      assignedById: managerId,
      status:       "assigned",
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * The sequenceOrder that puts a bill at the END of this operator's queue.
 *
 * Tail of THIS operator's queue. The predicate must describe orders he
 * actually holds — see the note on the third instance of the dead
 * `status: { not: "done" }` filter (lib/tint/assignment-status.ts). Left
 * unfixed, an OBD he had once been assigned and then SKIPPED still matched
 * via its dead `skipped` row, inflating the max and pushing every new job
 * to an inflated sequenceOrder. Harmless to ordering (the values only need
 * to be increasing) but wrong, and it shares its shape with the two real
 * bugs fixed in reorder/route.ts, so it is corrected here rather than left
 * as the last copy of a predicate that matches everything.
 */
export async function nextTintSequenceOrder(assignedToId: number): Promise<number> {
  const maxSeq = await prisma.orders.aggregate({
    where: {
      workflowStage: "tint_assigned",
      isRemoved:     false,
      tintAssignments: {
        some: {
          assignedToId,
          status: { in: [...TINT_ASSIGNMENT_ACTIVE_STATUSES] },
        },
      },
    },
    _max: { sequenceOrder: true },
  });
  return (maxSeq._max.sequenceOrder ?? 0) + 1;
}

/** The tint_logs note: "Assigned to {op}" / "Re-assigned to {op}", plus " — {note}". */
export function tintAssignLogNote(isReassign: boolean, operatorName: string, note?: string): string {
  return isReassign
    ? `Re-assigned to ${operatorName}` + (note ? ` — ${note}` : "")
    : `Assigned to ${operatorName}` + (note ? ` — ${note}` : "");
}

/** INSERT tint_logs (INSERT-ONLY — never skip). Throws on a failed write. */
export async function writeTintAssignLog(opts: {
  orderId: number;
  managerId: number;
  isReassign: boolean;
  note: string;
}): Promise<void> {
  await prisma.tint_logs.create({
    data: {
      orderId:       opts.orderId,
      action:        opts.isReassign ? "reassigned" : "assigned",
      performedById: opts.managerId,
      note:          opts.note,
    },
  });
}
