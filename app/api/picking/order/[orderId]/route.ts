import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatPack } from "@/lib/place-order/pack";

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
  // code), NOT through the enrichedLineItem.sku relation. The FK rides
  // `skuId`, which still points at the OLD sku_master and shares no id space
  // with v2 — following it here would render a confidently WRONG product name
  // and pack on a live picking bill. `skuCodeRaw` is the stable natural key,
  // never null, identical across both tables.
  // Reasoning: docs/prompts/drafts/code-discovery-2026-07-19b-catalog-repoint.md
  //
  // No isPrimary filter — a duplicate twin is still a real SAP code the picker
  // may be holding. Sequential await, no $transaction (CORE §3).
  const codes = Array.from(
    new Set(rawLines.map((l) => l.skuCodeRaw).filter((c): c is string => Boolean(c))),
  );
  const catalogRows =
    codes.length > 0
      ? await prisma.sku_master_v2.findMany({
          where: { material: { in: codes } },
          select: { material: true, description: true, packCode: true, unit: true },
        })
      : [];
  const catalogByCode = new Map(catalogRows.map((r) => [r.material, r]));

  // `pack` is the code ONLY ("1L", "500ML") — no container word. The picker
  // matches pack size against the shelf/box, not the container type.
  // Unresolved codes fall back to the raw SAP text exactly as before; a blank
  // pack stays blank rather than guessing (CLAUDE_PICKING.md §7 — a blank is a
  // mis-pick preventer, a wrong value is not).
  const lines = rawLines.map((l) => {
    const cat = catalogByCode.get(l.skuCodeRaw);
    return {
      id: l.id,
      name: cat?.description ?? l.skuDescriptionRaw ?? null,
      sku: l.skuCodeRaw,
      pack: cat ? formatPack(cat.packCode, cat.unit) : null,
      qty: l.unitQty,
    };
  });

  return NextResponse.json({ lines });
}
