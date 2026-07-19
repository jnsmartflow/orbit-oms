import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Returns the soft-removed line items for one order. Lazy-fetched by the
 * order detail panel when the operator clicks "Show removed (N)".
 *
 * Rows have lineStatus other than "active" — currently always
 * "removed_by_import" but the column accepts other values for future
 * soft-delete sources (e.g. "voided_by_operator").
 *
 * Auth list mirrors /api/orders/[id]/detail and /audit-history.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const session = await auth();
    requireRole(session, [
      ROLES.SUPPORT, ROLES.DISPATCHER, ROLES.ADMIN,
      ROLES.OPERATIONS, ROLES.TINT_MANAGER,
    ]);

    const orderId = parseInt(params.id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }

    const order = await prisma.orders.findFirst({
      where:  { id: orderId, isRemoved: false },
      select: { obdNumber: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Read raw lines directly (lineStatus column lives here, not on the
    // enriched table). `lineWeight` still comes off the enriched row; the
    // product NAME now resolves against sku_master_v2 by `material` instead of
    // the enrichedLineItem.sku relation (see the catalog lookup below).
    const rawLines = await prisma.import_raw_line_items.findMany({
      where: {
        obdNumber:  order.obdNumber,
        lineStatus: { not: "active" },
      },
      select: {
        skuCodeRaw:        true,
        skuDescriptionRaw: true,
        unitQty:           true,
        volumeLine:        true,
        isTinting:         true,
        lineStatus:        true,
        removedAt:         true,
        removedReason:     true,
        enrichedLineItem: {
          select: { lineWeight: true },
        },
      },
      orderBy: { id: "asc" },
    });

    // Catalog resolution by `material` (the SAP code), NOT via the skuId FK —
    // that still points at the OLD sku_master, which shares no id space with
    // sku_master_v2, so following it would show a wrong product description.
    // No isPrimary filter. Sequential await, no $transaction (CORE §3).
    // Reasoning: docs/prompts/drafts/code-discovery-2026-07-19b-catalog-repoint.md
    const codes = Array.from(
      new Set(rawLines.map((r) => r.skuCodeRaw).filter((c): c is string => Boolean(c))),
    );
    const catalogRows =
      codes.length > 0
        ? await prisma.sku_master_v2.findMany({
            where:  { material: { in: codes } },
            select: { material: true, description: true },
          })
        : [];
    const catalogByCode = new Map(catalogRows.map((c) => [c.material, c]));

    const lines = rawLines.map((r) => ({
      // skuCode stays the RAW SAP code — it already was (the old relation
      // resolved to the same string), and it is the code the operator matches.
      skuCode:        r.skuCodeRaw,
      skuDescription:
        catalogByCode.get(r.skuCodeRaw)?.description ?? r.skuDescriptionRaw ?? "—",
      unitQty:        r.unitQty,
      lineWeight:     r.enrichedLineItem?.lineWeight ?? null,
      volumeLine:     r.volumeLine,
      isTinting:      r.isTinting,
      lineStatus:     r.lineStatus,
      removedAt:      r.removedAt ? r.removedAt.toISOString() : null,
      removedReason:  r.removedReason,
    }));

    return NextResponse.json({ lines });
  } catch (err) {
    console.error("Removed-lines error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load removed lines" },
      { status: 500 },
    );
  }
}
