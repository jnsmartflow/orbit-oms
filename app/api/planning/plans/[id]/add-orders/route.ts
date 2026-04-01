import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.DISPATCHER, ROLES.ADMIN, ROLES.OPERATIONS]);
  const userId = parseInt(session!.user.id, 10);

  const planId = parseInt(params.id, 10);
  if (isNaN(planId)) {
    return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
  }

  const plan = await prisma.dispatch_plans.findUnique({ where: { id: planId } });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (["loading", "dispatched"].includes(plan.status)) {
    return NextResponse.json({ error: "Cannot add orders to plan in loading or dispatched status" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderIds?: number[] };
  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    return NextResponse.json({ error: "orderIds must be a non-empty array" }, { status: 400 });
  }

  let added = 0;
  let skipped = 0;
  let addedWeight = 0;
  let addedVolume = 0;

  // Current max sequenceOrder
  const maxSeq = await prisma.dispatch_plan_orders.findFirst({
    where: { planId },
    orderBy: { sequenceOrder: "desc" },
    select: { sequenceOrder: true },
  });
  let seq = maxSeq?.sequenceOrder ?? 0;

  for (const orderId of body.orderIds) {
    // Check order is in dispatch_confirmation (with or without splits)
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: {
        splits: {
          where: { dispatchStatus: "dispatch", status: { not: "cancelled" } },
          select: { id: true },
        },
        querySnapshot: true,
      },
    });

    if (!order || !["dispatch_confirmation", "dispatched"].includes(order.workflowStage)) {
      skipped++;
      continue;
    }

    // Check not already in another plan
    const existing = await prisma.dispatch_plan_orders.findFirst({
      where: { orderId },
    });
    if (existing) {
      skipped++;
      continue;
    }

    seq++;
    await prisma.dispatch_plan_orders.create({
      data: {
        planId,
        orderId,
        sequenceOrder: seq,
        addedById: userId,
      },
    });

    added++;
    addedWeight += order.querySnapshot?.totalWeight ?? 0;
    addedVolume += order.querySnapshot?.totalVolume ?? 0;
  }

  // Update plan totals
  if (added > 0) {
    await prisma.dispatch_plans.update({
      where: { id: planId },
      data: {
        totalOrders: plan.totalOrders + added,
        totalWeightKg: plan.totalWeightKg + addedWeight,
        totalVolume: plan.totalVolume + addedVolume,
      },
    });
  }

  return NextResponse.json({ success: true, added, skipped });
}
