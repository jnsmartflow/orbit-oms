import { prisma } from "@/lib/prisma";

/**
 * Slot cascade: when a slot's time + grace period passes,
 * auto-move eligible orders to the next open slot.
 * Called from board API routes — must be fast and never throw.
 */
export async function runSlotCascadeIfNeeded(today: string): Promise<void> {
  try {
    // ── 1. Check last cascade time (throttle to every 5 min) ──────────
    const lastCheckConfig = await prisma.system_config.findUnique({
      where: { key: "last_cascade_check" },
    });

    if (lastCheckConfig) {
      const lastCheck = new Date(lastCheckConfig.value);
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (lastCheck > fiveMinAgo) {
        return; // Checked recently, skip
      }
    }

    // ── 2. Load slots ─────────────────────────────────────────────────
    const slots = await prisma.slot_master.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });

    if (slots.length === 0) {
      console.warn("[slot-cascade] No active slots found, skipping");
      return;
    }

    // ── 3. Read grace minutes ─────────────────────────────────────────
    const graceConfig = await prisma.system_config.findUnique({
      where: { key: "slot_cascade_grace_minutes" },
    });
    const graceMinutes = graceConfig ? parseInt(graceConfig.value, 10) || 15 : 15;

    // ── 4. Current IST time ───────────────────────────────────────────
    const nowIST = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    );

    // ── 5. Build slot deadline map ────────────────────────────────────
    // Parse each slot's deadline = today + slotTime + grace
    // Skip isNextDay slots (sortOrder=5) — they refer to tomorrow
    const slotDeadlines: { slot: typeof slots[number]; deadline: Date }[] = [];

    for (const slot of slots) {
      if (slot.isNextDay) continue; // Next Day Morning never cascades within today

      const [hours, minutes] = slot.slotTime.split(":").map(Number);
      const deadline = new Date(today + "T00:00:00+05:30");
      deadline.setHours(hours, minutes + graceMinutes, 0, 0);
      slotDeadlines.push({ slot, deadline });
    }

    // ── 6. Determine closed vs open slots ─────────────────────────────
    const closedSlots = slotDeadlines.filter((s) => nowIST > s.deadline);
    if (closedSlots.length === 0) {
      // No slots have closed yet — update check time and return
      await updateLastCascadeCheck();
      return;
    }

    const openSlots = slotDeadlines.filter((s) => nowIST <= s.deadline);
    // Fallback: if no open same-day slots remain, use Next Day Morning
    const nextDaySlot = slots.find((s) => s.isNextDay);

    // ── 7. Build exclusion set: orders on confirmed/loading/dispatched trips
    const protectedDPOs = await prisma.dispatch_plan_orders.findMany({
      where: {
        clearedAt: null,
        plan: { status: { in: ["confirmed", "loading", "dispatched"] } },
      },
      select: { orderId: true },
    });
    const protectedOrderIds = new Set(protectedDPOs.map((d) => d.orderId));

    // ── 8. Cascade each closed slot ───────────────────────────────────
    let totalCascaded = 0;

    for (const { slot: closedSlot } of closedSlots) {
      // Determine target slot
      const targetSlot =
        openSlots.length > 0 ? openSlots[0].slot : nextDaySlot;

      if (!targetSlot || targetSlot.id === closedSlot.id) continue;

      // Find eligible orders in this closed slot
      const eligible = await prisma.orders.findMany({
        where: {
          slotId: closedSlot.id,
          workflowStage: { notIn: ["dispatched", "cancelled", "hold"] },
        },
        select: { id: true },
      });

      // Filter out protected orders (on confirmed/loading/dispatched trips)
      const orderIds = eligible
        .map((o) => o.id)
        .filter((id) => !protectedOrderIds.has(id));

      if (orderIds.length === 0) continue;

      // Update slot assignment
      await prisma.orders.updateMany({
        where: { id: { in: orderIds } },
        data: { slotId: targetSlot.id },
      });

      // Insert audit logs
      for (const orderId of orderIds) {
        await prisma.order_status_logs.create({
          data: {
            orderId,
            fromStage: closedSlot.name,
            toStage: targetSlot.name,
            changedById: 1, // System action — uses first admin user
            note: `Auto-cascaded from ${closedSlot.name} to ${targetSlot.name}`,
          },
        });
      }

      totalCascaded += orderIds.length;
    }

    // ── 9. Update last check timestamp ────────────────────────────────
    await updateLastCascadeCheck();

    if (totalCascaded > 0) {
      console.log(
        `[slot-cascade] Cascaded ${totalCascaded} order(s) to next slot`,
      );
    }
  } catch (err) {
    console.error("[slot-cascade] Cascade failed:", err);
  }
}

async function updateLastCascadeCheck(): Promise<void> {
  const nowISOString = new Date().toISOString();
  await prisma.system_config.upsert({
    where: { key: "last_cascade_check" },
    update: { value: nowISOString },
    create: { key: "last_cascade_check", value: nowISOString },
  });
}
