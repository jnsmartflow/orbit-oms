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
//   · lib/trips/ship-to-on-trip.ts              ship-to change → the new
//                                                 shop's stop, same trip
//   · lib/tint/manual-pull.ts                   a bill pulled into tinting
//                                                 comes off every trip (and its
//                                                 revert, off any it joined since)
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

import type { Prisma } from "@prisma/client";
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
 * Bill columns that must land in the SAME orders.update as the trip link
 * (2026-10-24): a ship-to change on a bill that is on a trip moves it to the
 * new shop's stop, and the ship-to and the stop are one fact — so they are one
 * write, never two (the marker keys on MAX(orders.updatedAt)). Only the four
 * ship-to columns; lib/trips/ship-to-on-trip.ts is the caller.
 */
export interface RowsTripOrderData {
  shipToOverride: boolean;
  shipToOverrideCustomerId: number | null;
  shipToText: string | null;
  shipToAreaId: number | null;
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
 * PER-PART SHIP-TO (v27.81, 2026-11-19): a part's OWN four ship-to columns,
 * written in the SAME order_invoices write as its new stop (setRowsTrip's
 * `rowData`) — the ship-to and the stop are one fact. NULL shipToOverride =
 * inherit the OBD (lib/ship-to/effective.ts).
 */
export interface RowsTripRowData {
  shipToOverride: boolean | null;
  shipToOverrideCustomerId: number | null;
  shipToText: string | null;
  shipToAreaId: number | null;
}

/** One stop's share of a several-stop press (setRowsStops). */
export interface RowsStopGroup {
  rowIds: readonly number[];
  tripDropId: number | null;
}

export interface RowsStopsMove {
  /** One updateMany per group that has rows to move, in group order. */
  updates: Array<{ rowIds: number[]; tripDropId: number | null }>;
  /** The derived values over ALL rows after every group — the ONE orders.update. */
  derived: number | null;
  partlyOnTrip: boolean;
  noRows: boolean;
}

/**
 * PER-PART SHIP-TO (v27.81, rule 4): ONE press that puts an OBD's rows on
 * SEVERAL stops (each part to the stop of its own shop). Each group is planned
 * like planRowsTripMove against the ORIGINAL rows (onlyFromTripId reads the trip
 * a row was on BEFORE the press); the derived values come from all rows after
 * every group. Groups must not share a row — a caller bug, so it throws. With
 * ONE group the result equals planRowsTripMove's.
 */
export function planRowsStopsMove(
  rows: readonly TripLinkRow[],
  groups: readonly RowsStopGroup[],
  opts: RowsTripOpts = {},
): RowsStopsMove {
  const seen = new Set<number>();
  for (const g of groups) {
    for (const id of g.rowIds) {
      if (seen.has(id)) throw new Error(`planRowsStopsMove: invoice row ${id} is in two groups`);
      seen.add(id);
    }
  }
  if (rows.length === 0) {
    const last = groups.length > 0 ? groups[groups.length - 1].tripDropId : null;
    return { updates: [], derived: last, partlyOnTrip: false, noRows: true };
  }
  const target = new Map<number, number | null>();
  const updates: RowsStopsMove["updates"] = [];
  for (const g of groups) {
    const move = planRowsTripMove(rows, g.rowIds, g.tripDropId, opts);
    if (move.rowIdsToUpdate.length > 0) updates.push({ rowIds: move.rowIdsToUpdate, tripDropId: g.tripDropId });
    for (const id of move.rowIdsToUpdate) target.set(id, g.tripDropId);
  }
  const after = rows.map((r) => ({ seq: r.seq, tripDropId: target.has(r.id) ? (target.get(r.id) as number | null) : r.tripDropId }));
  return { updates, derived: deriveObdTripDropId(after), partlyOnTrip: derivePartlyOnTrip(after), noRows: false };
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
  /** Written in step 3's one orders.update beside the derived values. A
   *  ship-to change (RowsTripOrderData), or — since 2026-10-24 — the manual
   *  tint pull's whole bill write (lib/tint/manual-pull.ts buildPullData), so a
   *  bill pulled off a trip into tinting is still ONE orders.update. The
   *  derived tripDropId / partlyOnTrip are spread last and always win. */
  orderData?: RowsTripOrderData | Prisma.ordersUncheckedUpdateInput,
  /** PER-PART SHIP-TO (v27.81): the part's own four ship-to columns, written in
   *  step 2's SAME order_invoices write as its new stop. Legal only with ONE
   *  chosen row that actually moves — asserted BEFORE anything is written. */
  rowData?: RowsTripRowData,
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
  if (rowData !== undefined && !rowDataMoves(rowIds, move)) {
    // A row already on the target, or no longer on onlyFromTripId, would
    // silently drop the ship-to — refuse before any write; the caller re-reads.
    throw new Error(`setRowsTrip: the ship-to needs exactly one invoice row that moves (order ${orderId}) — reopen and try again`);
  }
  if (move.noRows) {
    console.error(`[order-invoices] order ${orderId} has no invoice rows — orders.tripDropId written alone; re-run v27.63 PART 3`);
  }
  // 2.
  if (move.rowIdsToUpdate.length > 0) {
    await prisma.order_invoices.updateMany({
      where: { id: { in: move.rowIdsToUpdate } },
      data: { tripDropId, ...(rowData ?? {}) },
    });
  }
  // 3. ONE orders.update — the commit point. Both derived values in it, never
  // a second write (the marker keys on MAX(orders.updatedAt)). A ship-to change
  // on a trip bill rides in this same write (`orderData`).
  await prisma.orders.update({
    where: { id: orderId },
    data: { ...(orderData ?? {}), tripDropId: move.derived, partlyOnTrip: move.partlyOnTrip },
  });
  return { rowIdsUpdated: move.rowIdsToUpdate, derived: move.derived, partlyOnTrip: move.partlyOnTrip };
}

/** setRowsTrip's rowData rule (pure, tested): ONE chosen row, and the plan moves exactly it. */
export function rowDataMoves(rowIds: readonly number[] | "all", move: Pick<RowsTripMove, "rowIdsToUpdate">): boolean {
  return rowIds !== "all" && rowIds.length === 1 && move.rowIdsToUpdate.length === 1 && move.rowIdsToUpdate[0] === rowIds[0];
}

/** Every invoice row of ONE OBD onto stop `tripDropId` (null = off any trip). */
export async function setOrderTrip(orderId: number, tripDropId: number | null): Promise<void> {
  await setRowsTrip(orderId, "all", tripDropId);
}

/**
 * PER-PART SHIP-TO (v27.81, rule 4): ONE press that puts an OBD's rows on
 * SEVERAL stops — each part to the stop of its own shop. The same three steps
 * as setRowsTrip and STILL EXACTLY ONE orders.update (ORDER_INVOICES §4.3): one
 * order_invoices.updateMany per group with rows to move, then ONE orders.update
 * with the derived values over all rows. Half-failure: as setRowsTrip — a
 * retry re-reads, moves what is left, and lands step 3. (Its callers are the
 * trip side — batch 3; nothing calls it yet.)
 */
export async function setRowsStops(
  orderId: number,
  groups: readonly RowsStopGroup[],
  opts: RowsTripOpts = {},
): Promise<{ rowIdsUpdated: number[]; derived: number | null; partlyOnTrip: boolean }> {
  // 1.
  const rows = await prisma.order_invoices.findMany({
    where: { orderId },
    select: { id: true, seq: true, tripDropId: true, tripDrop: { select: { tripId: true } } },
  });
  const plan = planRowsStopsMove(
    rows.map((r) => ({ id: r.id, seq: r.seq, tripDropId: r.tripDropId, tripId: r.tripDrop?.tripId ?? null })),
    groups,
    opts,
  );
  if (plan.noRows) {
    console.error(`[order-invoices] order ${orderId} has no invoice rows — orders.tripDropId written alone; re-run v27.63 PART 3`);
  }
  // 2. One statement per stop.
  for (const u of plan.updates) {
    await prisma.order_invoices.updateMany({ where: { id: { in: u.rowIds } }, data: { tripDropId: u.tripDropId } });
  }
  // 3. ONE orders.update — the commit point.
  await prisma.orders.update({
    where: { id: orderId },
    data: { tripDropId: plan.derived, partlyOnTrip: plan.partlyOnTrip },
  });
  return { rowIdsUpdated: plan.updates.flatMap((u) => u.rowIds), derived: plan.derived, partlyOnTrip: plan.partlyOnTrip };
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
