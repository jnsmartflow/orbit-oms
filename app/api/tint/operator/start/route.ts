import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderId: z.number().int().positive(),
});

// Sentinel thrown inside the transaction so we can map it to a specific HTTP response.
class NotAssignedError extends Error {
  constructor() { super("NOT_ASSIGNED"); }
}
class WrongStageError extends Error {
  constructor() { super("WRONG_STAGE"); }
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "tint_operator", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { orderId } = parsed.data;
  const userId = parseInt(session!.user.id, 10);

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Load order — verify stage
      const order = await tx.orders.findUnique({ where: { id: orderId } });
      if (!order) throw new Error("Order not found");
      if (order.workflowStage !== "tint_assigned") throw new WrongStageError();

      // 2. Verify assignment
      const assignment = await tx.tint_assignments.findFirst({
        where: {
          orderId,
          assignedToId: userId,
          status: { not: "done" },
        },
      });
      if (!assignment) throw new NotAssignedError();

      // 3. Update tint_assignments
      await tx.tint_assignments.update({
        where: { id: assignment.id },
        data:  { status: "in_progress", startedAt: new Date() },
      });

      // 4. Update order stage
      await tx.orders.update({
        where: { id: orderId },
        data:  { workflowStage: "tinting_in_progress" },
      });

      // 5. INSERT tint_logs (never skip)
      await tx.tint_logs.create({
        data: {
          orderId,
          action:        "started",
          performedById: userId,
        },
      });

      // 6. INSERT order_status_logs (never skip)
      await tx.order_status_logs.create({
        data: {
          orderId,
          fromStage:   "tint_assigned",
          toStage:     "tinting_in_progress",
          changedById: userId,
        },
      });
    });
  } catch (err) {
    if (err instanceof NotAssignedError) {
      return NextResponse.json({ error: "Not assigned to this order" }, { status: 403 });
    }
    if (err instanceof WrongStageError) {
      return NextResponse.json({ error: "Order is not pending tint assignment" }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start order" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
