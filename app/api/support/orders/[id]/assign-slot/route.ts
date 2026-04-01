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
  requireRole(session, [ROLES.SUPPORT, ROLES.DISPATCHER, ROLES.ADMIN, ROLES.OPERATIONS]);
  const userId = parseInt(session!.user.id, 10);

  const orderId = parseInt(params.id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { slotId?: number };
  const slotId = typeof body.slotId === "number" ? body.slotId : NaN;
  if (isNaN(slotId)) {
    return NextResponse.json({ error: "Invalid slotId" }, { status: 400 });
  }

  const slot = await prisma.slot_master.findUnique({ where: { id: slotId } });
  if (!slot) {
    return NextResponse.json({ error: "Slot not found" }, { status: 404 });
  }

  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    include: { slot: { select: { name: true } } },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.workflowStage === "cancelled") {
    return NextResponse.json({ error: "Order is cancelled" }, { status: 400 });
  }

  const previousSlotName = order.slot?.name ?? "Unassigned";

  await prisma.orders.update({
    where: { id: orderId },
    data: {
      slotId,
      originalSlotId: order.originalSlotId ?? slotId,
    },
  });

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: previousSlotName,
      toStage: slot.name,
      changedById: userId,
      note: "Slot manually assigned by support",
    },
  });

  return NextResponse.json({ success: true, orderId, slotId });
}
