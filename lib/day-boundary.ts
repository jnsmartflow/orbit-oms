import { prisma } from "@/lib/prisma";

function getTodayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export async function runDailyCleanupIfNeeded(): Promise<void> {
  try {
    const today = getTodayIST();

    // Check last cleanup date
    const config = await prisma.system_config.findUnique({
      where: { key: "last_cleanup_date" },
    });

    if (config && config.value >= today) {
      return; // Already cleaned today
    }

    const todayStart = new Date(today + "T00:00:00+05:30");

    // ── Warehouse cleanup ────────────────────────────────────────────────
    // Soft-clear stale unfinished pick assignments from previous days
    await prisma.pick_assignments.updateMany({
      where: {
        status: "assigned",
        assignedAt: { lt: todayStart },
        clearedAt: null,
      },
      data: { clearedAt: new Date() },
    });

    // ── Dispatcher cleanup ───────────────────────────────────────────────
    // Find draft plans from previous days
    const staleDraftPlans = await prisma.dispatch_plans.findMany({
      where: {
        status: "draft",
        planDate: { lt: todayStart },
      },
      select: { id: true },
    });

    // Soft-clear orders from those draft plans
    if (staleDraftPlans.length > 0) {
      await prisma.dispatch_plan_orders.updateMany({
        where: {
          planId: { in: staleDraftPlans.map((p) => p.id) },
          clearedAt: null,
        },
        data: { clearedAt: new Date() },
      });
    }

    // Soft-clear orders from confirmed/loading plans from previous days
    // so they appear unassigned in today's view, but history still shows them
    const staleActivePlans = await prisma.dispatch_plans.findMany({
      where: {
        status: { in: ["confirmed", "loading"] },
        planDate: { lt: todayStart },
      },
      select: { id: true },
    });

    if (staleActivePlans.length > 0) {
      await prisma.dispatch_plan_orders.updateMany({
        where: {
          planId: { in: staleActivePlans.map((p) => p.id) },
          clearedAt: null,
        },
        data: { clearedAt: new Date() },
      });
    }

    // ── Slot reset for carried-over orders ─────────────────────────────
    try {
      const morningSlot = await prisma.slot_master.findFirst({
        where: { sortOrder: 1 },
      });

      if (morningSlot) {
        // Find carried-over orders still in a non-Morning slot
        const carriedOverOrders = await prisma.orders.findMany({
          where: {
            obdEmailDate: { lt: todayStart },
            workflowStage: { notIn: ["dispatched", "cancelled"] },
            slotId: { not: morningSlot.id },
            NOT: { slotId: null },
          },
          select: { id: true, slot: { select: { name: true } } },
        });

        if (carriedOverOrders.length > 0) {
          const orderIds = carriedOverOrders.map((o) => o.id);

          await prisma.orders.updateMany({
            where: { id: { in: orderIds } },
            data: { slotId: morningSlot.id },
          });

          // Audit log for each reset order
          for (const order of carriedOverOrders) {
            await prisma.order_status_logs.create({
              data: {
                orderId: order.id,
                fromStage: order.slot?.name ?? "Unknown",
                toStage: morningSlot.name,
                changedById: 1, // System action
                note: "Day boundary: carried-over order reset to Morning slot",
              },
            });
          }

          console.log(
            `[day-boundary] Reset ${carriedOverOrders.length} carried-over order(s) to Morning slot`,
          );
        }
      }
    } catch (err) {
      console.error("[day-boundary] Slot reset failed:", err);
    }

    // ── Mark cleanup as done ─────────────────────────────────────────────
    await prisma.system_config.upsert({
      where: { key: "last_cleanup_date" },
      update: { value: today },
      create: { key: "last_cleanup_date", value: today },
    });
  } catch (err) {
    console.error("[day-boundary] Cleanup failed:", err);
  }
}
