import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.OPERATIONS]);

  // Load all active orders
  const orders = await prisma.orders.findMany({
    where: {
      workflowStage: { notIn: ["dispatched", "cancelled"] },
    },
    select: { id: true, obdNumber: true, slotId: true },
  });

  // Load obdEmailTime for all these orders from import_raw_summary
  const obdNumbers = orders.map((o) => o.obdNumber);
  const summaries = await prisma.import_raw_summary.findMany({
    where: { obdNumber: { in: obdNumbers } },
    select: { obdNumber: true, obdEmailTime: true },
  });
  const timeMap = new Map(summaries.map((s) => [s.obdNumber, s.obdEmailTime]));

  // Slot assignment function (same as resolveSlot)
  function getSlotId(emailTime: string | null): number {
    if (!emailTime) return 4; // Night
    if (emailTime < "10:30") return 1; // Morning
    if (emailTime < "12:30") return 2; // Afternoon
    if (emailTime < "15:30") return 3; // Evening
    return 4; // Night
  }

  let updated = 0;
  for (const order of orders) {
    const emailTime = timeMap.get(order.obdNumber) ?? null;
    const correctSlotId = getSlotId(emailTime);

    if (order.slotId !== correctSlotId) {
      await prisma.orders.update({
        where: { id: order.id },
        data: { slotId: correctSlotId, originalSlotId: correctSlotId },
      });
      updated++;
    }
  }

  return NextResponse.json({
    total: orders.length,
    updated,
    unchanged: orders.length - updated,
  });
}
