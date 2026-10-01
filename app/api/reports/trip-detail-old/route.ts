import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTripDetailRows, parseReportDate } from "@/lib/reports/trip-detail-data";
import { buildTripDetailOldWorkbook } from "@/lib/reports/trip-detail-old-workbook";

export const dynamic = "force-dynamic";

/** Longest range one download may cover, both ends inclusive — same as
 *  app/api/reports/trip-detail. */
const MAX_DAYS = 92;

/**
 * GET /api/reports/trip-detail-old?from=YYYY-MM-DD&to=YYYY-MM-DD[&deliveryTypeId=N]
 * — the SAME rows as /api/reports/trip-detail (getTripDetailRows), in the old
 * 26-column NTS layout (lib/reports/trip-detail-old-workbook.ts).
 *
 * READ-ONLY. Same gate as the current layout — `reports_trip_detail`
 * canExport: this is the same report in another shape, not a new permission.
 * Same parameters, same validation, same 92-day limit; the validation below is
 * a deliberate copy of that route's, kept line for line so the two refuse the
 * same inputs with the same messages.
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
    const body = buildTripDetailOldWorkbook(rows);
    const filename = `TripDetailOld-${from}-to-${to}.xlsx`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[reports/trip-detail-old]", err);
    return NextResponse.json({ error: "Could not build the report" }, { status: 500 });
  }
}
