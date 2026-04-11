import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ── Base SMU values shown on the Delivery Challan screen ──────────────────────
const CHALLAN_SMU_VALUES = ["Retail Offtake", "Decorative Projects"] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS]);

  const { searchParams } = new URL(req.url);
  const dateParam   = searchParams.get("date");    // ISO date string  e.g. "2026-03-21"
  const routeParam  = searchParams.get("route");   // route name       e.g. "Varacha"
  const smuParam    = searchParams.get("smu");     // smu value        e.g. "Project"
  const searchParam = searchParams.get("search");  // obdNumber | billToCustomerName

  try {
    // ── Step 1: find matching import_raw_summary rows ─────────────────────────
    // Base filter: smu must be one of the two challan-eligible values.
    // If a specific smu param is provided it narrows further.
    const smuFilter = smuParam
      ? { equals: smuParam }
      : { in: [...CHALLAN_SMU_VALUES] };

    // Date filter: match full calendar day in UTC (obdEmailDate is stored as DateTime)
    let obdDateFilter: { gte: Date; lt: Date } | undefined;
    if (dateParam) {
      const day  = new Date(dateParam);
      const next = new Date(day);
      next.setUTCDate(next.getUTCDate() + 1);
      obdDateFilter = { gte: day, lt: next };
    }

    // Search filter: ILIKE on obdNumber OR billToCustomerName
    const searchFilter = searchParam
      ? {
          OR: [
            { obdNumber:          { contains: searchParam, mode: "insensitive" as const } },
            { billToCustomerName: { contains: searchParam, mode: "insensitive" as const } },
          ],
        }
      : undefined;

    const rawSummaries = await prisma.import_raw_summary.findMany({
      where: {
        smu: smuFilter,
        ...(obdDateFilter && { obdEmailDate: obdDateFilter }),
        ...(searchFilter  && searchFilter),
      },
      select: {
        obdNumber:          true,
        smu:                true,
        obdEmailDate:       true,
        billToCustomerName: true,
      },
    });

    if (rawSummaries.length === 0) return NextResponse.json([]);

    const obdNumbers = rawSummaries.map((r) => r.obdNumber);
    const rawMap     = new Map(rawSummaries.map((r) => [r.obdNumber, r]));

    // ── Step 2: query orders for those OBDs with route + challan ─────────────
    // Route filter applied here so it hits the DB rather than post-processing.
    // Customer route = customer.primaryRoute (explicit override) OR
    //                  customer.area.primaryRoute (area default).
    const orders = await prisma.orders.findMany({
      where: {
        obdNumber: { in: obdNumbers },
        ...(routeParam && {
          customer: {
            OR: [
              { primaryRoute: { name: routeParam } },
              {
                primaryRouteId: null,
                area: { primaryRoute: { name: routeParam } },
              },
            ],
          },
        }),
      },
      select: {
        id:           true,
        obdNumber:    true,
        dispatchSlot: true,
        customer: {
          select: {
            primaryRoute: { select: { name: true } },
            area: {
              select: {
                primaryRoute: { select: { name: true } },
              },
            },
          },
        },
        challan: {
          select: { challanNumber: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // ── Step 3: assemble response ─────────────────────────────────────────────
    const result = orders.map((o) => {
      const raw       = rawMap.get(o.obdNumber);
      const routeName =
        o.customer?.primaryRoute?.name ??
        o.customer?.area?.primaryRoute?.name ??
        null;

      return {
        orderId:            o.id,
        obdNumber:          o.obdNumber,
        billToCustomerName: raw?.billToCustomerName ?? null,
        smu:                raw?.smu                ?? null,
        obdEmailDate:       raw?.obdEmailDate       ?? null,
        route:              routeName,
        slot:               o.dispatchSlot          ?? null,
        challanNumber:      o.challan?.challanNumber ?? null,
      };
    });

    return NextResponse.json(result);

  } catch (err) {
    console.error("[tint/manager/challans] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
