import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logTripReleased } from "@/lib/trips/activity";

export const dynamic = "force-dynamic";

/**
 * POST /api/floor/trips/[id]/confirm — Confirm plan. A draft trip becomes
 * `released`. That is ALL it does (slice 3, 2026-09-14).
 *
 * 🔴 IT TOUCHES NO ORDER ROW. NOT ONE COLUMN, NOT ONE LOG ROW.
 * This replaces POST /api/floor/trips/[id]/release, which ran the full floor
 * release over the trip's bills — slot, dispatch status, stage, visibility
 * stamp, a status log per bill. On the trips this depot builds that write
 * found nothing to do: every bill on a trip is already checked, and no held
 * bill was ever on one (FLOOR-TO-FLOOR-DISCOVERY.md §8.4). The route was a
 * trip-status write dressed as a bill write. The rule it now keeps is:
 *
 *     NO TRIP ACTION MAY CHANGE A BILL'S STATUS OR ITS HOLD.
 *
 * A bill reaches the floor through the import's auto-dispatch or the floor's
 * own Release; a hold is cleared on the floor, next to the held bill. Never
 * from here. Do not put a call to lib/floor/release.ts or
 * lib/picking/visibility-gate.ts back in this file.
 *
 * ⚠ THE ONE READ OF `orders` IS A COUNT, for the activity row's bill count.
 * Reads are not writes; the live-sync markers cannot see it.
 *
 * ⚠ `trips.dispatchWindowId` IS NOT READ. The old route branched on it
 * (`hasSlot` → `needsSlot`); nothing does now, and the slot is display-only.
 *
 * 🔴 NO CALLER ON THE FLOOR SCREEN SINCE SLICE 6 (2026-09-15). The Confirm plan
 * button went with the Draft / Confirmed words. Its job moved onto the vehicle:
 * a trip created with one is born `released` (POST /api/floor/trips), and a
 * PATCH that sets one on a draft writes `released` and the stamps in the same
 * update (PATCH /api/floor/trips/[id]). Mark dispatched renders on every open
 * trip, draft or not. This route is kept as the plain API for the same move.
 * Slice 10 replaces the draft carry-forward rule (lib/trips/live-trips.ts) that
 * all of this still feeds.
 *
 * ⚠ AN EMPTY TRIP CONFIRMS (slice 6). This refused a trip with no bills with a
 * 422 until the owner ruled an empty trip valid: the floor plans trucks before
 * the bills exist, and an empty confirmed trip is a truck with nothing on it
 * yet.
 *
 * Idempotent: an already-`released` trip answers 200 and writes nothing — no
 * status write, no stamp, no activity row.
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

  // The real session user, never a body claim.
  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const trip = await prisma.trips.findUnique({
    where: { id: tripId },
    select: { id: true, tripNumber: true, status: true, releasedAt: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  if (trip.status === "cancelled" || trip.status === "dispatched") {
    return NextResponse.json(
      { error: `A ${trip.status} trip cannot be confirmed.` },
      { status: 409 },
    );
  }

  const respond = (t: { id: number; tripNumber: string; status: string; releasedAt: Date | null }) =>
    NextResponse.json({
      trip: {
        id: t.id,
        tripNumber: t.tripNumber,
        status: t.status,
        releasedAt: t.releasedAt?.toISOString() ?? null,
      },
    });

  // Already confirmed — nothing to say and nothing to write.
  if (trip.status !== "draft") return respond(trip);

  // The bill count, for the activity row. ⚠ NOT A GATE: the 422 that refused an
  // empty trip here was removed in slice 6 — see the header.
  const drops = await prisma.trip_drops.findMany({ where: { tripId }, select: { id: true } });
  const billCount =
    drops.length > 0
      ? await prisma.orders.count({
          where: { tripDropId: { in: drops.map((d) => d.id) }, isRemoved: false },
        })
      : 0;

  // The stamps are written once. A trip only reaches this line from `draft`,
  // but `releasedAt` is still tested so a draft that was once released (none
  // exist; nothing moves a trip back) could never have its first stamp
  // overwritten.
  const updated = await prisma.trips.update({
    where: { id: tripId },
    data:
      trip.releasedAt !== null
        ? { status: "released" }
        : { status: "released", releasedAt: new Date(), releasedById: actorId },
    select: { id: true, tripNumber: true, status: true, releasedAt: true },
  });

  await logTripReleased({
    tripId,
    actorId,
    tripNumber: trip.tripNumber,
    billCount,
  });

  return respond(updated);
}
