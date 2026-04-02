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

    const order = await prisma.orders.findUnique({
      where: { id: orderId },
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

    // Line items — enriched join raw join sku
    const enrichedItems = await prisma.import_enriched_line_items.findMany({
      where: {
        rawLineItem: { obdNumber: order.obdNumber },
      },
      select: {
        unitQty: true,
        lineWeight: true,
        volumeLine: true,
        isTinting: true,
        sku: {
          select: {
            skuCode: true,
            skuName: true,
          },
        },
        rawLineItem: {
          select: {
            skuCodeRaw: true,
            skuDescriptionRaw: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });

    const lineItems = enrichedItems.map((e) => ({
      skuCode: e.sku?.skuCode ?? e.rawLineItem.skuCodeRaw,
      skuDescription: e.sku?.skuName ?? e.rawLineItem.skuDescriptionRaw ?? "—",
      unitQty: e.unitQty,
      lineWeight: e.lineWeight,
      volumeLine: e.volumeLine,
      isTinting: e.isTinting,
    }));

    return NextResponse.json({
      order,
      importSummary: importSummary
        ? { ...importSummary, soNumber }
        : null,
      lineItems,
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
