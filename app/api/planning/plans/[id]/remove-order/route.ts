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

  const planId = parseInt(params.id, 10);
  if (isNaN(planId)) {
    return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: number };
  if (!body.orderId || typeof body.orderId !== "number") {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const plan = await prisma.dispatch_plans.findUnique({ where: { id: planId } });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (["loading", "dispatched"].includes(plan.status)) {
    return NextResponse.json({ error: "Cannot remove orders from plan in loading or dispatched status" }, { status: 400 });
  }

  // Find the plan-order link
  const link = await prisma.dispatch_plan_orders.findFirst({
    where: { planId, orderId: body.orderId },
  });
  if (!link) {
    return NextResponse.json({ error: "Order not in this plan" }, { status: 404 });
  }

  // Get order weight/volume to subtract
  const order = await prisma.orders.findUnique({
    where: { id: body.orderId },
    include: { querySnapshot: true },
  });

  await prisma.dispatch_plan_orders.delete({ where: { id: link.id } });

  // Update plan totals
  const removedWeight = order?.querySnapshot?.totalWeight ?? 0;
  const removedVolume = order?.querySnapshot?.totalVolume ?? 0;

  await prisma.dispatch_plans.update({
    where: { id: planId },
    data: {
      totalOrders: Math.max(0, plan.totalOrders - 1),
      totalWeightKg: Math.max(0, plan.totalWeightKg - removedWeight),
      totalVolume: Math.max(0, plan.totalVolume - removedVolume),
    },
  });

  return NextResponse.json({ success: true });
}
