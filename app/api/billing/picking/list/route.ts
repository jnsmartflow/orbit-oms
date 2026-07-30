import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import { buildBillingPendingWhere } from "@/lib/billing/picking-where";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/picking/list — the Billing "Picking" tab's two lists.
 *
 * READ-ONLY. No writes, no mutations, no side effects. The mark-done write
 * lands in a later step and does not belong here.
 *
 *   pending — every approved-but-uninvoiced bill, ALL DATES. The predicate is
 *             buildBillingPendingWhere() (lib/billing/picking-where.ts), shared
 *             verbatim with the marker route so the two cannot drift. See that
 *             file for why there is no dispatchTargetDate fence.
 *   done    — what was invoiced TODAY (IST). Day-scoped on purpose: "what did
 *             we invoice today" is a per-day question, unlike `pending`.
 *
 * `dispatchStatus` / `orderType` / `natureOfTransaction` on each pending row
 * are RAW PASS-THROUGH for the FLAGS column the UI renders later. This route
 * does not interpret them and holds no flag logic — deliberately.
 *
 * Sequential awaits only, never prisma.$transaction (CORE §3).
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate shape as app/api/picking/marker/route.ts. Stricter than the
  // legacy session-only /api/mail-orders routes on purpose — new routes get
  // real gating. The operations-only pilot is enforced by the UI feature flag,
  // not here; this route stays on mail_orders/canView.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // ── Pending — approved, uninvoiced, every date. ─────────────────────────
  const pendingWhere = await buildBillingPendingWhere();

  const pendingRows = await prisma.orders.findMany({
    where: pendingWhere,
    // Oldest-checked first — the order the floor finished them in, which is the
    // order billing works them. obdNumber is a deterministic tiebreak (and the
    // fallback ordering for any row whose checkedAt is somehow null; Approve
    // always stamps it, so that should not occur in practice).
    orderBy: [{ pickAssignment: { checkedAt: "asc" } }, { obdNumber: "asc" }],
    select: {
      id: true,
      obdNumber: true,
      shipToCustomerName: true,
      // The resolved Support ship-to override. `shipToOverridden` below is
      // derived from the ID, NOT from the scalar orders.shipToOverride — that
      // flag can be true with a null id on free-text redirects (CORE §7.3),
      // where no dealer row exists and the displayed name does not change.
      shipToOverrideCustomerId: true,
      shipToOverrideCustomer: { select: { customerName: true } },
      dispatchTargetDate: true,
      dispatchWindow: { select: { id: true, windowTime: true, label: true } },
      volume: true,
      totalUnitQty: true,
      pickAssignment: { select: { checkedAt: true } },
      // Raw pass-through for FLAGS — not interpreted here.
      dispatchStatus: true,
      orderType: true,
      natureOfTransaction: true,
    },
  });

  const pending = pendingRows.map((o) => ({
    id: o.id,
    obdNumber: o.obdNumber,
    shipToName: o.shipToOverrideCustomer?.customerName ?? o.shipToCustomerName,
    shipToOverridden: o.shipToOverrideCustomerId !== null,
    dispatchTargetDate: o.dispatchTargetDate,
    dispatchWindow: o.dispatchWindow,
    volume: o.volume,
    totalUnitQty: o.totalUnitQty,
    checkedAt: o.pickAssignment?.checkedAt ?? null,
    dispatchStatus: o.dispatchStatus,
    orderType: o.orderType,
    natureOfTransaction: o.natureOfTransaction,
  }));

  // ── Done — invoiced today (IST). ────────────────────────────────────────
  // getISTDayRange() (lib/dates) is the SAME helper Floor uses — a half-open
  // [start, end) window of real Date objects. Never hand-roll a day boundary,
  // and never Date.parse an offset-less string for this (CORE §3).
  const { start, end } = getISTDayRange();

  const doneRows = await prisma.orders.findMany({
    where: {
      invoicedAt: { gte: start, lt: end },
      isRemoved: false,
    },
    orderBy: { invoicedAt: "desc" },
    select: {
      id: true,
      obdNumber: true,
      shipToCustomerName: true,
      shipToOverrideCustomer: { select: { customerName: true } },
      dispatchTargetDate: true,
      dispatchWindow: { select: { id: true, windowTime: true, label: true } },
      invoiceNo: true,
      invoicedAt: true,
      invoicedBy: { select: { id: true, name: true } },
    },
  });

  const done = doneRows.map((o) => ({
    id: o.id,
    obdNumber: o.obdNumber,
    shipToName: o.shipToOverrideCustomer?.customerName ?? o.shipToCustomerName,
    dispatchTargetDate: o.dispatchTargetDate,
    dispatchWindow: o.dispatchWindow,
    // Null until the next SAP upload fills it — the UI shows "awaiting SAP".
    invoiceNo: o.invoiceNo,
    invoicedAt: o.invoicedAt,
    invoicedBy: o.invoicedBy,
  }));

  return NextResponse.json({ pending, done });
}
