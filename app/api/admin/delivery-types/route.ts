import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR, ROLES.FLOOR_SUPERVISOR]);

  const rows = await prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json(rows);
}
