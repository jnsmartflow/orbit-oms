import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { logTripCancelled } from "@/lib/trips/activity";
import { cancelledTripNumber, isTripNumberCollision } from "@/lib/trips/number";
import { prisma } from "@/lib/prisma";
import { DISPATCHED } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

interface Failed {
  orderId: number;
  error: string;
}

/**
 * POST /api/floor/trips/[id]/cancel — call off a trip.
 *
 * 🔴 A CANCELLED TRIP GIVES ITS NUMBER BACK, DELIBERATELY (slice 5, 2026-09-15).
 * Cancel L-260914-03 and the trip is renamed L-260914-03-C (then -C2, -C3 if
 * that is taken — cancelledTripNumber, lib/trips/number.ts), and the next trip
 * built that day and type takes 03 again. WHY: the day's numbers are how the
 * floor reads the day's loads, and a run of 01, 02, 04, 05, 07 left behind by
 * cancelled drafts read as missing loads rather than as plans that changed.
 *
 * ⚠ THE COST, ACCEPTED BY THE OWNER: a sheet printed for the cancelled trip
 * carries the same number as its successor. The safeguard is on the successor —
 * its `created` activity row says "number reused, previously held by
 * L-260914-03-C" — so two sheets with one number can always be traced.
 *
 * 🔴 THE RENAME IS NOT COSMETIC. trips_date_type_seq_live_key excludes cancelled
 * trips, which frees the SEQ; `trips_tripNumber_key` still covers every row, so
 * a cancelled trip left named L-260914-03 would refuse every attempt to reuse
 * 03. chk_trips_number_shape now admits the -C suffix on a cancelled trip only,
 * and the status and the new name go in ONE `trips.update` below.
 *
 * 🔴 AND IT IS STILL CANCELLED, NEVER DELETED. The row keeps its history, its
 * drops and its stamps under the new name; `trip_activity` is ON DELETE
 * RESTRICT, so a trip with history cannot be deleted at all. (CORE §3 forbids
 * deleting files; this is the same instinct applied to a row.)
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
 * ⚠ VISIBILITY IS PER TRIP SINCE SLICE 8 (2026-09-15), AND CANCEL NEEDS NOTHING
 * FOR IT. Detaching the bills puts them on no trip, and a bill on no trip is
 * always visible to the floor whatever desk control says — so a cancelled trip's
 * waiting bills return to To plan visible, which is the truthful state, and a
 * bill a picker is already holding stays with him (never gated).
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

  // ── A TRIP THAT HAS ALREADY GONE CANNOT BE CALLED OFF (2026-09-13) ────────
  //
  // 🔴 REFUSING IS THE ONLY HONEST ANSWER OF THE THREE. Since confirming began
  // marking bills `dispatched` (now POST …/dispatch, lib/floor/dispatch.ts), a
  // cancel can now meet goods that are recorded as having left. Both obvious
  // behaviours are worse than refusing:
  //
  //   - detach and leave them dispatched → a cancelled trip whose bills say
  //     they shipped on it. The trip is gone and the record still claims a
  //     load that officially never happened.
  //   - detach and un-dispatch them → silently rewriting the history of real
  //     goods on a real truck, from a button labelled "Cancel trip".
  //
  // Refusing does neither, and it is the RECOVERABLE direction: admitting this
  // case later is one edit, while an un-dispatch cannot be taken back and
  // `order_status_logs` is insert-only. If an undo is ever wanted it belongs in
  // its own deliberate action that writes `dispatched → pick_checked` log rows,
  // never as a side effect of cancelling.
  //
  // ⚠ THE COUNT IS IN THE MESSAGE. "Cannot cancel" sends the operator looking
  // for a bug; "3 bills on it are already marked dispatched" tells them what
  // happened and what to do about it.
  //
  // ⚠ IT SITS ABOVE THE DETACH LOOP, so a refusal writes nothing at all — the
  // same shape as the `cancelled` and `dispatched` status checks above it.
  const dispatchedCount =
    drops.length > 0
      ? await prisma.orders.count({
          where: { tripDropId: { in: drops.map((d) => d.id) }, workflowStage: DISPATCHED },
        })
      : 0;
  if (dispatchedCount > 0) {
    return NextResponse.json(
      {
        error:
          `This trip cannot be cancelled — ${dispatchedCount} bill${dispatchedCount === 1 ? " on it is" : "s on it are"} ` +
          `already marked dispatched. The load has gone; cancelling it now would either leave those bills ` +
          `claiming a trip that never ran, or rewrite the record of goods that really shipped.`,
        dispatchedCount,
      },
      { status: 409 },
    );
  }
  const orders =
    drops.length > 0
      ? await prisma.orders.findMany({
          where: { tripDropId: { in: drops.map((d) => d.id) } },
          // 🔴 `obdNumber` IS READ HERE FOR THE ACTIVITY LOG AND THE READ CANNOT
          // MOVE LATER. The loop below sets `tripDropId` to null on every one of
          // these bills, and after that there is no way to ask which bills were
          // on this trip — the drop rows survive but hold nothing. This SELECT
          // is the last moment the answer exists.
          select: { id: true, obdNumber: true },
          orderBy: { id: "asc" },
        })
      : [];

  // ── THE NAME IT WILL CARRY (slice 5, 2026-09-15) ──────────────────────────
  // Every name already taken under this number's -C family, read BEFORE the
  // log so the log can say both names. `startsWith` cannot over-match another
  // number: every base is {T}-{YYMMDD}-{two or more digits}, so
  // "L-260914-10-C…" never starts with "L-260914-1-C".
  const takenCancelNames = await prisma.trips.findMany({
    where: { tripNumber: { startsWith: `${trip.tripNumber}-C` } },
    select: { tripNumber: true },
  });
  const renamedTo = cancelledTripNumber(
    trip.tripNumber,
    takenCancelNames.map((t) => t.tripNumber),
  );

  // ── THE RECORD, WRITTEN BEFORE THE ERASURE (2026-09-14, slice 2) ─────────
  // Deliberately ahead of the detach loop rather than after it. Written even
  // when the trip carried nothing: an empty load being called off is still a
  // thing that happened, and `obdNumbers: []` says so precisely.
  //
  // ⚠ IT LOGS THE INTENT, AND THE LOOP BELOW CAN STILL PARTLY FAIL. The
  // alternative — logging afterwards from the `detached` list — loses the whole
  // record if the process dies mid-loop, which is the failure that matters.
  // A bill that refused to detach is reported to the caller in `failed`.
  await logTripCancelled({
    tripId,
    actorId: cancelledById,
    tripNumber: trip.tripNumber,
    renamedTo,
    orderIds: orders.map((o) => o.id),
    obdNumbers: orders.map((o) => o.obdNumber),
    // ⚠ NO REASON IS PASSED, because this route does not take one — it reads
    // `_req` and never parses a body. `logTripCancelled` accepts one so a later
    // slice can add the field without touching the writer; inventing a body
    // parameter here would be a different change than the one asked for.
  });

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

  // chk_trips_cancelled_complete requires BOTH stamps alongside the status, and
  // chk_trips_number_shape requires the -C name alongside it too — so all four
  // go in this ONE update, never two.
  //
  // ⚠ A P2002 HERE HAS ONE REAL CAUSE: the same trip cancelled by two presses at
  // once, the first having already taken the -C name. No two LIVE trips can
  // share a number (trips_date_type_seq_live_key), so no other trip can race for
  // this -C family. Re-read and answer as the already-cancelled skip; anything
  // else is a genuine fault and says so rather than renaming a second time.
  let updated;
  try {
    updated = await prisma.trips.update({
      where: { id: tripId },
      data: { status: "cancelled", cancelledAt: new Date(), cancelledById, tripNumber: renamedTo },
      select: { id: true, tripNumber: true, status: true, cancelledAt: true },
    });
  } catch (err) {
    if (!isTripNumberCollision(err)) throw err;
    const now = await prisma.trips.findUnique({
      where: { id: tripId },
      select: { id: true, tripNumber: true, status: true },
    });
    if (now?.status === "cancelled") {
      return NextResponse.json({
        trip: { id: now.id, tripNumber: now.tripNumber, status: now.status },
        detached,
        failed,
        alreadyCancelled: true,
      });
    }
    return NextResponse.json(
      { error: `Could not rename the cancelled trip to ${renamedTo} — that name is taken. Try again.`, detached, failed },
      { status: 409 },
    );
  }

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
