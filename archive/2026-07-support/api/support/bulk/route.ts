import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT, supportMayEdit } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN, ROLES.OPERATIONS]);
  const userId = parseInt(session!.user.id, 10);

  const body = (await req.json().catch(() => ({}))) as {
    orderIds?: number[];
    action?: string;
    note?: string;
    dispatchTargetDate?: string;
    dispatchWindowId?: number;
  };

  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    return NextResponse.json({ error: "orderIds must be a non-empty array" }, { status: 400 });
  }
  if (body.action !== "dispatch" && body.action !== "hold") {
    return NextResponse.json({ error: "action must be 'dispatch' or 'hold'" }, { status: 400 });
  }

  if (body.action === "dispatch") {
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
  }

  const { orderIds, action, note } = body;

  // Parse date once for the whole batch — only used when action === "dispatch"
  const [dy, dm, dd] = (body.dispatchTargetDate ?? "1970-01-01").split("-").map(Number);
  const targetDate = new Date(Date.UTC(dy, dm - 1, dd));
  let processed = 0;
  let skipped = 0;

  for (const orderId of orderIds) {
    const order = await prisma.orders.findFirst({
      where: { id: orderId, isRemoved: false },
      include: {
        splits: { where: { status: { not: "cancelled" } } },
      },
    });

    if (!order || order.workflowStage === "cancelled") {
      skipped++;
      continue;
    }

    if (
      (action === "dispatch" || action === "hold") &&
      !supportMayEdit(order.workflowStage)
    ) {
      skipped++;
      continue;
    }

    if (action === "dispatch") {
      const defaultNote = note ?? "Dispatched by support (bulk)";

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
    } else {
      // hold
      const defaultNote = note ?? "Placed on hold by support (bulk)";

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

      await prisma.orders.update({
        where: { id: orderId },
        data: { dispatchStatus: "hold", heldAt: order.obdEmailDate ?? new Date() },
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
    }

    processed++;
  }

  return NextResponse.json({ success: true, processed, skipped });
}
