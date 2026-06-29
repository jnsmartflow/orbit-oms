import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
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
  dispatchWindow: { select: { windowTime: true, label: true } },
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

  // IST day range + UTC date range — hoisted for use in both WHERE and footprintType
  const { start: istStart, end: istEnd } = getISTDayRange(dateStr);
  const [histYr, histMo, histDy] = dateStr.split("-").map(Number);
  const dateStart = new Date(Date.UTC(histYr, histMo - 1, histDy));
  const dateEnd   = new Date(Date.UTC(histYr, histMo - 1, histDy + 1));

  if (!section || !["slot", "hold", "earlier"].includes(section)) {
    return NextResponse.json({ error: "Invalid or missing section param" }, { status: 400 });
  }

  // ── Build where clause ───────────────────────────────────────────────────
  // isRemoved: false excludes soft-removed orders from the support board.
  const where: Prisma.ordersWhereInput = { isRemoved: false };

  if (section === "slot") {
    if (!isHistoryView) {
      // Today: all orders that ARRIVED today (IST-fenced on both arms).
      // slotId present → also scope to that arrival slot; absent → all slots.
      if (slotIdStr) where.arrivalSlotId = parseInt(slotIdStr, 10);
      where.OR = [
        { workflowStage: { notIn: ["dispatched", "cancelled", "closed", "order_created"] }, obdEmailDate: { gte: istStart, lt: istEnd } },
        { workflowStage: { in: ["closed", "dispatched", "cancelled"] }, obdEmailDate: { gte: istStart, lt: istEnd } },
      ];
    } else {
      // History: TWO-FOOTPRINT — obdEmailDate (arrival), heldAt (hold), dispatchTargetDate (dispatch).
      if (slotIdStr) {
        const histSlotId = parseInt(slotIdStr, 10);
        where.OR = [
          // ── Done: arrival footprint (any slot)
          { obdEmailDate: { gte: istStart, lt: istEnd }, workflowStage: { in: ["dispatched", "closed", "cancelled"] } },
          // ── Done: hold footprint now released (held on D, later closed)
          { heldAt: { gte: istStart, lt: istEnd }, workflowStage: "closed" },
          // ── Done: dispatch footprint — always unslotted, always in done group
          { dispatchTargetDate: { gte: dateStart, lt: dateEnd }, workflowStage: "closed" },
          // ── Pending: (arrived OR held) on D, slot-filtered
          {
            workflowStage: { notIn: ["dispatched", "closed", "cancelled", "order_created"] },
            AND: [
              { OR: [{ obdEmailDate: { gte: istStart, lt: istEnd } }, { heldAt: { gte: istStart, lt: istEnd } }] },
              { OR: [{ arrivalSlotId: histSlotId }, { arrivalSlotId: null, originalSlotId: histSlotId }] },
            ],
          },
        ];
      } else {
        // ALL-slot: union of all three footprints
        where.OR = [
          { obdEmailDate: { gte: istStart, lt: istEnd },
            workflowStage: { notIn: ["order_created"] } },
          { heldAt: { gte: istStart, lt: istEnd },
            workflowStage: { notIn: ["cancelled", "order_created"] } },
          { dispatchTargetDate: { gte: dateStart, lt: dateEnd }, workflowStage: "closed" },
        ];
      }
    }
  } else if (section === "hold") {
    where.dispatchStatus = "hold";
    where.workflowStage = { notIn: ["dispatched", "cancelled", "closed"] };
  } else if (section === "earlier") {
    // Orders that arrived before today IST and are still pending/unhandled.
    // Uses IST-aware today string to match slots/route.ts boundary exactly.
    const istTodayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const { start: todayIstStart } = getISTDayRange(istTodayStr);
    where.obdEmailDate  = { lt: todayIstStart };
    where.workflowStage = { in: ["pending_support", "tinting_done"] };
    where.dispatchStatus = null;
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
  const orders = await prisma.orders.findMany({
    where: { AND: [where, hideExclusion] },
    include: ORDER_INCLUDE,
    orderBy: ORDER_BY,
  });

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
    const isDone = order.workflowStage === "closed" || order.workflowStage === "dispatched" || order.dispatchStatus === "hold" || order.workflowStage === "cancelled";

    // footprintType: which footprint this row represents. Set for both today and history.
    // Priority: cancel > dispatch > hold > arrival.
    let footprintType: "arrival" | "hold" | "dispatch" | "cancel" = "arrival";
    if (order.workflowStage === "cancelled") {
      footprintType = "cancel";
    } else if (isHistoryView) {
      const dispDt = order.dispatchTargetDate;
      if (dispDt && dispDt >= dateStart && dispDt < dateEnd) {
        footprintType = "dispatch";
      } else if (order.heldAt && order.heldAt >= istStart && order.heldAt < istEnd) {
        footprintType = "hold";
      }
    } else {
      // Today board: read dispatchStatus directly — no date-range comparison needed.
      if (order.dispatchStatus === "dispatch") footprintType = "dispatch";
      else if (order.dispatchStatus === "hold") footprintType = "hold";
    }

    return { ...order, isCarriedOver, daysOverdue, importVolume, isDone, footprintType };
  });

  return NextResponse.json({ orders: mappedOrders });
}
