import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getFloorLiveMarkerWhere } from "@/lib/floor/queries";
import { getDecisionsLatest, laterIso } from "@/lib/picking/duplicate-so";

export const dynamic = "force-dynamic";

/**
 * GET /api/floor/marker — a lightweight "is the floor reachable / has it changed?"
 * probe over the floor's EXACT live set. Mirrors app/api/picking/marker/route.ts
 * in shape: one aggregate, no joins, no line items, no sort.
 *
 *   count  — COUNT(*) of live-floor orders (arrivals/departures move it)
 *   latest — the LATER of MAX(orders.updatedAt) (in-place edits move it; hits
 *            orders_updatedAt_idx) and MAX(pick_delete_decisions.updatedAt)
 *            (a Billing All OK / Undo moves the same-SO tag, not an order).
 *
 * The WHERE comes from getFloorLiveMarkerWhere() — the SAME predicate
 * getFloorBoard's live branch renders (floorLiveBaseWhere + hide) — so the marker
 * and the board can never watch different sets.
 *
 * READ-ONLY: no orders.update anywhere here (a second write would fire a false
 * "changed" on every board's MAX(updatedAt) marker — CORE §3 / Picking §10).
 *
 * ONE probe powers everything on the floor: the board's live-sync polls THIS
 * route via lib/hooks/use-picking-marker's `url` param (so it watches the floor's
 * exact set, not picking's), and that poll's `onProbe` drives the connection
 * strip. Query params (?scope=…) appended by the hook are IGNORED here — the
 * floor set is fixed.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const where = await getFloorLiveMarkerWhere();
  const agg = await prisma.orders.aggregate({
    where,
    _count: true,
    _max: { updatedAt: true },
  });

  // `latest` also carries the Billing Pick delete decisions clock (2026-09-27):
  // an All OK / Undo changes the board's same-SO tag with no order row moving.
  // The predicate above is untouched — marker and board still watch ONE set.
  const decisionsLatest = await getDecisionsLatest();

  return NextResponse.json(
    { count: agg._count, latest: laterIso(agg._max.updatedAt, decisionsLatest) },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
