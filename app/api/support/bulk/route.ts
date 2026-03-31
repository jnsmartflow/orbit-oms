import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN]);
  const userId = parseInt(session!.user.id, 10);

  const body = (await req.json().catch(() => ({}))) as {
    orderIds?: number[];
    action?: string;
    note?: string;
  };

  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    return NextResponse.json({ error: "orderIds must be a non-empty array" }, { status: 400 });
  }
  if (body.action !== "dispatch" && body.action !== "hold") {
    return NextResponse.json({ error: "action must be 'dispatch' or 'hold'" }, { status: 400 });
  }

  const { orderIds, action, note } = body;
  let processed = 0;
  let skipped = 0;

  for (const orderId of orderIds) {
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: {
        splits: { where: { status: { not: "cancelled" } } },
      },
    });

    if (!order || order.workflowStage === "cancelled") {
      skipped++;
      continue;
    }

    if (
      action === "dispatch" &&
      ["tinting_in_progress", "tint_assigned"].includes(order.workflowStage)
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
          workflowStage: "dispatch_confirmation",
          dispatchStatus: "dispatch",
        },
      });

      await prisma.order_status_logs.create({
        data: {
          orderId,
          fromStage: order.workflowStage,
          toStage: "dispatch_confirmation",
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
    }

    processed++;
  }

  return NextResponse.json({ success: true, processed, skipped });
}
