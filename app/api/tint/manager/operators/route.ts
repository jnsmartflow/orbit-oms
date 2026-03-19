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

  const users = await prisma.users.findMany({
    where:   { role: { name: "tint_operator" }, isActive: true },
    select:  { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ operators: users });
}
