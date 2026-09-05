import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";
import { getHideExclusion } from "@/lib/hide/visibility";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/marker — a lightweight "has the tint board changed?"
 * probe. Mirrors app/api/floor/marker/route.ts exactly in shape: one aggregate,
 * no joins, no line items, no sort.
 *
 *   count  — COUNT(*) of orders on the Tint Manager board (arrivals and
 *            departures move it)
 *   latest — MAX(orders.updatedAt) (in-place edits move it); hits the
 *            orders_updatedAt_idx index created for the picking marker.
 *
 * Consumed by lib/hooks/use-picking-marker's `url` param, the same way Floor
 * watches its own set — so the poll, the refetch trigger and the connection
 * strip all run off ONE probe.
 *
 * READ-ONLY: there is no `orders.update` anywhere in this file. Never add one —
 * this marker and every other board's key on MAX(orders.updatedAt), so a write
 * here would fire a false "changed" on all of them (CORE §3, PICKING §10,
 * FLOOR §10).
 *
 * ── Predicate, and the one place it differs from Floor ───────────────────────
 * Floor gets to share ONE `floorLiveBaseWhere` between its board and its marker,
 * which is what stops the two drifting. The Tint Manager board cannot do that:
 * app/api/tint/manager/orders/route.ts renders SIX separate queries (pending
 * orders, completed-today orders, active splits, completed splits, completed
 * assignments, slots) and has no single `orders` WHERE to lend. So this is a
 * deliberate UNION APPROXIMATION of those feeds, and the drift risk is real and
 * named rather than pretended away:
 *
 *   arm 1 — the three open tint stages (Sets A / C: Pending, Assigned,
 *           In Progress). Matches the board's Set A `workflowStage: { in: [...] }`
 *           exactly.
 *   arm 2 — whole-OBD completions today (Set E): a tint_assignments row at
 *           `tinting_done` with `completedAt` in today. A finished bill leaves
 *           the tint stages entirely (done/route.ts writes `pending_support` or
 *           `pending_picking`), so arm 1 cannot see it and the Completed column
 *           would never refresh without this.
 *   arm 3 — split completions today (Set D), on `order_splits`. Same reason:
 *           a split finishing is a visible board change whose parent order sits
 *           outside arm 1.
 *
 * ⚠ If any of those six feeds gains or loses a stage, THIS predicate must move
 * with it, or the board will stop refreshing on a change it displays.
 *
 * ⚠ `startOfToday` is deliberately computed the SAME (server-local, not IST) way
 * as the board's, in app/api/tint/manager/orders/route.ts. That expression is
 * arguably wrong — on Vercel the server runs UTC, so "today" starts at 05:30 IST
 * rather than midnight — but it is PRE-EXISTING and out of scope here. Copying it
 * verbatim keeps the marker and the board on one boundary; "fixing" it in only
 * one of the two would put them 5.5 hours apart and make the Completed column
 * refresh at the wrong moment. Fix both together or neither.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.OPERATION_MANAGER]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const now          = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  // Sequential await, never $transaction (CORE §3). The hide-exclusion is
  // AND-merged exactly as the board's six queries merge it, so a hidden OBD
  // cannot move a marker for a row nobody can see.
  const hideExclusion = await getHideExclusion();

  const agg = await prisma.orders.aggregate({
    where: {
      AND: [
        {
          orderType: "tint",
          isRemoved: false,
          OR: [
            {
              workflowStage: {
                in: ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"],
              },
            },
            {
              tintAssignments: {
                some: { status: TINT_STATUS_DONE, completedAt: { gte: startOfToday } },
              },
            },
            {
              splits: {
                some: { status: TINT_STATUS_DONE, completedAt: { gte: startOfToday } },
              },
            },
          ],
        },
        hideExclusion,
      ],
    },
    _count: true,
    _max: { updatedAt: true },
  });

  return NextResponse.json(
    { count: agg._count, latest: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
