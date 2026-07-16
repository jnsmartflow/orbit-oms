import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

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
 * unique `obdNumber`. Reads the FULL active line set (not just the subset
 * that successfully enriched against sku_master) so a line that failed
 * SAP-to-master enrichment still shows up — with its raw SAP description —
 * rather than silently vanishing from what the picker sees on the bill.
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
      enrichedLineItem: {
        select: {
          sku: { select: { skuName: true, packSize: true } },
        },
      },
    },
    orderBy: { lineId: "asc" },
  });

  // `pack` is the code ONLY ("1LT", "500ML") — no container word. The picker
  // matches pack size against the shelf/box, not the container type.
  const lines = rawLines.map((l) => ({
    id: l.id,
    name: l.enrichedLineItem?.sku?.skuName ?? l.skuDescriptionRaw ?? null,
    sku: l.skuCodeRaw,
    pack: l.enrichedLineItem?.sku?.packSize ?? null,
    qty: l.unitQty,
  }));

  return NextResponse.json({ lines });
}
