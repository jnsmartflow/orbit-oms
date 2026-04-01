import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { runDailyCleanupIfNeeded } from "@/lib/day-boundary";
import { runSlotCascadeIfNeeded } from "@/lib/slot-cascade";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const session = await auth();
  requireRole(session, [ROLES.DISPATCHER, ROLES.FLOOR_SUPERVISOR, ROLES.ADMIN, ROLES.OPERATIONS]);

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? todayIST;
  const showDispatched = searchParams.get("showDispatched") === "true";
  const isHistoryView = date < todayIST;

  // Only run cleanup for today's view
  if (date === todayIST) {
    await runDailyCleanupIfNeeded();
    await runSlotCascadeIfNeeded(todayIST);
  }

  const workflowStages = showDispatched
    ? ["dispatch_confirmation", "dispatched"]
    : ["dispatch_confirmation"];

  // Orders ready for planning: today + carried-over (older, not completed)
  const orders = await prisma.orders.findMany({
    where: {
      workflowStage: { in: workflowStages },
      obdEmailDate: {
        lte: new Date(date + "T23:59:59"),
      },
      OR: [
        // Tinting orders with dispatched splits
        {
          splits: {
            some: {
              dispatchStatus: "dispatch",
              status: { not: "cancelled" },
            },
          },
        },
        // Non-tinting orders (no splits at all)
        {
          splits: { none: {} },
        },
      ],
    },
    include: {
      customer: {
        select: {
          id: true,
          customerName: true,
          customerRating: true,
          dispatchDeliveryType: { select: { id: true, name: true } },
          area: {
            select: {
              id: true,
              name: true,
              primaryRoute: { select: { id: true, name: true } },
              deliveryType: { select: { id: true, name: true } },
            },
          },
        },
      },
      slot: { select: { id: true, name: true, sortOrder: true, slotTime: true, isNextDay: true } },
      originalSlot: { select: { name: true } },
      querySnapshot: {
        select: {
          totalUnitQty: true,
          totalWeight: true,
          totalVolume: true,
          hasTinting: true,
          articleTag: true,
        },
      },
      splits: {
        where: { status: { not: "cancelled" } },
        select: {
          id: true,
          status: true,
          dispatchStatus: true,
          isPicked: true,
          pickedAt: true,
          totalQty: true,
        },
      },
      dispatchPlanOrders: {
        where: isHistoryView ? {} : { clearedAt: null },
        select: {
          id: true,
          planId: true,
          sequenceOrder: true,
          plan: {
            select: {
              id: true,
              status: true,
              vehicleId: true,
              vehicle: { select: { vehicleNo: true, category: true } },
              tripNumber: true,
              slotId: true,
            },
          },
        },
      },
    },
    orderBy: [{ priorityLevel: "asc" }, { obdEmailDate: "asc" }],
  });

  // Existing plans: today + carried-over (non-dispatched from before today)
  const todayDate = new Date(date);
  const planWhereConditions = [];
  // Today's plans
  if (showDispatched) {
    planWhereConditions.push({ planDate: todayDate });
  } else {
    planWhereConditions.push({ planDate: todayDate, status: { not: "dispatched" } });
  }
  // Carried-over plans from before today (draft/confirmed/loading only)
  planWhereConditions.push({
    planDate: { lt: todayDate },
    status: { in: ["draft", "confirmed", "loading"] },
  });

  const plans = await prisma.dispatch_plans.findMany({
    where: { OR: planWhereConditions },
    include: {
      slot: { select: { id: true, name: true, sortOrder: true, slotTime: true, isNextDay: true } },
      vehicle: { select: { id: true, vehicleNo: true, category: true, capacityKg: true } },
      createdBy: { select: { id: true, name: true } },
      orders: {
        where: isHistoryView ? {} : { clearedAt: null },
        include: {
          order: {
            select: {
              id: true,
              obdNumber: true,
              shipToCustomerName: true,
              querySnapshot: {
                select: { totalWeight: true, totalVolume: true, totalUnitQty: true },
              },
            },
          },
        },
        orderBy: { sequenceOrder: "asc" },
      },
    },
    orderBy: [{ slotId: "asc" }, { tripNumber: "asc" }],
  });

  // Add carry-over fields to each order
  const enrichedOrders = orders.map((o) => {
    const orderDate = new Date(o.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const isCarriedOver = orderDate < todayIST;
    const daysOverdue = isCarriedOver
      ? Math.floor((new Date(todayIST).getTime() - new Date(orderDate).getTime()) / 86400000)
      : 0;
    return { ...o, isCarriedOver, daysOverdue };
  });

  return NextResponse.json({ orders: enrichedOrders, plans, date });
}
