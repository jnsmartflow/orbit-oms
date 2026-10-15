// lib/order-invoices/trip-link.ts — THE ONLY WRITER OF TRIP LINKS (Schema
// v27.66; per-invoice since Phase 5 commit 2, 2026-10-15). Server-only
// (Prisma); the rules are the pure functions at the top, tested in
// trip-link.test.ts (npx tsx --test lib/order-invoices/trip-link.test.ts).
//
// MODEL A (v27.66): the invoice ROW is the dispatch unit, so a trip link lives
// on order_invoices."tripDropId". orders."tripDropId" is DERIVED from it — the
// tripDropId of the LOWEST-seq row that has one, NULL when none — and is still
// DUAL-WRITTEN here because readers still read it (the board's index term, the
// labels, "on ANY trip"). Nothing else may write either column:
//   · app/api/floor/trips/[id]/bills/route.ts   add / remove (whole OBD or
//                                                 chosen invoice rows)
//   · app/api/floor/trips/[id]/cancel/route.ts  detach every row on that trip
// call setRowsTrip. A new writer goes through here too.
//
// 🔴 WRITE ORDER, PER OBD — rows first, the OBD last:
//   1. read ALL the OBD's rows (id, seq, tripDropId, the stop's tripId)
//   2. ONE order_invoices.updateMany for the TARGET rows not already on the
//      target stop (onlyFromTripId: only target rows whose stop is on that trip)
//   3. ONE orders.update with the derived tripDropId AND the derived
//      "partlyOnTrip" flag (v27.69), both recomputed from ALL rows as they are
//      after step 2 — never from the target rows alone
// Step 3 is the commit point for every reader still on orders.
//
// HALF-FAILURE ANSWER. Dying between 2 and 3 leaves the rows moved and
// orders."tripDropId" / "partlyOnTrip" stale. A RETRY CONVERGES: step 1 re-reads the rows, step
// 2 then finds nothing left to move (the rows are already where they were
// sent; with onlyFromTripId they are no longer on that trip) and writes
// nothing, and step 3 recomputes the derived stop from the rows and lands it.
// The routes keep that retry reachable: when a press finds the rows already
// where it was asked to put them but orders disagrees with them
// (needsDerivedRepair), it still calls setRowsTrip, which writes only step 3.
// Dying inside step 2 is not a half-state: updateMany is one statement.
// scripts/parity-oi-trips-20261012.ts counts every OBD left half-written
// ("derived stop check", 0 expected); PART 3 of
// sql/2026-10-15-v27.69-orders-partly-on-trip.sql repairs the flag by hand.
//
// ⚠ EXACTLY ONE orders.update PER OBD, as before (FLOOR §4/§10, PICKING §10:
// the markers key on MAX(orders.updatedAt)). The rows' write fires the
// order_invoices live triggers (an 'order' line and v27.66 'trip' lines for the
// old and new stops' trips — which is what tells a trip one invoice joined or
// left it when orders."tripDropId" did not move); the orders write fires its
// own — a duplicate line per press, harmless.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "../prisma";
import { deriveObdTripDropId, derivePartlyOnTrip } from "./trip-read";

/** One invoice row's trip link, as the rules need it. */
export interface TripLinkRow {
  id: number;
  seq: number;
  tripDropId: number | null;
  /** The trip of the row's stop (null = on no stop). Only onlyFromTripId reads it. */
  tripId?: number | null;
}

// The derived rule's one home is trip-read.ts; re-exported for callers here.
export { deriveObdTripDropId, derivePartlyOnTrip };

export interface RowsTripMove {
  /** Target rows not already on the target — the one updateMany. */
  rowIdsToUpdate: number[];
  /** What orders."tripDropId" becomes: the derived rule over ALL rows after the move. */
  derived: number | null;
  /** What orders."partlyOnTrip" becomes (v27.69): some row on a stop and some on none, after the move. */
  partlyOnTrip: boolean;
  /** The OBD has no invoice rows (Model A says it always has seq 1): orders is
   *  written alone with the target, exactly as before v27.66, and the caller logs it. */
  noRows: boolean;
}

export interface RowsTripOpts {
  /** Only rows whose stop belongs to this trip move (a remove / a cancel must
   *  never strip an invoice off ANOTHER trip). */
  onlyFromTripId?: number;
}

/**
 * Move some or all of an OBD's invoice rows onto stop `target` (null = off any
 * trip). `rowIds` = 'all' or the chosen rows; ids that are not this OBD's rows
 * are ignored (the caller validates them first).
 */
export function planRowsTripMove(
  rows: readonly TripLinkRow[],
  rowIds: readonly number[] | "all",
  target: number | null,
  opts: RowsTripOpts = {},
): RowsTripMove {
  if (rows.length === 0) return { rowIdsToUpdate: [], derived: target, partlyOnTrip: false, noRows: true };
  const chosen = rowIds === "all" ? null : new Set(rowIds);
  const move = new Set(
    rows
      .filter((r) => chosen === null || chosen.has(r.id))
      .filter((r) => opts.onlyFromTripId === undefined || (r.tripDropId !== null && r.tripId === opts.onlyFromTripId))
      .filter((r) => r.tripDropId !== target)
      .map((r) => r.id),
  );
  const after = rows.map((r) => ({ seq: r.seq, tripDropId: move.has(r.id) ? target : r.tripDropId }));
  return {
    rowIdsToUpdate: rows.filter((r) => move.has(r.id)).map((r) => r.id),
    derived: deriveObdTripDropId(after),
    partlyOnTrip: derivePartlyOnTrip(after),
    noRows: false,
  };
}

/** A WHOLE-OBD move: every row of the OBD onto `target` (null = off any trip). */
export function planWholeObdTripMove(rows: TripLinkRow[], target: number | null): RowsTripMove {
  return planRowsTripMove(rows, "all", target);
}

/**
 * Does orders disagree with the OBD's rows — the derived stop or (v27.69) the
 * "partlyOnTrip" flag? True only after a press died between step 2 and step 3
 * (or a hand fix); the routes then still call setRowsTrip, which moves no row
 * and lands both derived values.
 */
export function needsDerivedRepair(
  rows: readonly TripLinkRow[],
  order: { tripDropId: number | null; partlyOnTrip: boolean },
): boolean {
  if (rows.length === 0) return false;
  return deriveObdTripDropId(rows) !== order.tripDropId || derivePartlyOnTrip(rows) !== order.partlyOnTrip;
}

/**
 * Put some or all of ONE OBD's invoice rows on stop `tripDropId`, or take them
 * off (null). The header's three steps; throws on a failed write, so the
 * caller's per-bill catch reports it. Returns what it wrote.
 */
export async function setRowsTrip(
  orderId: number,
  rowIds: readonly number[] | "all",
  tripDropId: number | null,
  opts: RowsTripOpts = {},
): Promise<{ rowIdsUpdated: number[]; derived: number | null; partlyOnTrip: boolean }> {
  // 1.
  const rows = await prisma.order_invoices.findMany({
    where: { orderId },
    select: { id: true, seq: true, tripDropId: true, tripDrop: { select: { tripId: true } } },
  });
  const move = planRowsTripMove(
    rows.map((r) => ({ id: r.id, seq: r.seq, tripDropId: r.tripDropId, tripId: r.tripDrop?.tripId ?? null })),
    rowIds,
    tripDropId,
    opts,
  );
  if (move.noRows) {
    console.error(`[order-invoices] order ${orderId} has no invoice rows — orders.tripDropId written alone; re-run v27.63 PART 3`);
  }
  // 2.
  if (move.rowIdsToUpdate.length > 0) {
    await prisma.order_invoices.updateMany({
      where: { id: { in: move.rowIdsToUpdate } },
      data: { tripDropId },
    });
  }
  // 3. ONE orders.update — the commit point. Both derived values in it, never
  // a second write (the marker keys on MAX(orders.updatedAt)).
  await prisma.orders.update({
    where: { id: orderId },
    data: { tripDropId: move.derived, partlyOnTrip: move.partlyOnTrip },
  });
  return { rowIdsUpdated: move.rowIdsToUpdate, derived: move.derived, partlyOnTrip: move.partlyOnTrip };
}

/** Every invoice row of ONE OBD onto stop `tripDropId` (null = off any trip). */
export async function setOrderTrip(orderId: number, tripDropId: number | null): Promise<void> {
  await setRowsTrip(orderId, "all", tripDropId);
}

/** setOrderTrip for several OBDs, one at a time; a failure is reported per
 *  OBD and never stops the rest. */
export async function setTripForOrders(
  orderIds: number[],
  tripDropId: number | null,
): Promise<{ done: number[]; failed: { orderId: number; error: string }[] }> {
  const done: number[] = [];
  const failed: { orderId: number; error: string }[] = [];
  for (const orderId of orderIds) {
    try {
      await setOrderTrip(orderId, tripDropId);
      done.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }
  return { done, failed };
}
