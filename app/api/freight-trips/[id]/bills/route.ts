import { NextResponse } from "next/server";
import { freightGate, idList } from "@/lib/freight-trips/gate";
import { getFreightTripState, isCancelled } from "@/lib/freight-trips/queries";
import { addFreightBills, removeFreightBills } from "@/lib/freight-trips/bills";

export const dynamic = "force-dynamic";

/**
 * POST /api/freight-trips/[id]/bills — { action: "add" | "remove", orderIds: number[] }
 *
 * add:    each bill must exist, not be removed, and be HELD right now. One active
 *         freight trip per bill (DB partial unique) — a bill on another trip is
 *         refused "Already on F-… — remove it first".
 * remove: stamps removedAt / removedById / reason 'removed' on THIS trip's active
 *         row only; the row is kept.
 * One activity row per press, naming only the OBDs that moved. Refused on a
 * cancelled trip (409). Writes freight_trip_bills (+ activity) ONLY — never the
 * bill itself.
 *
 * Returns { added | removed: orderId[], skipped: [{ orderId, reason }] }.
 */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await freightGate("canEdit");
  if (!gate.ok) return gate.response;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: unknown; orderIds?: unknown };
  if (body.action !== "add" && body.action !== "remove") {
    return NextResponse.json({ error: 'action must be "add" or "remove"' }, { status: 400 });
  }
  const orderIds = idList(body.orderIds);
  if (orderIds === null || orderIds.length === 0) {
    return NextResponse.json({ error: "orderIds must be a non-empty array of positive integers" }, { status: 400 });
  }

  const trip = await getFreightTripState(id);
  if (!trip) return NextResponse.json({ error: "Freight trip not found" }, { status: 404 });
  if (isCancelled(trip.status)) {
    return NextResponse.json({ error: `${trip.tripNumber} is cancelled — its bills cannot change.` }, { status: 409 });
  }

  if (body.action === "add") {
    const r = await addFreightBills({ freightTripId: id, orderIds, actorId: gate.userId });
    return NextResponse.json({ added: r.done, skipped: r.skipped });
  }
  const r = await removeFreightBills({ freightTripId: id, orderIds, actorId: gate.userId });
  return NextResponse.json({ removed: r.done, skipped: r.skipped });
}
