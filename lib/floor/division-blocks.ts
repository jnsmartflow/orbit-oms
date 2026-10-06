// Floor Control — DIVISION BANDS + SHIP-TO BLOCKS for the open route card
// (2026-10-06, owner; design: docs/mockups/floor-trips/floor-division-blocks-final.html).
//
// PURE. No Prisma, no I/O, no React. It only regroups rows the board already
// carries; nothing here reads, writes or decides what the pool is.
//
// Inside one route section of OpenPanel (components/floor/route-cards.tsx) the
// DUE, non-Hand bills are split into:
//   bands   one per division, in the fixed order 70 → 77 → 74 → Other, drawn
//           only when they hold a bill;
//   blocks  one per STOP inside a band — `row.stopKey`, the trip module's own
//           stop identity (lib/trips/drop-key.ts), so a block holds exactly the
//           bills one trip drop would. Compared for EQUALITY ONLY — never parse
//           the key (drop-key.ts explains the two id spaces).
//
// ⚠ A ship-to with bills in two divisions is a block in BOTH bands (owner).
// That is why a band carries no stop count — the route heading keeps the one
// true stop count.
//
// ⚠ TOTALS ARE NOT COMPUTED HERE. The caller sums each band's / block's `rows`
// with the floor's own helpers (sumLitres / sumWeightKg / kgText), so a band and
// its route heading can never disagree about a kilo. Hand and upcoming bills
// never reach this module (they keep their own list under the route section).

import { sortPickingQueue } from "@/lib/picking/sort";
import { FLOOR_SPINE } from "@/lib/floor/sort";
import type { FloorBoardRow } from "@/lib/floor/types";

export type DivisionKey = "70" | "77" | "74" | "other";

/** Band order (owner): Deco Retail → Retail Offtake → Decorative Projects → Other. */
export const DIVISION_ORDER: readonly DivisionKey[] = ["70", "77", "74", "other"];

export const DIVISION_NAME: Record<DivisionKey, string> = {
  "70": "Deco Retail",
  "77": "Retail Offtake",
  "74": "Decorative Projects",
  other: "Other divisions",
};

/**
 * The band a bill sits in, by `smuCode` — derived server-side from `orders.smu`
 * through SMU_CODE_BY_NAME (lib/floor/queries.ts). "76", "10" ("Deco") and null
 * (no SMU, or a name not in the map) all land in Other.
 */
export function divisionOf(row: Pick<FloorBoardRow, "smuCode">): DivisionKey {
  const c = row.smuCode;
  return c === "70" || c === "77" || c === "74" ? c : "other";
}

/**
 * Who a bill is billed to, when that is worth saying (owner, D3):
 *   site bill      → the SAP bill-to name (`billToName`);
 *   redirected bill → the ORIGINAL customer (`customerName`);
 *   otherwise      → null (ship-to = bill-to, nothing to say).
 *
 * `isSite` is passed in rather than re-derived: the site rule has ONE owner,
 * `shipMarkers` (components/floor/floor-table.tsx), and the caller asks it.
 */
export function billedToOf(row: FloorBoardRow, isSite: boolean): string | null {
  if (isSite) return row.billToName;
  if (row.isShipToOverride) return row.customerName;
  return null;
}

export interface ShipToBlock {
  /** `row.stopKey` — opaque, the React key and the grouping key. */
  key: string;
  /** The ship-to's display name (`dealerName`, the effective customer). */
  name: string;
  /** Tint first, then FLOOR_SPINE (D6). */
  rows: FloorBoardRow[];
  area: string | null;
  isKeyCustomer: boolean;
  isSite: boolean;
  /** Any bill in the block was redirected here. */
  isRedirect: boolean;
  /** One billed-to shared by every bill → the header says it; else null. */
  headerBilledTo: string | null;
  /** The bills disagree → each row says its own (FloorTable `billedToFor`). */
  billedToPerRow: boolean;
}

export interface DivisionBand {
  key: DivisionKey;
  name: string;
  /** Every bill in the band, block by block, in display order. */
  rows: FloorBoardRow[];
  blocks: ShipToBlock[];
}

/** Tint bills (orderType "tint") first, then FLOOR_SPINE — a stable partition. */
function sortBlockRows(rows: FloorBoardRow[]): FloorBoardRow[] {
  const spine = sortPickingQueue(rows, FLOOR_SPINE) as FloorBoardRow[];
  return [...spine.filter((r) => r.isTint), ...spine.filter((r) => !r.isTint)];
}

function buildBlock(key: string, rows: FloorBoardRow[], isSite: (r: FloorBoardRow) => boolean): ShipToBlock {
  const sorted = sortBlockRows(rows);
  const billedTo = sorted.map((r) => billedToOf(r, isSite(r)));
  const same = billedTo.every((b) => b === billedTo[0]);
  return {
    key,
    name: sorted[0].dealerName,
    rows: sorted,
    area: sorted[0].area,
    isKeyCustomer: sorted.some((r) => r.isKeyCustomer),
    isSite: sorted.some(isSite),
    isRedirect: sorted.some((r) => r.isShipToOverride),
    headerBilledTo: same ? billedTo[0] : null,
    billedToPerRow: !same,
  };
}

/**
 * The bands for one route section's DUE, non-Hand rows. Bands with no bill are
 * left out; blocks A–Z by name (the stop key breaks a tie, so the order never
 * flickers between refreshes).
 */
export function buildDivisionBands(
  rows: FloorBoardRow[],
  isSite: (r: FloorBoardRow) => boolean,
): DivisionBand[] {
  const bands: DivisionBand[] = [];
  for (const key of DIVISION_ORDER) {
    const inBand = rows.filter((r) => divisionOf(r) === key);
    if (inBand.length === 0) continue;
    const byStop = new Map<string, FloorBoardRow[]>();
    for (const r of inBand) {
      const arr = byStop.get(r.stopKey) ?? [];
      arr.push(r);
      byStop.set(r.stopKey, arr);
    }
    const blocks = Array.from(byStop.entries())
      .map(([k, rs]) => buildBlock(k, rs, isSite))
      .sort((a, b) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    bands.push({ key, name: DIVISION_NAME[key], rows: blocks.flatMap((b) => b.rows), blocks });
  }
  return bands;
}
