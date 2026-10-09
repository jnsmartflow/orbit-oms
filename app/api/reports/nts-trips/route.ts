import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { parseReportDate } from "@/lib/reports/trip-detail-data";
import { getNtsTripsRows } from "@/lib/reports/nts-trips-data";
import { buildNtsTripsWorkbook } from "@/lib/reports/nts-trips-workbook";

export const dynamic = "force-dynamic";

/** Longest range one download may cover, both ends inclusive — same as
 *  app/api/reports/trip-detail and trip-detail-old. */
const MAX_DAYS = 92;

/**
 * GET /api/reports/nts-trips?from=YYYY-MM-DD&to=YYYY-MM-DD[&deliveryTypeId=N]
 * — NTS TRIPS (2026-10-09): one row per Nagadhiraj Floor trip in Smart Flow's
 * "Tempo Report" layout (lib/reports/nts-trips-data.ts — which trips and which
 * bills are in its header). `from`/`to` are the trip's CREATED dates (IST);
 * `deliveryTypeId` filters each TRIP by its own type.
 *
 * READ-ONLY. Same gate as Trip Detail — `reports_trip_detail` canExport (owner:
 * no new key). Same parameters, same validation, same 92-day limit; the
 * validation below is a deliberate copy of trip-detail-old's, kept line for
 * line so the routes refuse the same inputs with the same messages.
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
    const rows = await getNtsTripsRows({ from, to, deliveryTypeId });
    const body = buildNtsTripsWorkbook(rows);
    const filename = `NTSTrips-${from}-to-${to}.xlsx`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[reports/nts-trips]", err);
    return NextResponse.json({ error: "Could not build the report" }, { status: 500 });
  }
}
