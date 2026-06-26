import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.DISPATCHER, ROLES.ADMIN, ROLES.OPERATIONS]);

  const windows = await prisma.dispatch_slot_master.findMany({
    where: { isActive: true },
    select: { id: true, windowTime: true, label: true },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ windows });
}
