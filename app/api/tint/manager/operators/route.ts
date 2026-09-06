import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";

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

  const users = await prisma.users.findMany({
    where: {
      isActive: true,
      userRoles: {
        some: { role: { name: "tint_operator" } },
      },
    },
    select:  { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ operators: users });
}
