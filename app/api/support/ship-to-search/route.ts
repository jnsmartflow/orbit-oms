import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN, ROLES.OPERATIONS]);

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json([]);
  }

  const matches = await prisma.delivery_point_master.findMany({
    where: {
      customerName: { contains: q, mode: "insensitive" },
      isActive: true,
    },
    select: { id: true, customerName: true, area: { select: { name: true } } },
    take: 8,
    orderBy: { customerName: "asc" },
  });

  return NextResponse.json(
    matches.map((m) => ({ id: m.id, customerName: m.customerName, area: m.area?.name ?? null })),
  );
}
