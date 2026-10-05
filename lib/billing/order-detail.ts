// lib/billing/order-detail.ts — ONE bill's detail for a Billing panel: the
// header facts, the active lines and their CONFIRMED pick findings.
//
// MOVED (2026-10-05, Billing Print v2) out of
// app/api/billing/picking/order/[orderId]/route.ts so the Picking tab's route
// and the Print tab's (app/api/billing/print/order/[orderId]) read a bill
// identically. The code below is that route's body, unchanged. Each ROUTE keeps
// its own gate and adds its own facts — the Picking route its `isPending`, the
// Print route the bill's Print state — so this function has no gate and knows
// nothing about either tab.
//
// 🔴 CONFIRMED FINDINGS ONLY — `recordedById: { not: null }`. A PENDING finding
// is a picker's claim awaiting a supervisor, and Billing must never see one
// (CLAUDE_PICKING §11.5). Never infer the state from qtyFound or reason.
//
// READ-ONLY. Server-only (Prisma). Sequential awaits, never prisma.$transaction
// (CORE §3).

import { prisma } from "@/lib/prisma";
import { resolveCatalogByCode } from "@/lib/picking/resolve-lines";
import type { BillingDetailLine, BillingOrderDetail } from "@/lib/billing/types";

/** The panel payload minus the Picking tab's own `isPending` fact. */
export type BillingOrderDetailBase = Omit<BillingOrderDetail, "isPending">;

/** One bill's detail, or null when there is no such live (non-removed) bill. */
export async function loadBillingOrderDetail(orderId: number): Promise<BillingOrderDetailBase | null> {
  // ── The bill ────────────────────────────────────────────────────────────
  // Soft-delete read (CORE §3): a removed order has no lines to show.
  //
  // ⚠ NO STAGE OR INVOICE FENCE HERE, DELIBERATELY. The list decides WHICH
  // bills are on screen; this route answers "show me this bill" for whatever
  // the list handed over. Duplicating buildBillingPendingWhere() would mean a
  // row that is legitimately rendered (an already-invoiced info row, say, if a
  // later step makes those clickable) opening onto a 404. The payload is
  // read-only and reveals nothing a holder of billing_picking/canView cannot
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
  if (!order) return null;

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
            // The old-MFG date, for the note's "· Mar 2024" tail (2026-08-09).
            // Deliberately NOT selected when this route was written the day
            // before, because the note had no date in it then; added the moment
            // it did. Null on every short_quantity row by construction.
            mfgMonth: true,
            mfgYear: true,
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
            mfgMonth: finding.mfgMonth,
            mfgYear: finding.mfgYear,
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

  const detail: BillingOrderDetailBase = {
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

  return detail;
}
