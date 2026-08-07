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
  const lines = rawLines.map((l) => {
    const cat = catalogByCode.get(l.skuCodeRaw);
    return {
      id: l.id,
      name: cat?.name ?? l.skuDescriptionRaw ?? null,
      sku: l.skuCodeRaw,
      pack: cat?.pack ?? null,
      qty: l.unitQty,
    };
  });

  return NextResponse.json({ lines });
}
