import { prisma } from "@/lib/prisma";

/**
 * Reconstruct the slot name an order was in at the end of a given IST day.
 *
 * Looks at order_status_logs for slot-change entries (cascade, manual assign,
 * day boundary) that occurred on or before the end of that day.
 * Falls back to orders.originalSlotId if no log entries exist.
 */
export async function getSlotNameAtEndOfDay(
  orderId: number,
  dateIST: string,
): Promise<string | null> {
  // IST 23:59:59 = UTC 18:29:59 same day
  const endOfDayUTC = new Date(dateIST + "T18:29:59.000Z");

  const log = await prisma.order_status_logs.findFirst({
    where: {
      orderId,
      createdAt: { lte: endOfDayUTC },
      OR: [
        { note: { startsWith: "Auto-cascaded" } },
        { note: { startsWith: "Slot manually assigned" } },
        { note: { startsWith: "Day boundary" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { toStage: true },
  });

  if (log) return log.toStage;

  // Fall back to originalSlotId
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    select: {
      originalSlot: { select: { name: true } },
    },
  });

  return order?.originalSlot?.name ?? null;
}

/**
 * Batch version: reconstruct slot names for multiple orders at end of a given
 * IST day. Returns Map<orderId, slotName | null>.
 */
export async function getSlotNamesAtEndOfDay(
  orderIds: number[],
  dateIST: string,
): Promise<Map<number, string | null>> {
  const result = new Map<number, string | null>();
  if (orderIds.length === 0) return result;

  const endOfDayUTC = new Date(dateIST + "T18:29:59.000Z");

  // Fetch all matching slot-change logs for these orders up to end of day,
  // ordered by createdAt DESC so the first per orderId is the latest
  const logs = await prisma.order_status_logs.findMany({
    where: {
      orderId: { in: orderIds },
      createdAt: { lte: endOfDayUTC },
      OR: [
        { note: { startsWith: "Auto-cascaded" } },
        { note: { startsWith: "Slot manually assigned" } },
        { note: { startsWith: "Day boundary" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { orderId: true, toStage: true },
  });

  // Take the first (most recent) log entry per orderId
  for (const log of logs) {
    if (!result.has(log.orderId)) {
      result.set(log.orderId, log.toStage);
    }
  }

  // Find orders that had no log entries — fall back to originalSlotId
  const missingIds = orderIds.filter((id) => !result.has(id));

  if (missingIds.length > 0) {
    const orders = await prisma.orders.findMany({
      where: { id: { in: missingIds } },
      select: {
        id: true,
        originalSlot: { select: { name: true } },
      },
    });

    for (const order of orders) {
      result.set(order.id, order.originalSlot?.name ?? null);
    }
  }

  // Ensure all requested IDs are in the map (even if not found at all)
  for (const id of orderIds) {
    if (!result.has(id)) {
      result.set(id, null);
    }
  }

  return result;
}
