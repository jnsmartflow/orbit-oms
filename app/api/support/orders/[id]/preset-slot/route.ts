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

  const body = (await req.json().catch(() => ({}))) as {
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
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (
    order.orderType !== "tint" ||
    !["pending_tint_assignment", "tint_assigned", "tinting_in_progress"].includes(order.workflowStage)
  ) {
    return NextResponse.json(
      { error: "Pre-set slot only valid on a tint order during tinting." },
      { status: 409 },
    );
  }

  await prisma.orders.update({
    where: { id: orderId },
    data: {
      dispatchTargetDate: targetDate,
      dispatchWindowId:   body.dispatchWindowId,
    },
  });

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage:   order.workflowStage,
      toStage:     order.workflowStage,
      changedById: userId,
      note:        "Dispatch slot pre-set during tinting",
    },
  });

  return NextResponse.json({ success: true, orderId });
}
