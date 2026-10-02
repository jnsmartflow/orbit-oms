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
//
// ROUTE CARDS (2026-10-02). The pool screen draws Floor-style club cards, which
// need two facts a hold row does not carry: the effective dealer's route ID
// (clubs match on route id, never name) and the stop key (computeDropKey). Both
// come from ONE extra batched read here — getFloorHold is not touched — and ride
// each row as additive fields (FreightPoolRow). The clubs themselves are Floor's
// getRouteClubs() (lib/floor/route-clubs.ts), imported read-only.

import { prisma } from "@/lib/prisma";
import { getFloorHold } from "@/lib/floor/queries";
import { applySearch, parseSearch } from "@/lib/floor/search";
import { computeDropKey } from "@/lib/trips/drop-key";
import type { FloorScope, FloorHoldRow } from "@/lib/floor/types";

/** A pool row: Floor's hold row + the two facts the route cards need. */
export interface FreightPoolRow extends FloorHoldRow {
  /** The effective dealer's area.primaryRouteId — what a club member matches on. */
  routeId: number | null;
  /** computeDropKey — one stop per effective customer. */
  stopKey: string;
}

export async function getFreightPool(scope: FloorScope = "All", search?: string): Promise<FloorHoldRow[]> {
  const rows = await getFloorHold(scope, undefined, undefined, {
    freightTripBills: { none: { removedAt: null } },
  });
  const q = search?.trim() ?? "";
  return q === "" ? rows : applySearch(rows, parseSearch(q));
}

/** The pool with each row's route id and stop key (one batched read, sequential). */
export async function getFreightPoolRows(scope: FloorScope = "All", search?: string): Promise<FreightPoolRow[]> {
  const rows = await getFreightPool(scope, search);
  if (rows.length === 0) return [];
  const DEALER = { select: { area: { select: { primaryRouteId: true } } } } as const;
  const facts = await prisma.orders.findMany({
    where: { id: { in: rows.map((r) => r.orderId) } },
    select: {
      id: true,
      customerId: true,
      shipToOverrideCustomerId: true,
      shipToCustomerId: true,
      customer: DEALER,
      shipToOverrideCustomer: DEALER,
    },
  });
  const byId = new Map(facts.map((f) => [f.id, f]));
  return rows.map((r) => {
    const f = byId.get(r.orderId);
    const dealer = f ? f.shipToOverrideCustomer ?? f.customer : null;
    return {
      ...r,
      routeId: dealer?.area?.primaryRouteId ?? null,
      stopKey: f ? computeDropKey(f) : `o:${r.orderId}`,
    };
  });
}
