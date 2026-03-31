import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { runDailyCleanupIfNeeded } from "@/lib/day-boundary";
import { runSlotCascadeIfNeeded } from "@/lib/slot-cascade";

export const dynamic = "force-dynamic";

// ── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: number;
  obdNumber: string;
  weightKg: number;
  units: number;
  isPicked: boolean;
  pickedAt: string | null;
  hasTinting: boolean;
  tintingStatus: string | null;
  pickAssignment: { id: number; sequence: number; pickerId: number } | null;
  isCarriedOver: boolean;
  daysOverdue: number;
}

interface CustomerGroup {
  customerId: string;
  customerName: string;
  area: string;
  route: string;
  priority: string;
  customerRating: string;
  deliveryType: string;
  slotId: number;
  slotName: string;
  slotSortOrder: number;
  slotTime: string;
  slotIsNextDay: boolean;
  totalKg: number;
  totalUnits: number;
  hasTinting: boolean;
  tintingPendingCount: number;
  tintingCompleteCount: number;
  tripInfo: { tripNumber: number; vehicleNo: string; vehicleType: string } | null;
  orders: OrderItem[];
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<NextResponse> {
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const session = await auth();
  requireRole(session, [ROLES.FLOOR_SUPERVISOR, ROLES.ADMIN]);

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? todayIST;
  const deliveryTypeFilter = searchParams.get("deliveryType");
  const isHistoryView = date < todayIST;

  // Only run cleanup for today's view
  if (date === todayIST) {
    await runDailyCleanupIfNeeded();
    await runSlotCascadeIfNeeded(todayIST);
  }

  // Fetch orders ready for warehouse: today + carried-over (older, not completed)
  const rawOrders = await prisma.orders.findMany({
    where: {
      workflowStage: "dispatch_confirmation",
      obdEmailDate: {
        lte: new Date(date + "T23:59:59"),
      },
      OR: [
        { splits: { some: { dispatchStatus: "dispatch", status: { not: "cancelled" } } } },
        { splits: { none: {} } },
      ],
    },
    include: {
      customer: {
        select: {
          id: true,
          customerName: true,
          customerRating: true,
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
      slot: { select: { id: true, name: true, sortOrder: true, slotTime: true, isNextDay: true } },
      querySnapshot: {
        select: {
          totalUnitQty: true,
          totalWeight: true,
          hasTinting: true,
        },
      },
      splits: {
        where: { status: { not: "cancelled" } },
        select: {
          id: true,
          status: true,
          dispatchStatus: true,
        },
      },
      dispatchPlanOrders: {
        where: isHistoryView ? {} : { clearedAt: null },
        select: {
          plan: {
            select: {
              tripNumber: true,
              status: true,
              vehicle: { select: { vehicleNo: true, category: true } },
            },
          },
        },
      },
      pickAssignment: {
        select: {
          id: true,
          pickerId: true,
          sequence: true,
          status: true,
          clearedAt: true,
        },
      },
    },
    orderBy: [{ priorityLevel: "asc" }, { obdEmailDate: "asc" }],
  });

  // For today's view, treat cleared pick assignments as null (soft-deleted)
  if (!isHistoryView) {
    for (const order of rawOrders) {
      if (order.pickAssignment?.clearedAt) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (order as any).pickAssignment = null;
      }
    }
  }

  // Helper: build customer groups from a list of orders
  function buildCustomerGroups(orderList: typeof rawOrders): CustomerGroup[] {
    const customerMap = new Map<string, typeof rawOrders>();
    for (const order of orderList) {
      const key = order.shipToCustomerId;
      if (!customerMap.has(key)) customerMap.set(key, []);
      customerMap.get(key)!.push(order);
    }

    const groups: CustomerGroup[] = [];

  for (const [customerId, orders] of Array.from(customerMap.entries())) {
    const first = orders[0];
    const customer = first.customer;
    const dt =
      customer?.dispatchDeliveryType?.name ??
      customer?.area?.deliveryType?.name ??
      "Local";

    // Tinting counts
    let tintingPending = 0;
    let tintingComplete = 0;
    let groupHasTinting = false;
    for (const o of orders) {
      if (o.querySnapshot?.hasTinting) {
        groupHasTinting = true;
        const tintSplits = o.splits.filter((s) =>
          ["tinting_in_progress", "tint_assigned"].includes(s.status),
        );
        const doneSplits = o.splits.filter((s) => s.status === "tinting_done");
        tintingPending += tintSplits.length;
        tintingComplete += doneSplits.length;
      }
    }

    // Trip info from first order's dispatch plan
    let tripInfo: CustomerGroup["tripInfo"] = null;
    const planOrder = first.dispatchPlanOrders[0];
    if (planOrder?.plan?.status === "confirmed" && planOrder.plan.vehicle) {
      tripInfo = {
        tripNumber: planOrder.plan.tripNumber,
        vehicleNo: planOrder.plan.vehicle.vehicleNo,
        vehicleType: planOrder.plan.vehicle.category,
      };
    }

    // Determine priority label from highest priority order
    const highestPri = Math.min(...orders.map((o) => o.priorityLevel));
    const priLabel = highestPri === 1 ? "P1" : highestPri === 2 ? "P2" : "P3";

    const group: CustomerGroup = {
      customerId,
      customerName: customer?.customerName ?? first.shipToCustomerName ?? "—",
      area: customer?.area?.name ?? "",
      route: customer?.area?.primaryRoute?.name ?? "",
      priority: priLabel,
      customerRating: customer?.customerRating ?? "",
      deliveryType: dt,
      slotId: first.slotId ?? 0,
      slotName: first.slot?.name ?? "No Slot",
      slotSortOrder: first.slot?.sortOrder ?? 99,
      slotTime: first.slot?.slotTime ?? "00:00",
      slotIsNextDay: first.slot?.isNextDay ?? false,
      totalKg: orders.reduce((s, o) => s + (o.querySnapshot?.totalWeight ?? 0), 0),
      totalUnits: orders.reduce((s, o) => s + (o.querySnapshot?.totalUnitQty ?? 0), 0),
      hasTinting: groupHasTinting,
      tintingPendingCount: tintingPending,
      tintingCompleteCount: tintingComplete,
      tripInfo,
      orders: orders.map((o) => {
        // Determine tinting status for this specific order
        let tintingStatus: string | null = null;
        if (o.querySnapshot?.hasTinting) {
          const hasPending = o.splits.some((s) =>
            ["tinting_in_progress", "tint_assigned"].includes(s.status),
          );
          tintingStatus = hasPending ? "pending" : "done";
        }

        const orderDate = new Date(o.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        const isCarriedOver = orderDate < todayIST;
        const daysOverdue = isCarriedOver
          ? Math.floor((new Date(todayIST).getTime() - new Date(orderDate).getTime()) / 86400000)
          : 0;

        return {
          id: o.id,
          obdNumber: o.obdNumber,
          weightKg: o.querySnapshot?.totalWeight ?? 0,
          units: o.querySnapshot?.totalUnitQty ?? 0,
          isPicked: o.isPicked,
          pickedAt: o.pickedAt?.toISOString() ?? null,
          hasTinting: o.querySnapshot?.hasTinting ?? false,
          tintingStatus,
          pickAssignment: o.pickAssignment
            ? {
                id: o.pickAssignment.id,
                sequence: o.pickAssignment.sequence,
                pickerId: o.pickAssignment.pickerId,
              }
            : null,
          isCarriedOver,
          daysOverdue,
        };
      }),
    };

    groups.push(group);
    }

    return groups;
  }

  // Build ALL groups from unfiltered data (for assigned section + stats)
  const allGroups = buildCustomerGroups(rawOrders);

  // Apply delivery type + slot filters for UNASSIGNED section only
  let filteredForUnassigned = rawOrders;
  if (deliveryTypeFilter) {
    const dtLower = deliveryTypeFilter.toLowerCase();
    filteredForUnassigned = filteredForUnassigned.filter((o) => {
      const dt = (
        o.customer?.dispatchDeliveryType?.name ??
        o.customer?.area?.deliveryType?.name ??
        "Local"
      ).toLowerCase();
      return dt.includes(dtLower);
    });
  }
  // Unassigned: filtered + no pick_assignment
  const filteredUnassignedOrders = filteredForUnassigned.filter((o) => !o.pickAssignment);
  const unassigned = buildCustomerGroups(filteredUnassignedOrders);

  // Auto-sort unassigned: carried-over first → slot urgency → vehicle → priority → key → tinting
  unassigned.sort((a, b) => {
    // Carried-over orders first (highest daysOverdue first)
    const aMaxOverdue = Math.max(...a.orders.map((o) => o.daysOverdue), 0);
    const bMaxOverdue = Math.max(...b.orders.map((o) => o.daysOverdue), 0);
    if (aMaxOverdue !== bMaxOverdue) return bMaxOverdue - aMaxOverdue;
    if (a.slotSortOrder !== b.slotSortOrder) return a.slotSortOrder - b.slotSortOrder;
    const aVeh = a.tripInfo ? 0 : 1;
    const bVeh = b.tripInfo ? 0 : 1;
    if (aVeh !== bVeh) return aVeh - bVeh;
    const aPri = a.priority === "P1" ? 1 : a.priority === "P2" ? 2 : 3;
    const bPri = b.priority === "P1" ? 1 : b.priority === "P2" ? 2 : 3;
    if (aPri !== bPri) return aPri - bPri;
    const aKey = a.customerRating === "A" ? 0 : 1;
    const bKey = b.customerRating === "A" ? 0 : 1;
    if (aKey !== bKey) return aKey - bKey;
    const aTint = a.hasTinting ? (a.tintingPendingCount === 0 ? 0 : 1) : 2;
    const bTint = b.hasTinting ? (b.tintingPendingCount === 0 ? 0 : 1) : 2;
    return aTint - bTint;
  });

  // Assigned: UNFILTERED — always shows ALL picker assignments for today
  const assignedMap = new Map<
    number,
    { groups: CustomerGroup[]; totalKg: number; total: number; picked: number; pending: number }
  >();

  for (const group of allGroups) {
    const hasAssignment = group.orders.some((o) => o.pickAssignment !== null);
    if (!hasAssignment) continue;

    const pickerId = group.orders.find((o) => o.pickAssignment)?.pickAssignment?.pickerId;
    if (!pickerId) continue;

    if (!assignedMap.has(pickerId)) {
      assignedMap.set(pickerId, { groups: [], totalKg: 0, total: 0, picked: 0, pending: 0 });
    }
    const bucket = assignedMap.get(pickerId)!;
    bucket.groups.push(group);
    bucket.totalKg += group.totalKg;
    bucket.total += group.orders.length;
    bucket.picked += group.orders.filter((o) => o.isPicked).length;
    bucket.pending += group.orders.filter((o) => !o.isPicked).length;
  }

  // Fetch picker user info
  const pickerIds = Array.from(assignedMap.keys());
  const pickerUsers =
    pickerIds.length > 0
      ? await prisma.users.findMany({
          where: { id: { in: pickerIds } },
          select: { id: true, name: true },
        })
      : [];

  const pickerNameMap = new Map<number, string>();
  for (const u of pickerUsers) {
    pickerNameMap.set(u.id, u.name);
  }

  const assigned = Array.from(assignedMap.entries()).map(([pickerId, bucket]) => {
    const name = pickerNameMap.get(pickerId) ?? "Unknown";
    return {
      picker: {
        id: pickerId,
        name,
        avatarInitial: name.charAt(0).toUpperCase(),
      },
      assignments: bucket.groups,
      stats: {
        total: bucket.total,
        picked: bucket.picked,
        pending: bucket.pending,
        totalKg: bucket.totalKg,
      },
    };
  });

  // Overall stats (from ALL unfiltered groups)
  const totalOrders = allGroups.reduce((s, g) => s + g.orders.length, 0);
  const pickedOrders = allGroups.reduce(
    (s, g) => s + g.orders.filter((o) => o.isPicked).length,
    0,
  );
  const unassignedOrderCount = allGroups
    .filter((g) => g.orders.every((o) => !o.pickAssignment))
    .reduce((s, g) => s + g.orders.length, 0);
  const pickingOrders = totalOrders - pickedOrders - unassignedOrderCount;

  return NextResponse.json({
    unassigned,
    assigned,
    stats: {
      unassigned: unassignedOrderCount,
      picking: pickingOrders > 0 ? pickingOrders : 0,
      picked: pickedOrders,
      totalOBDs: totalOrders,
    },
  });
}
