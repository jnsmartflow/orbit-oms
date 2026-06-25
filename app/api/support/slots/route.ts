import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { runDailyCleanupIfNeeded } from "@/lib/day-boundary";
import { runSlotCascadeIfNeeded } from "@/lib/slot-cascade";
import { getHideExclusion } from "@/lib/hide/visibility";
import { getISTDayRange } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.DISPATCHER, ROLES.ADMIN, ROLES.OPERATIONS]);

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date")?.trim() ?? "";
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const dateStr = dateParam || todayStr;
  const isHistoryView = dateStr < todayStr;
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

  // Hide-feature exclusion — AND-merged into the history orders list below.
  const hideExclusion = await getHideExclusion();

  // ── Per-slot counts ─────────────────────────────────────────────────────
  let slotResults;
  let doneCount = 0;

  if (isHistoryView) {
    // History: IST date-fence + direct arrivalSlotId counts. No log reconstruction.
    // pendingCount has no dispatchStatus filter so held orders count (and render)
    // in exactly one place — their slot's pending section.
    const { start: histStart, end: histEnd } = getISTDayRange(dateStr);

    doneCount = await prisma.orders.count({
      where: {
        AND: [
          {
            obdEmailDate: { gte: histStart, lt: histEnd },
            workflowStage: { in: ["dispatched", "closed"] },
            isRemoved: false,
          },
          hideExclusion,
        ],
      },
    });

    slotResults = [];
    for (const slot of slots) {
      const pendingCount = await prisma.orders.count({
        where: {
          AND: [
            {
              obdEmailDate: { gte: histStart, lt: histEnd },
              workflowStage: { in: ["pending_support", "tinting_done"] },
              OR: [
                { arrivalSlotId: slot.id },
                { arrivalSlotId: null, originalSlotId: slot.id },
              ],
              isRemoved: false,
            },
            hideExclusion,
          ],
        },
      });

      const tintingCount = await prisma.orders.count({
        where: {
          AND: [
            {
              obdEmailDate: { gte: histStart, lt: histEnd },
              workflowStage: { in: ["tinting_in_progress", "tint_assigned"] },
              OR: [
                { arrivalSlotId: slot.id },
                { arrivalSlotId: null, originalSlotId: slot.id },
              ],
              isRemoved: false,
            },
            hideExclusion,
          ],
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
        dispatchedCount: 0,
        tintingCount,
      });
    }
  } else {
    // Today: use current slotId with direct DB counts
    const { start: todayStart, end: todayEnd } = getISTDayRange(dateStr);
    slotResults = [];
    for (const slot of slots) {
      const pendingCount = await prisma.orders.count({
        where: {
          arrivalSlotId: slot.id,
          workflowStage: { in: ["pending_support", "tinting_done"] },
          dispatchStatus: null,
          isRemoved: false,
        },
      });

      const dispatchedCount = await prisma.orders.count({
        where: {
          arrivalSlotId: slot.id,
          dispatchStatus: "dispatch",
          isRemoved: false,
          obdEmailDate: { gte: todayStart, lt: todayEnd },
        },
      });

      const tintingCount = await prisma.orders.count({
        where: {
          arrivalSlotId: slot.id,
          workflowStage: { in: ["tinting_in_progress", "tint_assigned"] },
          isRemoved: false,
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
    where: { dispatchStatus: "hold", isRemoved: false },
  });

  return NextResponse.json({
    slots: slotResults,
    holdCount,
    doneCount,
    date: dateStr,
  });
}
