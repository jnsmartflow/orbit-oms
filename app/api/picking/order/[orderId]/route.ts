import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { resolveCatalogByCode } from "@/lib/picking/resolve-lines";

export const dynamic = "force-dynamic";

/**
 * Read-only line items for the mobile picking board's detail screen.
 * PickingQueueRow carries only order-level aggregates (articleTag,
 * volumeLitres, weightKg from `orders.querySnapshot`) — never individual
 * lines, so this is a rare, on-demand tap-through, not part of the main
 * queue payload.
 *
 * There is no FK from `orders` to its line items — `import_raw_line_items`
 * only carries a plain `obdNumber` string, matched here via the order's own
 * unique `obdNumber`. Reads the FULL active line set (not just the subset the
 * catalog can resolve) so a line whose SAP code isn't mastered still shows up
 * — with its raw SAP description — rather than silently vanishing from what
 * the picker sees on the bill.
 *
 * Product name + pack resolve against sku_master_v2 by `material` (2026-07-19b
 * repoint, Option B); ~73% of active raw SAP codes resolve, the rest fall back
 * to raw text. Do NOT reintroduce the enrichedLineItem.sku relation here — see
 * the comment at the catalog lookup below.
 *
 * 2026-08-07 — each line now also carries `finding`: the pick_findings row for
 * that raw line, or null. ADDITIVE ONLY: every pre-existing field on `lines` is
 * untouched, so the supervisor board (which reads the same endpoint and does not
 * know about findings) is unaffected.
 */
export async function GET(
  _req: Request,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate as the other picking routes (queue/assign/unassign) — admin
  // bypass, else canView on 'picking'.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  // Sequential awaits only (CORE §3) — no prisma.$transaction, both reads.
  // Soft-delete read: never surface a removed order's lines.
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { obdNumber: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const rawLines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: {
      id: true,
      skuCodeRaw: true,
      skuDescriptionRaw: true,
      unitQty: true,
    },
    orderBy: { lineId: "asc" },
  });

  // Catalog resolution goes through sku_master_v2 keyed on `material` (the SAP
  // code), NOT through the enrichedLineItem.sku relation — the FK rides
  // `skuId`, which shares no id space with v2 and would render a confidently
  // WRONG name/pack on a live picking bill.
  //
  // Moved into lib/picking/resolve-lines.ts on 2026-08-07 (extraction, not a
  // behaviour change: same query, same select, same de-dup, same fallbacks) so
  // the Combined view can resolve MANY bills' codes through the identical
  // path. ⚠️ THE FULL WARNING AND ITS REASONING NOW LIVE IN THAT FILE — read it
  // there before touching this lookup.
  //
  // Sequential await, no $transaction (CORE §3).
  const catalogByCode = await resolveCatalogByCode(rawLines.map((l) => l.skuCodeRaw));

  // `pack` is the code ONLY ("1L", "500ML") — no container word. The picker
  // matches pack size against the shelf/box, not the container type.
  // Unresolved codes fall back to the raw SAP text exactly as before; a blank
  // pack stays blank rather than guessing (CLAUDE_PICKING.md §7 — a blank is a
  // mis-pick preventer, a wrong value is not).
  // ── Findings (2026-08-07) — has anyone recorded a shortage on these lines? ──
  // ONE extra query, keyed on rawLineItemId (UNIQUE on pick_findings, so this is
  // at most one row per line). Read-only; this route writes nothing.
  //
  // The pair that matters downstream is reportedAt vs recordedAt:
  //   reportedById set, recordedById NULL → the picker recorded it, awaiting a
  //                                          supervisor's confirmation (amber)
  //   recordedById set                    → a supervisor confirmed it (red)
  // The UI reads exactly that distinction; nothing here interprets it.
  //
  // Sequential await, no $transaction (CORE §3). Skipped entirely on a bill
  // with no lines.
  const findingRows =
    rawLines.length > 0
      ? await prisma.pick_findings.findMany({
          where: { rawLineItemId: { in: rawLines.map((l) => l.id) } },
          select: {
            rawLineItemId: true,
            qtyFound:      true,
            reason:        true,
            remarks:       true,
            // Old-MFG month/year (2026-08-08). Prefills the popup on re-open,
            // and since 2026-08-09 also renders as the note's "· Mar 2024"
            // tail on old_mfg lines (lib/picking/types.ts).
            mfgMonth:      true,
            mfgYear:       true,
            reportedById:  true,
            reportedAt:    true,
            recordedById:  true,
            recordedAt:    true,
          },
        })
      : [];
  const findingByLineId = new Map(findingRows.map((f) => [f.rawLineItemId, f]));

  // `pack` is the code ONLY ("1L", "500ML") — no container word. The picker
  // matches pack size against the shelf/box, not the container type.
  // Unresolved codes fall back to the raw SAP text exactly as before; a blank
  // pack stays blank rather than guessing (CLAUDE_PICKING.md §7 — a blank is a
  // mis-pick preventer, a wrong value is not).
  const lines = rawLines.map((l) => {
    const cat = catalogByCode.get(l.skuCodeRaw);
    const finding = findingByLineId.get(l.id);
    return {
      id: l.id,
      name: cat?.name ?? l.skuDescriptionRaw ?? null,
      sku: l.skuCodeRaw,
      pack: cat?.pack ?? null,
      qty: l.unitQty,
      // null — not undefined and not an empty object — when nothing is
      // recorded, so a consumer can test `finding !== null` and be done.
      finding: finding
        ? {
            qtyFound:     finding.qtyFound,
            reason:       finding.reason,
            remarks:      finding.remarks,
            mfgMonth:     finding.mfgMonth,
            mfgYear:      finding.mfgYear,
            reportedById: finding.reportedById,
            reportedAt:   finding.reportedAt,
            recordedById: finding.recordedById,
            recordedAt:   finding.recordedAt,
          }
        : null,
    };
  });

  return NextResponse.json({ lines });
}
