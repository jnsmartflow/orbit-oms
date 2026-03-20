import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);
  if (session!.user.role !== "admin") {
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
      const order = await tx.orders.findUnique({ where: { id: orderId } });
      if (!order) throw new Error("Order not found");
      if (order.workflowStage !== "tint_assigned") {
        throw new Error("Order is not in assigned stage");
      }

      // 2a. Cancel active tint_assignments (status != 'done')
      await tx.tint_assignments.updateMany({
        where:  { orderId, status: { not: "done" } },
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
