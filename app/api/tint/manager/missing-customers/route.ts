import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";
import { getHideExclusion } from "@/lib/hide/visibility";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.OPERATION_MANAGER]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const hideExclusion = await getHideExclusion();

  const rows = await prisma.orders.findMany({
    where: {
      AND: [
        {
          customerMissing: true,
          smu: { in: ["Retail Offtake", "Decorative Projects"] },
          workflowStage: { notIn: ["dispatched", "cancelled", "closed"] },
          isRemoved: false,
        },
        hideExclusion,
      ],
    },
    select: {
      id: true,
      obdNumber: true,
      shipToCustomerId: true,
      shipToCustomerName: true,
      smu: true,
      orderType: true,
      obdEmailDate: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const orders = rows.map((r) => ({
    orderId: r.id,
    obdNumber: r.obdNumber,
    shipToCustomerId: r.shipToCustomerId,
    shipToCustomerName: r.shipToCustomerName,
    smu: r.smu,
    orderType: r.orderType,
    obdEmailDate: r.obdEmailDate?.toISOString() ?? null,
  }));

  return NextResponse.json({ count: orders.length, orders });
}
