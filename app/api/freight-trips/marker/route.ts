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
 * orders.updatedAt), so a hold or release on Floor moves it too.
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

  const stamps = [trips._max.updatedAt, bills._max.addedAt, bills._max.removedAt, held._max.updatedAt]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const latest = stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : null;
  const count = trips._count._all + activeBills + held._count._all;

  return NextResponse.json(
    { count, latest, trips: trips._count._all, activeBills, held: held._count._all },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
