import type { MoOrderLine, MoOrder } from "./types";

// ── Pack volume map ─────────────────────────────────────────────────────────

const PACK_VOLUME_LITERS: Record<string, number> = {
  '0.2': 0.2,
  '0.5': 0.5,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '10': 10,
  '15': 15,
  '20': 20,
  '22': 22,
  '25': 25,
  '30': 30,
  '40': 40,
  '50': 50,
  '100': 0.1,
  '200': 0.2,
  '250': 0.25,
  '400': 0.4,
  '500': 0.5,
};

export function getPackVolumeLiters(packCode: string | null | undefined): number {
  if (!packCode) return 0;
  const raw = packCode.trim();

  // 1. Direct lookup (covers mo_sku_lookup numeric values)
  if (PACK_VOLUME_LITERS[raw] !== undefined) return PACK_VOLUME_LITERS[raw];

  // 2. Handle suffixed values from mo_order_lines (e.g. "500ml", "200ml", "25kg")
  const mlMatch = raw.match(/^(\d+(?:\.\d+)?)\s*ml$/i);
  if (mlMatch) return parseFloat(mlMatch[1]) / 1000;

  const lMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(?:l|ltr|lt|litt)$/i);
  if (lMatch) {
    const val = parseFloat(lMatch[1]);
    // Use the explicit map if the numeric part matches
    if (PACK_VOLUME_LITERS[lMatch[1]] !== undefined) return PACK_VOLUME_LITERS[lMatch[1]];
    return val;
  }

  // 3. kg → skip (can't convert weight to volume without density)
  const kgMatch = raw.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
  if (kgMatch) return 0;

  // 4. Try parsing as plain number (fallback)
  const num = parseFloat(raw);
  if (!isNaN(num) && PACK_VOLUME_LITERS[String(num)] !== undefined) {
    return PACK_VOLUME_LITERS[String(num)];
  }

  return 0;
}

export function getLineVolume(quantity: number, packCode: string | null | undefined): number {
  return quantity * getPackVolumeLiters(packCode);
}

export function getOrderVolume(lines: MoOrderLine[]): number {
  return lines.reduce((sum, l) => sum + getLineVolume(l.quantity, l.packCode), 0);
}

export function formatVolume(liters: number): string {
  if (liters <= 0) return '';
  if (liters < 1) return `${Math.round(liters * 1000)}ml`;
  return `${Math.round(liters)}L`;
}

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

export const BATCH_COPY_LIMIT = 20;
export const SPLIT_VOLUME_THRESHOLD = 1500; // liters

/**
 * Greedy bin-packing: split lines into two groups by volume.
 * Lines are ATOMIC — never split at unit level.
 * Returns [groupA_indices, groupB_indices] referencing the input array positions.
 */
export function splitLinesByVolume(
  lines: Array<{ index: number; quantity: number; packCode: string | null }>,
): [number[], number[]] {
  const withVolume = lines.map((l) => ({
    index: l.index,
    volume: getLineVolume(l.quantity, l.packCode),
  }));

  // Sort by volume DESC (greedy bin-packing — largest first)
  withVolume.sort((a, b) => b.volume - a.volume);

  const groupA: number[] = [];
  const groupB: number[] = [];
  let volA = 0;
  let volB = 0;

  for (const item of withVolume) {
    if (volA <= volB) {
      groupA.push(item.index);
      volA += item.volume;
    } else {
      groupB.push(item.index);
      volB += item.volume;
    }
  }

  return [groupA, groupB];
}

export function buildClipboardText(lines: MoOrderLine[]): string {
  return lines
    .filter((l) => l.matchStatus === "matched" && l.skuCode != null)
    .map((l) => `${l.skuCode}\t${l.quantity}`)
    .join("\n");
}

export function buildBatchClipboardText(
  lines: MoOrderLine[],
  batchIndex: number,
): { text: string; totalBatches: number; batchStart: number; batchEnd: number } {
  const matched = lines.filter((l) => l.matchStatus === "matched" && l.skuCode != null);
  const totalBatches = Math.ceil(matched.length / BATCH_COPY_LIMIT);

  if (totalBatches <= 1) {
    return {
      text: matched.map((l) => `${l.skuCode}\t${l.quantity}`).join("\n"),
      totalBatches: 1,
      batchStart: 1,
      batchEnd: matched.length,
    };
  }

  const start = batchIndex * BATCH_COPY_LIMIT;
  const end = Math.min(start + BATCH_COPY_LIMIT, matched.length);
  const batch = matched.slice(start, end);

  return {
    text: batch.map((l) => `${l.skuCode}\t${l.quantity}`).join("\n"),
    totalBatches,
    batchStart: start + 1,
    batchEnd: end,
  };
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

  // Sort within each slot: urgent/hold first, then by time (stable), split pairs adjacent
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => {
      const weightA = getDispatchSortWeight(a);
      const weightB = getDispatchSortWeight(b);
      if (weightA !== weightB) return weightA - weightB;

      // Within same dispatch weight, group split pairs
      const splitGroupA = a.splitFromId ?? (a.splitLabel ? a.id : Infinity);
      const splitGroupB = b.splitFromId ?? (b.splitLabel ? b.id : Infinity);
      if (splitGroupA !== splitGroupB) return splitGroupA - splitGroupB;

      // Within same split group, A before B
      if (a.splitLabel && b.splitLabel) {
        return a.splitLabel.localeCompare(b.splitLabel);
      }

      return 0;
    });
  }

  // Return keys in fixed order, only if they have orders
  const result: Record<string, MoOrder[]> = {};
  for (const key of ["Morning", "Afternoon", "Evening", "Night"] as const) {
    if (groups[key]) result[key] = groups[key];
  }
  return result;
}

const KEEP_UPPER = new Set([
  "CO", "CO.", "LLP", "PVT", "LTD", "PVT.", "LTD.",
  "II", "III", "IV",
  "HW", "H/W",
  "JSW", "SAP", "OBD", "IGT", "UPC",
]);

const KEEP_LOWER = new Set([
  "and", "of", "the", "for", "in", "at", "to", "by",
  "an", "or", "on", "with",
]);

export function smartTitleCase(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .split(/\s+/)
    .map((word, index) => {
      const upper = word.toUpperCase();
      const lower = word.toLowerCase();
      if (KEEP_UPPER.has(upper)) return upper;
      if (/[\/&]/.test(word) && word.length <= 5) return upper;
      if (index > 0 && KEEP_LOWER.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

const OD_CI_KEYWORDS = ["od", "ci", "credit hold", "block", "overdue"];

export function isOdCiFlagged(order: MoOrder): boolean {
  const fields = [order.remarks?.toLowerCase(), order.subject?.toLowerCase()];
  return fields.some(
    (f) => f != null && OD_CI_KEYWORDS.some((kw) => f.includes(kw)),
  );
}
