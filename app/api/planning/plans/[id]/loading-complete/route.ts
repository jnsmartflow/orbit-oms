import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.FLOOR_SUPERVISOR, ROLES.ADMIN]);
  const userId = parseInt(session!.user.id, 10);

  const planId = parseInt(params.id, 10);
  if (isNaN(planId)) {
    return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
  }

  const plan = await prisma.dispatch_plans.findUnique({
    where: { id: planId },
    include: {
      orders: {
        select: { orderId: true },
      },
    },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  if (!plan.vehicleId) {
    return NextResponse.json({ error: "No vehicle assigned to plan" }, { status: 400 });
  }

  // Mark all orders in this plan as dispatched
  for (const planOrder of plan.orders) {
    const order = await prisma.orders.findUnique({
      where: { id: planOrder.orderId },
      include: {
        splits: {
          where: { status: { not: "cancelled" } },
          select: { id: true, status: true },
        },
      },
    });

    if (!order || order.workflowStage === "cancelled") continue;

    // Update all non-cancelled splits to dispatched
    for (const split of order.splits) {
      await prisma.order_splits.update({
        where: { id: split.id },
        data: { status: "dispatched", dispatchStatus: "dispatch" },
      });

      await prisma.split_status_logs.create({
        data: {
          splitId: split.id,
          fromStage: split.status,
          toStage: "dispatched",
          changedById: userId,
          note: `Dispatched via plan #${planId} loading complete`,
        },
      });
    }

    // Update order workflowStage
    await prisma.orders.update({
      where: { id: order.id },
      data: { workflowStage: "dispatched" },
    });

    await prisma.order_status_logs.create({
      data: {
        orderId: order.id,
        fromStage: order.workflowStage,
        toStage: "dispatched",
        changedById: userId,
        note: `Dispatched via plan #${planId} loading complete`,
      },
    });
  }

  // Update plan status
  await prisma.dispatch_plans.update({
    where: { id: planId },
    data: {
      status: "dispatched",
      dispatchedAt: new Date(),
      dispatchedById: userId,
    },
  });

  return NextResponse.json({ success: true, ordersDispatched: plan.orders.length });
}
