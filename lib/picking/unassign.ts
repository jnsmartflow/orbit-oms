// lib/picking/unassign.ts
//
// THE unassign write — take a bill off its picker and put it back in the
// picking queue (`pending_picking`, waiting for a picker).
//
// 🔴 ONE RULE, TWO CALLERS (2026-10-01). Extracted from
// app/api/picking/unassign/route.ts so Floor's Release of a bill HELD at
// `pick_assigned` (lib/floor/release.ts) removes the picker by the SAME writes
// in the SAME order, never a second spelling of them:
//   - app/api/picking/unassign/route.ts  — the supervisor's / Floor panel's Unassign
//   - lib/floor/release.ts               — Release on a held pick_assigned bill
// and, through takeBillOffPicker (same two writes, same order, the caller's own
// stage write), lib/tint/manual-pull.ts — a bill pulled into tinting from a
// picker's hands (2026-10-24).
// Other paths that delete an assignment (Floor cancel, Floor CI, Picking
// cancel, pick-delete) set `cancelled`, not `pending_picking`, and are not
// callers today.
//
// ⚠ THE ORDER NEVER REVERSES. (1) the stage write, (2) the assignment delete.
// If (2) fails, the bill is already back in the queue — visible, mutable, with a
// stale pick_assignments row left over: a fixable leftover. Reversed, a failed
// stage write would strand the bill at `pick_assigned` with its assignment
// record gone — locked, with no trace of who had it.
//
// ⚠ THE DELETE IS WHAT KEEPS A BILL ASSIGNABLE. `pick_assignments.orderId` is
// @unique and app/api/picking/assign/route.ts refuses "Already assigned." when a
// row survives — at `pending_picking` that would be forever, since only this
// write deletes a row for a live bill (see app/api/floor/actions/route.ts, the
// cancel branch's ORPHAN FIX note).
//
// ⚠ EXACTLY ONE `orders.update`. A caller that needs more columns written in the
// same move (Release writes the slot and the status) passes them in `alsoWrite`
// — never a second update: the live-sync markers key on MAX(orders.updatedAt).
//
// NOT HERE, ON PURPOSE: the stage guard (each caller checks `pick_assigned`
// itself, with its own refusal shape) and the `order_status_logs` row (each
// caller says in its own words what happened). No push — unassign has never
// sent one (CLAUDE_NOTIFICATIONS §2).
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";

export async function returnAssignedBillToQueue(
  orderId: number,
  /** Extra columns for the SAME orders.update. The stage is always written last
   *  and cannot be overridden from here. */
  alsoWrite: Prisma.ordersUncheckedUpdateInput = {},
  /** For the console warning only — who called. */
  source = "picking/unassign",
): Promise<{ assignmentRowsDeleted: number }> {
  return takeBillOffPicker(
    orderId,
    // (1) FIRST write — revert the stage (plus whatever the caller adds).
    async () => {
      await prisma.orders.update({
        where: { id: orderId },
        data: { ...alsoWrite, workflowStage: SUPPORT_DONE_OUTPUT },
      });
    },
    source,
  );
}

/**
 * The header's ORDER, for a caller whose stage write is not "back to the
 * queue" (2026-10-24, the manual tint pull — lib/tint/manual-pull.ts, which
 * sends the bill to the tint room and may write through setRowsTrip).
 *
 * (1) `write` — the caller's ONE orders.update, run first and awaited.
 * (2) the pick_assignments delete. deleteMany (not delete) so a missing row is
 * NOT an error — log and continue rather than throw.
 *
 * returnAssignedBillToQueue above is this with the queue write; its behaviour
 * did not change when it was moved onto it.
 */
export async function takeBillOffPicker(
  orderId: number,
  write: () => Promise<void>,
  /** For the console warning only — who called. */
  source: string,
): Promise<{ assignmentRowsDeleted: number }> {
  await write();

  const deleted = await prisma.pick_assignments.deleteMany({ where: { orderId } });
  if (deleted.count === 0) {
    console.warn(`[${source}] No pick_assignments row found for order ${orderId} during unassign.`);
  }
  return { assignmentRowsDeleted: deleted.count };
}
