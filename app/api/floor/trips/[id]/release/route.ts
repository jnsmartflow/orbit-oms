import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { releaseBillsToFloor } from "@/lib/floor/release";
import { stampPickVisibility } from "@/lib/picking/visibility-gate";

export const dynamic = "force-dynamic";

/**
 * POST /api/floor/trips/[id]/release — release a trip to the floor.
 *
 * Three things happen, in this order:
 *   1. every releasable bill on the trip gets the FULL release — the trip's
 *      slot, `dispatchStatus='dispatch'`, `workflowStage=pending_picking`,
 *      `dispatchSlotSource='manual'`, and one log row (lib/floor/release.ts),
 *   2. every bill on the trip that is now at `pending_picking` gets the
 *      visibility stamp (lib/picking/visibility-gate.ts), and
 *   3. the trip moves to `released` with its own audit stamps.
 *
 * 🔴 STEP 1 IS THE FIX, AND IT IS WHY THIS ROUTE WAS WRONG BEFORE.
 * It used to call `stampPickVisibility` and nothing else. That function refuses
 * any bill not already at `SUPPORT_DONE_OUTPUT`, so a bill at `pending_support`
 * put on a trip and released stayed at `pending_support`, kept `dispatchStatus`
 * NULL, never reached the picking board, and came back in a bucket this route
 * had labelled as though a picker already had it. Three failures, one of them a
 * lie on screen. Diagnosis: `code-discovery-2026-09-10-noslot-backlog.md §B5`.
 *
 * 🔴 NEITHER WRITE IS REIMPLEMENTED HERE. `releaseBillsToFloor` is shared with
 * `POST /api/floor/release`; `stampPickVisibility` is shared with
 * `POST /api/floor/pick-visible`. ONE OWNER PER BEHAVIOUR — a second copy of
 * either is two answers to the same question, and the copy is always the one
 * that misses the next rule change.
 *
 * 🔴 IDEMPOTENT AND RE-RUNNABLE, DELIBERATELY. Calling this again on an
 * already-released trip releases whatever has since become releasable and skips
 * the rest. That is HOW A TINT BILL CATCHES UP: it sits on the trip through
 * `tint_assigned` → `tinting_in_progress`, is skipped into `waitingForTint`
 * each time, and the run after its shades finish releases it. The trip's own
 * `releasedAt`/`releasedById` are stamped only on the FIRST release, so a
 * re-run cannot overwrite who released it or when.
 *
 * ⚠ A TRIP WITH NO SLOT CANNOT BE RELEASED — 409. The release writes the trip's
 * window onto its bills, and a trip with `dispatchWindowId` NULL has nothing to
 * write. Writing a null window would hand the floor a bill with a dispatch
 * status and no time, which sorts nowhere and reads as an error on every board.
 *
 * ⚠ THE BUCKETS ARE HONEST AND A REFUSAL IS NEVER RE-LABELLED:
 *   released       — the full write happened
 *   alreadyVisible — already released and already on the floor; stamped, or the
 *                    stamp was already there
 *   waitingForTint — mid-tint, skipped, NOT an error, with the stage
 *   failed         — a real failure, with the reason
 *
 * ⚠ NO EXTRA `order_status_logs` ROWS. `releaseBillsToFloor` writes exactly one
 * per bill it releases; the visibility stamp writes none, and the trip carries
 * its own stamps. Attach and detach still write none at all.
 *
 * ⚠ THE TRIP AND THE GATE SWITCH STAY INDEPENDENT. This route never reads
 * `isPickGateOn()` and never touches `app_settings` (decision record §2.1:
 * gate-off must be a full no-op for the trip board).
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
    select: {
      id: true,
      tripNumber: true,
      status: true,
      tripDate: true,
      dispatchWindowId: true,
      releasedAt: true,
      releasedById: true,
    },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // A finished trip is finished. `draft` and `released` both proceed — see the
  // idempotency note in the header; `loading` proceeds too, because a bill can
  // still catch up while the van is being loaded.
  if (trip.status === "cancelled" || trip.status === "dispatched") {
    return NextResponse.json(
      { error: `A ${trip.status} trip cannot be released.` },
      { status: 409 },
    );
  }

  // (b) No slot → nothing to write. Refused before anything is read or written.
  if (trip.dispatchWindowId === null) {
    return NextResponse.json(
      {
        error:
          "This trip has no slot — set a dispatch window before releasing it, " +
          "or its bills would reach the floor with no time on them.",
      },
      { status: 409 },
    );
  }

  // The window's label, for the log note. ONE read for the whole trip, never
  // per bill.
  const window = await prisma.dispatch_slot_master.findUnique({
    where: { id: trip.dispatchWindowId },
    select: { windowTime: true },
  });
  const windowLabel = window?.windowTime ?? String(trip.dispatchWindowId);

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

  // An EMPTY trip cannot be released. Stamping the trip as though something
  // happened would put a `released` trip with no bills on the board, with no way
  // to tell it from one whose bills were all removed afterwards.
  if (orders.length === 0) {
    return NextResponse.json(
      { error: "This trip has no bills — add bills before releasing it." },
      { status: 422 },
    );
  }
  const orderIds = orders.map((o) => o.id);

  // ── STEP 1 · the full release, through the shared writer ─────────────────
  //
  // `skipAlreadyReleased: true` is (c): a bill already at `pending_picking` with
  // `dispatchStatus: 'dispatch'` keeps the slot it has. It may have been set
  // deliberately and may differ from this trip's; rewriting it would silently
  // move a promised time because the bill happened to be on a trip, and would
  // spend an `orders.update` — and therefore a false marker change on every
  // board — doing it.
  const rel = await releaseBillsToFloor({
    orderIds,
    targetDate: trip.tripDate,
    windowId: trip.dispatchWindowId,
    windowLabel,
    actorId: releasedById,
    noteLabel: `Released with trip ${trip.tripNumber}`,
    skipAlreadyReleased: true,
  });

  // ── STEP 2 · the visibility stamp ────────────────────────────────────────
  //
  // Only the bills that are NOW at `pending_picking` — the ones just released,
  // plus the ones that already were. A mid-tint or failed bill is deliberately
  // not offered: `stampPickVisibility` would refuse it, and feeding it a request
  // guaranteed to fail just to re-bucket the refusal is exactly the dishonesty
  // this rewrite removes.
  const stampable = [...rel.released, ...rel.alreadyReleased];
  const stamp =
    stampable.length > 0
      ? await stampPickVisibility({ orderIds: stampable, visible: true, actorId: releasedById })
      : { changed: [], skipped: [], failed: [] };

  // A stamp failure is a REAL failure and is reported as one. It should not
  // happen — every id here was at `pending_picking` a moment ago — but a race
  // (a supervisor assigning in the same second) can produce it, and the honest
  // answer is to say so rather than fold it into a friendlier bucket.
  const allFailed = [...rel.failed, ...stamp.failed];

  // Nothing achieved at all → the trip does NOT move. A `released` trip whose
  // bills are all still unreleased is a lie on the board.
  //
  // ⚠ `waitingForTint` COUNTS AS ACHIEVED. A trip of nothing but mid-tint bills
  // is a legitimate, expected state: the planner has built tomorrow's load and
  // the paint is still being mixed. Releasing it now is what makes the trip
  // re-runnable later, and refusing would leave him unable to confirm a plan he
  // has finished making.
  if (
    rel.released.length === 0 &&
    rel.alreadyReleased.length === 0 &&
    rel.waitingForTint.length === 0
  ) {
    return NextResponse.json(
      {
        error: "No bill on this trip could be released.",
        released: [],
        alreadyVisible: [],
        waitingForTint: [],
        failed: allFailed,
      },
      { status: 422 },
    );
  }

  // ── STEP 3 · the trip's own state ────────────────────────────────────────
  //
  // ⚠ THE STAMPS ARE WRITTEN ONCE. On a re-run the trip is already `released`
  // and `releasedAt`/`releasedById` are left exactly as they were — a catch-up
  // release of one tint bill must not rewrite who released the load, or when.
  // The status write is still made so a `draft` trip advances on its first run.
  const alreadyReleasedTrip = trip.releasedAt !== null;
  const updated = await prisma.trips.update({
    where: { id: tripId },
    data: alreadyReleasedTrip
      ? { status: trip.status === "draft" ? "released" : trip.status }
      : { status: "released", releasedAt: new Date(), releasedById },
    select: { id: true, tripNumber: true, status: true, releasedAt: true },
  });

  return NextResponse.json({
    trip: {
      id: updated.id,
      tripNumber: updated.tripNumber,
      status: updated.status,
      releasedAt: updated.releasedAt?.toISOString() ?? null,
    },
    // The full write happened on these.
    released: rel.released,
    // Already on the floor. `stamp.changed` are the ones whose visibility stamp
    // moved just now; `stamp.skipped` were already stamped. Both are "already
    // visible" from the planner's point of view, which is what the bucket says.
    alreadyVisible: [...rel.alreadyReleased, ...stamp.skipped].filter(
      (id, i, a) => a.indexOf(id) === i,
    ),
    // Newly stamped — a subset of `released` + `alreadyVisible`, reported so a
    // caller can say "8 shown to the floor" without recomputing it.
    stamped: stamp.changed,
    // 🔴 SKIPPED, NOT FAILED. Re-run the release once the shades are done.
    waitingForTint: rel.waitingForTint,
    failed: allFailed,
  });
}
