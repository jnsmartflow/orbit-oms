import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { stampPickVisibility } from "@/lib/picking/visibility-gate";

export const dynamic = "force-dynamic";

/**
 * POST /api/floor/trips/[id]/release — release a trip to the floor.
 *
 * Two things happen, in this order:
 *   1. every bill on the trip is handed to the picking floor (the visibility
 *      stamp), and
 *   2. the trip moves to `released` with its audit stamps.
 *
 * 🔴 THE STAMPING IS NOT REIMPLEMENTED HERE. It calls
 * `stampPickVisibility()` in lib/picking/visibility-gate.ts — the same function
 * `/api/floor/pick-visible` calls, extracted from that route for exactly this
 * reason. ONE OWNER PER BEHAVIOUR: two copies would be two answers to "may this
 * bill be handed over", on the same column, on the same screen, and the second
 * copy is always the one that misses the next rule change.
 *
 * 🔒 THE LOCKED RULE SURVIVES UNTOUCHED. Only a bill at `SUPPORT_DONE_OUTPUT`
 * (`pending_picking`) can be stamped. A bill already assigned, picked or checked
 * is NOT an error and NOT a reason to fail the release — it is already visible
 * and there is nothing to hand over. It lands in `notWaiting` below and the
 * trip still releases.
 *
 * ⚠ THE BUCKETS ARE REPORTED HONESTLY AND SEPARATELY:
 *   stamped       — bills whose stamp actually moved (work appeared on a phone)
 *   alreadyVisible — bills already handed over; no write happened
 *   notWaiting     — bills past `pending_picking`; nothing to do, already with
 *                    the floor by definition
 *   failed         — bills that genuinely could not be read or written
 * Collapsing the middle two into "released" would claim writes that did not
 * happen, which is the trap the `changed` / `shown` rename in pick-visible was
 * made to avoid.
 *
 * ⚠ NO `order_status_logs` ROWS. The bills carry `pickVisibleAt`/`pickVisibleById`
 * and the trip carries `releasedAt`/`releasedById`; a log row would be a third
 * copy and a second write per bill (the marker landmine — FLOOR §4/§10).
 *
 * ⚠ THE TRIP AND THE GATE SWITCH STAY INDEPENDENT. This route never reads
 * `isPickGateOn()` and never touches `app_settings`. Release stamps
 * `pickVisibleAt` whether the gate is on or off — with it off the stamp is
 * simply not being filtered on, and the floor sees no change. That is the
 * decision record's §2.1 requirement that gate-OFF be a full no-op for the trip
 * board, and it is why nothing here branches on the switch.
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
  const releasedById = Number(session.user.id);
  if (!Number.isInteger(releasedById) || releasedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const trip = await prisma.trips.findUnique({
    where: { id: tripId },
    select: { id: true, status: true, releasedAt: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Only a draft can be released. Re-releasing a live trip would re-stamp every
  // bill and overwrite the original actor and time — and `stampPickVisibility`
  // would correctly skip them all, so the trip's own stamps would move while
  // nothing else did. Refuse instead of half-acting.
  if (trip.status !== "draft") {
    return NextResponse.json(
      { error: `Only a draft trip can be released — this one is ${trip.status}.` },
      { status: 409 },
    );
  }

  // The trip's bills, via its drops. TWO batched reads keyed on an IN list —
  // never an include chain (lib/picking/queue.ts:537-554).
  const drops = await prisma.trip_drops.findMany({
    where: { tripId },
    select: { id: true },
  });
  const orders =
    drops.length > 0
      ? await prisma.orders.findMany({
          where: { tripDropId: { in: drops.map((d) => d.id) }, isRemoved: false },
          select: { id: true },
          orderBy: { id: "asc" },
        })
      : [];

  // An EMPTY trip cannot be released. Releasing nothing to the floor, and
  // stamping the trip as though something happened, would put a `released` trip
  // with no bills on the board and no way to tell it from one whose bills were
  // all removed afterwards.
  if (orders.length === 0) {
    return NextResponse.json(
      { error: "This trip has no bills — add bills before releasing it." },
      { status: 422 },
    );
  }

  // Hand the bills over, through the one owner of that rule.
  const stamp = await stampPickVisibility({
    orderIds: orders.map((o) => o.id),
    visible: true,
    actorId: releasedById,
  });

  // Split the refusals. A bill past `pending_picking` is NOT a failure of the
  // release — it is already with the floor. `stampPickVisibility` reports it in
  // `failed` because for its own caller (the Show button) it IS a refusal; here
  // it is an expected, ordinary state, so it is re-bucketed rather than
  // surfaced as an error the planner cannot act on.
  //
  // ⚠ The test reads the MESSAGE, which is a seam worth naming: the function
  // returns a string, not a code. It is stable because both messages are
  // written in one place, and if a third refusal reason is ever added there it
  // will land in `failed` here — the safe direction, since an unknown refusal
  // should be visible rather than quietly filed as "already with the floor".
  const notWaiting: number[] = [];
  const failed: typeof stamp.failed = [];
  for (const f of stamp.failed) {
    if (f.error.includes("only waiting bills can be shown")) notWaiting.push(f.orderId);
    else failed.push(f);
  }

  // Every bill genuinely failed → the trip does NOT move. A `released` trip
  // whose bills are all still hidden is a lie on the board.
  if (stamp.changed.length === 0 && stamp.skipped.length === 0 && notWaiting.length === 0) {
    return NextResponse.json(
      { error: "No bill on this trip could be released.", stamped: [], alreadyVisible: [], notWaiting, failed },
      { status: 422 },
    );
  }

  // ONE trips.update. `releasedAt`/`releasedById` are the trip's own audit
  // stamps — the reason no order_status_logs row is written for any of this.
  const updated = await prisma.trips.update({
    where: { id: tripId },
    data: { status: "released", releasedAt: new Date(), releasedById },
    select: { id: true, tripNumber: true, status: true, releasedAt: true },
  });

  return NextResponse.json({
    trip: {
      id: updated.id,
      tripNumber: updated.tripNumber,
      status: updated.status,
      releasedAt: updated.releasedAt?.toISOString() ?? null,
    },
    stamped: stamp.changed,
    alreadyVisible: stamp.skipped,
    notWaiting,
    failed,
  });
}
