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
    // enriched table). Join enriched + sku via include to get the resolved
    // skuCode/skuName, mirroring the detail-endpoint shape.
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
          select: {
            lineWeight: true,
            sku:        { select: { skuCode: true, skuName: true } },
          },
        },
      },
      orderBy: { id: "asc" },
    });

    const lines = rawLines.map((r) => ({
      skuCode:        r.enrichedLineItem?.sku?.skuCode ?? r.skuCodeRaw,
      skuDescription: r.enrichedLineItem?.sku?.skuName ?? r.skuDescriptionRaw ?? "—",
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
