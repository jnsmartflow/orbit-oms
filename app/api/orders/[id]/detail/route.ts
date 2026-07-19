import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const session = await auth();
    requireRole(session, [ROLES.SUPPORT, ROLES.DISPATCHER, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.TINT_MANAGER]);

    const orderId = parseInt(params.id, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }

    const order = await prisma.orders.findFirst({
      where: { id: orderId, isRemoved: false },
      select: {
        id: true,
        obdNumber: true,
        workflowStage: true,
        dispatchStatus: true,
        slotId: true,
        slot: { select: { name: true } },
        originalSlotId: true,
        originalSlot: { select: { name: true } },
        priorityLevel: true,
        createdAt: true,
        smu: true,
        customer: {
          select: {
            customerName: true,
            area: {
              select: {
                name: true,
                primaryRoute: { select: { name: true } },
                deliveryType: { select: { name: true } },
              },
            },
          },
        },
        querySnapshot: {
          select: {
            hasTinting: true,
            totalUnitQty: true,
            articleTag: true,
          },
        },
        splits: {
          where: { status: { not: "cancelled" } },
          select: {
            id: true,
            status: true,
            dispatchStatus: true,
          },
          orderBy: { splitNumber: "asc" },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Import summary — join on obdNumber
    const importSummary = await prisma.import_raw_summary.findFirst({
      where: { obdNumber: order.obdNumber },
      orderBy: { createdAt: "desc" },
      select: {
        billToCustomerId: true,
        billToCustomerName: true,
        shipToCustomerId: true,
        shipToCustomerName: true,
        obdEmailDate: true,
        obdEmailTime: true,
        invoiceNo: true,
        invoiceDate: true,
        materialType: true,
        totalUnitQty: true,
        grossWeight: true,
        volume: true,
      },
    });

    // soNumber — may not exist in schema yet, use raw query fallback
    let soNumber: string | null = null;
    try {
      const raw = await prisma.$queryRaw<{ soNumber: string | null }[]>`
        SELECT "soNumber" FROM import_raw_summary
        WHERE "obdNumber" = ${order.obdNumber}
        ORDER BY "createdAt" DESC LIMIT 1
      `;
      soNumber = raw[0]?.soNumber ?? null;
    } catch {
      // Column doesn't exist yet — ignore
    }

    // Line items — enriched join raw. The catalog is resolved separately, by
    // SAP code, NOT through the enrichedLineItem.sku relation (see below).
    // lineStatus filter on rawLineItem closes the Step 3 gap: only active
    // raw lines feed the detail panel's lineItems list.
    const enrichedItems = await prisma.import_enriched_line_items.findMany({
      where: {
        rawLineItem: { obdNumber: order.obdNumber, lineStatus: "active" },
      },
      select: {
        unitQty: true,
        lineWeight: true,
        volumeLine: true,
        isTinting: true,
        rawLineItem: {
          select: {
            skuCodeRaw: true,
            skuDescriptionRaw: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });

    // Catalog resolution goes through sku_master_v2 keyed on `material` (the
    // SAP code), NOT through the enrichedLineItem.sku relation. That relation
    // rides `skuId`, which still points at the OLD sku_master and shares no id
    // space with v2 — following it here would render a confidently WRONG
    // product name on a live Support / Tint Manager detail panel.
    // `skuCodeRaw` is the stable natural key, never null, identical across
    // both tables.
    // Reasoning: docs/prompts/drafts/code-discovery-2026-07-19b-catalog-repoint.md
    //
    // No isPrimary filter — a duplicate twin is still a real SAP code that
    // must resolve. Sequential await, no $transaction (CORE §3).
    const codes = Array.from(
      new Set(
        enrichedItems
          .map((e) => e.rawLineItem.skuCodeRaw)
          .filter((c): c is string => Boolean(c)),
      ),
    );
    const catalogRows =
      codes.length > 0
        ? await prisma.sku_master_v2.findMany({
            where: { material: { in: codes } },
            select: { material: true, description: true },
          })
        : [];
    const catalogByCode = new Map(catalogRows.map((r) => [r.material, r]));

    // Count soft-removed lines (any status other than "active") for the
    // detail panel's "Show removed (N)" toggle. Cheap — single COUNT.
    const removedLineCount = await prisma.import_raw_line_items.count({
      where: { obdNumber: order.obdNumber, lineStatus: { not: "active" } },
    });

    // Fallbacks preserved exactly as before — an unresolved code still shows
    // its raw SAP code and description, never a blank.
    const lineItems = enrichedItems.map((e) => {
      const cat = catalogByCode.get(e.rawLineItem.skuCodeRaw);
      return {
        skuCode: cat?.material ?? e.rawLineItem.skuCodeRaw,
        skuDescription:
          cat?.description ?? e.rawLineItem.skuDescriptionRaw ?? "—",
        unitQty: e.unitQty,
        lineWeight: e.lineWeight,
        volumeLine: e.volumeLine,
        isTinting: e.isTinting,
      };
    });

    return NextResponse.json({
      order,
      importSummary: importSummary
        ? { ...importSummary, soNumber }
        : null,
      lineItems,
      removedLineCount,
      splits: order.splits,
      querySnapshot: order.querySnapshot,
    });
  } catch (err) {
    console.error("Order detail error:", err);
    return NextResponse.json(
      { error: "Failed to fetch order detail" },
      { status: 500 },
    );
  }
}
