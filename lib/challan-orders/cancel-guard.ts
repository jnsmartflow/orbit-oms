// lib/challan-orders/cancel-guard.ts
//
// THE RULES EVERY CANCEL / REMOVE PATH APPLIES TO A CHALLAN (ORB) ORDER, AND TO A SAP
// BILL LINKED TO ONE (Challan orders slices 5–6, 2026-10-07 — owner S5-3, S5-4, S6-3,
// S6-4, S6-7, web-update-2026-10-06-challan-orders.md §4d / §4e). One owner; every path
// imports it.
//
//   S5-4  ONLY ADMIN cancels or removes an ORB order. "Admin" is the app's own check —
//         lib/rbac.ts isSuperuser(session): the admin role OR the superuser flag. The
//         route resolves it and passes `actorIsAdmin` down; every core DEFAULTS IT TO
//         FALSE, so a caller that forgets to pass it refuses an ORB order (fail closed)
//         and changes nothing for any other bill. Admin still obeys each path's own
//         stage rules.
//   S6-7  ONLY ADMIN cancels a SAP bill linked to a challan ('challan_linked') — the
//         same check, its own words (linkedObdCancelRefusal). The only door is the
//         Challan orders screen (POST /api/challan-orders/linked-obds/[orderId]/cancel);
//         the bill is on no other screen.
//   S5-3 + S6-4  When an ORB order IS cancelled / removed (releaseChallanOnCancel):
//         its goods never left (an ORB order cannot be cancelled once on a trip or
//         dispatched), so each SAP bill linked to it goes back to Floor's UNDECIDED
//         list (pending_support, status null — a person releases or holds it) with
//         challanOrderId CLEARED (slice 7), and every live link on it — 'waiting' AND
//         'linked' — becomes 'unlinked'.
//   S6-3  When a linked OBD is cancelled, its link goes back to 'waiting' so a
//         re-issued OBD on that SO is caught again (lib/challan-orders/linked-cancel.ts).
//
// Paths that call these (code-update-2026-10-07-challan-slice5.md §3 + slice 6):
//   lib/floor/bill-actions.ts applyBillAction("cancel")  ← /api/floor/actions, /api/tint/manager/cancel
//   lib/floor/raise-ci.ts raiseFullBillCi                ← /api/floor/ci, /api/tint/manager/ci
//   lib/billing/pick-delete.ts pickDelete                ← /api/billing/pick-delete/delete, /api/tint/manager/pick-delete/delete
//   app/api/picking/cancel/route.ts                      (inline)
//   app/api/tint/manager/orders/[id]/remove/route.ts     (inline)
//   lib/challan-orders/linked-cancel.ts                  ← /api/challan-orders/linked-obds/[orderId]/cancel

import { prisma } from "@/lib/prisma";
import { CHALLAN_LINKED } from "@/lib/workflow-stages";

/** The refusal every path shows a non-admin on an ORB order. */
export const CHALLAN_ADMIN_ONLY = "Only admin can cancel a challan order.";
/** The refusal for a SAP bill linked to a challan (S6-7). */
export const CHALLAN_LINKED_ADMIN_ONLY = "Only admin can cancel a challan-linked bill.";

/** null = allowed; else the refusal text. Pure. */
export function challanCancelRefusal(isChallanOrder: boolean, actorIsAdmin: boolean): string | null {
  return isChallanOrder && !actorIsAdmin ? CHALLAN_ADMIN_ONLY : null;
}

/** S6-7 — null = allowed; else the refusal text. Pure. */
export function linkedObdCancelRefusal(actorIsAdmin: boolean): string | null {
  return actorIsAdmin ? null : CHALLAN_LINKED_ADMIN_ONLY;
}

/**
 * S5-3 + S6-4 — after an ORB order's cancel / remove write.
 *   1. each SAP bill linked to it (challanOrderId = the ORB, still 'challan_linked')
 *      → pending_support, dispatchStatus null, challanOrderId null — ONE write,
 *      compare-and-swap on the stage — and one log. The pointer is CLEARED (slice 7,
 *      2026-10-08): from here the bill is an ordinary bill, not one billed against a
 *      surviving challan, and a kept pointer listed it under the cancelled ORB in
 *      History once it was later cancelled (board.ts challanLinkedOrders reads the
 *      'cancelled' stage). History stays in the log below (it names the ORB) and in
 *      the 'unlinked' link row (SO + orbOrderId). ⚠ Contrast S6-3
 *      (linked-cancel.ts): a linked OBD cancelled as such KEEPS its pointer — it WAS
 *      billed against the challan and is shown struck through under it.
 *   2. every live link on it ('waiting' and 'linked') → 'unlinked' — linkedOrderId and
 *      obdLinkedAt cleared, as chk_challan_order_so_links_shape requires.
 * A bill with no ORB link is never touched. Returns the counts.
 */
export async function releaseChallanOnCancel(
  orbOrderId: number,
  actorId: number,
): Promise<{ billsReturned: number; linksUnlinked: number }> {
  const orb = await prisma.orders.findUnique({ where: { id: orbOrderId }, select: { obdNumber: true } });
  const linked = await prisma.orders.findMany({
    where: { challanOrderId: orbOrderId, workflowStage: CHALLAN_LINKED, isRemoved: false },
    select: { id: true },
  });
  let billsReturned = 0;
  for (const b of linked) {
    const moved = await prisma.orders.updateMany({
      where: { id: b.id, workflowStage: CHALLAN_LINKED },
      data: { workflowStage: "pending_support", dispatchStatus: null, challanOrderId: null },
    });
    if (moved.count === 0) continue;
    billsReturned += 1;
    await prisma.order_status_logs.create({
      data: {
        orderId: b.id,
        fromStage: CHALLAN_LINKED,
        toStage: "pending_support",
        changedById: actorId,
        note: `Challan ${orb?.obdNumber ?? `#${orbOrderId}`} cancelled — bill returned to the floor`,
      },
    });
  }
  const res = await prisma.challan_order_so_links.updateMany({
    where: { orbOrderId, status: { in: ["waiting", "linked"] } },
    data: { status: "unlinked", linkedOrderId: null, obdLinkedAt: null, unlinkedById: actorId, unlinkedAt: new Date() },
  });
  return { billsReturned, linksUnlinked: res.count };
}
