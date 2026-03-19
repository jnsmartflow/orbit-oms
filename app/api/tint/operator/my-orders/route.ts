import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "tint_operator", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const userId = parseInt(session!.user.id, 10);

  const orders = await prisma.orders.findMany({
    where: {
      orderType:     "tint",
      workflowStage: { in: ["pending_tint_assignment", "tinting_in_progress"] },
      tintAssignments: {
        some: {
          assignedToId: userId,
          status:       { not: "done" },
        },
      },
    },
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
        where:   { assignedToId: userId, status: { not: "done" } },
        orderBy: { createdAt: "desc" },
        take:    1,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ orders });
}
