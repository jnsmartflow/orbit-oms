import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTintSummaryData } from "@/lib/reports/tint-summary-data";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/tint-summary — read-only daily "Tint Summary" report (JSON).
//
// Thin transport wrapper. All aggregation lives in lib/reports/tint-summary-data.
//
// Query params (all optional):
//   date=YYYY-MM-DD   IST OBD-date the report is built for (default = today IST)
//   operators=1,2,3   comma operator ids — scopes operator-centric outputs only
//   includeHold=true  when "false", drops lower(dispatchStatus)="hold" OBDs
//   smu=A,B           comma SMU names — filters all order-based sections
//   area=Local,IGT    comma delivery-type names — filters all order-based sections
//   trendDays=7       length of the intake-vs-completed trend window
// ─────────────────────────────────────────────────────────────────────────────

function csvNums(v: string | null): number[] {
  return (v ?? "").split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
}
function csvStrs(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function GET(req: Request): Promise<NextResponse> {
  // Gate (2026-09-17): the reports_tint_summary tick, the same key the hub and
  // the print page use. Replaced a requireRole role list + a primary-role
  // checkPermission. Checked before the try so a denial is a JSON 403, never a
  // redirect swallowed by the catch.
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "reports_tint_summary", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  try {
    const url = new URL(req.url, "http://localhost");
    const trendDaysRaw = url.searchParams.get("trendDays");
    const data = await getTintSummaryData({
      date: url.searchParams.get("date") ?? undefined,
      operators: csvNums(url.searchParams.get("operators")),
      includeHold: (url.searchParams.get("includeHold") ?? "true").toLowerCase() !== "false",
      smu: csvStrs(url.searchParams.get("smu")),
      area: csvStrs(url.searchParams.get("area")),
      trendDays: trendDaysRaw ? parseInt(trendDaysRaw, 10) : undefined,
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[reports/tint-summary] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
