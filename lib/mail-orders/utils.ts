import type { MoOrderLine, MoOrder } from "./types";

export function getSlotFromTime(
  receivedAt: string,
): "Morning" | "Afternoon" | "Evening" | "Night" {
  const d = new Date(receivedAt);
  const [h, m] = d
    .toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
    .split(":")
    .map(Number);
  const mins = h * 60 + m;
  if (mins < 630) return "Morning";       // before 10:30
  if (mins < 810) return "Afternoon";     // 10:30–13:30
  if (mins < 990) return "Evening";       // 13:30–16:30
  return "Night";                          // after 16:30
}

export function formatTime(receivedAt: string): string {
  const d = new Date(receivedAt);
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function buildClipboardText(lines: MoOrderLine[]): string {
  return lines
    .filter((l) => l.matchStatus === "matched" && l.skuCode != null)
    .map((l) => `${l.skuCode}\t${l.quantity}`)
    .join("\n");
}

function getDispatchSortWeight(order: MoOrder): number {
  const isHold = order.dispatchStatus === "Hold";
  const isUrgent = order.dispatchPriority === "Urgent";
  if (isHold && isUrgent) return 0;
  if (isUrgent) return 1;
  if (isHold) return 2;
  return 3;
}

export function groupOrdersBySlot(
  orders: MoOrder[],
): Record<string, MoOrder[]> {
  const groups: Record<string, MoOrder[]> = {};

  const sorted = [...orders].sort(
    (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
  );

  for (const order of sorted) {
    const slot = getSlotFromTime(order.receivedAt);
    if (!groups[slot]) groups[slot] = [];
    groups[slot].push(order);
  }

  // Sort within each slot: urgent/hold first, then by time (stable)
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => getDispatchSortWeight(a) - getDispatchSortWeight(b));
  }

  // Return keys in fixed order, only if they have orders
  const result: Record<string, MoOrder[]> = {};
  for (const key of ["Morning", "Afternoon", "Evening", "Night"] as const) {
    if (groups[key]) result[key] = groups[key];
  }
  return result;
}

const OD_CI_KEYWORDS = ["od", "ci", "credit hold", "block", "overdue"];

export function isOdCiFlagged(order: MoOrder): boolean {
  const fields = [order.remarks?.toLowerCase(), order.subject?.toLowerCase()];
  return fields.some(
    (f) => f != null && OD_CI_KEYWORDS.some((kw) => f.includes(kw)),
  );
}
