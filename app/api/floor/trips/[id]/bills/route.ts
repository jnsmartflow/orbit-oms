import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { computeDropKey } from "@/lib/trips/drop-key";
import { deleteTripDropIfEmpty, findOrCreateTripDrop } from "@/lib/trips/drop";
import { logTripBills } from "@/lib/trips/activity";

export const dynamic = "force-dynamic";

interface Failed {
  orderId: number;
  error: string;
}

/**
 * POST /api/floor/trips/[id]/bills — attach bills to a trip, or detach them.
 *
 * Body: `{ orderIds: number[], action: "add" | "remove" }`
 * Response: `{ attached|detached: number[], skipped: number[], failed: [...] }`
 *
 * 🔴 TRIP MEMBERSHIP IS NOT GATED BY STAGE. A bill can join a trip at ANY
 * `workflowStage` — waiting, with a picker, picked, checked. That is an owner
 * decision (floor-trip-module §2: *"A bill can be added to a trip while already
 * assigned or picked; it just cannot be HIDDEN again"*), and it is the whole
 * reason membership and VISIBILITY are separate facts on separate columns.
 * Do not add a stage guard here.
 *
 * ⚠ BUT MEMBERSHIP MOVES VISIBILITY (slice 8, 2026-09-15; rule changed
 * 2026-09-21). With desk control on, a WAITING bill is on the supervisor's
 * Assign tab only while it is on a SHOWN trip. So ADDING a waiting bill to a
 * shown trip puts it on his screen at once, adding it to an unshown trip keeps
 * it off, and REMOVING it from a shown trip HIDES it — it returns to To plan,
 * which the floor does not see. This route writes nothing for it: the picking
 * query reads the trip (lib/picking/visibility-gate.ts waitingBranchWhere). A
 * bill already with a picker is never hidden by it.
 *
 * ⚠ EXACTLY ONE `orders.update` PER BILL. The live-sync markers key on
 * `MAX(orders.updatedAt)`, so a second write fires a false "changed" on every
 * board (FLOOR §4/§10, PICKING §10).
 *
 * ⚠ NO `order_status_logs` ROW, for attach OR detach. The trips table carries
 * its own audit stamps and this is a high-frequency action — a planner moves
 * bills between trips repeatedly while building a load. A log row per bill would
 * be noise that buries the events somebody reads back, and it would be the
 * second write the marker landmine warns about.
 *
 * Same 422/partial contract as /api/floor/release.
 * Sequential awaits, never prisma.$transaction (CORE §3).
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The real session user, for the activity log. Never a body claim, and the
  // same shape every other trip write route uses.
  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderIds?: number[]; action?: string };
  const action = body.action;
  if (action !== "add" && action !== "remove") {
    return NextResponse.json({ error: 'action is required and must be "add" or "remove"' }, { status: 400 });
  }
  const orderIds = body.orderIds;
  // Rejected BEFORE the loop, so a 422 below means "everything was tried and
  // everything failed" rather than "you sent nothing".
  if (
    !Array.isArray(orderIds) ||
    orderIds.length === 0 ||
    !orderIds.every((id) => typeof id === "number" && Number.isInteger(id))
  ) {
    return NextResponse.json(
      { error: "orderIds is required and must be a non-empty array of integers" },
      { status: 400 },
    );
  }

  const trip = await prisma.trips.findUnique({
    where: { id: tripId },
    // isHand — the add branch admits only matching bills (2026-09-24).
    select: { id: true, status: true, isHand: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  // A cancelled or dispatched trip is finished with. Refusing here is the
  // recoverable direction: admitting a stage later is one edit, un-attaching a
  // bill from a load that has already left is not.
  if (trip.status === "cancelled" || trip.status === "dispatched") {
    return NextResponse.json(
      { error: `Cannot change the bills on a ${trip.status} trip.` },
      { status: 409 },
    );
  }

  const changed: number[] = [];
  // ⚠ FILLED IN LOCKSTEP WITH `changed`, for the activity row. Same order, same
  // length — a bill that was skipped or refused is in neither, because the log
  // records what HAPPENED and not what was asked for.
  const changedObds: string[] = [];
  const skipped: number[] = [];
  const failed: Failed[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          // For the ACTIVITY LOG (lib/trips/activity.ts). An order id means
          // nothing to a planner reading a trip's history months later; the OBD
          // number is what is printed on the paper in his hand.
          obdNumber: true,
          isRemoved: true,
          tripDropId: true,
          customerId: true,
          shipToOverrideCustomerId: true,
          shipToCustomerId: true,
          shipToCustomerName: true,
          // The Hand mark — a Hand bill rides only a Hand trip (add branch).
          handAt: true,
        },
      });
      if (!order || order.isRemoved) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      if (action === "remove") {
        // 🔴 THE BILL MUST BE ON THIS TRIP (2026-10-03 — closes FLOOR_TRIPS open
        // item 4 / landmine 8). This path used to clear WHATEVER stop a bill was
        // on, whatever trip the URL named, so a wrong call could strip a bill off
        // its real trip. Now the bill's stop is read first: on no trip, or on a
        // different trip → refused, NO WRITE (a no-op update would still bump
        // updatedAt and fire a false "changed" on every board). Every floor
        // caller already sends only bills on the URL's trip (floor-page.tsx
        // undoAdd and removeSelectionFromTrips), so they never meet this.
        const currentDrop =
          order.tripDropId !== null
            ? await prisma.trip_drops.findUnique({
                where: { id: order.tripDropId },
                select: { tripId: true },
              })
            : null;
        if (order.tripDropId === null || currentDrop === null || currentDrop.tripId !== tripId) {
          failed.push({ orderId, error: "Not on this trip" });
          continue;
        }
        const dropId = order.tripDropId;

        // ONE orders.update.
        await prisma.orders.update({
          where: { id: orderId },
          data: { tripDropId: null },
        });
        changed.push(orderId);
        changedObds.push(order.obdNumber);

        // If that stop now holds nothing, delete it. Counted AFTER the update
        // above so this bill is already gone from the tally.
        //
        // ⚠ "Nothing" = no order (removed ones included — a soft-removed bill
        // still carries its pointer) AND no re-delivery (2026-10-03, discovery
        // B9: trip_redeliveries.tripDropId is RESTRICT). The rule lives in
        // lib/trips/drop.ts deleteTripDropIfEmpty, shared with the re-delivery
        // remove path.
        await deleteTripDropIfEmpty(dropId);
        continue;
      }

      // ── add ────────────────────────────────────────────────────────────────
      const dropKey = computeDropKey(order);

      if (order.tripDropId !== null) {
        // Already on a stop. If it is the right stop on THIS trip, skip with no
        // write. If it is anywhere else, refuse rather than silently moving it:
        // a bill on two loads is the kind of thing nobody notices until a van is
        // short, and "move" is a different action the caller should ask for.
        const current = await prisma.trip_drops.findUnique({
          where: { id: order.tripDropId },
          // The trip NUMBER rides this same read (2026-09-18): the refusal is
          // read by a planner, and an internal id is nothing he can act on.
          select: { id: true, tripId: true, dropKey: true, trip: { select: { tripNumber: true } } },
        });
        if (current && current.tripId === tripId && current.dropKey === dropKey) {
          skipped.push(orderId);
          continue;
        }
        failed.push({
          orderId,
          error:
            current && current.tripId !== tripId
              ? `Already on ${current.trip.tripNumber} — remove it from that trip first.`
              : "Already attached to a different stop on this trip.",
        });
        continue;
      }

      // 🔴 HAND vs TRUCK (2026-09-24, design web-update-2026-09-24-billing-mo-
      // actions.md §4). A bill the dealer collects never joins a truck, and a
      // truck bill never joins a Hand trip. THIS route is the only runtime
      // writer of tripDropId, so every add path — the rail, the add band,
      // "+ New trip", load plan "Make trip" — is held to it here, per bill.
      // To move a bill across, clear its Hand mark first.
      const isHandBill = order.handAt !== null;
      if (isHandBill !== trip.isHand) {
        failed.push({
          orderId,
          error: isHandBill
            ? "The dealer collects this bill (Hand) — put it on a Hand trip, not a truck."
            : "This is a Hand trip (dealer collects) — only Hand bills can join it.",
        });
        continue;
      }

      // Find-or-create the stop — lib/trips/drop.ts (extracted 2026-10-03, same
      // lookup, same MAX(dropSeq)+1, same snapshot). A lost race on the
      // (tripId, dropKey) unique throws into this bill's catch below and is
      // reported as this bill's failure, as before.
      const drop = await findOrCreateTripDrop(tripId, order);

      // ONE orders.update per bill — the only write to `orders` on this path.
      await prisma.orders.update({
        where: { id: orderId },
        data: { tripDropId: drop.id },
      });
      changed.push(orderId);
      changedObds.push(order.obdNumber);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  // ── ONE ACTIVITY ROW FOR THE WHOLE PRESS (2026-09-14, slice 2) ───────────
  // Never one per bill: attaching 40 bills is ONE thing a planner did, and 40
  // rows would bury the events somebody reads back — the same reasoning the
  // header gives for writing no `order_status_logs` rows on this path.
  //
  // Written whatever the status below turns out to be, the 422 case INCLUDED: a
  // press that moved some bills and failed on others still moved them.
  // `logTripBills` returns early when nothing actually changed, so a press that
  // achieved nothing writes no row.
  await logTripBills({
    tripId,
    actorId,
    direction: action,
    orderIds: changed,
    obdNumbers: changedObds,
  });

  // Nothing achieved at all → 422. A SKIP counts as achieved: the bill is in the
  // state the caller asked for.
  const status = changed.length === 0 && skipped.length === 0 && failed.length > 0 ? 422 : 200;
  const key = action === "add" ? "attached" : "detached";
  return NextResponse.json({ [key]: changed, skipped, failed }, { status });
}
