import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const LIMIT = 25;

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN]);

  const { searchParams } = new URL(req.url);
  const search         = searchParams.get("search")?.trim() ?? "";
  const stage          = searchParams.get("stage")?.trim() ?? "";
  const orderType      = searchParams.get("orderType")?.trim() ?? "";
  const dispatchStatus = searchParams.get("dispatchStatus")?.trim() ?? "";
  const page           = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));

  // ── Build where clause ───────────────────────────────────────────────────
  const where: Prisma.ordersWhereInput = {};

  if (search) {
    where.OR = [
      { obdNumber:         { contains: search, mode: "insensitive" } },
      { shipToCustomerName: { contains: search, mode: "insensitive" } },
    ];
  }
  if (stage)     where.workflowStage  = stage;
  if (orderType) where.orderType       = orderType;

  if (dispatchStatus === "not_set") {
    where.dispatchStatus = null;
  } else if (dispatchStatus) {
    where.dispatchStatus = dispatchStatus;
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  const [orders, total, pendingSupportCount, pendingTintCount, onHoldCount] =
    await Promise.all([
      prisma.orders.findMany({
        where,
        include: {
          customer: {
            select: {
              customerName: true,
              area: { select: { name: true } },
            },
          },
          querySnapshot: {
            select: { totalWeight: true, totalLines: true, hasTinting: true },
          },
          batch: { select: { batchRef: true } },
        },
        orderBy: { createdAt: "desc" },
        skip:  (page - 1) * LIMIT,
        take:  LIMIT,
      }),
      prisma.orders.count({ where }),
      prisma.orders.count({ where: { ...where, workflowStage: "pending_support" } }),
      prisma.orders.count({
        where: {
          ...where,
          workflowStage: { in: ["pending_tint_assignment", "tinting_in_progress"] },
        },
      }),
      prisma.orders.count({ where: { ...where, dispatchStatus: "hold" } }),
    ]);

  return NextResponse.json({
    orders,
    total,
    page,
    totalPages:          Math.ceil(total / LIMIT),
    pendingSupportCount,
    pendingTintCount,
    onHoldCount,
  });
}
