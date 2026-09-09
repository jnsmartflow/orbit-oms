import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTripDetail } from "@/lib/trips/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/floor/trips/[id] — one trip, with its drops in `dropSeq` order.
 *
 * Per-trip bill counts by state (waiting / withPicker / picked / checked, plus
 * an `other` remainder), total litres, and `isReady` — which is DERIVED from
 * the bills, never read from a column. See lib/trips/queries.ts.
 *
 * Gate: `floor` canEdit, matching every sibling under /api/floor. Read-only:
 * no writes anywhere in this path, so the live-sync markers cannot see it.
 *
 * ⚠ NOT `/api/trips/[tripNo]` — that address belongs to the NTS Trip Report
 * mirror (`app/api/trips/[tripNo]/route.ts`) and is keyed on the NTS trip
 * NUMBER, not on an Orbit id. The two modules stay apart for the whole parallel
 * run (floor-trip-module decision record §5).
 */
export async function GET(
  _req: Request,
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

  const trip = await getTripDetail(tripId);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  return NextResponse.json({ trip });
}
