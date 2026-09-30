// lib/billing/marker-counts.ts — the Picking and Print pills' COUNTS, lifted out of their marker
// routes (2026-09-30, live feed billing 2b-i) so POST /api/billing/sync can import the SAME
// function the marker uses instead of re-declaring it. The logic is moved, not changed:
//   · countBillingPending — was inline in app/api/billing/picking/marker/route.ts
//   · getPrintCount       — was inline in app/api/billing/print/marker/route.ts
// The Telephonic and Pick delete counts already live in their lib modules
// (getTelephonicMarker, getPickDeleteMarker). Read-only; sequential awaits (CORE §3).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildBillingPendingWhere } from "@/lib/billing/picking-where";
import { getPrintWorkTripIds, loadPrintTrips } from "@/lib/billing/print";

/**
 * The Picking pill: COUNT(*) over buildBillingPendingWhere() — outstanding work only, the
 * identical predicate the list's pending section uses. `hideExclusion` optional, exactly as the
 * builder's (the marker route passes the one it already read).
 */
export async function countBillingPending(hideExclusion?: Prisma.ordersWhereInput): Promise<number> {
  const pendingWhere = await buildBillingPendingWhere(hideExclusion);
  const countAgg = await prisma.orders.aggregate({ where: pendingWhere, _count: true });
  return countAgg._count;
}

/**
 * The Print pill: trips with copy work outstanding — the SAME number the list's `pending` holds.
 * Never-copied trips are counted without loading them; only copied trips touched since their
 * copy are loaded, to confirm they reopened (usually none).
 */
export async function getPrintCount(): Promise<number> {
  const workIds = await getPrintWorkTripIds();
  // Split the work ids: never-copied ones count as they are; copied-and-touched
  // ones are loaded and counted only if they really reopened.
  const touched = workIds.length
    ? await prisma.trips.findMany({
        where: { id: { in: workIds }, billingCopiedAt: { not: null } },
        select: { id: true },
      })
    : [];
  const reopened = (await loadPrintTrips(touched.map((t) => t.id))).filter((t) => t.state === "reopened").length;
  return workIds.length - touched.length + reopened;
}
