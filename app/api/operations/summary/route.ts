import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.OPERATIONS]);

  // ── Today IST ───────────────────────────────────────────────────────────────
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayIST = nowIST.toISOString().slice(0, 10);
  const todayStart = new Date(todayIST + "T00:00:00+05:30");
  const todayEnd = new Date(todayIST + "T23:59:59+05:30");
  const todayDate = new Date(todayIST); // for planDate (@db.Date)

  // ── IMPORT ──────────────────────────────────────────────────────────────────
  const totalToday = await prisma.orders.count({
    where: { createdAt: { gte: todayStart, lte: todayEnd } },
  });
  const pendingSupport = await prisma.orders.count({
    where: { workflowStage: "pending_support" },
  });
  const onHold = await prisma.orders.count({
    where: { dispatchStatus: "hold" },
  });
  const dispatched = await prisma.orders.count({
    where: { workflowStage: "dispatched" },
  });

  // ── TINTING ─────────────────────────────────────────────────────────────────
  const pendingTint = await prisma.order_splits.count({
    where: {
      status: { in: ["tint_assigned", "pending"] },
      order: { querySnapshot: { hasTinting: true } },
    },
  });
  const inProgressTint = await prisma.order_splits.count({
    where: { status: "tinting_in_progress" },
  });
  const doneTint = await prisma.order_splits.count({
    where: { status: "tinting_done" },
  });

  // ── DISPATCH ────────────────────────────────────────────────────────────────
  const draftTrips = await prisma.dispatch_plans.count({
    where: { status: "draft", planDate: todayDate },
  });
  const confirmedTrips = await prisma.dispatch_plans.count({
    where: { status: "confirmed", planDate: todayDate },
  });
  const dispatchedTrips = await prisma.dispatch_plans.count({
    where: { status: "dispatched", planDate: todayDate },
  });
  const vehiclesOutRaw = await prisma.dispatch_plans.findMany({
    where: { status: "dispatched", planDate: todayDate },
    select: { vehicleId: true },
    distinct: ["vehicleId"],
  });
  const vehiclesOut = vehiclesOutRaw.length;

  // ── WAREHOUSE ───────────────────────────────────────────────────────────────
  const assignedOrderIds = await prisma.pick_assignments.findMany({
    where: { clearedAt: null },
    select: { orderId: true },
  });
  const assignedIds = assignedOrderIds.map((a) => a.orderId);
  const unassigned = await prisma.orders.count({
    where: {
      workflowStage: {
        in: ["pending_support", "submitted", "tinting", "tint_done", "ready"],
      },
      id: { notIn: assignedIds.length > 0 ? assignedIds : [-1] },
    },
  });
  const picking = await prisma.pick_assignments.count({
    where: { status: "assigned", clearedAt: null },
  });
  const picked = await prisma.pick_assignments.count({
    where: { status: "picked", clearedAt: null },
  });

  // ── ALERTS ──────────────────────────────────────────────────────────────────
  const overdueOrders = await prisma.orders.findMany({
    where: { originalSlotId: { not: null } },
    select: { slotId: true, originalSlotId: true },
  });
  const overdueCount = overdueOrders.filter(
    (o) => o.slotId !== o.originalSlotId,
  ).length;

  const slots = await prisma.slot_master.findMany({
    where: { isNextDay: false },
    select: { id: true, slotTime: true },
  });
  const nowISTTime = nowIST.toISOString().slice(11, 16); // "HH:MM" in UTC+5:30
  const graceMins = 15;
  const closedSlotIds = slots
    .filter((s) => {
      const [h, m] = s.slotTime.split(":").map(Number);
      const slotMinutes = h * 60 + m + graceMins;
      const [nh, nm] = nowISTTime.split(":").map(Number);
      const nowMinutes = nh * 60 + nm;
      return nowMinutes > slotMinutes;
    })
    .map((s) => s.id);

  const closedSlotOrders =
    closedSlotIds.length > 0
      ? await prisma.orders.count({
          where: {
            slotId: { in: closedSlotIds },
            workflowStage: { in: ["pending_support", "submitted"] },
          },
        })
      : 0;

  // ── Response ────────────────────────────────────────────────────────────────
  return NextResponse.json({
    import: { totalToday, pendingSupport, onHold, dispatched },
    tinting: { pending: pendingTint, inProgress: inProgressTint, done: doneTint },
    dispatch: { draftTrips, confirmedTrips, dispatchedTrips, vehiclesOut },
    warehouse: { unassigned, picking, picked },
    alerts: { overdue: overdueCount, onHold, closedSlot: closedSlotOrders },
  });
}
