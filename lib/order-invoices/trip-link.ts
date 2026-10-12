// lib/order-invoices/trip-link.ts — THE ONLY WRITER OF TRIP LINKS (Schema
// v27.66, Phase 3 commit 2, 2026-10-12). Server-only (Prisma); the rules are the
// pure functions at the top, tested in trip-link.test.ts
// (npx tsx --test lib/order-invoices/trip-link.test.ts).
//
// MODEL A (v27.66): the invoice ROW is the dispatch unit, so a trip link lives
// on order_invoices."tripDropId". orders."tripDropId" is DERIVED from it — the
// tripDropId of the LOWEST-seq row that has one, NULL when none — and is still
// DUAL-WRITTEN here because every reader still reads it (Phase 3 commits 3+
// move them). Nothing else may write either column:
//   · app/api/floor/trips/[id]/bills/route.ts   add / remove
//   · app/api/floor/trips/[id]/cancel/route.ts  detach every bill
// call setOrderTrip. A new writer goes through here too.
//
// 🔴 WRITE ORDER, PER OBD — rows first, the OBD last:
//   1. read the OBD's rows (id, seq, tripDropId)
//   2. ONE order_invoices.updateMany for every row not already on the target
//   3. ONE orders.update with the derived tripDropId
// Step 3 is the commit point: every reader reads orders, so until it lands the
// OBD has not visibly moved. HALF-FAILURE ANSWER: dying between 2 and 3 leaves
// the rows on the new stop and orders on the old one; the caller has already
// reported that bill as failed, and pressing again converges (step 2 is then a
// no-op, step 3 lands). PART 8 row 6 of the v27.66 SQL counts any unsplit OBD
// left like that, and PART 3a repairs one from orders (the readers' truth).
//
// ⚠ EXACTLY ONE orders.update PER OBD, as before (FLOOR §4/§10, PICKING §10:
// the markers key on MAX(orders.updatedAt)). The rows' write fires the
// order_invoices live triggers (an 'order' line and v27.66 'trip' lines); the
// orders write fires its own — a duplicate line per press, harmless.
//
// SEAM FOR PHASE 5: a PER-ROW move (one invoice of a split OBD onto a trip)
// will be planRowTripMove + setInvoiceRowTrip beside these — same order (rows,
// then the derived OBD via deriveObdTripDropId), same one orders.update. It is
// NOT built here; today every move is whole-OBD.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "../prisma";
import { deriveObdTripDropId } from "./trip-read";

/** One invoice row's trip link, as the rules need it. */
export interface TripLinkRow {
  id: number;
  seq: number;
  tripDropId: number | null;
}

// The derived rule's one home is trip-read.ts; re-exported for callers here.
export { deriveObdTripDropId };

export interface WholeObdTripMove {
  /** Rows not already on the target — the one updateMany. */
  rowIdsToUpdate: number[];
  /** What orders."tripDropId" becomes. */
  derived: number | null;
  /** The OBD has no invoice rows (Model A says it always has seq 1): orders is
   *  written alone, exactly as before v27.66, and the caller logs it. */
  noRows: boolean;
}

/** A WHOLE-OBD move: every row of the OBD onto `target` (null = off any trip). */
export function planWholeObdTripMove(rows: TripLinkRow[], target: number | null): WholeObdTripMove {
  if (rows.length === 0) return { rowIdsToUpdate: [], derived: target, noRows: true };
  const after = rows.map((r) => ({ seq: r.seq, tripDropId: target }));
  return {
    rowIdsToUpdate: rows.filter((r) => r.tripDropId !== target).map((r) => r.id),
    derived: deriveObdTripDropId(after),
    noRows: false,
  };
}

/**
 * Put ONE OBD — every invoice row of it — on stop `tripDropId`, or take it off
 * any trip (null). The header's three steps; throws on a failed write, so the
 * caller's per-bill catch reports it exactly as before.
 */
export async function setOrderTrip(orderId: number, tripDropId: number | null): Promise<void> {
  // 1.
  const rows = await prisma.order_invoices.findMany({
    where: { orderId },
    select: { id: true, seq: true, tripDropId: true },
  });
  const move = planWholeObdTripMove(rows, tripDropId);
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
  // 3. ONE orders.update — the commit point.
  await prisma.orders.update({
    where: { id: orderId },
    data: { tripDropId: move.derived },
  });
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
