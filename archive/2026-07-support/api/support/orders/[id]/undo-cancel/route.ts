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
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN, ROLES.OPERATIONS]);
  const userId = parseInt(session!.user.id, 10);

  const orderId = parseInt(params.id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const { note } = (await req.json().catch(() => ({}))) as { note?: string };

  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    include: {
      splits: { where: { status: "cancelled" } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.workflowStage !== "cancelled") {
    return NextResponse.json(
      { error: "Order is not cancelled" },
      { status: 409 },
    );
  }

  const defaultNote = note ?? "Undo cancel by support";

  // Restore each cancelled split to tinting_done (the only status splits
  // carry when an order reaches pending_support — confirmed by tint split done
  // route which sets status="tinting_done" before bubbling to pending_support).
  // Non-tint orders have no splits; this loop is a no-op for them.
  for (const split of order.splits) {
    await prisma.order_splits.update({
      where: { id: split.id },
      data: { status: "tinting_done", dispatchStatus: null },
    });
    await prisma.split_status_logs.create({
      data: {
        splitId: split.id,
        fromStage: "cancelled",
        toStage: "tinting_done",
        changedById: userId,
        note: defaultNote,
      },
    });
  }

  // Restore order: back to pending_support, clear dispatchStatus
  await prisma.orders.update({
    where: { id: orderId },
    data: {
      workflowStage: "pending_support",
      dispatchStatus: null,
    },
  });

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: "cancelled",
      toStage: "pending_support",
      changedById: userId,
      note: defaultNote,
    },
  });

  return NextResponse.json({ success: true, orderId });
}
