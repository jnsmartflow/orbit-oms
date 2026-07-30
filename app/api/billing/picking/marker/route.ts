import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildBillingPendingWhere } from "@/lib/billing/picking-where";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/picking/marker — the cheap "has the billing pending list
 * changed?" probe, mirroring app/api/picking/marker/route.ts. The client polls
 * this and refetches the full list ONLY when {count, latest} moves.
 *
 * It aggregates over buildBillingPendingWhere() — the IDENTICAL predicate
 * app/api/billing/picking/list/route.ts renders its `pending` list from — so
 * the marker can never watch a narrower set than the list shows. That shared
 * helper is the single definition of "pending"; do not inline a variant here.
 *
 * Marker = (count, latest), one aggregate, no joins, no rows:
 *   count  — COUNT(*) of pending bills; catches arrivals (a pick approved) and
 *            departures (a bill marked done / invoiced by SAP).
 *   latest — MAX(orders.updatedAt); catches in-place edits. Hits
 *            orders_updatedAt_idx.
 *
 * READ-ONLY, like picking's marker: it adds no orders.update. Never add one —
 * the marker keys on MAX(updatedAt), so an extra write fires a false "changed"
 * on every poll (CORE §3).
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate as the list route — this endpoint is reachable directly by URL
  // and reflects real depot data.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Sequential awaits only, never prisma.$transaction (CORE §3).
  const where = await buildBillingPendingWhere();

  const agg = await prisma.orders.aggregate({
    where,
    _count: true,
    _max: { updatedAt: true },
  });

  const body = {
    count: agg._count,
    latest: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null,
  };

  // No proxy or browser may serve a stale marker — freshness is the point.
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
