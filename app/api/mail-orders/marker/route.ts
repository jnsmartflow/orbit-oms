import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";

export const dynamic = "force-dynamic";

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/mail-orders/marker — the cheap "has the Mail Orders board changed?"
 * probe. The client polls THIS and refetches the expensive GET /api/mail-orders
 * only when {count, latest} moves.
 *
 * Mirrors app/api/floor/marker and app/api/billing/picking/marker. Mail Orders
 * was the last major board still blind-refetching its full payload on a timer —
 * that payload is mo_orders + four nested includes + three batch lookups + the
 * tag settings, every 30s, whether anything changed or not.
 *
 * ── WHAT MOVES THE MARKER ────────────────────────────────────────────────────
 *
 *   count   COUNT(mo_orders) in the selected IST day. Catches arrivals (the
 *           parser POSTing a new order) and any removal.
 *   latest  MAX of TWO timestamps:
 *             • MAX(mo_orders.updatedAt) within the same IST day
 *             • MAX(app_tag_settings.updatedAt), all rows, not day-scoped
 *
 * `mo_orders.updatedAt` is stamped by the DATABASE — trigger
 * trg_mo_orders_updated_at, BEFORE UPDATE (CORE §7.6). That is why this marker
 * can be trusted across ELEVEN different write routes without each one having
 * to remember to touch a timestamp: punch, so-number, customer, lock, note,
 * split, ingest, re-enrich, backfill-customers, the billing dual-write, and
 * line-resolve. Line resolve is covered because it updates
 * `mo_orders.matchedLines` as its last step
 * (lines/[lineId]/resolve/route.ts:132) — the trigger does the rest.
 *
 * The tag arm is deliberately NOT day-scoped: an admin switching a badge off in
 * Settings → Hide changes what EVERY row renders, on every day. The write sets
 * `updatedAt` explicitly on both create and update
 * (app/api/admin/tag-settings/route.ts:62-63), so a first-ever toggle — which
 * INSERTs the row — moves this too.
 *
 * ── WHAT DELIBERATELY DOES NOT MOVE IT (known, accepted gaps) ────────────────
 *
 * Each of these is read by GET /api/mail-orders but is NOT watched here. The
 * consequence in every case is the same and it is mild: the change appears on
 * the operator's next full refetch — the next real order event, a date step, or
 * a reload — rather than within one poll.
 *
 *   1. mo_line_status — the per-line found/not-found + reason. Its route
 *      (lines/[lineId]/status) writes ONLY mo_line_status and never touches
 *      mo_orders, so the trigger cannot see it. ACCEPTED: 11 rows have ever
 *      been written and none in the last 21 days (verified read-only
 *      2026-08-10). Not worth a third aggregate on every probe. It is also
 *      operator-local — whoever sets it is looking at the optimistic UI that
 *      already reflects it.
 *   2. delivery_point_master.isKeyCustomer — feeds the key-dealer flag.
 *      ACCEPTED as a documented gap: master-data edits are rare and
 *      administrative, and nobody is watching this board for one to land.
 *   3. mo_customer_keywords (area / route / delivery type) — same class as 2.
 *      Note the common case IS covered: when an operator picks a customer, the
 *      keyword row and `mo_orders` are written together, and the latter fires
 *      the trigger.
 *   4. mo_sku_lookup_v2 (the altSkus chips) — same class again, and already
 *      behind a 5-minute server cache in the list route.
 *
 * If any of these ever needs covering, add a THIRD aggregate here rather than
 * widening the day scope — the day window is what keeps this probe cheap.
 *
 * READ-ONLY: two aggregates, no joins, no rows, and no write of any kind. Never
 * add an `update` to a marker — the change-detection keys on MAX(updatedAt), so
 * a write here would fire a false "changed" on every poll (CORE §3).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Gated on mail_orders/canView, matching the billing marker — and NOT the
  // session-only pattern most of app/api/mail-orders/** still uses (the CORE
  // §13 / MAIL_ORDERS §18 security landmine). Anyone who can open the board
  // already holds this grant: the page layout gates on exactly this check, so
  // this is strictly tighter with no reachable regression.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // A malformed day is a 400, never a silent fallback to today — the same
  // stance the billing marker takes. Absent → undefined → today.
  const dateParam = new URL(req.url).searchParams.get("date");
  if (dateParam !== null && !DATE_STR_RE.test(dateParam)) {
    return NextResponse.json(
      { error: `Invalid date "${dateParam}" — expected YYYY-MM-DD` },
      { status: 400 },
    );
  }

  // The SAME window GET /api/mail-orders renders. That route computes it with a
  // local helper whose body is identical to this one (both: IST midnight → UTC,
  // +24h); using the shared lib/dates version here keeps the two from drifting.
  const { start, end } = getISTDayRange(dateParam ?? undefined);

  // Sequential awaits only, never prisma.$transaction (CORE §3).
  const ordersAgg = await prisma.mo_orders.aggregate({
    where: { receivedAt: { gte: start, lt: end } },
    _count: true,
    _max: { updatedAt: true },
  });

  const tagsAgg = await prisma.app_tag_settings.aggregate({
    _max: { updatedAt: true },
  });

  // `latest` is the newer of the two. app_tag_settings.updatedAt is NULLABLE in
  // the schema, so a null on either side simply loses the comparison rather
  // than poisoning it.
  const ordersLatest = ordersAgg._max.updatedAt ?? null;
  const tagsLatest = tagsAgg._max.updatedAt ?? null;
  const latestDate =
    ordersLatest && tagsLatest
      ? ordersLatest > tagsLatest
        ? ordersLatest
        : tagsLatest
      : (ordersLatest ?? tagsLatest);

  const body = {
    count: ordersAgg._count,
    latest: latestDate ? latestDate.toISOString() : null,
    // Echoed for parity with the sibling markers and for debugging; the client
    // hook reads only {count, latest}.
    scope: "mail-orders-day",
    ordersLatest: ordersLatest ? ordersLatest.toISOString() : null,
    tagsLatest: tagsLatest ? tagsLatest.toISOString() : null,
  };

  // No proxy or browser may serve a stale marker — freshness is the point.
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
