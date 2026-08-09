import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  buildBillingPendingWhere,
  buildBillingMarkerWhere,
} from "@/lib/billing/picking-where";
import { getHideExclusion } from "@/lib/hide/visibility";

export const dynamic = "force-dynamic";

/** Duplicated verbatim from app/api/billing/picking/list/route.ts — see the
 *  note there. The two routes must accept exactly the same input, because the
 *  client points both at the same day. */
const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/billing/picking/marker — the cheap "has the billing pending list
 * changed?" probe, mirroring app/api/picking/marker/route.ts. The client polls
 * this and refetches the full list ONLY when {count, latest} moves.
 *
 * Marker = (count, latest) — and the two are DELIBERATELY MEASURED OVER
 * DIFFERENT SETS. Two aggregates, no joins, no rows:
 *
 *   count  — COUNT(*) over buildBillingPendingWhere() ONLY, the IDENTICAL
 *            predicate app/api/billing/picking/list/route.ts renders its
 *            `pending` list from. It is the number the Orders|Picking tab badge
 *            shows, and that badge means WORK OUTSTANDING
 *            (components/billing/billing-tab-bar.tsx). Already-invoiced
 *            informational rows are not work and must never inflate it.
 *            Catches arrivals (a pick approved) and departures (marked done /
 *            invoiced by SAP).
 *   latest — MAX(orders.updatedAt) over buildBillingMarkerWhere(), the UNION of
 *            pending AND the day's already-invoiced rows. Catches in-place
 *            edits. Hits orders_updatedAt_idx.
 *
 * 🔒 WHY `latest` IS WIDER THAN `count`. Approving a bill that already carries
 * an invoiceNo moves the pending set not at all — neither its COUNT(*) nor its
 * MAX(updatedAt) — because the row never enters that set. A pending-only marker
 * would therefore never fire, and the new informational row would sit
 * unrendered until someone reloaded the page: precisely the disappearing-bill
 * failure this feature exists to remove. Widening `latest` (never `count`) is
 * what keeps MARKER ⊇ LIST while leaving the badge honest.
 *
 * `?date=` scopes ONLY the union's informational arm; `count` is all-dates,
 * like the pending list it mirrors.
 *
 * READ-ONLY, like picking's marker: it adds no orders.update. Never add one —
 * the marker keys on MAX(updatedAt), so an extra write fires a false "changed"
 * on every poll (CORE §3).
 */
export async function GET(req: Request): Promise<NextResponse> {
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

  // Same shape gate as the list route — a malformed day is a 400, never a
  // silent fallback to today. Absent → undefined → today, unchanged.
  const dateParam = new URL(req.url).searchParams.get("date");
  if (dateParam !== null && !DATE_STR_RE.test(dateParam)) {
    return NextResponse.json(
      { error: `Invalid date "${dateParam}" — expected YYYY-MM-DD` },
      { status: 400 },
    );
  }
  const dateStr = dateParam ?? undefined;

  // Sequential awaits only, never prisma.$transaction (CORE §3).
  //
  // TWO aggregates over TWO sets, for the reason in the header block: the badge
  // count must stay outstanding-work, while change detection must see the
  // informational rows too.
  // ONE hide read for the whole request, threaded into both builders. This
  // route used to pay for THREE identical obd_visibility_rules reads per poll
  // (here, plus both arms inside buildBillingMarkerWhere) — and it polls every
  // 15s. Not a cache: still a real, fresh read on each request, just once.
  const hideExclusion = await getHideExclusion();

  const pendingWhere = await buildBillingPendingWhere(hideExclusion);
  const countAgg = await prisma.orders.aggregate({
    where: pendingWhere,
    _count: true,
  });

  const unionWhere = await buildBillingMarkerWhere(dateStr, hideExclusion);
  const latestAgg = await prisma.orders.aggregate({
    where: unionWhere,
    _max: { updatedAt: true },
  });

  const body = {
    count: countAgg._count,
    latest: latestAgg._max.updatedAt ? latestAgg._max.updatedAt.toISOString() : null,
  };

  // No proxy or browser may serve a stale marker — freshness is the point.
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
