// Floor Control — the sort rule list for the floor board.
//
// Floor sorts with the picking spine MINUS byAssigned, so Assigned/Done rows
// HOLD their position instead of sinking on assign and rising on done (the
// reshuffle the desk operator loses his place to). This matches the Picking
// DESKTOP board, which already sorts the spine minus byAssigned
// (CLAUDE_PICKING §9 / CLAUDE_UI §61).
//
// The rule objects are IMPORTED from lib/picking/sort.ts, never copied — that
// file is owned by CLAUDE_PICKING §3 and Picking mobile depends on it unchanged.
// ONE shared constant, imported by BOTH the server sort (lib/floor/queries.ts)
// and the client re-sort (components/floor/floor-board.tsx), so the two can
// never drift and flicker on refetch. sortPickingQueue still appends its
// obdNumber ASC tiebreak after this list, so the effective order is:
//   window → deliveryType → keyCustomer → priority → fifo → obdNumber.
import { byWindow, byDeliveryType, byKeyCustomer, byPriority, byFifo, sortPickingQueue } from "@/lib/picking/sort";
import type { SortRule } from "@/lib/picking/types";
import type { FloorBoardRow } from "@/lib/floor/types";

export const FLOOR_SPINE: SortRule[] = [byWindow, byDeliveryType, byKeyCustomer, byPriority, byFifo];

// ── One invoice, several OBDs: keep them together (2026-10-08) ──────────────
// SAP can cover two or more OBDs with one invoice, and the spine splits them:
// ⚡ priority is per OBD and the two arrive minutes apart (live 2026-10-08:
// 3 of 10 recent pairs differ on priority, 5 on arrival time). FLOOR_SPINE is
// NOT changed for it — the pass below runs AFTER the spine.
//
// 🔴 USE sortFloorRows WHEREVER FLOOR SORTS BOARD ROWS. Same rule as the spine
// itself (FLOOR §3, "one rule, both places"): server, client and live-merge must
// order rows identically or the board flickers on refetch.

/** The fields the pair pass reads — kept narrow so callers and tests can pass any row shape. */
type PairableRow = Pick<FloorBoardRow, "invoiceNo"> & { redelivery?: FloorBoardRow["redelivery"] };

/**
 * Pull the OBDs that share an invoice together, in ONE already-ordered list.
 *
 * Walking the list, the first member of an invoice met is its highest-ranked;
 * every other member IN THIS LIST is placed directly after it, in their own
 * existing order. So the group takes the position of its best-ranked member —
 * marking one OBD urgent lifts both.
 *
 * Pure and stable: rows with no invoice, re-delivery rows (`rd:` ticks — their
 * row is the bill's FIRST trip, never grouped), and an invoice with only one
 * member here keep their place relative to each other. Nothing is added,
 * dropped or duplicated. Any group size.
 *
 * ⚠ ONE LIST ONLY. A partner in another list (upcoming half, another route,
 * stop, tab or trip) is not pulled across — the display shows a split there.
 */
export function keepPairsAdjacent<T extends PairableRow>(rows: T[]): T[] {
  const groupOf = (r: T): string | null => (r.invoiceNo !== null && !r.redelivery ? r.invoiceNo : null);
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = groupOf(r);
    if (k === null) continue;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  if (!Array.from(groups.values()).some((g) => g.length > 1)) return rows;

  const out: T[] = [];
  const placed = new Set<T>();
  for (const r of rows) {
    if (placed.has(r)) continue;
    const k = groupOf(r);
    const g = k === null ? undefined : groups.get(k);
    if (g && g.length > 1) {
      for (const m of g) {
        out.push(m);
        placed.add(m);
      }
    } else {
      out.push(r);
      placed.add(r);
    }
  }
  return out;
}

/** FLOOR_SPINE, then keepPairsAdjacent — THE Floor board row order. */
export function sortFloorRows<T extends FloorBoardRow>(rows: T[]): T[] {
  return keepPairsAdjacent(sortPickingQueue(rows, FLOOR_SPINE) as T[]);
}

// ── Hold and Cancel & CI order (moved here 2026-09-30, live feed 7b) ─────────
// These were inline in lib/floor/queries.ts (getFloorHold / getFloorCancelled).
// They live HERE now so the server feed and the client live-merge
// (lib/floor/live-merge.ts, which re-sorts after a row patch) share ONE rule —
// the same reason FLOOR_SPINE lives here. Pure, client-safe, no imports.

/** On hold: most recently held first (heldSince desc); unknown-held rows last. */
export function compareHoldRows(
  a: { heldSince: string | null },
  b: { heldSince: string | null },
): number {
  if (a.heldSince === b.heldSince) return 0;
  if (a.heldSince === null) return 1;
  if (b.heldSince === null) return -1;
  return a.heldSince < b.heldSince ? 1 : -1;
}

/** Cancel & CI: newest first (`at` desc). */
export function compareCancelledRows(a: { at: string | null }, b: { at: string | null }): number {
  return a.at === b.at ? 0 : (a.at ?? "") < (b.at ?? "") ? 1 : -1;
}
