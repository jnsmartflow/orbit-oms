// lib/trips/drop.ts
//
// FIND OR CREATE A TRIP'S STOP for a bill. Extracted 2026-10-03 from the add
// path of app/api/floor/trips/[id]/bills/route.ts, unchanged in behaviour, so
// the coming re-delivery add can put a bill on a stop without a second copy of
// the rule.
//
// The stop identity is `computeDropKey` (lib/trips/drop-key.ts) and the stop's
// customer is `effectiveCustomerId` — never an inlined
// `shipToOverrideCustomerId ?? customerId` (FLOOR_TRIPS §15 landmine 6).
//
// ⚠ NO RETRY ON A RACE, as before: the unique (tripId, dropKey) is the backstop
// if two planners add bills for the same shop at once, and the losing create
// throws to the caller, which reports that one bill as failed.
//
// STOPS CLOSE UP ON REMOVE (2026-10-17): deleting an empty stop renumbers the
// trip's survivors 1..N in their current order (compactTripDropSeq).
// Until 2026-10-17 gaps in dropSeq were left alone; owner reversed it, stops now close up on remove. Do not revert.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { computeDropKey, dropShipToCode, dropShipToText, effectiveCustomerId, type DropKeyInput } from "@/lib/trips/drop-key";
import { isAsPerChallanBill } from "@/lib/ship-to/effective";
import { dealerDisplayName } from "@/lib/orders/dealer-name";

/**
 * Delete a stop that now holds nothing — no order, no invoice row and no re-delivery. Returns
 * true when it deleted. ONE rule for both remove paths (bills and re-deliveries).
 *
 * ⚠ `isRemoved` IS DELIBERATELY NOT FILTERED. A soft-removed bill still carries
 * its `tripDropId`, so a drop holding only removed bills is NOT empty — deleting
 * it would clear their pointers through the FK's ON DELETE SET NULL and lose
 * where they were. The read side hides them from counts (lib/trips/queries.ts).
 *
 * ⚠ RE-DELIVERIES COUNT (2026-10-03). trip_redeliveries.tripDropId is ON DELETE
 * RESTRICT, so deleting a stop under one would fail; it must simply stay.
 *
 * ⚠ INVOICE ROWS COUNT (v27.66, 2026-10-12). order_invoices.tripDropId is ON
 * DELETE SET NULL, so deleting a stop an invoice row still sits on would
 * silently take that row off its trip. While every move is whole-OBD
 * (lib/order-invoices/trip-link.ts) the rows sit exactly where their orders do,
 * so this changes nothing today; from Phase 5 a row can sit on a stop its OBD
 * does not point at, and then this is the check that keeps the stop.
 *
 * After a delete the trip's stops close up 1..N (compactTripDropSeq, owner
 * 2026-10-17). Not on cancel — cancel never comes here, and a cancelled trip's
 * drops stay as the record of the plan.
 */
export async function deleteTripDropIfEmpty(dropId: number): Promise<boolean> {
  const orders = await prisma.orders.count({ where: { tripDropId: dropId } });
  if (orders > 0) return false;
  const invoiceRows = await prisma.order_invoices.count({ where: { tripDropId: dropId } });
  if (invoiceRows > 0) return false;
  const redeliveries = await prisma.trip_redeliveries.count({ where: { tripDropId: dropId } });
  if (redeliveries > 0) return false;
  const deleted = await prisma.trip_drops.delete({ where: { id: dropId }, select: { tripId: true } });
  await compactTripDropSeq(deleted.tripId);
  return true;
}

/**
 * Renumber a trip's stops 1..N in their current dropSeq order (owner,
 * 2026-10-17: stop numbers never have gaps). Full compaction, so it also heals
 * any older gap on the same trip.
 *
 * Walking ASCENDING means a row only ever moves DOWN to a number its
 * predecessors have already vacated, so the unique (tripId, dropSeq) is never
 * hit by this pass alone. A concurrent add only ever takes MAX + 1, above every
 * target here.
 *
 * ⚠ NEVER THROWS. The delete that called it has already happened; failing the
 * caller would report a removed bill as not removed. A race (P2002 from a
 * concurrent compaction, P2025 from a row deleted under us) gets ONE retry from
 * a fresh read, then a warning — never a loop. A leftover gap is harmless and
 * the next remove heals it.
 *
 * No trip_activity / order_status_logs row and no `orders` write: a renumber is
 * not something a planner did.
 */
export async function compactTripDropSeq(tripId: number): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const drops = await prisma.trip_drops.findMany({
        where: { tripId },
        orderBy: { dropSeq: "asc" },
        select: { id: true, dropSeq: true },
      });
      for (let i = 0; i < drops.length; i++) {
        if (drops[i].dropSeq !== i + 1) {
          await prisma.trip_drops.update({ where: { id: drops[i].id }, data: { dropSeq: i + 1 } });
        }
      }
      return;
    } catch (err) {
      if (attempt === 2) {
        console.warn(
          `[trips] could not close up stop numbers on trip ${tripId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}

/** The order fields the stop needs: the drop-key inputs plus SAP's ship-to name. */
export interface TripDropInput extends DropKeyInput {
  /** orders.shipToCustomerName — the name fallback when the master has none. */
  shipToCustomerName: string | null;
}

/**
 * The stop on `tripId` for this bill's customer — found by (tripId, dropKey),
 * or created with dropSeq = MAX + 1 and a customer snapshot.
 *
 * A second bill for the same stop reuses the row and does NOT refresh the
 * snapshot.
 */
export async function findOrCreateTripDrop(tripId: number, order: TripDropInput): Promise<{ id: number }> {
  const dropKey = computeDropKey(order);

  // The unique is (tripId, dropKey), so this is the natural lookup and the
  // constraint is the backstop if two planners add bills for the same shop at once.
  const existing = await prisma.trip_drops.findFirst({
    where: { tripId, dropKey },
    select: { id: true },
  });
  if (existing) return existing;

  // dropSeq = max + 1, from 1. MAX+1 not COUNT+1: stops close up on remove
  // (compactTripDropSeq), but a compaction that lost a race can leave a gap,
  // and a count would then reuse a number the unique still holds.
  const last = await prisma.trip_drops.findFirst({
    where: { tripId },
    orderBy: { dropSeq: "desc" },
    select: { dropSeq: true },
  });
  const dropSeq = (last?.dropSeq ?? 0) + 1;

  // The customer snapshot for the sheet. Resolved through the EFFECTIVE
  // customer — the same id `computeDropKey` keyed on, so the name and the
  // key can never describe different shops.
  const effectiveId = effectiveCustomerId(order);
  // TYPED SHIP-TO (v27.73, step 7A, 2026-10-20) — its own stop. The key body
  // and the column come from ONE function (dropShipToText), so the live CHECK
  // dropKey = 't:' || shipToText always holds.
  const typedText = dropShipToText(order);
  const customer =
    effectiveId !== null
      ? await prisma.delivery_point_master.findUnique({
          where: { id: effectiveId },
          select: {
            id: true,
            customerName: true,
            area: { select: { name: true, primaryRoute: { select: { name: true } } } },
          },
        })
      : null;

  // A typed stop's area and route are the PICKED area's (routing follows the
  // typed area everywhere — owner, 2026-10-20), never the dealer's. One read,
  // only for a typed stop.
  const typedArea =
    typedText !== null && order.shipToAreaId !== null
      ? await prisma.area_master.findUnique({
          where: { id: order.shipToAreaId },
          select: { name: true, primaryRoute: { select: { name: true } } },
        })
      : null;
  const dealerName = dealerDisplayName(customer?.customerName, order.shipToCustomerName);

  return prisma.trip_drops.create({
    data: {
      tripId,
      dropSeq,
      customerId: customer?.id ?? null,
      // ALWAYS SAP's own code — the CHECK reads it on the fallback branch
      // and the column is NOT NULL.
      shipToCode: dropShipToCode(order),
      // 🔴 chk_trip_drops_key REJECTS A WRONG VALUE. There is no default
      // on this column; it is computed by the one module that owns the
      // rule (lib/trips/drop-key.ts) and never inline.
      dropKey,
      shipToText: typedText,
      // The name that goes on the sheet. Master name first, then the name
      // SAP put on the bill, then the literal — the same fallback ladder
      // lib/picking/queue.ts uses for `dealerName`, so an unmatched bill
      // still names a real shop instead of printing "(Unmatched)" on a
      // driver's paperwork.
      //
      // `nonBlank` since 2026-09-29 (dealerDisplayName): a bare `??` let an
      // empty or whitespace-only SAP name through and made a BLANK stop.
      // Existing snapshots are not rewritten.
      //
      // A TYPED stop (owner, 2026-10-20): the site name as typed; "As per
      // challan" is never a stop name — the dealer's name stands instead.
      // customerId above stays the bill's dealer (the CHECK does not read it on
      // the t: branch); trip reports still find the dealer by it.
      customerName:
        typedText !== null && !isAsPerChallanBill(order) ? (order.shipToText as string).trim() : dealerName,
      areaName: typedText !== null ? (typedArea?.name ?? null) : (customer?.area?.name ?? null),
      routeName: typedText !== null ? (typedArea?.primaryRoute?.name ?? null) : (customer?.area?.primaryRoute?.name ?? null),
    },
    select: { id: true },
  });
}
