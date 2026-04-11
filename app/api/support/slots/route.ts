import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { runDailyCleanupIfNeeded } from "@/lib/day-boundary";
import { runSlotCascadeIfNeeded } from "@/lib/slot-cascade";
import { getSlotNamesAtEndOfDay } from "@/lib/slot-history";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.DISPATCHER, ROLES.ADMIN, ROLES.OPERATIONS]);

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date")?.trim() ?? "";
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const dateStr = dateParam || todayStr;
  const isHistoryView = dateStr < todayStr;
  const dateStart = new Date(dateStr + "T00:00:00.000Z");
  const dateEnd   = new Date(dateStr + "T23:59:59.999Z");

  // DISABLED: slot cascade removed — slots are fixed by obdEmailTime
  // await runDailyCleanupIfNeeded();
  // await runSlotCascadeIfNeeded(todayStr);

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

  // ── Per-slot counts ─────────────────────────────────────────────────────
  let slotResults;

  if (isHistoryView) {
    // History: reconstruct slot assignments from audit logs
    const allOrders = await prisma.orders.findMany({
      where: {
        obdEmailDate: { gte: dateStart, lte: dateEnd },
        workflowStage: { notIn: ["dispatched", "cancelled"] },
      },
      select: {
        id: true,
        workflowStage: true,
        dispatchStatus: true,
      },
    });

    const orderIds = allOrders.map((o) => o.id);
    const slotMap = orderIds.length > 0
      ? await getSlotNamesAtEndOfDay(orderIds, dateStr)
      : new Map<number, string | null>();

    // Build a lookup: order id -> order data
    const orderById = new Map(allOrders.map((o) => [o.id, o]));

    slotResults = slots.map((slot) => {
      // Find orders whose reconstructed slot matches this slot's name
      const matchingIds = orderIds.filter((id) => slotMap.get(id) === slot.name);

      let pendingCount = 0;
      let dispatchedCount = 0;
      let tintingCount = 0;

      for (const id of matchingIds) {
        const o = orderById.get(id)!;
        if (
          ["pending_support", "tinting_done"].includes(o.workflowStage) &&
          o.dispatchStatus === null
        ) {
          pendingCount++;
        } else if (o.dispatchStatus === "dispatch") {
          dispatchedCount++;
        } else if (
          ["tinting_in_progress", "tint_assigned"].includes(o.workflowStage)
        ) {
          tintingCount++;
        }
      }

      const cutoffTime = slot.slotConfigs.find(c => c.windowEnd !== null)?.windowEnd ?? slot.slotTime ?? null;
      const deliveryTypeId = slot.slotConfigs[0]?.deliveryTypeId ?? null;

      return {
        id: slot.id,
        name: slot.name,
        sortOrder: slot.sortOrder,
        cutoffTime,
        deliveryTypeId,
        slotTime: slot.slotTime,
        isNextDay: slot.isNextDay,
        pendingCount,
        dispatchedCount,
        tintingCount,
      };
    });
  } else {
    // Today: use current slotId with direct DB counts
    slotResults = [];
    for (const slot of slots) {
      const pendingCount = await prisma.orders.count({
        where: {
          slotId: slot.id,
          workflowStage: { in: ["pending_support", "tinting_done"] },
          dispatchStatus: null,
        },
      });

      const dispatchedCount = await prisma.orders.count({
        where: {
          slotId: slot.id,
          dispatchStatus: "dispatch",
        },
      });

      const tintingCount = await prisma.orders.count({
        where: {
          slotId: slot.id,
          workflowStage: { in: ["tinting_in_progress", "tint_assigned"] },
        },
      });

      const cutoffTime = slot.slotConfigs.find(c => c.windowEnd !== null)?.windowEnd ?? slot.slotTime ?? null;
      const deliveryTypeId = slot.slotConfigs[0]?.deliveryTypeId ?? null;

      slotResults.push({
        id: slot.id,
        name: slot.name,
        sortOrder: slot.sortOrder,
        cutoffTime,
        deliveryTypeId,
        slotTime: slot.slotTime,
        isNextDay: slot.isNextDay,
        pendingCount,
        dispatchedCount,
        tintingCount,
      });
    }
  }

  // Global hold count (across all slots)
  const holdCount = await prisma.orders.count({
    where: { dispatchStatus: "hold" },
  });

  return NextResponse.json({
    slots: slotResults,
    holdCount,
    date: dateStr,
  });
}
