import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { computeDropKey, dropShipToCode } from "@/lib/trips/drop-key";

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
 * Do not add a stage guard here. The stage guard belongs to release, where it
 * already lives, in `stampPickVisibility()`.
 *
 * ⚠ EXACTLY ONE `orders.update` PER BILL. The live-sync markers key on
 * `MAX(orders.updatedAt)`, so a second write fires a false "changed" on every
 * board (FLOOR §4/§10, PICKING §10).
 *
 * ⚠ NO `order_status_logs` ROW, for attach OR detach. The trips table carries
 * its own audit stamps and this is a high-frequency action — a planner moves
 * bills between trips repeatedly while building a load. Same reasoning recorded
 * at pick-visible/route.ts and now in `stampPickVisibility()`'s header: a log
 * row per bill would be noise that buries the events somebody reads back, and it
 * would be the second write the marker landmine warns about.
 *
 * Same 422/partial contract as /api/floor/release and /api/floor/pick-visible.
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
    select: { id: true, status: true },
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
  const skipped: number[] = [];
  const failed: Failed[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          isRemoved: true,
          tripDropId: true,
          customerId: true,
          shipToOverrideCustomerId: true,
          shipToCustomerId: true,
          shipToCustomerName: true,
        },
      });
      if (!order || order.isRemoved) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      if (action === "remove") {
        if (order.tripDropId === null) {
          // Not on any trip — the caller asked for a state it is already in.
          // A skip, not a failure, and NO WRITE: a no-op update would still bump
          // updatedAt and fire a false "changed" on every board.
          skipped.push(orderId);
          continue;
        }
        const dropId = order.tripDropId;

        // ONE orders.update.
        await prisma.orders.update({
          where: { id: orderId },
          data: { tripDropId: null },
        });
        changed.push(orderId);

        // If that stop now holds nothing, delete it. Counted AFTER the update
        // above so this bill is already gone from the tally.
        //
        // ⚠ `isRemoved` IS DELIBERATELY NOT FILTERED HERE. A soft-removed bill
        // still carries its `tripDropId`, so a drop holding only removed bills
        // is NOT empty — deleting it would clear their pointers through the FK's
        // ON DELETE SET NULL and lose where they were. The read side already
        // hides them from counts (lib/trips/queries.ts filters isRemoved there,
        // which is the right place for a display rule).
        const remaining = await prisma.orders.count({ where: { tripDropId: dropId } });
        if (remaining === 0) {
          await prisma.trip_drops.delete({ where: { id: dropId } });
        }
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
          select: { id: true, tripId: true, dropKey: true },
        });
        if (current && current.tripId === tripId && current.dropKey === dropKey) {
          skipped.push(orderId);
          continue;
        }
        failed.push({
          orderId,
          error:
            current && current.tripId !== tripId
              ? `Already on trip ${current.tripId} — remove it from that trip first.`
              : "Already attached to a different stop on this trip.",
        });
        continue;
      }

      // Find-or-create the stop. The unique is (tripId, dropKey), so this is the
      // natural lookup and the constraint is the backstop if two planners add
      // bills for the same shop at once.
      let drop = await prisma.trip_drops.findFirst({
        where: { tripId, dropKey },
        select: { id: true },
      });

      if (!drop) {
        // dropSeq = max + 1, from 1. MAX+1 not COUNT+1: removing the last bill
        // from a stop deletes the row and leaves a gap, and a count would then
        // reuse a number the unique still holds.
        //
        // ⚠ GAPS ARE LEFT ALONE, deliberately. Uniqueness is on
        // (tripId, dropSeq), never contiguity. Renumbering the survivors would
        // change a stop order a driver may already have been given.
        const last = await prisma.trip_drops.findFirst({
          where: { tripId },
          orderBy: { dropSeq: "desc" },
          select: { dropSeq: true },
        });
        const dropSeq = (last?.dropSeq ?? 0) + 1;

        // The customer snapshot for the sheet. Resolved through the EFFECTIVE
        // customer — the same id `computeDropKey` keyed on, so the name and the
        // key can never describe different shops.
        const effectiveId = order.shipToOverrideCustomerId ?? order.customerId;
        const customer =
          effectiveId !== null
            ? await prisma.delivery_point_master.findUnique({
                where: { id: effectiveId },
                select: {
                  id: true,
                  customerName: true,
                  area: { select: { name: true, primaryRoute: { select: { name: true } } } },
                },
              })
            : null;

        drop = await prisma.trip_drops.create({
          data: {
            tripId,
            dropSeq,
            customerId: customer?.id ?? null,
            // ALWAYS SAP's own code — the CHECK reads it on the fallback branch
            // and the column is NOT NULL.
            shipToCode: dropShipToCode(order),
            // 🔴 chk_trip_drops_key REJECTS A WRONG VALUE. There is no default
            // on this column; it is computed by the one module that owns the
            // rule (lib/trips/drop-key.ts) and never inline.
            dropKey,
            // The name that goes on the sheet. Master name first, then the name
            // SAP put on the bill, then the literal — the same fallback ladder
            // lib/picking/queue.ts uses for `dealerName`, so an unmatched bill
            // still names a real shop instead of printing "(Unmatched)" on a
            // driver's paperwork.
            customerName:
              customer?.customerName ?? order.shipToCustomerName ?? "(Unmatched)",
            areaName: customer?.area?.name ?? null,
            routeName: customer?.area?.primaryRoute?.name ?? null,
          },
          select: { id: true },
        });
      }

      // ONE orders.update per bill — the only write to `orders` on this path.
      await prisma.orders.update({
        where: { id: orderId },
        data: { tripDropId: drop.id },
      });
      changed.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  // Nothing achieved at all → 422. A SKIP counts as achieved: the bill is in the
  // state the caller asked for.
  const status = changed.length === 0 && skipped.length === 0 && failed.length > 0 ? 422 : 200;
  const key = action === "add" ? "attached" : "detached";
  return NextResponse.json({ [key]: changed, skipped, failed }, { status });
}
