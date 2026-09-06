import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { getHideExclusion } from "@/lib/hide/visibility";
import { SUPPORT_DONE_STAGE_NAMES } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). Reads were held back when the
  // tint WRITES converted; this closes the split. Operations User loses these —
  // he holds no tint_manager tick and both tint layouts already redirect him.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const hideExclusion = await getHideExclusion();

  const rows = await prisma.orders.findMany({
    where: {
      AND: [
        {
          customerMissing: true,
          smu: { in: ["Retail Offtake", "Decorative Projects"] },
          workflowStage: { notIn: ["cancelled", ...SUPPORT_DONE_STAGE_NAMES] },
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
