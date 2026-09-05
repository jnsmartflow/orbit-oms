import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";
import { TINT_ASSIGNMENT_ACTIVE_STATUSES } from "@/lib/tint/assignment-status";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.OPERATION_MANAGER]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const body = (await req.json()) as { orderId?: unknown };
  const orderId = typeof body.orderId === "number" ? body.orderId : null;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const managerId = parseInt(session!.user.id, 10);

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Verify order exists and is in tint_assigned stage
      const order = await tx.orders.findFirst({ where: { id: orderId, isRemoved: false } });
      if (!order) throw new Error("Order not found");
      if (order.workflowStage !== "tint_assigned") {
        throw new Error("Order is not in assigned stage");
      }

      // 2a. Cancel the operator's LIVE claim on this OBD.
      //
      // ⚠ This read `status: { not: "done" }` until 2026-09-05 — the FOURTH and
      // most damaging copy of a predicate that matches every row ever written.
      // "done" is not a value this system produces (lib/tint/assignment-status.ts:
      // the finished value is "tinting_done"), and unlike the three read-side
      // copies fixed in a0f9378b this one drives a WRITE. It swept up every DEAD
      // row on the order and overwrote it: a `skipped` row became `cancelled`,
      // silently destroying the assignment-side record of the skip (the
      // tint_skip_events row survives, but tint_assignments.status +
      // skipEventId — the link SkipHistoryModal and the board's "Skipped N×"
      // pill read through — did not).
      //
      // Narrowed to the live statuses, which is what "cancel the assignment"
      // ever meant. Verified read-only 2026-09-05: no order currently mixes a
      // live row with a dead one, so this is behaviour-identical on today's
      // data — the defect was latent, waiting for the first cancel of an OBD
      // that had been skipped and re-assigned.
      await tx.tint_assignments.updateMany({
        where:  { orderId, status: { in: [...TINT_ASSIGNMENT_ACTIVE_STATUSES] } },
        data:   { status: "cancelled", updatedAt: new Date() },
      });

      // 2b. Revert order back to pending_tint_assignment
      await tx.orders.update({
        where: { id: orderId },
        data:  { workflowStage: "pending_tint_assignment", sequenceOrder: 0 },
      });

      // 2c. INSERT tint_logs (INSERT-ONLY — never skip)
      await tx.tint_logs.create({
        data: {
          orderId,
          action:        "assignment_cancelled",
          performedById: managerId,
          note:          "Assignment cancelled by manager",
        },
      });

      // 2d. INSERT order_status_logs (INSERT-ONLY — never skip)
      await tx.order_status_logs.create({
        data: {
          orderId,
          fromStage:   "tint_assigned",
          toStage:     "pending_tint_assignment",
          changedById: managerId,
          note:        "Assignment cancelled by manager",
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg === "Order is not in assigned stage" ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
