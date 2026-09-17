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
  //
  // OR the TI Report tick (2026-09-17): the report's operator filter
  // (ti-report-content.tsx) calls this too, and a TI-Report-only holder has no
  // tint_manager tick. Additive — the board's check is unchanged. Sequential
  // awaits; the second only runs when the first says no.
  const roles = session.user.roles ?? [session.user.role];
  const allowed =
    (await checkAnyPermission(roles, "tint_manager", "canView")) ||
    (await checkAnyPermission(roles, "reports_ti_report", "canView"));
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
