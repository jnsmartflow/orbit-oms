import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAllPermissionsForRoles, canViewAnyReport, type REPORT_PAGE_KEYS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { getTintSummaryData } from "@/lib/reports/tint-summary-data";
import type { ReportParams } from "@/components/reports/report-params";
import TintSummaryDocument from "@/components/reports/tint-summary-document";
import { TIReportContent } from "@/components/tint/ti-report-content";
import ReportsTopBar from "@/components/reports/reports-top-bar";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const csvNums = (v?: string) => (v ?? "").split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n));
const csvStrs = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIst = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

// Rail items — Option C. Single "TINT" group; no future/greyed groups (step 6).
// Each carries the tick that shows it (lib/permissions.ts REPORT_PAGE_KEYS — a
// new report is registered there AND here).
const RAIL_ITEMS = [
  { id: "tint-summary", label: "Tint Summary", pageKey: "reports_tint_summary" },
  { id: "ti-report",    label: "TI Report",    pageKey: "reports_ti_report" },
] as const satisfies readonly { id: string; label: string; pageKey: (typeof REPORT_PAGE_KEYS)[number] }[];
type ReportId = (typeof RAIL_ITEMS)[number]["id"];

export default async function ReportsHubPage({ searchParams }: { searchParams: SP }) {
  // ── Auth gate: one tick per report (2026-09-17) ───────────────────────────
  // The hub opens for canView on ANY report key; the rail shows only the
  // permitted ones. No job-title bypass — the superuser / admin all-true arm
  // inside getAllPermissionsForRoles is the only bypass. The old `ti_report`
  // tick gates nothing any more.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const roles = session.user.roles ?? [session.user.role];
  const allPerms = await getAllPermissionsForRoles(roles);
  if (!canViewAnyReport(allPerms)) redirect("/unauthorized");

  const canTiReportExport = allPerms["reports_ti_report"]?.canExport ?? false;
  const railItems = RAIL_ITEMS.filter((it) => allPerms[it.pageKey]?.canView === true);

  // ?r= missing, unknown, or pointing at a report this person cannot see →
  // the first permitted report. railItems is non-empty (gate above).
  const requested = one(searchParams.r);
  const r: ReportId = railItems.find((it) => it.id === requested)?.id ?? railItems[0].id;
  const showTintSummary = r === "tint-summary";
  const dateRaw = one(searchParams.date);
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayIst();

  // ── Customise params (Tint Summary only) ─────────────────────────────────
  const trendDaysN = parseInt(one(searchParams.trendDays) ?? "", 10);
  const reportParams: ReportParams = {
    date,
    hide: csvStrs(one(searchParams.hide)),
    operators: csvNums(one(searchParams.operators)),
    includeHold: one(searchParams.includeHold)?.toLowerCase() !== "false",
    smu: csvStrs(one(searchParams.smu)),
    area: csvStrs(one(searchParams.area)),
    trendDays: Number.isFinite(trendDaysN) ? trendDaysN : 7,
  };

  // Operator roster for the drawer (tint operators), only when the tab needs it.
  const operatorRoster =
    showTintSummary
      ? await prisma.users.findMany({
          where: { isActive: true, userRoles: { some: { role: { name: "tint_operator" } } } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* ── Reports rail (208px) ─────────────────────────────────────────── */}
      <aside className="flex w-[208px] flex-shrink-0 flex-col border-r border-gray-200 bg-white py-4">
        <div className="border-b border-gray-100 px-4 pb-3">
          <Link href="/" className="text-[11px] text-gray-400 transition-colors hover:text-gray-600">
            ← Orbit
          </Link>
          <div className="mt-1 text-[15px] font-bold text-gray-900">Reports</div>
        </div>
        <nav className="px-2 pt-3">
          <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Tint</div>
          {railItems.map((it) => {
            const active = r === it.id;
            const href = it.id === "tint-summary" ? `/reports?r=tint-summary&date=${date}` : `/reports?r=${it.id}`;
            return (
              <Link
                key={it.id}
                href={href}
                className={cn(
                  "mb-0.5 block border-l-2 px-3 py-2 text-[13px] transition-colors",
                  active
                    ? "border-brand-600 bg-brand-50 font-semibold text-brand-700"
                    : "border-transparent text-gray-600 hover:bg-gray-50",
                )}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* r is always a permitted report, so getTintSummaryData() below only
            ever runs for a reports_tint_summary holder. */}
        {showTintSummary ? (
          <>
            <ReportsTopBar params={reportParams} roster={operatorRoster} />
            <div className="flex flex-1 justify-center overflow-auto bg-[#f1f3f5] py-6">
              {/* Scaled live preview — zoom keeps layout flow (no leftover space). */}
              <div style={{ zoom: 0.62 } as React.CSSProperties}>
                <TintSummaryDocument
                  data={await getTintSummaryData({
                    date,
                    operators: reportParams.operators,
                    includeHold: reportParams.includeHold,
                    smu: reportParams.smu,
                    area: reportParams.area,
                    trendDays: reportParams.trendDays,
                  })}
                  hiddenSections={reportParams.hide}
                  generatedByName={session.user.name ?? "Tint Manager"}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            {/* Relocated TI Report — unchanged behaviour (brings its own header). */}
            <TIReportContent canExport={canTiReportExport} />
          </div>
        )}
      </main>
    </div>
  );
}
