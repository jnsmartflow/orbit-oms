import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { resolveCatalogByCode } from "@/lib/picking/resolve-lines";
import type { BillingDetailLine, BillingOrderDetail } from "@/lib/billing/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/picking/order/[orderId] — one bill's line items for the
 * Billing Picking tab's detail panel.
 *
 * READ-ONLY. Four SELECTs and nothing else — no writes, no mutations, no side
 * effects anywhere in this file.
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
 * controls for. Gate: `mail_orders`/canView, identical to the list route
 * beside it, so anyone who can see the list can open a row on it.
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
  // mail_orders/canView. NOT floor/canView; see the block comment above.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  // ── The bill ────────────────────────────────────────────────────────────
  // Soft-delete read (CORE §3): a removed order has no lines to show.
  //
  // ⚠ NO STAGE OR INVOICE FENCE HERE, DELIBERATELY. The list decides WHICH
  // bills are on screen; this route answers "show me this bill" for whatever
  // the list handed over. Duplicating buildBillingPendingWhere() would mean a
  // row that is legitimately rendered (an already-invoiced info row, say, if a
  // later step makes those clickable) opening onto a 404. The payload is
  // read-only and reveals nothing an operator with mail_orders/canView cannot
  // already see on the list.
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: {
      id: true,
      obdNumber: true,
      // Same two-source date Floor's panel prints — the OBD email date when we
      // have it, else the order timestamp (app/api/floor/order/[orderId]).
      obdEmailDate: true,
      orderDateTime: true,
      shipToCustomerName: true,
      shipToCustomerId: true,
      // Resolved through the FK relation, never by parsing deliveryRemarks —
      // the billing face's own rule (§23.2, `e545af29`). `isShipToOverride` is
      // derived from the ID and not from the scalar `shipToOverride`, which can
      // be true with a null id on a free-text redirect (CORE §7.3).
      shipToOverrideCustomerId: true,
      shipToOverrideCustomer: { select: { customerName: true, customerCode: true } },
      customer: { select: { customerName: true, customerCode: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ── Lines ───────────────────────────────────────────────────────────────
  // There is no FK from `orders` to its line items — `import_raw_line_items`
  // carries a plain `obdNumber` string, matched here via the order's own unique
  // obdNumber. Identical to both existing detail routes.
  //
  // `lineStatus: "active"` drops lines a re-import soft-removed. Reads the FULL
  // active set, not just the catalog-resolvable subset, so a line whose SAP code
  // is unmastered still appears with its raw description rather than silently
  // vanishing from a bill the operator is about to invoice.
  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: {
      id: true,
      skuCodeRaw: true,
      skuDescriptionRaw: true,
      unitQty: true,
      volumeLine: true,
      isTinting: true,
    },
    orderBy: { lineId: "asc" },
  });

  // Shared resolver — sku_master_v2 keyed on `material` (the SAP code). ⚠ NEVER
  // via enrichedLineItem.sku: that FK rides skuId, which shares no id space
  // with v2 and renders a confidently WRONG name/pack (CORE §13). The full
  // warning lives in lib/picking/resolve-lines.ts; read it there before
  // touching this. Sequential await (CORE §3).
  const catalogByCode = await resolveCatalogByCode(rawLines.map((l) => l.skuCodeRaw));

  // ── Confirmed findings, one batched read ────────────────────────────────
  // Mirrors app/api/picking/order/[orderId]/route.ts:109-125 — `in` the line
  // ids, into a Map, attached below. rawLineItemId is UNIQUE on pick_findings,
  // so this is at most one row per line. Skipped entirely on a bill with no
  // lines, matching that route and the list's own empty-list guard.
  //
  // 🔴 `recordedById: { not: null }` — the confirmed-only filter. See the block
  // comment at the top of this file for why a pending finding must not appear
  // on a billing screen.
  const findingRows =
    rawLines.length > 0
      ? await prisma.pick_findings.findMany({
          where: {
            rawLineItemId: { in: rawLines.map((l) => l.id) },
            recordedById: { not: null },
          },
          select: {
            rawLineItemId: true,
            qtyFound: true,
            reason: true,
            recordedAt: true,
            // Two named users relations on this table (reportedBy/recordedBy) —
            // this is the CONFIRMING supervisor, the one the panel names.
            recordedBy: { select: { name: true } },
          },
        })
      : [];
  const findingByLineId = new Map(findingRows.map((f) => [f.rawLineItemId, f]));

  const lines: BillingDetailLine[] = rawLines.map((l) => {
    const cat = catalogByCode.get(l.skuCodeRaw);
    const finding = findingByLineId.get(l.id);
    return {
      id: l.id,
      sku: l.skuCodeRaw,
      // Unresolved code falls back to the raw SAP text; a blank pack stays
      // blank rather than guessing (CLAUDE_PICKING §7).
      name: cat?.name ?? l.skuDescriptionRaw ?? null,
      pack: cat?.pack ?? null,
      qty: l.unitQty,
      litres: l.volumeLine ?? 0,
      isTint: l.isTinting,
      // null — not undefined, not {} — when nothing is confirmed, so the panel
      // tests `finding !== null` and is done.
      finding: finding
        ? {
            qtyFound: finding.qtyFound,
            reason: finding.reason,
            recordedAt: finding.recordedAt?.toISOString() ?? null,
            recordedByName: finding.recordedBy?.name ?? null,
          }
        : null,
    };
  });

  // Gift lines OUT OF SCOPE — plain sum, no gift exclusion, same as Floor's.
  const totalLitres = lines.reduce((s, l) => s + l.litres, 0);

  // The dealer actually being shipped to: the override when one resolved, else
  // the matched customer, else the raw SAP name. Same precedence the list route
  // and Floor's panel use, so one bill never shows two different names.
  const dealer = order.shipToOverrideCustomer ?? order.customer;

  const detail: BillingOrderDetail = {
    orderId: order.id,
    obdNumber: order.obdNumber,
    obdDateTime: (order.obdEmailDate ?? order.orderDateTime)?.toISOString() ?? null,
    customerName: dealer?.customerName ?? order.shipToCustomerName ?? null,
    customerCode: dealer?.customerCode ?? order.shipToCustomerId ?? null,
    isShipToOverride: order.shipToOverrideCustomerId !== null,
    lines,
    lineCount: lines.length,
    totalLitres,
  };

  return NextResponse.json({ detail });
}
