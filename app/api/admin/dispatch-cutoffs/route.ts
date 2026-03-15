import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const configs = await prisma.delivery_type_slot_config.findMany({
    orderBy: [{ deliveryTypeId: "asc" }, { sortOrder: "asc" }],
    include: {
      deliveryType: { select: { id: true, name: true } },
      slot: { select: { id: true, name: true, slotTime: true, isNextDay: true } },
    },
  });

  return NextResponse.json(configs);
}
