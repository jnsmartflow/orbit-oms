import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderId: z.number().int().positive(),
});

class NoActiveAssignmentError extends Error {
  constructor() { super("NO_ACTIVE_ASSIGNMENT"); }
}
class WrongStageError extends Error {
  constructor() { super("WRONG_STAGE"); }
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR]);

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
      if (order.workflowStage !== "tinting_in_progress") throw new WrongStageError();

      // 2. Verify active assignment
      const assignment = await tx.tint_assignments.findFirst({
        where: {
          orderId,
          assignedToId: userId,
          status:       "in_progress",
        },
      });
      if (!assignment) throw new NoActiveAssignmentError();

      // 3. Update tint_assignments
      await tx.tint_assignments.update({
        where: { id: assignment.id },
        data:  { status: "done", completedAt: new Date() },
      });

      // 4. Update order — moves directly to pending_support (tinting_done skipped)
      await tx.orders.update({
        where: { id: orderId },
        data:  { workflowStage: "pending_support" },
      });

      // 5. INSERT tint_logs (never skip)
      await tx.tint_logs.create({
        data: {
          orderId,
          action:        "completed",
          performedById: userId,
        },
      });

      // 6. INSERT order_status_logs (never skip)
      await tx.order_status_logs.create({
        data: {
          orderId,
          fromStage:   "tinting_in_progress",
          toStage:     "pending_support",
          changedById: userId,
          note:        "Tinting completed",
        },
      });
    });
  } catch (err) {
    if (err instanceof NoActiveAssignmentError) {
      return NextResponse.json(
        { error: "No active assignment found for this order" },
        { status: 403 },
      );
    }
    if (err instanceof WrongStageError) {
      return NextResponse.json(
        { error: "Order is not currently in tinting" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to complete order" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
