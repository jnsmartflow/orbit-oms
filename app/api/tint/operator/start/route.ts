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


export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR, ROLES.OPERATIONS]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_operator", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { orderId } = parsed.data;
  const userId = parseInt(session!.user.id, 10);
  const isOpsOrAdmin = ["operations", "admin"].includes(session!.user.role ?? "");

  // Guard 1 — TI gate: operator must have submitted the Tinter Issue form first
  const assignment = await prisma.tint_assignments.findFirst({
    where: {
      orderId,
      ...(isOpsOrAdmin ? {} : { assignedToId: userId }),
      status: { not: "cancelled" },
    },
    select: { tiSubmitted: true },
  });

  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }

  if (!assignment.tiSubmitted) {
    return NextResponse.json(
      { error: "Please submit the Tinter Issue form before starting" },
      { status: 400 },
    );
  }

  // Guard 2 — One-job rule: operator may not have two jobs in progress simultaneously
  if (!isOpsOrAdmin) {
    const activeJob = await prisma.$queryRaw`
      SELECT "operatorId" FROM operator_active_job
      WHERE "operatorId" = ${Number(session!.user.id)}
      LIMIT 1
    `;

    if ((activeJob as unknown[]).length > 0) {
      return NextResponse.json(
        { error: "You already have a job in progress. Complete it first." },
        { status: 400 },
      );
    }
  }

  try {
    // 1. Load order — verify stage
    const order = await prisma.orders.findUnique({ where: { id: orderId } })
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }
    if (!["tint_assigned", "tinting_in_progress"].includes(order.workflowStage)) {
      return NextResponse.json({ error: "Order is not in a startable stage" }, { status: 409 })
    }

    // 2. Verify assignment
    const activeAssignment = await prisma.tint_assignments.findFirst({
      where: {
        orderId,
        ...(isOpsOrAdmin ? {} : { assignedToId: userId }),
        status: { not: "cancelled" },
      },
    })
    if (!activeAssignment) {
      return NextResponse.json({ error: "Not assigned to this order" }, { status: 403 })
    }

    // 3. Update tint_assignments
    await prisma.tint_assignments.update({
      where: { id: activeAssignment.id },
      data:  { status: "tinting_in_progress", startedAt: new Date() },
    })

    // 4. Update order stage
    await prisma.orders.update({
      where: { id: orderId },
      data:  { workflowStage: "tinting_in_progress" },
    })

    // 5. INSERT tint_logs
    await prisma.tint_logs.create({
      data: {
        orderId,
        action:        "started",
        performedById: userId,
      },
    })

    // 6. INSERT order_status_logs
    await prisma.order_status_logs.create({
      data: {
        orderId,
        fromStage:   "tint_assigned",
        toStage:     "tinting_in_progress",
        changedById: userId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("start error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
