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
