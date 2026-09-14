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
 * ⚠ THE ONE READ OF `orders` IS A COUNT, and it exists for the empty-trip
 * refusal below. Reads are not writes; the live-sync markers cannot see it.
 *
 * ⚠ `trips.dispatchWindowId` IS NOT READ. The old route branched on it
 * (`hasSlot` → `needsSlot`); nothing does now, and the slot is display-only.
 *
 * ⚠ A BRIDGE, AND KNOWN TO BE ONE. Slice 6 removes the Draft / Confirmed words
 * and slice 10 replaces the draft carry-forward rule (lib/trips/live-trips.ts)
 * with one based on the bills inside. Until then this press is what stops a
 * finished draft following the planner onto every later day's desk, and what
 * puts Mark dispatched on the header (it renders on a non-draft trip only).
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

  // An EMPTY trip cannot be confirmed — the rule the old route kept. A
  // confirmed trip with no bills is indistinguishable on the board from one
  // whose bills were all removed afterwards. The button is disabled at zero
  // too; this is the server's half.
  const drops = await prisma.trip_drops.findMany({ where: { tripId }, select: { id: true } });
  const billCount =
    drops.length > 0
      ? await prisma.orders.count({
          where: { tripDropId: { in: drops.map((d) => d.id) }, isRemoved: false },
        })
      : 0;
  if (billCount === 0) {
    return NextResponse.json(
      { error: "This trip has no bills — add bills before confirming it." },
      { status: 422 },
    );
  }

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
