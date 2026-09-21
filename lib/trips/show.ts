// lib/trips/show.ts
//
// SHOW TO FLOOR, PER TRIP (slice 8, 2026-09-15). The one owner of writing
// `trips.shownAt` / `shownById`.
//
// With desk control on, a WAITING bill reaches the supervisor's Assign tab only
// once it is on a trip and that trip is shown (lib/picking/visibility-gate.ts
// `waitingBranchWhere`). A bill on no trip is hidden (owner, 2026-09-21). One
// writer, here: `setTripShown` — the planner's Show to floor and the ··· menu's
// take-back.
//
// ⚠ TURNING DESK CONTROL ON SHOWS NOTHING. Until 2026-09-21
// `showTripsHoldingWaitingBills` (the no-cliff rule) marked every unshown trip
// holding a waiting bill as shown on an OFF → ON flip. The owner removed it — the
// planner's show choices stand — and the function went with its only caller
// (app/api/floor/pick-gate/route.ts). Old `trip_activity` rows with
// `via: "desk_control_on"` are its history; leave them.
//
// 🔴 EVERY WRITE HERE IS TO `trips`. Never an order row: no trip action may change
// a bill's status or its hold (the rule the rebuild follows since slice 3). A
// shown trip's bills become visible because the picking QUERY reads the trip, not
// because anything was stamped on them.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { WAITING_FOR_PICKER } from "@/lib/picking/visibility-gate";
import { logTripShown, logTripTakenBack } from "@/lib/trips/activity";

/** Waiting bills on one trip — what the supervisor sees once it is shown. */
async function countTripBills(tripId: number): Promise<{ waiting: number; total: number }> {
  const drops = await prisma.trip_drops.findMany({ where: { tripId }, select: { id: true } });
  if (drops.length === 0) return { waiting: 0, total: 0 };
  const dropIds = drops.map((d) => d.id);
  const waiting = await prisma.orders.count({ where: { ...WAITING_FOR_PICKER, tripDropId: { in: dropIds } } });
  const total = await prisma.orders.count({ where: { isRemoved: false, tripDropId: { in: dropIds } } });
  return { waiting, total };
}

export type ShowOutcome =
  | { ok: true; changed: boolean; tripNumber: string; shownAt: string | null; waitingCount: number }
  | { ok: false; status: number; error: string };

/**
 * Show one trip to the floor, or take it back.
 *
 * ⚠ IDEMPOTENT, AND A NO-OP WRITES NOTHING. Showing a shown trip (or taking back
 * one that is not shown) returns `changed: false` with no `trips.update` and no
 * activity row — a second press must not move the stamp to whoever pressed it
 * second, exactly as cancel and dispatch already behave.
 *
 * ⚠ TAKE-BACK HIDES ONLY THE STILL-WAITING BILLS. Clearing `shownAt` changes what
 * the WAITING branch admits; a bill already with a picker, picked or checked is
 * never gated, so it stays on the supervisor's screen and in the picker's hands.
 * Non-destructive by construction — which is why take-back is safe to offer.
 *
 * The caller has already checked the permission, the session user and that desk
 * control is ON (the route refuses both presses while it is off).
 */
export async function setTripShown(opts: {
  tripId: number;
  shown: boolean;
  actorId: number;
}): Promise<ShowOutcome> {
  const trip = await prisma.trips.findUnique({
    where: { id: opts.tripId },
    select: { id: true, tripNumber: true, status: true, shownAt: true },
  });
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  if (trip.status === "cancelled" || trip.status === "dispatched") {
    return { ok: false, status: 409, error: `A ${trip.status} trip cannot be ${opts.shown ? "shown" : "taken back"}.` };
  }

  const counts = await countTripBills(trip.id);
  const alreadyThere = opts.shown ? trip.shownAt !== null : trip.shownAt === null;
  if (alreadyThere) {
    return {
      ok: true,
      changed: false,
      tripNumber: trip.tripNumber,
      shownAt: trip.shownAt?.toISOString() ?? null,
      waitingCount: counts.waiting,
    };
  }

  const updated = await prisma.trips.update({
    where: { id: trip.id },
    data: opts.shown ? { shownAt: new Date(), shownById: opts.actorId } : { shownAt: null, shownById: null },
    select: { shownAt: true },
  });

  if (opts.shown) {
    await logTripShown({
      tripId: trip.id,
      actorId: opts.actorId,
      tripNumber: trip.tripNumber,
      waitingCount: counts.waiting,
      via: "button",
    });
  } else {
    await logTripTakenBack({
      tripId: trip.id,
      actorId: opts.actorId,
      tripNumber: trip.tripNumber,
      hiddenCount: counts.waiting,
      stayedCount: counts.total - counts.waiting,
    });
  }

  return {
    ok: true,
    changed: true,
    tripNumber: trip.tripNumber,
    shownAt: updated.shownAt?.toISOString() ?? null,
    waitingCount: counts.waiting,
  };
}
