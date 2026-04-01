import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

function n(v: { toString(): string } | null | undefined): number {
  if (v == null) return 0;
  return parseFloat(v.toString());
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const dateFrom    = searchParams.get("dateFrom");
  const dateTo      = searchParams.get("dateTo");
  const operatorIdS = searchParams.get("operatorId");
  const tinterType  = searchParams.get("tinterType"); // "TINTER" | "ACOTONE" | null
  const obdSearch   = searchParams.get("obdSearch")?.trim() ?? "";

  const dateFromStart = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`) : undefined;
  const dateToEnd     = dateTo   ? new Date(`${dateTo}T23:59:59.999Z`)   : undefined;
  const operatorId    = operatorIdS ? parseInt(operatorIdS, 10) : undefined;

  // ── Date condition — filter on createdAt (submission date) ─────────────────
  // orders.obdEmailDate is nullable and unreliable; createdAt is always set.
  const dateCondition = (dateFromStart || dateToEnd)
    ? {
        createdAt: {
          ...(dateFromStart ? { gte: dateFromStart } : {}),
          ...(dateToEnd     ? { lte: dateToEnd     } : {}),
        },
      }
    : {};

  // ── OBD search — via orders → querySnapshot (import_obd_query_summary) ────
  const obdCondition = obdSearch
    ? { order: { querySnapshot: { obdNumber: { contains: obdSearch, mode: "insensitive" as const } } } }
    : {};

  // ── Per-table where objects ────────────────────────────────────────────────
  const tinterWhere: Prisma.tinter_issue_entriesWhereInput = {
    ...(operatorId !== undefined ? { submittedById: operatorId } : {}),
    ...dateCondition,
    ...obdCondition,
  };
  const acotoneWhere: Prisma.tinter_issue_entries_bWhereInput = {
    ...(operatorId !== undefined ? { submittedById: operatorId } : {}),
    ...dateCondition,
    ...obdCondition,
  };

  // ── TINTER include (all scalars auto-selected + relations) ────────────────
  const tinterInc = {
    order:       { select: { querySnapshot: { select: { obdNumber: true } } } },
    submittedBy: { select: { id: true, name: true } },
    rawLineItem: {
      select: {
        skuCodeRaw: true,
        rawSummary: { select: { shipToCustomerName: true, billToCustomerName: true } },
      },
    },
  } as const;

  // ── ACOTONE select — explicit to exclude tinterType (not on this table) ───
  const acotoneSelect = {
    id: true, baseSku: true, tinQty: true, packCode: true, createdAt: true,
    YE2: true, YE1: true, XY1: true, XR1: true, WH1: true,
    RE2: true, RE1: true, OR1: true, NO2: true, NO1: true,
    MA1: true, GR1: true, BU2: true, BU1: true,
    order:       { select: { querySnapshot: { select: { obdNumber: true } } } },
    submittedBy: { select: { id: true, name: true } },
    rawLineItem: {
      select: {
        skuCodeRaw: true,
        rawSummary: { select: { shipToCustomerName: true, billToCustomerName: true } },
      },
    },
  } as const;

  try {
    // ── Query both tables in parallel ────────────────────────────────────────
    const [tinterRaw, acotoneRaw] = await Promise.all([
      tinterType === "ACOTONE"
        ? ([] as Awaited<ReturnType<typeof prisma.tinter_issue_entries.findMany<{ include: typeof tinterInc }>>>)
        : prisma.tinter_issue_entries.findMany({
            where:   tinterWhere,
            include: tinterInc,
            orderBy: { createdAt: "desc" },
          }),

      tinterType === "TINTER"
        ? ([] as Awaited<ReturnType<typeof prisma.tinter_issue_entries_b.findMany<{ select: typeof acotoneSelect }>>>)
        : prisma.tinter_issue_entries_b.findMany({
            where:   acotoneWhere,
            select:  acotoneSelect,
            orderBy: { createdAt: "desc" },
          }),
    ]);

    // ── Map TINTER rows ───────────────────────────────────────────────────────
    const tinterRows = tinterRaw.map((e) => ({
      id:           e.id,
      tinterType:   "TINTER" as const,
      obdNumber:    e.order.querySnapshot?.obdNumber ?? "",
      customerName: e.rawLineItem?.rawSummary?.shipToCustomerName ?? "",
      billToName:   e.rawLineItem?.rawSummary?.billToCustomerName ?? "",
      operatorName: e.submittedBy.name,
      baseSku:      e.baseSku,
      tinQty:       n(e.tinQty),
      packCode:     e.packCode ?? null,
      skuCodeRaw:   e.rawLineItem?.skuCodeRaw ?? null,
      shades: {
        YOX: n(e.YOX), LFY: n(e.LFY), GRN: n(e.GRN), TBL: n(e.TBL), WHT: n(e.WHT),
        MAG: n(e.MAG), FFR: n(e.FFR), BLK: n(e.BLK), OXR: n(e.OXR), HEY: n(e.HEY),
        HER: n(e.HER), COB: n(e.COB), COG: n(e.COG),
      },
      createdAt: e.createdAt.toISOString(),
    }));

    // ── Map ACOTONE rows ──────────────────────────────────────────────────────
    const acotoneRows = acotoneRaw.map((e) => ({
      id:           e.id,
      tinterType:   "ACOTONE" as const,
      obdNumber:    e.order.querySnapshot?.obdNumber ?? "",
      customerName: e.rawLineItem?.rawSummary?.shipToCustomerName ?? "",
      billToName:   e.rawLineItem?.rawSummary?.billToCustomerName ?? "",
      operatorName: e.submittedBy.name,
      baseSku:      e.baseSku,
      tinQty:       n(e.tinQty),
      packCode:     e.packCode ?? null,
      skuCodeRaw:   e.rawLineItem?.skuCodeRaw ?? null,
      shades: {
        YE2: n(e.YE2), YE1: n(e.YE1), XY1: n(e.XY1), XR1: n(e.XR1), WH1: n(e.WH1),
        RE2: n(e.RE2), RE1: n(e.RE1), OR1: n(e.OR1), NO2: n(e.NO2), NO1: n(e.NO1),
        MA1: n(e.MA1), GR1: n(e.GR1), BU2: n(e.BU2), BU1: n(e.BU1),
      },
      createdAt: e.createdAt.toISOString(),
    }));

    // ── Combine + sort by createdAt DESC ─────────────────────────────────────
    const combined = [...tinterRows, ...acotoneRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const summary = {
      totalEntries: combined.length,
      totalTinQty:  combined.reduce((s, r) => s + r.tinQty, 0),
      byType: { TINTER: tinterRows.length, ACOTONE: acotoneRows.length },
    };

    return NextResponse.json({ rows: combined, summary });
  } catch (err) {
    console.error("[ti-report]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
