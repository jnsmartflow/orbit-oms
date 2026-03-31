import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.DISPATCHER, ROLES.ADMIN]);

  // Today at midnight for date filtering
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const today = new Date(todayStr + "T00:00:00.000Z");

  // Fetch all active slots ordered by sortOrder
  const slots = await prisma.slot_master.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      slotConfigs: {
        where: { isActive: true },
        select: {
          deliveryTypeId: true,
          windowEnd: true,
        },
      },
    },
  });

  // Per-slot counts (sequential awaits)
  const slotResults = [];
  for (const slot of slots) {
    const pendingCount = await prisma.orders.count({
      where: {
        slotId: slot.id,
        workflowStage: { in: ["pending_support", "tinting_done"] },
        dispatchStatus: null,
        obdEmailDate: { gte: today },
      },
    });

    const dispatchedCount = await prisma.orders.count({
      where: {
        slotId: slot.id,
        dispatchStatus: "dispatch",
        obdEmailDate: { gte: today },
      },
    });

    const tintingCount = await prisma.orders.count({
      where: {
        slotId: slot.id,
        workflowStage: { in: ["tinting_in_progress", "tint_assigned"] },
        obdEmailDate: { gte: today },
      },
    });

    // Use first config's windowEnd as cutoffTime
    const cutoffTime = slot.slotConfigs.find(c => c.windowEnd !== null)?.windowEnd ?? slot.slotTime ?? null;
    const deliveryTypeId = slot.slotConfigs[0]?.deliveryTypeId ?? null;

    slotResults.push({
      id: slot.id,
      name: slot.name,
      sortOrder: slot.sortOrder,
      cutoffTime,
      deliveryTypeId,
      pendingCount,
      dispatchedCount,
      tintingCount,
    });
  }

  // Global hold count (across all slots)
  const holdCount = await prisma.orders.count({
    where: { dispatchStatus: "hold" },
  });

  // Overdue count
  const overdueCount = await prisma.orders.count({
    where: {
      obdEmailDate: { lt: today },
      workflowStage: { notIn: ["dispatched", "cancelled"] },
      OR: [
        { dispatchStatus: null },
        { dispatchStatus: { not: "dispatch" } },
      ],
    },
  });

  return NextResponse.json({
    slots: slotResults,
    overdueCount,
    holdCount,
    date: todayStr,
  });
}
