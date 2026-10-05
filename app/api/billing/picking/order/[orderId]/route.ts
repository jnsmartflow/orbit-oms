import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildBillingPendingWhere } from "@/lib/billing/picking-where";
import type { BillingOrderDetail } from "@/lib/billing/types";
import { loadBillingOrderDetail } from "@/lib/billing/order-detail";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/picking/order/[orderId] — one bill's line items for the
 * Billing Picking tab's detail panel.
 *
 * READ-ONLY. SELECTs and nothing else — no writes, no mutations, no side
 * effects anywhere in this file. (Five as of 2026-08-20: the `isPending` probe
 * below joined the four originals. Still not a write, and still not a fence.)
 *
 * ── WHY THIS EXISTS RATHER THAN REUSING FLOOR'S ────────────────────────────
 * `GET /api/floor/order/[orderId]` returns very nearly this payload, and
 * reusing it would still be WRONG: it gates on `floor`/canView, which
 * Deepanshu (25) and Bankim (26) do not hold. Pointing Billing at it would sail
 * through the pilot — Operations User (20) has floor access — and then 403 for
 * every real billing operator the day the flag opens. That is exactly the trap
 * `/api/billing/ship-to-search` and `/api/billing/dispatch-windows` were carved
 * out to avoid (CLAUDE_MAIL_ORDERS §23.3); this route is the third instance of
 * the same call, not a new pattern.
 * It also carries ship-to/slot/override/activity facts this panel has no
 * controls for. Gate: `billing_picking`/canView (was `mail_orders` until
 * 2026-09-11), identical to the list route beside it, so anyone who can see the
 * list can open a row on it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 * 🔴 CONFIRMED FINDINGS ONLY — `recordedById: { not: null }`. A PENDING finding
 * is a picker's claim awaiting a supervisor, and Billing must never see one:
 * an operator who saw "found 1 of 2" on this panel would act on it, when the
 * floor has not yet agreed it is true. This is the SAME predicate the list
 * route's `hasConfirmedShortage` counts (app/api/billing/picking/list/route.ts),
 * and the two MUST stay identical — if they drift, a row can carry the ⚠ flag
 * and open onto a panel with nothing flagged, and the operator has no way to
 * tell which surface is lying. Never infer the state from qtyFound or reason
 * (lib/picking/types.ts:136-140).
 *
 * Sequential awaits only, never prisma.$transaction (CORE §3).
 */
export async function GET(
  _req: Request,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The SAME gate as app/api/billing/picking/list/route.ts — admin bypass, else
  // billing_picking/canView (was mail_orders/canView until 2026-09-11).
  //
  // ⚠ STILL NOT `floor`/canView, and that is what the block comment above is
  // about: this route exists precisely because reusing /api/floor/order/[orderId]
  // would 403 for the billing operators, who hold no `floor`. Repointing the key
  // does not soften that — the reason simply moved from one billing key to a
  // narrower one. And it is NOT the floor board's `picking` either.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "billing_picking", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  // ── The bill, its lines and its confirmed findings ─────────────────────
  // lib/billing/order-detail.ts (moved there 2026-10-05 so the Print tab's
  // route reads a bill identically). No stage or invoice fence — see that
  // file and the block comment above.
  const base = await loadBillingOrderDetail(orderId);
  if (!base) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ── Still pending? ──────────────────────────────────────────────────────
  // 2026-08-20, for the panel's "Mark done" button. A bill with a confirmed
  // finding gets NO checkbox on the list, so this panel is the only place it
  // can be invoiced — and a button that would silently update 0 rows must not
  // be offered.
  //
  // ⚠ THIS IS NOT A FENCE, and does not become one. The route still returns
  // the bill whatever this comes back as (no 404, no narrowed select) — see the
  // no-fence note in lib/billing/order-detail.ts for why fencing here would 404 a legitimately
  // rendered row. It only reports a fact the client is allowed to act on.
  //
  // 🔒 buildBillingPendingWhere() ITSELF, never a re-spelled copy of its terms.
  // The button's precondition and the write's WHERE
  // (app/api/billing/picking/mark-done/route.ts, same helper AND-ed into its
  // updateMany) are therefore the SAME predicate by construction: the button
  // cannot appear on a bill the write would refuse, and cannot vanish from one
  // it would accept. Hand-inlining `workflowStage/invoiceNo/invoicedAt` here
  // would also silently drop the hide exclusion the helper carries.
  //
  // Costs one indexed SELECT (plus the helper's own obd_visibility_rules read)
  // on a user-initiated panel open — not a poll. Placed AFTER the 404 so a bad
  // id never pays for it. Sequential await, never prisma.$transaction (CORE §3).
  const pendingWhere = await buildBillingPendingWhere();
  const pendingHit = await prisma.orders.findFirst({
    where: { AND: [pendingWhere, { id: base.orderId }] },
    select: { id: true },
  });
  const isPending = pendingHit !== null;

  const detail: BillingOrderDetail = { ...base, isPending };

  return NextResponse.json({ detail });
}
