import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN, ROLES.DISPATCHER]);

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
  const dateStart = new Date(dateStr + "T00:00:00.000Z");
  const dateEnd   = new Date(dateStr + "T23:59:59.999Z");

  if (!section || !["overdue", "slot", "hold"].includes(section)) {
    return NextResponse.json({ error: "Invalid or missing section param" }, { status: 400 });
  }

  if (section === "slot" && !slotIdStr) {
    return NextResponse.json({ error: "slotId required for section=slot" }, { status: 400 });
  }

  // ── Build where clause ───────────────────────────────────────────────────
  const where: Prisma.ordersWhereInput = {};

  if (section === "overdue") {
    where.obdEmailDate = { lt: dateStart };
    where.workflowStage = { notIn: ["dispatched", "cancelled"] };
    where.OR = [
      { dispatchStatus: null },
      { dispatchStatus: { not: "dispatch" } },
    ];
  } else if (section === "slot") {
    where.slotId = parseInt(slotIdStr, 10);
    where.obdEmailDate = { gte: dateStart, lte: dateEnd };
    where.workflowStage = {
      notIn: ["dispatched", "cancelled", "order_created", "pending_tint_assignment"],
    };
  } else if (section === "hold") {
    where.dispatchStatus = "hold";
    where.workflowStage = { notIn: ["dispatched", "cancelled"] };
  }

  // Status sub-filter
  if (status === "pending") {
    where.workflowStage = { in: ["pending_support", "tinting_done"] };
    where.dispatchStatus = null;
  } else if (status === "dispatch") {
    where.dispatchStatus = "dispatch";
  } else if (status === "tinting") {
    where.workflowStage = { in: ["tinting_in_progress", "tint_assigned"] };
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
      // Wrap existing OR with search OR using AND
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
  const orders = await prisma.orders.findMany({
    where,
    include: {
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
      slot: {
        select: { name: true },
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
      },
    },
    orderBy: [
      { priorityLevel: "asc" },
      { obdEmailDate: "asc" },
      { obdNumber: "asc" },
    ],
  });

  return NextResponse.json({ orders });
}
