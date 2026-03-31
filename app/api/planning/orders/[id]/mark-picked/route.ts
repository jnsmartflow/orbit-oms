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
  requireRole(session, [ROLES.FLOOR_SUPERVISOR, ROLES.ADMIN]);
  const userId = parseInt(session!.user.id, 10);

  const orderId = parseInt(params.id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { picked?: boolean };
  if (typeof body.picked !== "boolean") {
    return NextResponse.json({ error: "picked must be a boolean" }, { status: 400 });
  }

  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    include: {
      splits: {
        where: { status: { not: "cancelled" } },
        select: { id: true },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const now = new Date();
  const pickedAt = body.picked ? now : null;
  const pickedById = body.picked ? userId : null;

  // 1. Always update order-level isPicked
  await prisma.orders.update({
    where: { id: orderId },
    data: { isPicked: body.picked, pickedAt, pickedById },
  });

  // 2. Sync all splits to match
  for (const split of order.splits) {
    await prisma.order_splits.update({
      where: { id: split.id },
      data: { isPicked: body.picked, pickedAt, pickedById },
    });
  }

  // 3. Sync pick_assignments if one exists
  const assignment = await prisma.pick_assignments.findUnique({
    where: { orderId },
  });

  if (assignment) {
    await prisma.pick_assignments.update({
      where: { id: assignment.id },
      data: {
        status: body.picked ? "picked" : "assigned",
        pickedAt: body.picked ? now : null,
      },
    });
  }

  return NextResponse.json({ success: true, isPicked: body.picked });
}
