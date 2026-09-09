import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Failed {
  orderId: number;
  error: string;
}

/**
 * POST /api/floor/trips/[id]/cancel — call off a trip.
 *
 * 🔴 A TRIP IS CANCELLED, NEVER DELETED, AND THE REASON IS THE NUMBER.
 * `allocateTripNumber` reads MAX(seq)+1 for the (tripDate, typeCode) pair. Delete
 * a row and its seq becomes reachable again — the next trip built that day gets a
 * number that may already be on a printed sheet in a driver's hand, and the two
 * loads are indistinguishable afterwards. `trips_date_type_seq_key` would not
 * catch it either: the old row is gone, so there is nothing left to collide with.
 * The row and its number are retained precisely so that can never happen.
 *
 * (CORE §3 forbids deleting files; this is the same instinct applied to a row
 * whose identity is load-bearing outside the database.)
 *
 * 🔴 THE DROP ROWS STAY. Only `orders.tripDropId` is cleared. The drops are the
 * record of what was PLANNED — which stops, in which order — and a cancelled
 * trip that kept its number but lost its shape would answer "what did we call
 * off?" with nothing. `trip_drops.tripId` is ON DELETE CASCADE, so deleting the
 * trip would have taken them too; not deleting is what keeps them.
 *
 * ⚠ EXACTLY ONE `orders.update` PER BILL. The live-sync markers key on
 * MAX(orders.updatedAt), so a second write per bill fires a false "changed" on
 * every board (FLOOR §4/§10, PICKING §10).
 *
 * ⚠ NO `order_status_logs` ROWS. The trip carries `cancelledAt`/`cancelledById`,
 * and detaching a bill from a trip is not a workflow-stage event — the bill's
 * own stage is untouched by all of this. Same reasoning as attach/detach and the
 * visibility stamp.
 *
 * ⚠ THE BILLS' `pickVisibleAt` IS NOT CLEARED. Cancelling a trip does not
 * un-hand-over its bills: a picker may already be holding one, and the stage
 * guard in `stampPickVisibility` would refuse to pull it back anyway. The switch
 * and the stamps stay independent (the gate build's own locked rule), and so do
 * the trip and the stamps. A cancelled trip's waiting bills return to the At-desk
 * pool still visible to the floor, which is the truthful state.
 *
 * Sequential awaits, never prisma.$transaction (CORE §3).
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The real session user, never a body claim. chk_trips_cancelled_complete
  // requires BOTH cancelledAt and cancelledById, so a missing id would fail at
  // the database with a message nobody could act on.
  const cancelledById = Number(session.user.id);
  if (!Number.isInteger(cancelledById) || cancelledById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const trip = await prisma.trips.findUnique({
    where: { id: tripId },
    select: { id: true, tripNumber: true, status: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  if (trip.status === "cancelled") {
    // Already there. A skip, not a failure — and NO WRITE, or the cancel stamps
    // would move to whoever pressed the button second.
    return NextResponse.json({
      trip: { id: trip.id, tripNumber: trip.tripNumber, status: trip.status },
      detached: [],
      failed: [],
      alreadyCancelled: true,
    });
  }
  if (trip.status === "dispatched") {
    return NextResponse.json(
      { error: "This trip has already been dispatched and cannot be cancelled." },
      { status: 409 },
    );
  }

  // The trip's bills, through its drops. Two batched reads keyed on an IN list
  // — never an include chain (lib/picking/queue.ts:537-554).
  const drops = await prisma.trip_drops.findMany({
    where: { tripId },
    select: { id: true },
  });
  const orders =
    drops.length > 0
      ? await prisma.orders.findMany({
          where: { tripDropId: { in: drops.map((d) => d.id) } },
          select: { id: true },
          orderBy: { id: "asc" },
        })
      : [];

  // ⚠ NO `isRemoved: false` FILTER HERE, unlike every other orders read (CORE
  // §3's soft-delete rule). A soft-removed bill still carries its `tripDropId`,
  // and leaving that pointer would attach it to a cancelled trip forever — the
  // read side hides it from counts, but the pointer would outlive the trip. This
  // is a detach, not a display, so it takes every row.
  const detached: number[] = [];
  const failed: Failed[] = [];

  for (const o of orders) {
    try {
      // ONE orders.update per bill.
      await prisma.orders.update({
        where: { id: o.id },
        data: { tripDropId: null },
      });
      detached.push(o.id);
    } catch (err) {
      failed.push({ orderId: o.id, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  // The trip itself moves LAST. If a detach threw, the trip stays as it was and
  // the operator can retry — a cancelled trip still holding bills would be the
  // worse half-state, because those bills would be invisible in the pool while
  // pointing at a trip nobody can act on.
  if (failed.length > 0 && detached.length === 0) {
    return NextResponse.json(
      { error: "Could not detach any bill — the trip was not cancelled.", detached, failed },
      { status: 422 },
    );
  }

  const updated = await prisma.trips.update({
    where: { id: tripId },
    // chk_trips_cancelled_complete requires BOTH stamps alongside the status.
    data: { status: "cancelled", cancelledAt: new Date(), cancelledById },
    select: { id: true, tripNumber: true, status: true, cancelledAt: true },
  });

  return NextResponse.json({
    trip: {
      id: updated.id,
      tripNumber: updated.tripNumber,
      status: updated.status,
      cancelledAt: updated.cancelledAt?.toISOString() ?? null,
    },
    detached,
    failed,
  });
}
