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
import { byWindow, byDeliveryType, byKeyCustomer, byPriority, byFifo } from "@/lib/picking/sort";
import type { SortRule } from "@/lib/picking/types";

export const FLOOR_SPINE: SortRule[] = [byWindow, byDeliveryType, byKeyCustomer, byPriority, byFifo];

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
