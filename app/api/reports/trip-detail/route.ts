import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTripDetailRows, parseReportDate } from "@/lib/reports/trip-detail-data";
import { buildTripDetailWorkbook } from "@/lib/reports/trip-detail-workbook";

export const dynamic = "force-dynamic";

/** Longest range one download may cover, both ends inclusive. */
const MAX_DAYS = 92;

/**
 * GET /api/reports/trip-detail?from=YYYY-MM-DD&to=YYYY-MM-DD[&deliveryTypeId=N]
 * — every bill loaded on a Floor trip in the range, one row per bill, as .xlsx.
 *
 * READ-ONLY. Not one write in this file or in what it calls.
 *
 * Gate: `reports_trip_detail` canExport — the report IS the download, so the
 * export tick is the one that decides. Same shape as app/api/ci/export.
 *
 * Scope (lib/reports/trip-detail-data.ts): trips dated in the range, not
 * cancelled; bills not removed and not on hold. An empty range is a 200 with a
 * header-only workbook, never a 404.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "reports_trip_detail", "canExport");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from")?.trim() ?? "";
  const to = searchParams.get("to")?.trim() ?? "";
  const typeRaw = searchParams.get("deliveryTypeId")?.trim() ?? "";

  if (from === "" || to === "") {
    return NextResponse.json(
      { error: "`from` and `to` are both required — expected YYYY-MM-DD" },
      { status: 400 },
    );
  }

  let fromDate: Date;
  let toDate: Date;
  try {
    fromDate = parseReportDate(from);
    toDate = parseReportDate(to);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid date" },
      { status: 400 },
    );
  }
  if (fromDate.getTime() > toDate.getTime()) {
    return NextResponse.json({ error: "`from` must be on or before `to`" }, { status: 400 });
  }
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (days > MAX_DAYS) {
    return NextResponse.json(
      { error: `Range is ${days} days — the most one download can cover is ${MAX_DAYS} days. Split it into smaller ranges.` },
      { status: 400 },
    );
  }

  // Empty or "all" = every delivery type.
  let deliveryTypeId: number | null = null;
  if (typeRaw !== "" && typeRaw.toLowerCase() !== "all") {
    const n = Number(typeRaw);
    if (!Number.isSafeInteger(n) || n <= 0) {
      return NextResponse.json(
        { error: "`deliveryTypeId` must be a positive whole number, or omitted for all" },
        { status: 400 },
      );
    }
    deliveryTypeId = n;
  }

  try {
    const rows = await getTripDetailRows({ from, to, deliveryTypeId });
    const body = buildTripDetailWorkbook(rows);

    // Both halves were validated as YYYY-MM-DD above, so nothing free-typed
    // reaches the header.
    const filename = `TripDetail-${from}-to-${to}.xlsx`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[reports/trip-detail]", err);
    return NextResponse.json({ error: "Could not build the report" }, { status: 500 });
  }
}
