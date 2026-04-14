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

export interface SlotCutoffs {
  morning: string;
  afternoon: string;
  evening: string;
}

function parseHHMM(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function getSlotFromTime(
  receivedAt: string,
  cutoffs?: SlotCutoffs,
): "Morning" | "Afternoon" | "Evening" | "Night" {
  const d = new Date(receivedAt);
  const [h, m] = d
    .toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
    .split(":")
    .map(Number);
  const mins = h * 60 + m;

  const morningCutoff = cutoffs ? parseHHMM(cutoffs.morning) : 630;
  const afternoonCutoff = cutoffs ? parseHHMM(cutoffs.afternoon) : 750;
  const eveningCutoff = cutoffs ? parseHHMM(cutoffs.evening) : 930;

  if (mins < morningCutoff) return "Morning";
  if (mins < afternoonCutoff) return "Afternoon";
  if (mins < eveningCutoff) return "Evening";
  return "Night";
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

export const BATCH_COPY_LIMIT = 14;
export const SPLIT_VOLUME_THRESHOLD = 1500; // liters
export const SORT_DISPLAY_THRESHOLD = 5;

// Warehouse zone walk order: deep → dispatch
const ZONE_ORDER: Record<string, number> = {
  putty: 1, oil: 2, wood: 3, water: 4, stainer: 5,
};

const MATERIAL_ORDER: Record<string, number> = {
  enamel: 1, emulsion: 2, waterproofing: 3, primer: 4,
  wood: 5, putty: 6, stainer: 7,
};

function getBaseOrder(baseColour: string | null): number {
  if (!baseColour) return 50;
  const upper = baseColour.toUpperCase().trim();

  if (
    upper === 'BRILLIANT WHITE' ||
    upper === 'WHITE' ||
    upper === '90 BASE' ||
    upper === '00 BASE' ||
    upper.startsWith('90') ||
    upper.startsWith('00')
  ) return 1;

  if (upper === '92 BASE' || upper.startsWith('92')) return 2;
  if (upper === '93 BASE' || upper.startsWith('93')) return 3;
  if (upper === '94 BASE' || upper.startsWith('94')) return 4;
  if (upper === '95 BASE' || upper.startsWith('95')) return 5;
  if (upper === '96 BASE' || upper.startsWith('96')) return 6;
  if (upper === '97 BASE' || upper.startsWith('97')) return 7;
  if (upper === '98 BASE' || upper.startsWith('98')) return 8;

  return 20;
}

export function sortLinesForPicker(lines: MoOrderLine[]): MoOrderLine[] {
  return [...lines].sort((a, b) => {
    // Level 1: paintType — warehouse zone walk order
    const zoneA = ZONE_ORDER[(a.paintType || '').toLowerCase()] ?? 6;
    const zoneB = ZONE_ORDER[(b.paintType || '').toLowerCase()] ?? 6;
    if (zoneA !== zoneB) return zoneA - zoneB;

    // Level 2: packVolume ASC — small packs first, heavy last
    const volA = getPackVolumeLiters(a.packCode);
    const volB = getPackVolumeLiters(b.packCode);
    if (volA === 0 && volB !== 0) return 1;
    if (volA !== 0 && volB === 0) return -1;
    if (volA !== volB) return volA - volB;

    // Level 3: materialType — groups same material on same shelf
    const matA = MATERIAL_ORDER[(a.materialType || '').toLowerCase()] ?? 8;
    const matB = MATERIAL_ORDER[(b.materialType || '').toLowerCase()] ?? 8;
    if (matA !== matB) return matA - matB;

    // Level 4: productName ASC — alphabetical within material type
    const prodA = (a.productName || '').toUpperCase();
    const prodB = (b.productName || '').toUpperCase();
    if (prodA !== prodB) return prodA.localeCompare(prodB);

    // Level 5a: base code order (white → 92 → 93 → ... → 98)
    const baseOrderA = getBaseOrder(a.baseColour);
    const baseOrderB = getBaseOrder(b.baseColour);
    if (baseOrderA !== baseOrderB) return baseOrderA - baseOrderB;

    // Level 5b: alphabetical fallback for same base order group
    const colA = (a.baseColour || '').toUpperCase();
    const colB = (b.baseColour || '').toUpperCase();
    return colA.localeCompare(colB);
  });
}
export const SPLIT_LINE_THRESHOLD = 20;

const MIN_GROUP_LINES = 8;
const DOMINANT_CATEGORY_THRESHOLD = 0.6; // 60% of total volume

interface SplitLine {
  index: number;
  quantity: number;
  packCode: string | null;
  productName: string | null;
  paintType?: string | null;
  materialType?: string | null;
}

interface Block {
  key: string;
  indices: number[];
  volume: number;
  lineCount: number;
  zoneOrder?: number;
}

/**
 * Zone-aware split algorithm.
 *
 * Priority:
 * 1. Zone integrity (two pickers should not visit the same zone)
 * 2. Balance (no group below MIN_GROUP_LINES) — hard constraint
 * 3. Line count / volume balance — nice to have (accept up to 70/30)
 */
export function splitLinesByCategory(
  lines: SplitLine[],
): [number[], number[]] {
  const totalLineCount = lines.length;
  const totalVolume = lines.reduce((s, l) => s + getLineVolume(l.quantity, l.packCode), 0);

  // Sort indices within a group by pack size DESC for picker efficiency
  const sortByPackSize = (indices: number[]) => {
    indices.sort((a, b) => {
      const volA = getPackVolumeLiters(lines[a].packCode);
      const volB = getPackVolumeLiters(lines[b].packCode);
      if (volA === 0 && volB === 0) return 0;
      if (volA === 0) return 1;
      if (volB === 0) return -1;
      if (volB !== volA) return volB - volA;
      return 0;
    });
  };

  // If too few lines to split meaningfully, just do simple halving
  if (totalLineCount < MIN_GROUP_LINES * 2) {
    const mid = Math.ceil(totalLineCount / 2);
    const halfA = lines.slice(0, mid).map(l => l.index);
    const halfB = lines.slice(mid).map(l => l.index);
    sortByPackSize(halfA);
    sortByPackSize(halfB);
    return [halfA, halfB];
  }

  // ── Step 1: Build zone blocks ─────────────────────────────
  const zoneMap = new Map<string, SplitLine[]>();
  for (const line of lines) {
    const zone = (line.paintType || '__unknown__').toLowerCase();
    if (!zoneMap.has(zone)) zoneMap.set(zone, []);
    zoneMap.get(zone)!.push(line);
  }

  const zoneBlocks: Block[] = [];
  Array.from(zoneMap.entries()).forEach(([zone, zoneLines]) => {
    zoneBlocks.push({
      key: zone,
      indices: zoneLines.map((l: SplitLine) => l.index),
      volume: zoneLines.reduce((s: number, l: SplitLine) => s + getLineVolume(l.quantity, l.packCode), 0),
      lineCount: zoneLines.length,
      zoneOrder: ZONE_ORDER[zone] ?? 6,
    });
  });

  // Sort by ZONE_ORDER for boundary split
  zoneBlocks.sort((a, b) => (a.zoneOrder ?? 6) - (b.zoneOrder ?? 6));

  // ── Step 2: Try zone-boundary split ───────────────────────
  // Try splitting between each adjacent zone pair, pick closest to 50/50
  if (zoneBlocks.length >= 2) {
    let bestSplitIdx = -1;
    let bestImbalance = Infinity;

    for (let i = 1; i < zoneBlocks.length; i++) {
      let leftCount = 0;
      for (let j = 0; j < i; j++) leftCount += zoneBlocks[j].lineCount;
      const ratio = Math.max(leftCount, totalLineCount - leftCount) / totalLineCount;
      // Accept up to 70/30 imbalance
      if (ratio <= 0.70) {
        const imbalance = Math.abs(leftCount - (totalLineCount - leftCount));
        if (imbalance < bestImbalance) {
          bestImbalance = imbalance;
          bestSplitIdx = i;
        }
      }
    }

    if (bestSplitIdx > 0) {
      const groupA: number[] = [];
      const groupB: number[] = [];
      for (let i = 0; i < zoneBlocks.length; i++) {
        if (i < bestSplitIdx) {
          groupA.push(...zoneBlocks[i].indices);
        } else {
          groupB.push(...zoneBlocks[i].indices);
        }
      }

      // Guard rail: min lines per group
      const cA = groupA.length;
      const cB = groupB.length;
      if (cA >= MIN_GROUP_LINES && cB >= MIN_GROUP_LINES) {
        sortByPackSize(groupA);
        sortByPackSize(groupB);
        return [groupA, groupB];
      }
      // Fall through to Step 3 if guard rail fails
    }
  }

  // ── Step 3: Dominant zone — split within it ───────────────
  // Find the largest zone
  const dominantZone = zoneBlocks.reduce((max, z) => z.lineCount > max.lineCount ? z : max, zoneBlocks[0]);
  const dominantRatio = dominantZone.lineCount / totalLineCount;

  if (dominantRatio > 0.75) {
    // Split within the dominant zone by materialType
    const domLines = lines.filter(l => (l.paintType || '__unknown__').toLowerCase() === dominantZone.key);
    const nonDomIndices: number[] = [];
    for (const zb of zoneBlocks) {
      if (zb.key !== dominantZone.key) nonDomIndices.push(...zb.indices);
    }

    // Build sub-blocks by materialType within dominant zone
    const matMap = new Map<string, SplitLine[]>();
    for (const line of domLines) {
      const mt = (line.materialType || '__unknown__').toLowerCase();
      if (!matMap.has(mt)) matMap.set(mt, []);
      matMap.get(mt)!.push(line);
    }

    const domVolume = domLines.reduce((s, l) => s + getLineVolume(l.quantity, l.packCode), 0);
    const subBlocks: Block[] = [];

    Array.from(matMap.entries()).forEach(([mt, mtLines]) => {
      const mtVolume = mtLines.reduce((s: number, l: SplitLine) => s + getLineVolume(l.quantity, l.packCode), 0);

      // Sub-split dominant materialType by packCode
      if (mtVolume > domVolume * DOMINANT_CATEGORY_THRESHOLD && mtLines.length > MIN_GROUP_LINES) {
        const packMap = new Map<string, SplitLine[]>();
        for (const line of mtLines) {
          const pk = line.packCode || '__nopack__';
          if (!packMap.has(pk)) packMap.set(pk, []);
          packMap.get(pk)!.push(line);
        }
        Array.from(packMap.entries()).forEach(([pk, pkLines]) => {
          subBlocks.push({
            key: `${mt}|${pk}`,
            indices: pkLines.map((l: SplitLine) => l.index),
            volume: pkLines.reduce((s: number, l: SplitLine) => s + getLineVolume(l.quantity, l.packCode), 0),
            lineCount: pkLines.length,
          });
        });
      } else {
        subBlocks.push({
          key: mt,
          indices: mtLines.map((l: SplitLine) => l.index),
          volume: mtVolume,
          lineCount: mtLines.length,
        });
      }
    });

    // Weighted bin-pack the sub-blocks
    subBlocks.sort((a, b) => b.volume - a.volume);
    let groupA: number[] = [];
    let groupB: number[] = [];
    let volA = 0;
    let volB = 0;
    let countA = 0;
    let countB = 0;

    for (const block of subBlocks) {
      const scoreA = totalVolume > 0
        ? 0.5 * (volA / totalVolume) + 0.5 * (countA / totalLineCount)
        : countA / totalLineCount;
      const scoreB = totalVolume > 0
        ? 0.5 * (volB / totalVolume) + 0.5 * (countB / totalLineCount)
        : countB / totalLineCount;

      if (scoreA <= scoreB) {
        groupA.push(...block.indices);
        volA += block.volume;
        countA += block.lineCount;
      } else {
        groupB.push(...block.indices);
        volB += block.volume;
        countB += block.lineCount;
      }
    }

    // Assign non-dominant zone lines to the group with fewer lines
    if (nonDomIndices.length > 0) {
      if (countA <= countB) {
        groupA.push(...nonDomIndices);
        countA += nonDomIndices.length;
      } else {
        groupB.push(...nonDomIndices);
        countB += nonDomIndices.length;
      }
    }

    // Guard rail
    if (countA >= MIN_GROUP_LINES && countB >= MIN_GROUP_LINES) {
      sortByPackSize(groupA);
      sortByPackSize(groupB);
      return [groupA, groupB];
    }
    // Fall through to Step 4 if guard rail fails
  }

  // ── Step 4: General weighted bin-pack on zone blocks ──────
  // (multi-zone, no clean boundary found, or dominant zone guard rail failed)
  zoneBlocks.sort((a, b) => b.volume - a.volume);

  let groupA: number[] = [];
  let groupB: number[] = [];
  let volA = 0;
  let volB = 0;
  let countA = 0;
  let countB = 0;

  for (const block of zoneBlocks) {
    const scoreA = totalVolume > 0
      ? 0.5 * (volA / totalVolume) + 0.5 * (countA / totalLineCount)
      : countA / totalLineCount;
    const scoreB = totalVolume > 0
      ? 0.5 * (volB / totalVolume) + 0.5 * (countB / totalLineCount)
      : countB / totalLineCount;

    if (scoreA <= scoreB) {
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
    zoneBlocks.sort((a, b) => b.lineCount - a.lineCount);

    groupA = [];
    groupB = [];
    countA = 0;
    countB = 0;
    volA = 0;
    volB = 0;

    for (const block of zoneBlocks) {
      const scoreA = totalVolume > 0
        ? 0.5 * (volA / totalVolume) + 0.5 * (countA / totalLineCount)
        : countA / totalLineCount;
      const scoreB = totalVolume > 0
        ? 0.5 * (volB / totalVolume) + 0.5 * (countB / totalLineCount)
        : countB / totalLineCount;

      if (scoreA <= scoreB) {
        groupA.push(...block.indices);
        countA += block.lineCount;
        volA += block.volume;
      } else {
        groupB.push(...block.indices);
        countB += block.lineCount;
        volB += block.volume;
      }
    }

    // Nuclear fallback: simple halving
    if (countA < MIN_GROUP_LINES || countB < MIN_GROUP_LINES) {
      const allIndices = lines.map(l => l.index);
      const mid = Math.ceil(allIndices.length / 2);
      const fallbackA = allIndices.slice(0, mid);
      const fallbackB = allIndices.slice(mid);
      sortByPackSize(fallbackA);
      sortByPackSize(fallbackB);
      return [fallbackA, fallbackB];
    }
  }

  sortByPackSize(groupA);
  sortByPackSize(groupB);

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

export function groupOrdersBySlot(
  orders: MoOrder[],
  cutoffs?: SlotCutoffs,
): Record<string, MoOrder[]> {
  const groups: Record<string, MoOrder[]> = {};

  const sorted = [...orders].sort(
    (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
  );

  for (const order of sorted) {
    const slot = getSlotFromTime(order.receivedAt, cutoffs);
    if (!groups[slot]) groups[slot] = [];
    groups[slot].push(order);
  }

  // Sort within each slot: time → bill number → split label
  const getBillNumber = (order: MoOrder): number => {
    const match = order.remarks?.match(/^Bill\s+(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  };

  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => {
      const timeA = new Date(a.receivedAt).getTime();
      const timeB = new Date(b.receivedAt).getTime();
      if (timeA !== timeB) return timeA - timeB;

      // Within same time: sort by bill number
      const billA = getBillNumber(a);
      const billB = getBillNumber(b);
      if (billA !== billB) return billA - billB;

      // Within same bill: split pairs — A before B
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

const OD_CI_PATTERNS = [
  /\bOD\b/i,
  /\bCI\b/i,
  /\bcredit\s*hold\b/i,
  /\bblock\b/i,
  /\boverdue\b/i,
  /\bbill\s*tomorrow\b/i,
];

export function isOdCiFlagged(order: MoOrder): boolean {
  const fields = [
    order.remarks,
    order.subject,
    order.billRemarks,
  ].filter(Boolean).join(' ');

  return OD_CI_PATTERNS.some(pattern => pattern.test(fields));
}

// ── Clean subject for display ──────────────────────────────────────────────

export function cleanSubject(subject: string): string {
  let s = subject;
  // Strip forwarding prefixes
  s = s.replace(/^(?:(?:fw|fwd|re)\s*:\s*)+/i, "");
  // Strip leading "Urgent"
  s = s.replace(/^urgent\s+/i, "");
  // Strip Order prefix patterns
  s = s.replace(/^Order\s*:\s*/i, "");
  s = s.replace(/^Order\s+for\s+/i, "");
  s = s.replace(/^Order-\d+\s*/i, "");
  s = s.replace(/^Order\s+-\s*/i, "");   // "Order -Name" space-dash
  s = s.replace(/^Order-[a-z]+\s+/i, ""); // "Order-aai", "Order-i" letter prefix
  s = s.replace(/^Order\s+/i, "");
  // Strip leading code digits
  s = s.replace(/^\d{4,}\s*/, "");
  // Strip trailing noise
  s = s.replace(/\s*[-\u2013]\s*(truck\s*order|truck)\s*$/i, ""); // "- Truck Order", "- Truck"
  s = s.replace(/\s*\(truck\s*order\)\s*/gi, "");            // "(truck order)"
  s = s.replace(/\s*\(\d{4,}\)\s*/g, "");                   // "(106058)"
  s = s.replace(/\s+\d{4,}$/, "");                          // trailing code
  s = s.replace(/\s*-\s*order$/i, "");
  s = s.replace(/\.+$/, "");
  // Strip trailing customer code with dash e.g. "Shree Khodiyar-549434"
  s = s.replace(/-\d{4,}$/, "");
  return s.trim() || subject.trim();
}

// ── Order flag extraction ──────────────────────────────────────────────────

export function getOrderFlags(order: MoOrder): string[] {
  const combined = [
    order.remarks,
    order.billRemarks,
    order.deliveryRemarks,
  ].filter(Boolean).join(' ');

  const flags: string[] = [];
  if (/\b(od|overdue)\b/i.test(combined)) flags.push("OD");
  if (/\b(ci|credit\s*(hold|block|issue))\b/i.test(combined)) flags.push("CI");
  if (/\bbounce\b/i.test(combined)) flags.push("Bounce");
  if (flags.length === 0 && order.dispatchStatus === "Hold") flags.push("Hold");
  return flags;
}

// ── Order signal extraction (shared by Table View + Review View) ───────────

export interface OrderSignal {
  label: string;
  type: "blocker" | "attention" | "info" | "split";
  dot?: string;
}

export function getOrderSignals(
  order: MoOrder,
  opts?: { isPunched?: boolean },
): OrderSignal[] {
  const result: OrderSignal[] = [];
  const combined = [order.remarks, order.billRemarks, order.deliveryRemarks]
    .filter(Boolean).join(" ").toLowerCase();

  // ── BLOCKER (red) ──
  if (/\b(od|overdue)\b/.test(combined))
    result.push({ label: "OD", type: "blocker" });
  if (/\b(ci|credit\s*(hold|block|issue))\b/.test(combined))
    result.push({ label: "CI", type: "blocker" });
  if (/\bbounce\b/.test(combined))
    result.push({ label: "Bounce", type: "blocker" });

  // ── ATTENTION (amber) ──
  if (/bill\s*tomorrow/.test(combined))
    result.push({ label: "Bill Tomorrow", type: "attention" });
  if (/cross\s*billing/.test(combined)) {
    const code = combined.match(/cross\s*billing\s*(\w+)/);
    result.push({ label: code ? `Cross ${code[1].toUpperCase()}` : "Cross", type: "attention" });
  }
  if (order.shipToOverride)
    result.push({ label: "\u2192 Ship-to", type: "attention" });
  if (order.dispatchPriority === "Urgent")
    result.push({ label: "Urgent", type: "attention" });

  // ── INFO (gray) ──
  if (/7\s*days/.test(combined))
    result.push({ label: "7 Days", type: "info" });
  if (/\bextension\b/.test(combined) && !/bill\s*tomorrow/.test(combined))
    result.push({ label: "Extension", type: "info" });
  const billMatches = Array.from(combined.matchAll(/\bbill\s+(\d+)\b/g));
  const billNums = Array.from(new Set(billMatches.map(m => parseInt(m[1])))).sort((a, b) => a - b);
  for (const n of billNums) {
    result.push({ label: `Bill ${n}`, type: "info" });
  }
  if (/dpl/.test(combined))
    result.push({ label: "DPL", type: "info" });
  if (/challan\s*attachment/.test(combined))
    result.push({ label: "Challan", type: "info" });
  if (/\btruck\b/i.test([order.subject, order.billRemarks, order.remarks].filter(Boolean).join(" ")))
    result.push({ label: "Truck", type: "info" });

  // ── SPLIT (purple) ──
  if (order.splitLabel)
    result.push({ label: `\u2702 ${order.splitLabel}`, type: "split" });
  const totalVol = getOrderVolume(order.lines);
  if (!order.splitLabel && !opts?.isPunched &&
      (totalVol > SPLIT_VOLUME_THRESHOLD || order.totalLines > SPLIT_LINE_THRESHOLD))
    result.push({ label: "\u26A0 Split", type: "split", dot: "bg-amber-400" });

  return result;
}

// ── Reply template builder ─────────────────────────────────────────────────

export function buildReplyTemplate(
  soName: string,
  orders: {
    customerName: string;
    customerCode: string | null;
    area: string | null;
    soNumber: string;
    flags: string[];
  }[],
  senderName: string = "Deepanshu",
  companyLine: string = "JSW Dulux Ltd \u2014 Surat Depot",
): string {
  // Full SO name (strip JSW prefix)
  const fullName = smartTitleCase(soName.replace(/^\([^)]*\)\s*/, "").trim());

  const clean = orders.filter(o => o.flags.length === 0);
  const flagged = orders.filter(o => o.flags.length > 0);

  const lines: string[] = [];
  lines.push(`Dear ${fullName},`);
  lines.push("");

  if (orders.length === 1) {
    // Single order — detail card format
    const o = orders[0];
    lines.push("Following order has been processed:");
    lines.push("");
    lines.push(`  Customer  :  ${o.customerName}`);
    if (o.customerCode) lines.push(`  Code      :  ${o.customerCode}`);
    if (o.area) lines.push(`  Area      :  ${smartTitleCase(o.area)}`);
    lines.push(`  SO No.    :  ${o.soNumber}`);
    if (o.flags.length > 0) {
      lines.push(`  Status    :  ${o.flags.join(", ")} (Hold)`);
    }
    lines.push("");
    if (flagged.length > 0) {
      lines.push("Please arrange clearance at earliest.");
      lines.push("");
    }
  } else {
    // Multi order — numbered list
    lines.push("Following orders have been processed:");
    lines.push("");

    let num = 0;
    for (const o of clean) {
      num++;
      let first = `  ${num}. ${o.customerName}`;
      if (o.customerCode) first += ` (${o.customerCode})`;
      lines.push(first);
      const secondParts: string[] = [];
      if (o.area) secondParts.push(smartTitleCase(o.area));
      secondParts.push(`SO ${o.soNumber}`);
      lines.push(`     ${secondParts.join(" \u00b7 ")}`);
      lines.push("");
    }

    if (flagged.length > 0) {
      lines.push("Action required:");
      lines.push("");
      for (const o of flagged) {
        num++;
        let first = `  ${num}. ${o.customerName}`;
        if (o.customerCode) first += ` (${o.customerCode})`;
        lines.push(first);
        const secondParts: string[] = [];
        if (o.area) secondParts.push(smartTitleCase(o.area));
        secondParts.push(`SO ${o.soNumber} \u2014 ${o.flags.join(", ")} (Hold)`);
        lines.push(`     ${secondParts.join(" \u00b7 ")}`);
        lines.push("");
      }
    }

    if (flagged.length > 0) {
      lines.push(`Total: ${orders.length} orders (${flagged.length} on hold)`);
    } else {
      lines.push(`Total: ${orders.length} orders`);
    }
    lines.push("");
  }

  lines.push("Regards,");
  lines.push(senderName);
  lines.push(companyLine);

  return lines.join("\n");
}
