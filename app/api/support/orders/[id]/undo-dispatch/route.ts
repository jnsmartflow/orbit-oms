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
      splits: { where: { status: { not: "cancelled" } } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.workflowStage !== "closed") {
    return NextResponse.json(
      { error: "Order is not in Done state" },
      { status: 409 },
    );
  }

  const defaultNote = note ?? "Undo dispatch by support";

  // Reverse each non-cancelled split: clear dispatchStatus, log audit only
  for (const split of order.splits) {
    await prisma.order_splits.update({
      where: { id: split.id },
      data: { dispatchStatus: null },
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

  // Reverse order: back to pending_support, clear dispatchStatus
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
      fromStage: "closed",
      toStage: "pending_support",
      changedById: userId,
      note: defaultNote,
    },
  });

  return NextResponse.json({ success: true, orderId });
}
