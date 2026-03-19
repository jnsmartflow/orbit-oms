import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const orders = await prisma.orders.findMany({
    where:   { orderType: "tint" },
    include: {
      customer: {
        select: {
          customerName: true,
          area: { select: { name: true } },
        },
      },
      querySnapshot: {
        select: { totalWeight: true, totalLines: true },
      },
      tintAssignments: {
        where:   { status: { not: "done" } },
        include: { assignedTo: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take:    1,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ orders });
}
