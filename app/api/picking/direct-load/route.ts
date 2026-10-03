import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PICK_ASSIGNED, PICK_CHECKED } from "@/lib/workflow-stages";
import { DIRECT_LOADABLE_STAGES, directLoadNote } from "@/lib/picking/direct-load";
import { sendToUser } from "@/lib/push/send";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/direct-load — the picking supervisor sends bill(s) straight
 * to `pick_checked` with NO picker ("Direct Loading", schema v27.52). Body
 * `{ orderIds: number[] }`. Returns `{ done: number[], skipped: [{ id, reason }] }`.
 *
 * Per bill, fully sequential — never prisma.$transaction, neither across bills
 * nor across one bill's writes (CORE §3):
 *   a. ONE guarded orders.updateMany (id + the stage READ + dispatch + not
 *      removed) → pick_checked + directLoadedAt/ById. Count 0 → skipped,
 *      "stage changed" — somebody moved it between the read and the write.
 *   b. Was pick_assigned → pick_assignments.deleteMany, AFTER (a), the order
 *      lib/picking/unassign.ts uses. If it throws, (a) is rolled back.
 *   c. ONE order_status_logs row.
 *   d. A picker was taken off it → "stop picking" push (tag pick-direct-<id>),
 *      fully swallowed.
 *
 * ELIGIBILITY mirrors app/api/picking/assign/route.ts per bill — the order must
 * exist; at pending_picking it must have NO pick_assignments row ("Already
 * assigned.") — plus, beyond assign: the stage may also be pick_assigned
 * (DIRECT_LOADABLE_STAGES), and the bill must be on the floor
 * (dispatchStatus "dispatch", not removed). Assign does not test those two
 * because it can only ever see a pending_picking bill on the board; this route
 * also lands a bill on billing's Pending list, whose predicate pins both, so a
 * held or removed bill must never get here (a hold is cleared on Floor).
 * Cancelled, tint-room, picked, checked and dispatched bills are all outside
 * DIRECT_LOADABLE_STAGES.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit, NOT canView — a supervisor action, the same gate as approve /
  // assign / unassign / cancel. Admin bypass lives inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderIds?: unknown };
  const raw = body.orderIds;
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)
  ) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array of integers" }, { status: 400 });
  }
  const orderIds = Array.from(new Set(raw as number[]));

  const done: number[] = [];
  const skipped: { id: number; reason: string }[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findFirst({
        where: { id: orderId },
        select: {
          id: true,
          workflowStage: true,
          dispatchStatus: true,
          isRemoved: true,
          obdNumber: true,
          shipToCustomerName: true,
          customer: { select: { customerName: true } },
          shipToOverrideCustomer: { select: { customerName: true } },
          pickAssignment: { select: { pickerId: true, picker: { select: { name: true } } } },
        },
      });
      if (!order) {
        skipped.push({ id: orderId, reason: "Order not found" });
        continue;
      }
      if (order.isRemoved) {
        skipped.push({ id: orderId, reason: "Order is removed" });
        continue;
      }
      if (order.dispatchStatus !== "dispatch") {
        skipped.push({ id: orderId, reason: order.dispatchStatus === "hold" ? "Order is on hold" : "Order is not on the floor" });
        continue;
      }
      const fromStage = order.workflowStage;
      if (!DIRECT_LOADABLE_STAGES.includes(fromStage)) {
        skipped.push({ id: orderId, reason: `Not allowed at stage ${fromStage}` });
        continue;
      }
      const wasAssigned = fromStage === PICK_ASSIGNED;
      // Assign's own guard: a waiting bill with an assignment row left over is
      // refused, not quietly overwritten.
      if (!wasAssigned && order.pickAssignment) {
        skipped.push({ id: orderId, reason: "Already assigned." });
        continue;
      }

      // a. The stage + the flag, in ONE guarded write.
      const now = new Date();
      const res = await prisma.orders.updateMany({
        where: { id: orderId, workflowStage: fromStage, isRemoved: false, dispatchStatus: "dispatch" },
        data: { workflowStage: PICK_CHECKED, directLoadedAt: now, directLoadedById: userId },
      });
      if (res.count === 0) {
        skipped.push({ id: orderId, reason: "stage changed" });
        continue;
      }

      // b. Take the picker off it — after (a), never before (lib/picking/unassign.ts).
      let removedPickerId: number | null = null;
      let removedPickerName: string | null = null;
      if (wasAssigned) {
        try {
          await prisma.pick_assignments.deleteMany({ where: { orderId } });
          removedPickerId = order.pickAssignment?.pickerId ?? null;
          removedPickerName = order.pickAssignment?.picker?.name ?? null;
        } catch (err) {
          // Best-effort rollback of (a) — never prisma.$transaction (CORE §3).
          await prisma.orders
            .update({
              where: { id: orderId },
              data: { workflowStage: fromStage, directLoadedAt: null, directLoadedById: null },
            })
            .catch(() => {});
          console.error(`[picking/direct-load] assignment delete failed for order ${orderId}:`, err);
          skipped.push({ id: orderId, reason: "Could not remove the picker. Rolled back." });
          continue;
        }
      }

      // c. Audit log.
      await prisma.order_status_logs.create({
        data: {
          orderId,
          fromStage,
          toStage: PICK_CHECKED,
          changedById: userId,
          note: directLoadNote(wasAssigned ? (removedPickerName ?? "unknown") : null),
        },
      });

      done.push(orderId);

      // d. "Stop picking" to the picker who held it — FULLY SWALLOWED, awaited
      // (Vercel freezes after the response), no orders write. Same shape as
      // the cancel route's push. Skipped when the supervisor is the picker.
      if (removedPickerId !== null && removedPickerId !== userId) {
        try {
          const dealerName =
            order.shipToOverrideCustomer?.customerName ??
            order.customer?.customerName ??
            order.shipToCustomerName ??
            "(Unmatched)";
          await sendToUser(removedPickerId, {
            title: "Direct loaded",
            body: `${dealerName} · ${order.obdNumber} — stop picking this bill`,
            tag: `pick-direct-${orderId}`,
            url: "/picking",
          });
        } catch (err) {
          console.error("[picking/direct-load] push notify failed (non-fatal):", err);
        }
      }
    } catch (err) {
      // One bill's unexpected throw never aborts the rest of the batch.
      skipped.push({ id: orderId, reason: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  return NextResponse.json({ done, skipped });
}
