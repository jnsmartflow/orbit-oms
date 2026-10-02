// lib/freight-trips/pool.ts — the freight pool: held bills NOT on an active freight trip.
//
// 🔴 REUSE, NEVER RE-IMPLEMENT. The rows are Floor's On hold rows, built by
// getFloorHold (lib/floor/queries.ts — Floor-owned, imported read-only): the
// same predicate (floorHoldWhere + the hide exclusion), the same row shape the
// shared HoldTable renders (components/floor/hold-table.tsx). Freight adds ONE
// term through getFloorHold's `extraWhere` — exactly how the Tint Manager's Hold
// tab narrows it to tint bills: not on an ACTIVE freight trip (a removed or
// trip-cancelled membership row has removedAt set and does not count).
//
// Held bills that are on a FLOOR trip still appear (owner decision): nothing
// here reads tripDropId. Read-only.

import { getFloorHold } from "@/lib/floor/queries";
import { applySearch, parseSearch } from "@/lib/floor/search";
import type { FloorScope, FloorHoldRow } from "@/lib/floor/types";

export async function getFreightPool(scope: FloorScope = "All", search?: string): Promise<FloorHoldRow[]> {
  const rows = await getFloorHold(scope, undefined, undefined, {
    freightTripBills: { none: { removedAt: null } },
  });
  const q = search?.trim() ?? "";
  return q === "" ? rows : applySearch(rows, parseSearch(q));
}
