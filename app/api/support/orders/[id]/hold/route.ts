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
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN]);
  const userId = parseInt(session!.user.id, 10);

  const orderId = parseInt(params.id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const { note } = (await req.json().catch(() => ({}))) as { note?: string };

  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    include: {
      splits: { where: { status: { not: "cancelled" } } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.workflowStage === "cancelled") {
    return NextResponse.json({ error: "Order is cancelled" }, { status: 400 });
  }

  const defaultNote = note ?? "Placed on hold by support";

  // Update each non-cancelled split
  for (const split of order.splits) {
    await prisma.order_splits.update({
      where: { id: split.id },
      data: { dispatchStatus: "hold" },
    });
    await prisma.split_status_logs.create({
      data: {
        splitId: split.id,
        fromStage: split.status,
        toStage: split.status,
        changedById: userId,
        note: defaultNote,
      },
    });
  }

  // Update order — only dispatchStatus, workflowStage unchanged
  await prisma.orders.update({
    where: { id: orderId },
    data: { dispatchStatus: "hold" },
  });

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: order.workflowStage,
      changedById: userId,
      note: defaultNote,
    },
  });

  return NextResponse.json({ success: true, orderId });
}
