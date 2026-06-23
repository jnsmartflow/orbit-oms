import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getSlotNamesAtEndOfDay } from "@/lib/slot-history";
import { getHideExclusion } from "@/lib/hide/visibility";
import { getISTDayRange } from "@/lib/dates";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// Shared include block used by both today and history queries
const ORDER_INCLUDE = {
  customer: {
    select: {
      id: true,
      customerName: true,
      dispatchDeliveryType: { select: { name: true } },
      area: {
        select: {
          name: true,
          primaryRoute: { select: { name: true } },
          deliveryType: { select: { name: true } },
        },
      },
    },
  },
  slot: { select: { name: true } },
  originalSlot: { select: { name: true } },
  querySnapshot: {
    select: {
      hasTinting: true,
      totalUnitQty: true,
      articleTag: true,
    },
  },
  splits: {
    where: { status: { not: "cancelled" } },
    select: { id: true, status: true, dispatchStatus: true },
  },
} as const;

const ORDER_BY: Prisma.ordersOrderByWithRelationInput[] = [
  { priorityLevel: "asc" },
  { obdEmailDate: "asc" },
  { obdNumber: "asc" },
];

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.OPERATIONS]);

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date")?.trim() ?? "";
  const section   = searchParams.get("section")?.trim() ?? "";
  const slotIdStr = searchParams.get("slotId")?.trim() ?? "";
  const status    = searchParams.get("status")?.trim() ?? "";
  const priority  = searchParams.get("priority")?.trim() ?? "";
  const search    = searchParams.get("search")?.trim() ?? "";

  // Default date = today
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateStr  = dateParam || todayStr;
  const isHistoryView = dateStr < todayStr;

  if (!section || !["slot", "hold"].includes(section)) {
    return NextResponse.json({ error: "Invalid or missing section param" }, { status: 400 });
  }

  if (section === "slot" && !slotIdStr) {
    return NextResponse.json({ error: "slotId required for section=slot" }, { status: 400 });
  }

  // ── Build where clause ───────────────────────────────────────────────────
  // isRemoved: false excludes soft-removed orders from the support board.
  const where: Prisma.ordersWhereInput = { isRemoved: false };

  if (section === "slot") {
    if (!isHistoryView) {
      where.slotId = parseInt(slotIdStr, 10);
      // Today: pending/tinting orders (any date — carry-over preserved) PLUS
      // today's closed orders fenced to obdEmailDate so history never bleeds in.
      const { start: obdStart, end: obdEnd } = getISTDayRange(dateStr);
      where.OR = [
        { workflowStage: { notIn: ["dispatched", "cancelled", "closed", "order_created", "pending_tint_assignment"] } },
        { workflowStage: "closed", obdEmailDate: { gte: obdStart, lt: obdEnd } },
      ];
    } else {
      // History: no slotId filter, closed excluded — reconstruction happens post-query
      where.workflowStage = {
        notIn: ["dispatched", "cancelled", "closed", "order_created", "pending_tint_assignment"],
      };
    }
  } else if (section === "hold") {
    where.dispatchStatus = "hold";
    where.workflowStage = { notIn: ["dispatched", "cancelled", "closed"] };
  }

  // Status sub-filter (skip for hold section — don't overwrite dispatchStatus)
  if (section !== "hold") {
    if (status === "pending") {
      where.workflowStage = { in: ["pending_support", "tinting_done"] };
      where.dispatchStatus = null;
    } else if (status === "dispatch") {
      where.dispatchStatus = "dispatch";
    } else if (status === "tinting") {
      where.workflowStage = { in: ["tinting_in_progress", "tint_assigned"] };
    }
  }

  // Priority filter
  if (priority) {
    where.priorityLevel = parseInt(priority, 10);
  }

  // Search filter
  if (search) {
    const searchFilter: Prisma.ordersWhereInput[] = [
      { obdNumber: { contains: search, mode: "insensitive" } },
      { shipToCustomerName: { contains: search, mode: "insensitive" } },
    ];
    if (where.OR) {
      where.AND = [
        { OR: where.OR as Prisma.ordersWhereInput[] },
        { OR: searchFilter },
      ];
      delete where.OR;
    } else {
      where.OR = searchFilter;
    }
  }

  // ── Query ────────────────────────────────────────────────────────────────
  // AND-merge the hide-feature exclusion with the fully-assembled where above.
  const hideExclusion = await getHideExclusion();
  let orders = await prisma.orders.findMany({
    where: { AND: [where, hideExclusion] },
    include: ORDER_INCLUDE,
    orderBy: ORDER_BY,
  });

  // ── History reconstruction: filter by reconstructed slot ─────────────────
  if (isHistoryView && section === "slot") {
    const requestedSlot = await prisma.slot_master.findUnique({
      where: { id: parseInt(slotIdStr, 10) },
      select: { name: true },
    });
    const requestedSlotName = requestedSlot?.name ?? "";

    const orderIds = orders.map((o) => o.id);
    const slotMap = await getSlotNamesAtEndOfDay(orderIds, dateStr);

    orders = orders.filter((o) => slotMap.get(o.id) === requestedSlotName);
  }

  // ── Volume lookup ───────────────────────────────────────────────────────
  const obdNumbers = orders.map((o) => o.obdNumber);
  const summaries = obdNumbers.length > 0
    ? await prisma.import_raw_summary.findMany({
        where: { obdNumber: { in: obdNumbers } },
        select: { obdNumber: true, volume: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const volumeMap = new Map<string, number | null>();
  for (const s of summaries) {
    if (!volumeMap.has(s.obdNumber)) volumeMap.set(s.obdNumber, s.volume);
  }

  const mappedOrders = orders.map((order) => {
    const obdDate = order.obdEmailDate?.toISOString().slice(0, 10) ?? dateStr;
    const isCarriedOver = obdDate < dateStr;
    const daysOverdue = isCarriedOver
      ? Math.floor((new Date(dateStr).getTime() - new Date(obdDate).getTime()) / 86400000)
      : 0;
    const importVolume = volumeMap.get(order.obdNumber) ?? null;
    return { ...order, isCarriedOver, daysOverdue, importVolume, isDone: order.workflowStage === "closed" };
  });

  return NextResponse.json({ orders: mappedOrders });
}
