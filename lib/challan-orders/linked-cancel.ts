// lib/challan-orders/linked-cancel.ts
//
// CANCEL A SAP BILL LINKED TO A CHALLAN (Challan orders slice 6, 2026-10-07 — owner
// S6-3, S6-7). ADMIN ONLY (cancel-guard.ts linkedObdCancelRefusal — the slice-5 guard's
// owner). Caller: POST /api/challan-orders/linked-obds/[orderId]/cancel, from the
// Challan orders screen — a linked bill is on no other screen.
//
// Writes (sequential awaits, never $transaction):
//   1. orders.updateMany CAS challan_linked → cancelled, dispatchStatus null.
//      challanOrderId is KEPT (history: which challan it was billed against).
//   2. one order_status_logs row with the desk cancel note.
//   3. the link (S6-3): if this bill was the link's linkedOrderId —
//        another live bill on the same SO + ORB → the link re-points to the oldest;
//        none → the link goes back to 'waiting', so a re-issued OBD is caught again.
// The future line match (slice 7) counts only challan_linked bills, so a cancelled
// one drops out of it with no extra write.

import { prisma } from "@/lib/prisma";
import { CHALLAN_LINKED } from "@/lib/workflow-stages";
import { buildDeskCancelNote, type DeskCancelReason } from "@/lib/floor/desk-cancel-reasons";
import { linkedObdCancelRefusal } from "./cancel-guard";

export type LinkedCancelResult = { ok: true; linkBackToWaiting: boolean } | { ok: false; error: string; status: number };

export async function cancelLinkedObd(args: {
  orderId: number;
  actorId: number;
  actorIsAdmin: boolean;
  reason: DeskCancelReason;
  remark: string | null;
}): Promise<LinkedCancelResult> {
  const refusal = linkedObdCancelRefusal(args.actorIsAdmin);
  if (refusal !== null) return { ok: false, error: refusal, status: 403 };

  const o = await prisma.orders.findUnique({
    where: { id: args.orderId },
    select: { id: true, obdNumber: true, soNumber: true, workflowStage: true, isRemoved: true, challanOrderId: true },
  });
  if (!o || o.isRemoved) return { ok: false, error: "Bill not found.", status: 404 };
  if (o.workflowStage !== CHALLAN_LINKED) {
    return { ok: false, error: `${o.obdNumber} is not linked to a challan (it is ${o.workflowStage}).`, status: 409 };
  }

  const moved = await prisma.orders.updateMany({
    where: { id: o.id, workflowStage: CHALLAN_LINKED },
    data: { workflowStage: "cancelled", dispatchStatus: null },
  });
  if (moved.count === 0) return { ok: false, error: "This bill changed — refresh.", status: 409 };

  await prisma.order_status_logs.create({
    data: {
      orderId: o.id,
      fromStage: CHALLAN_LINKED,
      toStage: "cancelled",
      changedById: args.actorId,
      note: buildDeskCancelNote(args.reason, args.remark),
    },
  });

  // 3. The link — only the row this bill was the linked OBD of.
  let linkBackToWaiting = false;
  if (o.soNumber && o.challanOrderId !== null) {
    const link = await prisma.challan_order_so_links.findFirst({
      where: { soNumber: o.soNumber, orbOrderId: o.challanOrderId, status: "linked", linkedOrderId: o.id },
      select: { id: true },
    });
    if (link) {
      const other = await prisma.orders.findFirst({
        where: { soNumber: o.soNumber, challanOrderId: o.challanOrderId, workflowStage: CHALLAN_LINKED, isRemoved: false },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      if (other) {
        await prisma.challan_order_so_links.updateMany({
          where: { id: link.id, status: "linked", linkedOrderId: o.id },
          data: { linkedOrderId: other.id },
        });
      } else {
        const back = await prisma.challan_order_so_links.updateMany({
          where: { id: link.id, status: "linked", linkedOrderId: o.id },
          data: { status: "waiting", linkedOrderId: null, obdLinkedAt: null },
        });
        linkBackToWaiting = back.count > 0;
      }
    }
  }
  return { ok: true, linkBackToWaiting };
}
