import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getPickingTrips } from "@/lib/picking/trips-view";

export const dynamic = "force-dynamic";

// GET /api/picking/trips — the Assign tab's Trips view feed (slice 1,
// 2026-10-13). Read-only; the rules live in lib/picking/trips-view.ts.
//
// 🔴 UNDER /api/picking/, NEVER /api/trips (FLOOR_TRIPS §15 landmine 1), and
// gated on `picking`, not `floor`: the floor supervisors hold `picking` and
// none holds `floor`, so /api/floor/trips/* is closed to them (discovery D).
//
// Takes NO query params — it always answers for today's desk. Nothing is read
// from the URL, so there is nothing to validate.
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same check + admin bypass as app/api/picking/queue/route.ts.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json(await getPickingTrips());
  } catch (err) {
    console.error("[picking/trips] GET failed", err);
    return NextResponse.json({ error: "Failed to load trips" }, { status: 500 });
  }
}
