import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const rows = await prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json(rows);
}
