import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";

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

  const body = (await req.json().catch(() => ({}))) as {
    note?: string;
    dispatchTargetDate?: string;
    dispatchWindowId?: number;
  };

  if (!body.dispatchTargetDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.dispatchTargetDate)) {
    return NextResponse.json(
      { error: "dispatchTargetDate is required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (!body.dispatchWindowId || !Number.isInteger(body.dispatchWindowId)) {
    return NextResponse.json(
      { error: "dispatchWindowId is required" },
      { status: 400 },
    );
  }

  const [y, m, d] = body.dispatchTargetDate.split("-").map(Number);
  const targetDate = new Date(Date.UTC(y, m - 1, d));

  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
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
  if (["tinting_in_progress", "tint_assigned"].includes(order.workflowStage)) {
    return NextResponse.json(
      { error: "Cannot dispatch — tinting not complete" },
      { status: 400 },
    );
  }

  const defaultNote = body.note ?? "Released from hold by support";

  // Update each non-cancelled split
  for (const split of order.splits) {
    await prisma.order_splits.update({
      where: { id: split.id },
      data: { dispatchStatus: "dispatch" },
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

  // Update order — same as dispatch
  await prisma.orders.update({
    where: { id: orderId },
    data: {
      workflowStage: SUPPORT_DONE_OUTPUT,
      dispatchStatus: "dispatch",
      dispatchTargetDate: targetDate,
      dispatchWindowId: body.dispatchWindowId,
      dispatchSlotSource: "manual",
    },
  });

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: SUPPORT_DONE_OUTPUT,
      changedById: userId,
      note: defaultNote,
    },
  });

  return NextResponse.json({ success: true, orderId });
}
