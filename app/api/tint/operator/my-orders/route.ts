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

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const [assignedOrders, assignedSplits, completedOrders, completedSplits] = await Promise.all([
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

    // Query 4a: tint_assignments completed today (whole-OBD flow)
    prisma.tint_assignments.findMany({
      where: {
        assignedToId: userId,
        status:       "tinting_done",
        completedAt:  { gte: startOfToday },
      },
      include: {
        order: {
          include: {
            customer:      { include: { area: { select: { name: true } } } },
            querySnapshot: { select: { totalVolume: true } },
          },
        },
      },
    }),

    // Query 4b: order_splits completed today
    prisma.order_splits.findMany({
      where: {
        assignedToId: userId,
        status:       { in: ["tinting_done", "pending_support", "dispatch_confirmation", "dispatched"] },
        completedAt:  { gte: startOfToday },
      },
      include: {
        order: {
          include: {
            customer: { include: { area: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);

  // Query 3a: Raw line items for assigned orders (orders has no direct Prisma relation to import_raw_line_items)
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

  // Query 3b: import_raw_summary — authoritative source of shipToCustomerId/Name
  // (shade_master stores values from import_raw_summary; orders.shipToCustomerId may be empty)
  const allObdNumbers = [
    ...assignedOrders.map(o => o.obdNumber),
    ...assignedSplits.map(s => s.order.obdNumber),
    ...completedOrders.map(c => c.order.obdNumber),
    ...completedSplits.map(s => s.order.obdNumber),
  ];
  const uniqueObdNumbers = Array.from(new Set(allObdNumbers));

  const rawSummaries = uniqueObdNumbers.length > 0
    ? await prisma.import_raw_summary.findMany({
        where:  { obdNumber: { in: uniqueObdNumbers } },
        select: { obdNumber: true, shipToCustomerId: true, shipToCustomerName: true },
      })
    : [];

  const shipToCustomerIdMap   = new Map(rawSummaries.map(r => [r.obdNumber, r.shipToCustomerId ?? ""]));
  const shipToCustomerNameMap = new Map(rawSummaries.map(r => [r.obdNumber, r.shipToCustomerName ?? null]));

  const ordersWithLineItems = assignedOrders.map(o => ({
    ...o,
    rawLineItems:       lineItemsByObd[o.obdNumber] ?? [],
    shipToCustomerId:   shipToCustomerIdMap.get(o.obdNumber) || o.shipToCustomerId,
    shipToCustomerName: shipToCustomerNameMap.get(o.obdNumber) ?? o.shipToCustomerName,
  }));

  const splitsWithCustomer = assignedSplits.map(s => ({
    ...s,
    order: {
      ...s.order,
      shipToCustomerId:   shipToCustomerIdMap.get(s.order.obdNumber) || s.order.shipToCustomerId,
      shipToCustomerName: shipToCustomerNameMap.get(s.order.obdNumber) ?? s.order.shipToCustomerName,
    },
  }));

  const completedOrdersEnhanced = completedOrders.map(c => ({
    ...c,
    order: {
      ...c.order,
      shipToCustomerId:   shipToCustomerIdMap.get(c.order.obdNumber) || c.order.shipToCustomerId,
      shipToCustomerName: shipToCustomerNameMap.get(c.order.obdNumber) ?? c.order.shipToCustomerName,
    },
  }));

  const completedSplitsEnhanced = completedSplits.map(s => ({
    ...s,
    order: {
      ...s.order,
      shipToCustomerId:   shipToCustomerIdMap.get(s.order.obdNumber) || s.order.shipToCustomerId,
      shipToCustomerName: shipToCustomerNameMap.get(s.order.obdNumber) ?? s.order.shipToCustomerName,
    },
  }));

  const hasActiveJob =
    ordersWithLineItems.some(o => o.tintAssignments[0]?.status === "tinting_in_progress") ||
    splitsWithCustomer.some(s => s.status === "tinting_in_progress");

  ordersWithLineItems.sort(
    (a, b) =>
      (a.tintAssignments[0]?.operatorSequence ?? 0) -
      (b.tintAssignments[0]?.operatorSequence ?? 0),
  );
  splitsWithCustomer.sort((a, b) => a.operatorSequence - b.operatorSequence);

  return NextResponse.json({
    assignedOrders:  ordersWithLineItems,
    assignedSplits:  splitsWithCustomer,
    hasActiveJob,
    completedOrders: completedOrdersEnhanced,
    completedSplits: completedSplitsEnhanced,
  });
}
