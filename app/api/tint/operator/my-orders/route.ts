import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "tint_operator", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const userId = parseInt(session!.user.id, 10);

  const [assignedOrders, assignedSplits] = await Promise.all([
    // Query 1: Regular assigned orders (non-split flow)
    prisma.orders.findMany({
      where: {
        workflowStage: { in: ["tint_assigned", "tinting_in_progress"] },
        tintAssignments: {
          some: {
            assignedToId: userId,
            status: { not: "done" },
          },
        },
      },
      include: {
        customer: {
          include: {
            area: { select: { name: true } },
          },
        },
        tintAssignments: {
          where:   { assignedToId: userId },
          select:  { id: true, status: true, startedAt: true, tiSubmitted: true, operatorSequence: true },
          orderBy: { createdAt: "desc" },
          take:    1,
        },
        querySnapshot: {
          select: {
            totalUnitQty: true,
            totalVolume:  true,
            articleTag:   true,
            totalLines:   true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),

    // Query 2: Splits assigned to this operator
    prisma.order_splits.findMany({
      where: {
        assignedToId: userId,
        status: { in: ["tint_assigned", "tinting_in_progress"] },
      },
      include: {
        order: {
          include: {
            customer: {
              include: {
                area: { select: { name: true } },
              },
            },
          },
        },
        lineItems: {
          include: {
            rawLineItem: {
              select: {
                skuCodeRaw:        true,
                skuDescriptionRaw: true,
                unitQty:           true,
                volumeLine:        true,
                isTinting:         true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Query 3: Raw line items for assigned orders (orders has no direct Prisma relation to import_raw_line_items)
  const obdNumbers = assignedOrders.map(o => o.obdNumber);
  const rawLineItemsRows = obdNumbers.length > 0
    ? await prisma.import_raw_line_items.findMany({
        where: { obdNumber: { in: obdNumbers } },
        select: {
          id:                true,
          obdNumber:         true,
          skuCodeRaw:        true,
          skuDescriptionRaw: true,
          unitQty:           true,
          volumeLine:        true,
          isTinting:         true,
        },
      })
    : [];

  const lineItemsByObd = rawLineItemsRows.reduce<Record<string, typeof rawLineItemsRows>>(
    (acc, li) => {
      if (!acc[li.obdNumber]) acc[li.obdNumber] = [];
      acc[li.obdNumber].push(li);
      return acc;
    },
    {},
  );

  const ordersWithLineItems = assignedOrders.map(o => ({
    ...o,
    rawLineItems: lineItemsByObd[o.obdNumber] ?? [],
  }));

  const hasActiveJob =
    ordersWithLineItems.some(o => o.tintAssignments[0]?.status === "tinting_in_progress") ||
    assignedSplits.some(s => s.status === "tinting_in_progress");

  ordersWithLineItems.sort(
    (a, b) =>
      (a.tintAssignments[0]?.operatorSequence ?? 0) -
      (b.tintAssignments[0]?.operatorSequence ?? 0),
  );
  assignedSplits.sort((a, b) => a.operatorSequence - b.operatorSequence);

  return NextResponse.json({ assignedOrders: ordersWithLineItems, assignedSplits, hasActiveJob });
}
