import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.DISPATCHER, ROLES.ADMIN]);
  const userId = parseInt(session!.user.id, 10);

  const body = (await req.json().catch(() => ({}))) as {
    slotId?: number;
    orderIds?: number[];
  };

  if (!body.slotId || typeof body.slotId !== "number") {
    return NextResponse.json({ error: "slotId is required" }, { status: 400 });
  }

  const slot = await prisma.slot_master.findUnique({ where: { id: body.slotId } });
  if (!slot) {
    return NextResponse.json({ error: "Slot not found" }, { status: 404 });
  }

  const planDate = new Date(new Date().toISOString().slice(0, 10));

  // Try to reuse an empty trip for today
  const allPlansToday = await prisma.dispatch_plans.findMany({
    where: { planDate },
    include: { _count: { select: { orders: true } } },
    orderBy: { tripNumber: "asc" },
  });

  const emptyPlan = allPlansToday.find((p) => p._count.orders === 0);

  let plan;

  if (emptyPlan) {
    // Reuse empty trip — update slot and reset to draft
    plan = await prisma.dispatch_plans.update({
      where: { id: emptyPlan.id },
      data: {
        slotId: body.slotId,
        status: "draft",
      },
    });
  } else {
    // Create new trip with next number
    const maxTrip = allPlansToday.length > 0
      ? allPlansToday[allPlansToday.length - 1].tripNumber
      : 0;

    plan = await prisma.dispatch_plans.create({
      data: {
        planDate,
        slotId: body.slotId,
        tripNumber: maxTrip + 1,
        status: "draft",
        createdById: userId,
      },
    });
  }

  // Add orders if provided
  const orderIds = body.orderIds ?? [];
  let totalOrders = 0;
  let totalWeightKg = 0;
  let totalVolume = 0;

  for (const orderId of orderIds) {
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: { querySnapshot: true },
    });
    if (!order) continue;

    await prisma.dispatch_plan_orders.create({
      data: {
        planId: plan.id,
        orderId,
        sequenceOrder: totalOrders + 1,
        addedById: userId,
      },
    });

    totalOrders++;
    totalWeightKg += order.querySnapshot?.totalWeight ?? 0;
    totalVolume += order.querySnapshot?.totalVolume ?? 0;
  }

  if (totalOrders > 0) {
    await prisma.dispatch_plans.update({
      where: { id: plan.id },
      data: { totalOrders, totalWeightKg, totalVolume },
    });
  }

  return NextResponse.json({ success: true, plan: { ...plan, totalOrders, totalWeightKg, totalVolume } });
}
