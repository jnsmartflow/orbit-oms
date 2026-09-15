// lib/trips/show.ts
//
// SHOW TO FLOOR, PER TRIP (slice 8, 2026-09-15). The one owner of writing
// `trips.shownAt` / `shownById`.
//
// With desk control on, a WAITING bill on a trip reaches the supervisor's Assign
// tab only once its trip is shown (lib/picking/visibility-gate.ts
// `waitingBranchWhere`). A bill on no trip is always visible. Three writers, all
// here:
//
//   - showTrip             — the planner's Show to floor
//   - takeBackTrip         — the ··· menu's take-back
//   - showTripsHoldingWaitingBills — turning desk control ON (the no-cliff rule)
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

/**
 * THE NO-CLIFF RULE — run when desk control is turned ON, BEFORE the switch flips.
 *
 * 🔴 A HARD REQUIREMENT (owner): turning the switch on must not remove anything
 * already on the supervisor's screen. With the switch off he sees every waiting
 * bill. After it, he sees waiting bills on no trip (always) and on shown trips —
 * and in-progress and checked bills are never gated. So the only thing that could
 * vanish is a waiting bill on a trip that is not shown, and this marks every such
 * trip shown first. Nothing else needs doing, and nothing relies on the old
 * per-bill `pickVisibleAt` stamps.
 *
 * 🔴 THE OFF → ON CYCLE RE-SHOWS A TRIP THE PLANNER HAD HELD BACK, AND THAT IS
 * DESIGNED, NOT A BUG (owner, 2026-09-15). While the switch was off the supervisor
 * could see that trip's bills anyway; turning it back on must not take them away,
 * so it is shown again. Nothing is lost — the planner can take it back.
 *
 * ⚠ ORDER MATTERS, and the caller keeps it: stamp trips, THEN flip the switch. If
 * the flip then failed, the trips carry a harmless record with the switch still
 * off. The reverse order would let a 15s poll between the two writes empty those
 * bills off the supervisor's screen.
 *
 * One `trips.update` per trip (a handful), each with its own activity row saying
 * it was desk control, not a person choosing that trip. Returns the numbers shown.
 */
export async function showTripsHoldingWaitingBills(actorId: number): Promise<string[]> {
  const trips = await prisma.trips.findMany({
    where: {
      shownAt: null,
      // ⚠ NO STATUS FILTER beyond cancelled, on purpose. The rule is "every trip
      // holding a waiting bill", and a status test could only ever carve a
      // cliff out of it. (A cancelled trip holds no bills — cancel detaches them.)
      status: { not: "cancelled" },
      drops: { some: { orders: { some: WAITING_FOR_PICKER } } },
    },
    select: { id: true, tripNumber: true },
  });

  const shown: string[] = [];
  for (const t of trips) {
    const counts = await countTripBills(t.id);
    await prisma.trips.update({
      where: { id: t.id },
      data: { shownAt: new Date(), shownById: actorId },
    });
    await logTripShown({
      tripId: t.id,
      actorId,
      tripNumber: t.tripNumber,
      waitingCount: counts.waiting,
      via: "desk_control_on",
    });
    shown.push(t.tripNumber);
  }
  return shown;
}
