import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// ── Sort whitelist ──────────────────────────────────────────────────────────
const ALLOWED_SORTS = ["usageDate", "tinQty", "createdAt"] as const;
type SortKey = (typeof ALLOWED_SORTS)[number];

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE     = 200;

function parsePositiveInt(v: string | null): number | undefined {
  if (!v) return undefined;
  if (!/^\d+$/.test(v)) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ── GET /api/sampling-library/:samplingNo/usage-log ─────────────────────────
export async function GET(
  req: Request,
  { params }: { params: { samplingNo: string } },
): Promise<NextResponse> {
  if (!/^\d+$/.test(params.samplingNo)) {
    return NextResponse.json({ error: "Invalid samplingNo" }, { status: 400 });
  }
  const samplingNo = parseInt(params.samplingNo, 10);

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "sampling_library", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page     = parsePositiveInt(searchParams.get("page"))     ?? 1;
  const reqSize  = parsePositiveInt(searchParams.get("pageSize")) ?? DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(reqSize, MAX_PAGE_SIZE);

  const sortParam  = searchParams.get("sort") ?? "";
  const orderParam = (searchParams.get("order") ?? "desc").toLowerCase();
  const sort: SortKey = (ALLOWED_SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as SortKey)
    : "usageDate";
  const order: "asc" | "desc" = orderParam === "asc" ? "asc" : "desc";

  try {
    const parent = await prisma.sampling_register.findUnique({
      where:  { samplingNo },
      select: { samplingNo: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Nulls last so blank dates don't dominate the desc sort.
    const orderBy: Prisma.sampling_usage_logOrderByWithRelationInput = sort === "usageDate"
      ? { usageDate: { sort: order, nulls: "last" } }
      : { [sort]: order };

    const rows = await prisma.sampling_usage_log.findMany({
      where: { samplingNo },
      skip:  (page - 1) * pageSize,
      take:  pageSize,
      orderBy,
      include: {
        operator: { select: { id: true, name: true } },
      },
    });
    const total = await prisma.sampling_usage_log.count({ where: { samplingNo } });
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

    const items = rows.map((r) => ({
      id:             r.id,
      usageDate:      r.usageDate ? r.usageDate.toISOString() : null,
      skuCodeRaw:     r.skuCodeRaw,
      packCode:       r.packCode,
      tinQty:         r.tinQty.toNumber(),
      dealerNameRaw:  r.dealerNameRaw,
      siteNameRaw:    r.siteNameRaw,
      deliveryNumber: r.deliveryNumber,
      operatorId:     r.operatorId,
      operatorName:   r.operator?.name ?? r.operatorNameRaw ?? null,
      createdAt:      r.createdAt.toISOString(),
    }));

    return NextResponse.json({ items, total, page, pageSize, totalPages });
  } catch (err) {
    console.error("[sampling-library/usage-log]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
