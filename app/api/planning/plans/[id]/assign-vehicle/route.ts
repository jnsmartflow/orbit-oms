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
  requireRole(session, [ROLES.DISPATCHER, ROLES.ADMIN]);
  const userId = parseInt(session!.user.id, 10);

  const planId = parseInt(params.id, 10);
  if (isNaN(planId)) {
    return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { vehicleId?: number };
  if (!body.vehicleId || typeof body.vehicleId !== "number") {
    return NextResponse.json({ error: "vehicleId is required" }, { status: 400 });
  }

  const plan = await prisma.dispatch_plans.findUnique({ where: { id: planId } });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (["loading", "dispatched"].includes(plan.status)) {
    return NextResponse.json({ error: "Cannot modify plan in loading or dispatched status" }, { status: 400 });
  }

  const vehicle = await prisma.vehicle_master.findUnique({ where: { id: body.vehicleId } });
  if (!vehicle || !vehicle.isActive) {
    return NextResponse.json({ error: "Vehicle not found or inactive" }, { status: 404 });
  }

  await prisma.dispatch_plans.update({
    where: { id: planId },
    data: {
      vehicleId: body.vehicleId,
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedById: userId,
    },
  });

  return NextResponse.json({ success: true });
}
