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

  const body = (await req.json().catch(() => ({}))) as {
    reason?: string;
    note?: string;
  };

  if (!body.reason?.trim()) {
    return NextResponse.json(
      { error: "Cancellation reason is required" },
      { status: 400 },
    );
  }

  const reason = body.reason.trim();
  const logNote = `Cancelled: ${reason}${body.note ? " — " + body.note : ""}`;

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
    return NextResponse.json({ error: "Order is already cancelled" }, { status: 400 });
  }

  // Cancel each non-cancelled split
  for (const split of order.splits) {
    await prisma.order_splits.update({
      where: { id: split.id },
      data: { status: "cancelled", dispatchStatus: null },
    });
    await prisma.split_status_logs.create({
      data: {
        splitId: split.id,
        fromStage: split.status,
        toStage: "cancelled",
        changedById: userId,
        note: logNote,
      },
    });
  }

  // Cancel order
  await prisma.orders.update({
    where: { id: orderId },
    data: { workflowStage: "cancelled", dispatchStatus: null },
  });

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: "cancelled",
      changedById: userId,
      note: logNote,
    },
  });

  return NextResponse.json({ success: true, orderId });
}
