// lib/order-invoices/trip-read.ts — HOW TRIP CODE READS "WHICH BILLS ARE ON
// THIS STOP / TRIP" AND "WHICH STOP IS THIS BILL ON" (Schema v27.66, Phase 3
// readers A, 2026-10-12). The pure parts are tested in trip-read.test.ts
// (npx tsx --test lib/order-invoices/trip-read.test.ts).
//
// MODEL A (v27.66): a trip link lives on the INVOICE ROW (order_invoices.
// "tripDropId"). orders."tripDropId" is still dual-written (lib/order-invoices/
// trip-link.ts) but is only DERIVED — and from Phase 5, when single rows of a
// split OBD can sit on different stops, it is WRONG for those OBDs. So trip
// readers go through the rows:
//   · "bills on these stops"  → onStopsWhere(dropIds): any invoice row on one of
//     them. orders.findMany returns each OBD ONCE.
//   · "where on THIS trip"    → placeOnTrips: per OBD and per trip it touches,
//     the stop of its LOWEST-seq row on that trip — one entry per (OBD, trip).
//   · "which stop is this OBD on" (no trip in hand) → obdStopIds: the stop of
//     the LOWEST-seq row that has one — the v27.66 derived rule, the SAME rule
//     trip-link.ts writes into orders."tripDropId" (deriveObdTripDropId, below,
//     is that rule's one home).
// 🔴 TOTALS STAY PER OBD for now: a bill on a trip brings its WHOLE OBD's
// litres / kg / count. Phase 5 makes them per row (an OBD half on this truck
// brings half its litres) — not here.
//
//   · "where is this OBD on THIS trip" (one bill, one trip — the trip actions'
//     guards, readers C) → obdStopOnTrip: its lowest-seq row's stop on that trip.
// ⚠ NOT FOR THE FLOOR BOARD. floorTripBillsWhere's `tripDropId: { not: null }`
// term is load-bearing for the query plan (CLAUDE_FLOOR.md landmine), and the
// picking gate reads orders."tripDropId" — both move in commit B, not through
// this file blindly.

import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

/** One invoice row's stop, as the rules need it. */
export interface StopRow {
  seq: number;
  tripDropId: number | null;
}

/**
 * THE v27.66 derived rule: an OBD's stop is the tripDropId of its LOWEST-seq
 * row that has one; null when no row is on a trip. trip-link.ts writes this
 * into orders."tripDropId"; every reader that needs "the" stop of an OBD uses it.
 */
export function deriveObdTripDropId(rows: readonly StopRow[]): number | null {
  let best: { seq: number; tripDropId: number } | null = null;
  for (const r of rows) {
    if (r.tripDropId === null) continue;
    if (best === null || r.seq < best.seq) best = { seq: r.seq, tripDropId: r.tripDropId };
  }
  return best?.tripDropId ?? null;
}

/** orders WHERE term: any invoice row of the OBD sits on one of these stops. */
export function onStopsWhere(dropIds: number[]): Prisma.ordersWhereInput {
  return { invoices: { some: { tripDropId: { in: dropIds } } } };
}

/** orders WHERE term: any invoice row of the OBD sits on any stop. */
export const ON_ANY_TRIP_WHERE: Prisma.ordersWhereInput = { invoices: { some: { tripDropId: { not: null } } } };

/** orders WHERE term: any invoice row of the OBD sits on a trip matching `trip`. */
export function onTripsWhere(trip: Prisma.tripsWhereInput): Prisma.ordersWhereInput {
  return { invoices: { some: { tripDrop: { trip } } } };
}

/** orders WHERE term: any invoice row of the OBD sits on one of these trips. */
export function onTripIdsWhere(tripIds: number[]): Prisma.ordersWhereInput {
  return { invoices: { some: { tripDrop: { tripId: { in: tripIds } } } } };
}

/**
 * orders WHERE term: any invoice row of the OBD sits on a SHOWN trip — the
 * picking gate's "visible" (lib/picking/visibility-gate.ts), mirrored by the
 * Floor row's isAwaitingShow.
 */
export const ON_SHOWN_TRIP_WHERE: Prisma.ordersWhereInput = onTripsWhere({ shownAt: { not: null } });

/** The `invoices` select for placeOnTrips — only rows on these stops (or on
 *  any stop when omitted), seq and stop. */
export function stopRowsSelect(dropIds?: number[]) {
  return {
    where: { tripDropId: dropIds ? { in: dropIds } : { not: null } },
    select: { seq: true, tripDropId: true },
  } satisfies Prisma.orders$invoicesArgs;
}

/**
 * One entry per (OBD, trip): the OBD's fields with `tripDropId` set to the stop
 * of its LOWEST-seq row on THAT trip (deriveObdTripDropId over that trip's
 * rows). Rows on stops not in `tripIdOfDrop` are ignored. Order is kept: the
 * input order, then trip order of first appearance.
 *
 * Today every OBD is on one stop (whole-OBD moves only), so this returns each
 * OBD once with the same stop orders."tripDropId" holds.
 */
export function placeOnTrips<T extends { invoices: StopRow[] }>(
  orders: readonly T[],
  tripIdOfDrop: ReadonlyMap<number, number>,
): Array<Omit<T, "invoices"> & { tripId: number; tripDropId: number }> {
  const out: Array<Omit<T, "invoices"> & { tripId: number; tripDropId: number }> = [];
  for (const o of orders) {
    const { invoices, ...rest } = o;
    const rowsByTrip = new Map<number, StopRow[]>();
    for (const r of invoices) {
      if (r.tripDropId === null) continue;
      const tripId = tripIdOfDrop.get(r.tripDropId);
      if (tripId === undefined) continue;
      const arr = rowsByTrip.get(tripId) ?? [];
      arr.push(r);
      rowsByTrip.set(tripId, arr);
    }
    Array.from(rowsByTrip.entries()).forEach(([tripId, rows]) => {
      const tripDropId = deriveObdTripDropId(rows);
      if (tripDropId !== null) out.push({ ...rest, tripId, tripDropId });
    });
  }
  return out;
}

/**
 * Where ONE OBD sits on ONE trip: the stop (id + dropKey) of its LOWEST-seq
 * invoice row on that trip, or null when no row of it is on the trip. One read,
 * keyed on order_invoices_orderId_seq_key. The trip actions' "is it on THIS
 * trip" (readers C, POST /api/floor/trips/[id]/bills).
 */
export async function obdStopOnTrip(orderId: number, tripId: number): Promise<{ id: number; dropKey: string } | null> {
  const row = await prisma.order_invoices.findFirst({
    where: { orderId, tripDrop: { tripId } },
    orderBy: { seq: "asc" },
    select: { tripDrop: { select: { id: true, dropKey: true } } },
  });
  return row?.tripDrop ?? null;
}

/** ONE read: each OBD's stop by the derived rule (null = on no trip). */
export async function obdStopIds(orderIds: number[]): Promise<Map<number, number | null>> {
  const ids = Array.from(new Set(orderIds));
  const out = new Map<number, number | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return out;
  const rows = await prisma.order_invoices.findMany({
    where: { orderId: { in: ids }, tripDropId: { not: null } },
    select: { orderId: true, seq: true, tripDropId: true },
  });
  const byOrder = new Map<number, StopRow[]>();
  for (const r of rows) {
    const arr = byOrder.get(r.orderId) ?? [];
    arr.push(r);
    byOrder.set(r.orderId, arr);
  }
  Array.from(byOrder.entries()).forEach(([orderId, rs]) => out.set(orderId, deriveObdTripDropId(rs)));
  return out;
}
