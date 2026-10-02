import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { freightGate } from "@/lib/freight-trips/gate";
import { getFreightTrip, isCancelled } from "@/lib/freight-trips/queries";
import { logFreightCancelled } from "@/lib/freight-trips/activity";
import { FREIGHT_TRIP_STATUS, REMOVED_REASON } from "@/lib/freight-trips/status";

export const dynamic = "force-dynamic";

/**
 * POST /api/freight-trips/[id]/cancel — cancel a freight trip. Kept, never deleted.
 *
 * ORDER, without $transaction (CORE §3):
 *   1. activity 'cancelled' with every OBD on the trip (the record survives even
 *      if a later step fails);
 *   2. ONE updateMany stamping removedAt / removedById / 'trip_cancelled' on the
 *      ACTIVE rows — the bills are free for another trip at once;
 *   3. the trip → cancelled + cancelledAt / cancelledById (one update, as
 *      chk_freight_trips_cancelled_complete requires them together).
 * Bills first: if step 3 fails the trip is active-but-empty and Cancel can be
 * pressed again; the reverse order could leave a cancelled trip still holding
 * bills against the partial unique index.
 *
 * Idempotent: an already-cancelled trip answers 200 and writes nothing.
 * Writes freight tables ONLY — never a bill.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await freightGate("canEdit");
  if (!gate.ok) return gate.response;
  const userId = gate.userId;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const trip = await prisma.freight_trips.findUnique({ where: { id }, select: { id: true, tripNumber: true, status: true } });
  if (!trip) return NextResponse.json({ error: "Freight trip not found" }, { status: 404 });
  if (isCancelled(trip.status)) {
    return NextResponse.json({ trip: await getFreightTrip(id), alreadyCancelled: true });
  }

  const active = await prisma.freight_trip_bills.findMany({
    where: { freightTripId: id, removedAt: null },
    select: { orderId: true, order: { select: { obdNumber: true } } },
  });

  await logFreightCancelled({
    freightTripId: id,
    actorId: userId,
    tripNumber: trip.tripNumber,
    obdNumbers: active.map((r) => r.order.obdNumber),
  });

  const now = new Date();
  if (active.length > 0) {
    await prisma.freight_trip_bills.updateMany({
      where: { freightTripId: id, removedAt: null },
      data: { removedAt: now, removedById: userId, removedReason: REMOVED_REASON.tripCancelled },
    });
  }

  await prisma.freight_trips.update({
    where: { id },
    data: { status: FREIGHT_TRIP_STATUS.cancelled, cancelledAt: now, cancelledById: userId },
  });

  return NextResponse.json({ trip: await getFreightTrip(id), freed: active.map((r) => r.orderId) });
}
