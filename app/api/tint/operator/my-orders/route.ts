import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR, ROLES.OPERATIONS]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_operator", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const userId = parseInt(session!.user.id, 10);
  const isOpsOrAdmin = ["operations", "admin"].includes(session!.user.role ?? "");

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const [assignedOrders, assignedSplits, completedOrders, completedSplits] = await Promise.all([
    // Query 1: Regular assigned orders (non-split flow)
    prisma.orders.findMany({
      where: {
        workflowStage: { in: ["tint_assigned", "tinting_in_progress"] },
        tintAssignments: {
          some: {
            ...(isOpsOrAdmin ? {} : { assignedToId: userId }),
            status: { not: "done" },
          },
        },
      },
      include: {
        customer: {
          include: {
            area: { select: { name: true, deliveryType: { select: { name: true } }, primaryRoute: { select: { name: true } } } },
          },
        },
        tintAssignments: {
          where:   isOpsOrAdmin ? { status: { not: "done" } } : { assignedToId: userId },
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
        ...(isOpsOrAdmin ? {} : { assignedToId: userId }),
        status: { in: ["tint_assigned", "tinting_in_progress"] },
      },
      include: {
        order: {
          include: {
            customer: {
              include: {
                area: { select: { name: true, deliveryType: { select: { name: true } }, primaryRoute: { select: { name: true } } } },
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
        ...(isOpsOrAdmin ? {} : { assignedToId: userId }),
        status:       "tinting_done",
        completedAt:  { gte: startOfToday },
      },
      include: {
        order: {
          include: {
            customer:      { include: { area: { select: { name: true, deliveryType: { select: { name: true } }, primaryRoute: { select: { name: true } } } } } },
            querySnapshot: { select: { totalVolume: true } },
          },
        },
      },
    }),

    // Query 4b: order_splits completed today
    prisma.order_splits.findMany({
      where: {
        ...(isOpsOrAdmin ? {} : { assignedToId: userId }),
        status:       { in: ["tinting_done", "pending_support", "dispatch_confirmation", "dispatched"] },
        completedAt:  { gte: startOfToday },
      },
      include: {
        order: {
          include: {
            customer: { include: { area: { select: { name: true, deliveryType: { select: { name: true } }, primaryRoute: { select: { name: true } } } } } },
          },
        },
      },
    }),
  ]);

  // Intermediate sets for downstream queries
  const obdNumbers         = assignedOrders.map(o => o.obdNumber);
  const allAssignedOrderIds = assignedOrders.map(o => o.id);
  const allAssignedSplitIds = assignedSplits.map(s => s.id);
  const allObdNumbers = [
    ...assignedOrders.map(o => o.obdNumber),
    ...assignedSplits.map(s => s.order.obdNumber),
    ...completedOrders.map(c => c.order.obdNumber),
    ...completedSplits.map(s => s.order.obdNumber),
  ];
  const uniqueObdNumbers    = Array.from(new Set(allObdNumbers));
  const hasCoverageTargets  = allAssignedOrderIds.length > 0 || allAssignedSplitIds.length > 0;

  // Build OR conditions for TI coverage queries
  const coverageOr: ({ orderId: { in: number[] }; splitId: null } | { splitId: { in: number[] } })[] = [];
  if (allAssignedOrderIds.length > 0) coverageOr.push({ orderId: { in: allAssignedOrderIds }, splitId: null });
  if (allAssignedSplitIds.length > 0) coverageOr.push({ splitId: { in: allAssignedSplitIds } });

  // Query 3a: Raw line items for assigned orders (orders has no direct Prisma relation to import_raw_line_items)
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

  // Query 3b: import_raw_summary — authoritative source of shipToCustomerId/Name
  const rawSummaries = uniqueObdNumbers.length > 0
    ? await prisma.import_raw_summary.findMany({
        where:  { obdNumber: { in: uniqueObdNumbers } },
        select: { obdNumber: true, shipToCustomerId: true, shipToCustomerName: true, billToCustomerId: true, billToCustomerName: true },
      })
    : [];

  // Query 3c–3d in parallel: TI coverage entries (both tinter tables)
  const [tinterCovRaw, acotoneCovRaw] = hasCoverageTargets
    ? await Promise.all([
        prisma.tinter_issue_entries.findMany({
          where:  { OR: coverageOr },
          select: { orderId: true, splitId: true, rawLineItemId: true },
        }),
        prisma.tinter_issue_entries_b.findMany({
          where:  { OR: coverageOr },
          select: { orderId: true, splitId: true, rawLineItemId: true },
        }),
      ])
    : [[], []] as [{ orderId: number; splitId: number | null; rawLineItemId: number | null }[], { orderId: number; splitId: number | null; rawLineItemId: number | null }[]];

  const lineItemsByObd = rawLineItemsRows.reduce<Record<string, typeof rawLineItemsRows>>(
    (acc, li) => {
      if (!acc[li.obdNumber]) acc[li.obdNumber] = [];
      acc[li.obdNumber].push(li);
      return acc;
    },
    {},
  );

  // Build TI coverage map: key = "split:<id>" | "order:<id>", value = Set of covered rawLineItemIds
  const coverageMap = new Map<string, Set<number>>();
  for (const e of [...tinterCovRaw, ...acotoneCovRaw]) {
    if (e.rawLineItemId == null) continue;
    const key = e.splitId != null ? `split:${e.splitId}` : `order:${e.orderId}`;
    if (!coverageMap.has(key)) coverageMap.set(key, new Set());
    coverageMap.get(key)!.add(e.rawLineItemId);
  }

  const shipToCustomerIdMap   = new Map(rawSummaries.map(r => [r.obdNumber, r.shipToCustomerId ?? ""]));
  const shipToCustomerNameMap = new Map(rawSummaries.map(r => [r.obdNumber, r.shipToCustomerName ?? null]));
  const billToCustomerIdMap   = new Map(rawSummaries.map(r => [r.obdNumber, r.billToCustomerId ?? null]));
  const billToCustomerNameMap = new Map(rawSummaries.map(r => [r.obdNumber, r.billToCustomerName ?? null]));

  const ordersWithLineItems = assignedOrders.map(o => ({
    ...o,
    rawLineItems:       lineItemsByObd[o.obdNumber] ?? [],
    shipToCustomerId:   shipToCustomerIdMap.get(o.obdNumber) || o.shipToCustomerId,
    shipToCustomerName: shipToCustomerNameMap.get(o.obdNumber) ?? o.shipToCustomerName,
    billToCustomerId:   billToCustomerIdMap.get(o.obdNumber) ?? null,
    billToCustomerName: billToCustomerNameMap.get(o.obdNumber) ?? null,
    areaName:           (o.customer as any)?.area?.name ?? null,
    routeName:          (o.customer as any)?.area?.primaryRoute?.name ?? null,
    deliveryTypeName:   (o.customer as any)?.area?.deliveryType?.name ?? null,
    tiCoveredLines:     coverageMap.get(`order:${o.id}`)?.size ?? 0,
    totalTintingLines:  (lineItemsByObd[o.obdNumber] ?? []).filter(li => li.isTinting).length,
  }));

  const splitsWithCustomer = assignedSplits.map(s => ({
    ...s,
    order: {
      ...s.order,
      shipToCustomerId:   shipToCustomerIdMap.get(s.order.obdNumber) || s.order.shipToCustomerId,
      shipToCustomerName: shipToCustomerNameMap.get(s.order.obdNumber) ?? s.order.shipToCustomerName,
      billToCustomerId:   billToCustomerIdMap.get(s.order.obdNumber) ?? null,
      billToCustomerName: billToCustomerNameMap.get(s.order.obdNumber) ?? null,
      areaName:           (s.order.customer as any)?.area?.name ?? null,
      routeName:          (s.order.customer as any)?.area?.primaryRoute?.name ?? null,
      deliveryTypeName:   (s.order.customer as any)?.area?.deliveryType?.name ?? null,
    },
    tiCoveredLines:    coverageMap.get(`split:${s.id}`)?.size ?? 0,
    totalTintingLines: s.lineItems.filter(li => li.rawLineItem.isTinting).length,
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
    (a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0),
  );
  splitsWithCustomer.sort(
    (a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0),
  );

  const totalDoneToday     = completedOrdersEnhanced.length + completedSplitsEnhanced.length;
  const totalAssignedToday = ordersWithLineItems.length + splitsWithCustomer.length + totalDoneToday;

  return NextResponse.json({
    assignedOrders:  ordersWithLineItems,
    assignedSplits:  splitsWithCustomer,
    hasActiveJob,
    completedOrders: completedOrdersEnhanced,
    completedSplits: completedSplitsEnhanced,
    totalAssignedToday,
    totalDoneToday,
  });
}
