import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { markBillsDispatched } from "@/lib/floor/dispatch";
import { logTripDispatched } from "@/lib/trips/activity";
import { DISPATCHED } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

/**
 * POST /api/floor/trips/[id]/dispatch — the goods on this trip have gone.
 *
 * 🔴 THE THIRD PRESS, AND IT EXISTS BECAUSE THERE WERE ONLY TWO. The depot's day
 * is: build a draft, RELEASE it so pickers can see it, pick and check through
 * the morning, and DISPATCH bills as they become ready. Until today the app had
 * no button for the last step, so it rode on the release — one press at 04:15
 * shipped whatever happened to be checked at 04:15 and nothing could ship
 * afterwards. Live evidence on trip L-260914-01: two `order_status_logs` rows
 * stamped the same second as `releasedAt`, on a truck that had not moved.
 *
 * ⚠ RE-RUNNABLE, AND THAT IS THE WHOLE DESIGN. Press it at 11:00 and the four
 * bills checked by then go; press it again at 15:00 and the next six go. A bill
 * already at `dispatched` comes back in `alreadyDispatched`, which is a no-op
 * and not a failure, so a double-press writes nothing twice.
 *
 * ⚠ WHICH BILLS MOVE IS NOT DECIDED HERE. `markBillsDispatched`
 * (lib/floor/dispatch.ts) moves exactly the bills at `pick_checked` that are not
 * on hold, and it is deliberately NOT widened by this route: a bill still with a
 * picker has not shipped, and a HELD bill does not go whatever the trip says.
 * Everything left behind comes back in a named bucket with its stage, so the
 * operator is told what stayed and why.
 *
 * ⚠ CLOSING THE TRIP. When every bill on it is dispatched or on hold, the trip
 * moves to `dispatched` with `dispatchedAt`/`dispatchedById`. All three are
 * written TOGETHER because `chk_trips_dispatched_complete` requires it — the
 * live CHECK is `status <> 'dispatched' OR (dispatchedAt IS NOT NULL AND
 * dispatchedById IS NOT NULL)` — so a status write without the stamps is
 * rejected by the database, not by us. No column was added; all three already
 * existed.
 *
 * ⚠ A HELD BILL DOES NOT KEEP A TRIP OPEN FOREVER. It is counted as settled for
 * the closing test, for the same reason it is excluded from `isReady`
 * (lib/trips/queries.ts): a hold is a human saying "not this one", and a load
 * that has otherwise gone should not sit open waiting for a decision nobody
 * intends to make. The held bill keeps its own stage and its own pointer; it is
 * the TRIP that closes, not the bill.
 *
 * Gated on page key "floor", action `canEdit` — the same gate every other trip
 * write route uses, held live by admin, operations and floor_access. NOT
 * admin-only.
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

  // The real session user, never a body claim. The CHECK constraint above needs
  // it, so a missing id would fail at the database with a message nobody could
  // act on.
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
    select: { id: true, tripNumber: true, status: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  if (trip.status === "cancelled") {
    return NextResponse.json(
      { error: "This trip was cancelled — its bills are back at the desk." },
      { status: 409 },
    );
  }
  if (trip.status === "dispatched") {
    // Already closed. A skip, not a failure, and NO WRITE — the stamps would
    // otherwise move to whoever pressed it second.
    return NextResponse.json({
      trip: { id: trip.id, tripNumber: trip.tripNumber, status: trip.status },
      dispatched: [],
      alreadyDispatched: [],
      notDispatched: [],
      held: [],
      failed: [],
      alreadyClosed: true,
    });
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
          // `obdNumber` rides along for the ACTIVITY LOG — the bills that move
          // are named by the number on the paper, not by an internal id.
          select: { id: true, obdNumber: true },
          orderBy: { id: "asc" },
        })
      : [];

  if (orders.length === 0) {
    return NextResponse.json(
      { error: "This trip has no bills to dispatch." },
      { status: 422 },
    );
  }

  const disp = await markBillsDispatched({
    orderIds: orders.map((o) => o.id),
    actorId,
    noteLabel: `Dispatched with trip ${trip.tripNumber}`,
  });

  // ── CLOSE THE TRIP WHEN NOTHING IS LEFT TO SEND ──────────────────────────
  //
  // Re-read rather than inferred from the buckets above: `markBillsDispatched`
  // reports what IT did, and the question here is what the trip looks like NOW.
  // One extra count, and only when something actually moved — a press that
  // dispatched nothing cannot have changed whether the trip is finished.
  let closed = false;
  if (disp.dispatched.length > 0) {
    const outstanding = await prisma.orders.count({
      where: {
        tripDropId: { in: drops.map((d) => d.id) },
        isRemoved: false,
        workflowStage: { not: DISPATCHED },
        // A held bill is settled for this purpose — see the header.
        dispatchStatus: { not: "hold" },
      },
    });
    if (outstanding === 0) {
      await prisma.trips.update({
        where: { id: tripId },
        // All three together — the CHECK constraint refuses anything less.
        data: { status: "dispatched", dispatchedAt: new Date(), dispatchedById: actorId },
      });
      closed = true;
    }
  }

  // ── ONE ACTIVITY ROW PER PRESS (2026-09-14, slice 2) ────────────────────
  // ⚠ A TEMPORARY WRITER. Slice 4 deletes Mark dispatched and this call goes
  // with it; the `dispatched` action stays in the vocabulary.
  //
  // ⚠ SEVERAL ROWS PER TRIP IS CORRECT. This press is re-runnable through the
  // day — four bills at 11:00 and six more at 15:00 is two rows, which is what
  // happened. A press that moved nothing writes none.
  const obdById = new Map(orders.map((o) => [o.id, o.obdNumber]));
  await logTripDispatched({
    tripId,
    actorId,
    tripNumber: trip.tripNumber,
    orderIds: disp.dispatched,
    obdNumbers: disp.dispatched.map((id) => obdById.get(id) ?? String(id)),
    closed,
  });

  return NextResponse.json({
    trip: {
      id: trip.id,
      tripNumber: trip.tripNumber,
      status: closed ? "dispatched" : trip.status,
    },
    // The goods that just left. Terminal.
    dispatched: disp.dispatched,
    // Already gone on an earlier press. A no-op, not a failure.
    alreadyDispatched: disp.alreadyDispatched,
    // 🔴 LEFT IN THE BUILDING ON PURPOSE, WITH THE STAGE SO THE CALLER CAN SAY
    // WHY. Not a failure and never folded into one.
    notDispatched: disp.notChecked,
    // A hold outranks the trip. Its own bucket for the same reason.
    held: disp.held,
    failed: disp.failed,
    // True when this press closed the trip out.
    closed,
  });
}
