import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTripSheet } from "@/lib/trip-sheet/load";
import { canViewTripSheets } from "@/lib/trip-sheet/access";
import { isShareGroupKey } from "@/lib/trip-sheet/share-groups";

export const dynamic = "force-dynamic";

// POST /api/trip-sheets/[id]/share-log — record that ONE group's sheet of an
// Orbit trip was shared (Schema v27.71, trip_share_log). `id` = trips.id.
// Body { groupKey, orderIds }: the chip's group and its bills at share time
// (the list compares this snapshot with the group's bills now — a mismatch
// drops the tick). Called by the list's share chips AFTER the share completed.
//
// Gate: canViewTripSheets — anyone who can see the page may log a share.
// ONE insert, no $transaction (CORE §3). The trip_share_log live trigger
// records the change for open screens. ⚠ NOT /api/trips (the NTS mirror).

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await canViewTripSheets(roles))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { groupKey?: unknown; orderIds?: unknown } | null;
  if (!body || !isShareGroupKey(body.groupKey)) return NextResponse.json({ error: "Invalid groupKey" }, { status: 400 });
  const raw = body.orderIds;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((n) => Number.isInteger(n) && (n as number) > 0)) {
    return NextResponse.json({ error: "orderIds must be a non-empty list of bill ids" }, { status: 400 });
  }
  const orderIds = Array.from(new Set(raw as number[])).sort((a, b) => a - b);

  // Every id must be a bill on THIS trip's sheet (the same bill set the chips
  // are built from: held out, re-deliveries in). 404 for unknown / cancelled.
  const sheet = await getTripSheet(tripId);
  if (!sheet) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const onTrip = new Set(sheet.stops.flatMap((s) => s.bills.map((b) => b.orderId)));
  const foreign = orderIds.filter((id) => !onTrip.has(id));
  if (foreign.length > 0) {
    return NextResponse.json({ error: `Not on ${sheet.header.tripNumber}: ${foreign.join(", ")}` }, { status: 400 });
  }

  const row = await prisma.tripShareLog.create({
    data: { tripId, groupKey: body.groupKey, sharedById: userId, orderIds },
    select: { id: true, sharedAt: true },
  });
  return NextResponse.json({ id: row.id, sharedAt: row.sharedAt.toISOString(), byName: session.user.name ?? null });
}
