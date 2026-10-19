import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { floorHoldWhere } from "@/lib/floor/queries";
import { getHideExclusion } from "@/lib/hide/visibility";
import { freightGate } from "@/lib/freight-trips/gate";

export const dynamic = "force-dynamic";

/**
 * GET /api/freight-trips/marker — the cheap { count, latest } a freight screen
 * polls, refetching only when either moves. READ-ONLY.
 *
 * Why polling: freight tables deliberately carry NO live_changes trigger (CORE
 * §13 — the trip trigger would publish freight ids as entity='trip' into Floor's
 * feed), so this marker is how a freight screen notices change.
 *
 * Covers: freight_trips (count, max updatedAt), freight_trip_bills (active count,
 * max addedAt, max removedAt) and Floor's held set — the pool — (count, max
 * orders.updatedAt), so a hold or release on Floor moves it too — and (6.3) the
 * newest invoice-row write of any split OBD, so a per-invoice hold moves it.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await freightGate("canView");
  if (!gate.ok) return gate.response;

  const trips = await prisma.freight_trips.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
  const bills = await prisma.freight_trip_bills.aggregate({ _max: { addedAt: true, removedAt: true } });
  const activeBills = await prisma.freight_trip_bills.count({ where: { removedAt: null } });
  const hide = await getHideExclusion();
  const held = await prisma.orders.aggregate({
    where: { AND: [floorHoldWhere(), hide] },
    _count: { _all: true },
    _max: { updatedAt: true },
  });

  // 6.3 — a PARTLY-held split OBD: a second invoice held (or one released)
  // moves neither orders.updatedAt nor the held count, only its invoice rows.
  // The newest write on any SPLIT OBD's rows (index-only distinct read first;
  // nothing more when no OBD is split).
  const splitIds = (
    await prisma.order_invoices.findMany({ where: { seq: { gt: 1 } }, select: { orderId: true }, distinct: ["orderId"] })
  ).map((r) => r.orderId);
  const splitRows =
    splitIds.length > 0
      ? await prisma.order_invoices.aggregate({ where: { orderId: { in: splitIds } }, _max: { updatedAt: true } })
      : null;

  const stamps = [trips._max.updatedAt, bills._max.addedAt, bills._max.removedAt, held._max.updatedAt, splitRows?._max.updatedAt ?? null]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const latest = stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : null;
  const count = trips._count._all + activeBills + held._count._all;

  return NextResponse.json(
    { count, latest, trips: trips._count._all, activeBills, held: held._count._all },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
