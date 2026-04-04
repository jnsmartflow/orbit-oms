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
export const SPLIT_LINE_THRESHOLD = 20;

const MIN_GROUP_LINES = 8;
const DOMINANT_CATEGORY_THRESHOLD = 0.6; // 60% of total volume

interface SplitLine {
  index: number;
  quantity: number;
  packCode: string | null;
  productName: string | null;
}

interface Block {
  key: string;
  indices: number[];
  volume: number;
  lineCount: number;
}

/**
 * Category-first split algorithm.
 *
 * Priority order:
 * 1. Balance (no group below MIN_GROUP_LINES) — hard constraint
 * 2. Category grouping (keep same-product lines together) — soft preference
 * 3. Volume balance — nice to have
 */
export function splitLinesByCategory(
  lines: SplitLine[],
): [number[], number[]] {
  const totalLines = lines.length;

  // If too few lines to split meaningfully, just do simple halving
  if (totalLines < MIN_GROUP_LINES * 2) {
    const mid = Math.ceil(totalLines / 2);
    return [
      lines.slice(0, mid).map(l => l.index),
      lines.slice(mid).map(l => l.index),
    ];
  }

  // ── Step 1: Group by productName ──────────────────────────
  const categoryMap = new Map<string, SplitLine[]>();
  for (const line of lines) {
    const cat = line.productName || '__unknown__';
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(line);
  }

  // ── Step 2: Build blocks ──────────────────────────────────
  const totalVolume = lines.reduce((s, l) => s + getLineVolume(l.quantity, l.packCode), 0);
  const blocks: Block[] = [];

  Array.from(categoryMap.entries()).forEach(([cat, catLines]) => {
    const catVolume = catLines.reduce((s: number, l: SplitLine) => s + getLineVolume(l.quantity, l.packCode), 0);

    // If this category dominates (>60% of total volume), sub-split by packCode
    if (catVolume > totalVolume * DOMINANT_CATEGORY_THRESHOLD && catLines.length > MIN_GROUP_LINES) {
      const packMap = new Map<string, SplitLine[]>();
      for (const line of catLines) {
        const pk = line.packCode || '__nopack__';
        if (!packMap.has(pk)) packMap.set(pk, []);
        packMap.get(pk)!.push(line);
      }
      Array.from(packMap.entries()).forEach(([pk, pkLines]) => {
        blocks.push({
          key: `${cat}|${pk}`,
          indices: pkLines.map((l: SplitLine) => l.index),
          volume: pkLines.reduce((s: number, l: SplitLine) => s + getLineVolume(l.quantity, l.packCode), 0),
          lineCount: pkLines.length,
        });
      });
    } else {
      blocks.push({
        key: cat,
        indices: catLines.map((l: SplitLine) => l.index),
        volume: catVolume,
        lineCount: catLines.length,
      });
    }
  });

  // ── Step 3: Sort blocks by volume DESC ────────────────────
  blocks.sort((a, b) => b.volume - a.volume);

  // ── Step 4: Greedy bin-pack at block level ────────────────
  let groupA: number[] = [];
  let groupB: number[] = [];
  let volA = 0;
  let volB = 0;
  let countA = 0;
  let countB = 0;

  for (const block of blocks) {
    if (volA <= volB) {
      groupA.push(...block.indices);
      volA += block.volume;
      countA += block.lineCount;
    } else {
      groupB.push(...block.indices);
      volB += block.volume;
      countB += block.lineCount;
    }
  }

  // ── Step 5: Guard rail — rebalance if either group < 8 lines ─
  if (countA < MIN_GROUP_LINES || countB < MIN_GROUP_LINES) {
    // Re-sort blocks by line count DESC for better distribution
    blocks.sort((a, b) => b.lineCount - a.lineCount);

    groupA = [];
    groupB = [];
    countA = 0;
    countB = 0;
    volA = 0;
    volB = 0;

    for (const block of blocks) {
      if (countA <= countB) {
        groupA.push(...block.indices);
        countA += block.lineCount;
        volA += block.volume;
      } else {
        groupB.push(...block.indices);
        countB += block.lineCount;
        volB += block.volume;
      }
    }

    // If STILL unbalanced, nuclear fallback: interleave
    if (countA < MIN_GROUP_LINES || countB < MIN_GROUP_LINES) {
      const allIndices = lines.map(l => l.index);
      const mid = Math.ceil(allIndices.length / 2);
      return [allIndices.slice(0, mid), allIndices.slice(mid)];
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

  // Sort within each slot: dispatch weight → time → split label (A before B)
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => {
      const weightA = getDispatchSortWeight(a);
      const weightB = getDispatchSortWeight(b);
      if (weightA !== weightB) return weightA - weightB;

      const timeA = new Date(a.receivedAt).getTime();
      const timeB = new Date(b.receivedAt).getTime();
      if (timeA !== timeB) return timeA - timeB;

      // Within same time: split pairs — A before B
      const labelA = a.splitLabel || '';
      const labelB = b.splitLabel || '';
      return labelA.localeCompare(labelB);
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
