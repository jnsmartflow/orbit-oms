import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.FLOOR_SUPERVISOR, ROLES.ADMIN]);
  const userId = parseInt(session!.user.id, 10);

  const body = (await req.json().catch(() => ({}))) as {
    orderIds?: number[];
    pickerId?: number;
  };

  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    return NextResponse.json({ error: "No orders selected" }, { status: 400 });
  }

  if (!body.pickerId || typeof body.pickerId !== "number") {
    return NextResponse.json({ error: "Invalid picker" }, { status: 400 });
  }

  // Validate picker exists with picker role
  const picker = await prisma.users.findUnique({
    where: { id: body.pickerId },
    include: { role: { select: { name: true } } },
  });

  if (!picker || picker.role.name !== "picker" || !picker.isActive) {
    return NextResponse.json({ error: "Invalid picker" }, { status: 400 });
  }

  // Validate all orders exist and have dispatched splits (or no splits for non-tinting)
  for (const orderId of body.orderIds) {
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: {
        splits: {
          where: { status: { not: "cancelled" } },
          select: { dispatchStatus: true },
        },
      },
    });

    if (!order || order.workflowStage === "cancelled") {
      return NextResponse.json(
        { error: `Order ${orderId} not found or cancelled` },
        { status: 400 },
      );
    }

    // Must be dispatch_confirmation with dispatched splits or no splits
    const hasDispatchedSplits = order.splits.some((s) => s.dispatchStatus === "dispatch");
    const hasNoSplits = order.splits.length === 0;
    if (!hasDispatchedSplits && !hasNoSplits) {
      return NextResponse.json(
        { error: `Order ${orderId} is not ready for picking` },
        { status: 400 },
      );
    }

    // Check not already assigned
    const existing = await prisma.pick_assignments.findUnique({
      where: { orderId },
      include: { picker: { select: { name: true } } },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Order ${orderId} is already assigned to ${existing.picker.name}` },
        { status: 400 },
      );
    }
  }

  // Get max sequence for this picker today
  const todayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
  const maxSeqRow = await prisma.pick_assignments.findFirst({
    where: {
      pickerId: body.pickerId,
      assignedAt: { gte: todayStart },
    },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  let seq = maxSeqRow?.sequence ?? 0;

  // Create assignments
  const created: { id: number; orderId: number; sequence: number }[] = [];

  for (const orderId of body.orderIds) {
    seq++;
    const assignment = await prisma.pick_assignments.create({
      data: {
        orderId,
        pickerId: body.pickerId,
        sequence: seq,
        assignedById: userId,
      },
      select: { id: true, orderId: true, sequence: true },
    });
    created.push(assignment);
  }

  return NextResponse.json({ success: true, assignments: created });
}
