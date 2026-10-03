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
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { computeDropKey, dropShipToCode, effectiveCustomerId, type DropKeyInput } from "@/lib/trips/drop-key";
import { dealerDisplayName } from "@/lib/orders/dealer-name";

/**
 * Delete a stop that now holds nothing — no order and no re-delivery. Returns
 * true when it deleted. ONE rule for both remove paths (bills and re-deliveries).
 *
 * ⚠ `isRemoved` IS DELIBERATELY NOT FILTERED. A soft-removed bill still carries
 * its `tripDropId`, so a drop holding only removed bills is NOT empty — deleting
 * it would clear their pointers through the FK's ON DELETE SET NULL and lose
 * where they were. The read side hides them from counts (lib/trips/queries.ts).
 *
 * ⚠ RE-DELIVERIES COUNT (2026-10-03). trip_redeliveries.tripDropId is ON DELETE
 * RESTRICT, so deleting a stop under one would fail; it must simply stay.
 */
export async function deleteTripDropIfEmpty(dropId: number): Promise<boolean> {
  const orders = await prisma.orders.count({ where: { tripDropId: dropId } });
  if (orders > 0) return false;
  const redeliveries = await prisma.trip_redeliveries.count({ where: { tripDropId: dropId } });
  if (redeliveries > 0) return false;
  await prisma.trip_drops.delete({ where: { id: dropId } });
  return true;
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

  // dropSeq = max + 1, from 1. MAX+1 not COUNT+1: removing the last bill
  // from a stop deletes the row and leaves a gap, and a count would then
  // reuse a number the unique still holds.
  //
  // ⚠ GAPS ARE LEFT ALONE, deliberately. Uniqueness is on
  // (tripId, dropSeq), never contiguity. Renumbering the survivors would
  // change a stop order a driver may already have been given.
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
      // The name that goes on the sheet. Master name first, then the name
      // SAP put on the bill, then the literal — the same fallback ladder
      // lib/picking/queue.ts uses for `dealerName`, so an unmatched bill
      // still names a real shop instead of printing "(Unmatched)" on a
      // driver's paperwork.
      //
      // `nonBlank` since 2026-09-29 (dealerDisplayName): a bare `??` let an
      // empty or whitespace-only SAP name through and made a BLANK stop.
      // Existing snapshots are not rewritten.
      customerName: dealerDisplayName(customer?.customerName, order.shipToCustomerName),
      areaName: customer?.area?.name ?? null,
      routeName: customer?.area?.primaryRoute?.name ?? null,
    },
    select: { id: true },
  });
}
