import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  // ── Auth: Admin only ────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  // ── Parse + clamp query params ──────────────────────────────────────────────
  const url = new URL(req.url);

  const pageParam     = parseInt(url.searchParams.get("page")     ?? "1",  10);
  const pageSizeParam = parseInt(url.searchParams.get("pageSize") ?? "25", 10);
  const searchRaw     = url.searchParams.get("search")?.trim() ?? "";

  const page     = Number.isFinite(pageParam)     && pageParam     >= 1                        ? pageParam     : 1;
  const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam >= 1 && pageSizeParam <= 100 ? pageSizeParam : 25;

  // ── Build where clause ──────────────────────────────────────────────────────
  const where: Prisma.ordersWhereInput = {
    isRemoved: true,
    ...(searchRaw.length > 0 ? {
      OR: [
        { obdNumber:          { contains: searchRaw, mode: "insensitive" } },
        { shipToCustomerName: { contains: searchRaw, mode: "insensitive" } },
      ],
    } : {}),
  };

  // ── Count + page fetch (sequential awaits — no $transaction) ───────────────
  const total = await prisma.orders.count({ where });

  const rows = await prisma.orders.findMany({
    where,
    orderBy: { removedAt: "desc" },
    skip:    (page - 1) * pageSize,
    take:    pageSize,
    select: {
      id:                 true,
      obdNumber:          true,
      shipToCustomerId:   true,
      shipToCustomerName: true,
      removalReason:      true,
      removalRemark:      true,
      removedAt:          true,
      removedBy:          { select: { id: true, name: true } },
      challan:            { select: { challanNumber: true, isVoided: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    total,
    page,
    pageSize,
    rows,
  });
}
