import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { TinterType, PackCode } from "@prisma/client";

export const dynamic = "force-dynamic";

// ── GET /api/admin/shades ──────────────────────────────────────────────────────
export async function GET(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR]);

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit  = Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10));
  const search       = searchParams.get("search")?.trim() ?? "";
  const tinterTypeParam = searchParams.get("tinterType")?.trim();
  const packCodeParam   = searchParams.get("packCode")?.trim();

  const tinterType = tinterTypeParam && tinterTypeParam in TinterType
    ? (tinterTypeParam as TinterType)
    : undefined;

  const packCode = packCodeParam && packCodeParam in PackCode
    ? (packCodeParam as PackCode)
    : undefined;

  const where = {
    ...(tinterType && { tinterType }),
    ...(packCode   && { packCode }),
    ...(search && {
      OR: [
        { shipToCustomerId: { contains: search, mode: "insensitive" as const } },
        { shadeName:        { contains: search, mode: "insensitive" as const } },
      ],
    }),
  };

  const [data, total] = await prisma.$transaction([
    prisma.shade_master.findMany({
      where,
      skip:    (page - 1) * limit,
      take:    limit,
      orderBy: { shadeName: "asc" },
      include: {
        createdBy: { select: { name: true } },
      },
    }),
    prisma.shade_master.count({ where }),
  ]);

  return NextResponse.json({ data, total, page, limit });
}
