import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAllPermissionsForRoles, holdsReportTick } from "@/lib/permissions";
import type { ReportParams } from "@/components/reports/report-params";
import { isReportId } from "@/components/reports/report-catalog";
import { TIReportContent } from "@/components/tint/ti-report-content";
import { ReportsPageDialog } from "@/components/reports/reports-page-dialog";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const csvNums = (v?: string) => (v ?? "").split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n));
const csvStrs = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIst = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * /reports — kept for saved links and for anyone opening the address.
 *
 * Since 2026-10-01 Reports is a POPUP over the current screen (the sidebar's
 * Reports row opens components/reports/reports-dialog.tsx). This page renders
 * that SAME dialog, always open, preselecting `?r=` and — for Tint Summary —
 * the date and Customise options a saved /reports?r=tint-summary&date=… link
 * carries. The report list, the access rule and the panels all come from the
 * dialog (GET /api/reports/options), so there is one implementation, not two.
 *
 * One exception: `?r=ti-report` still renders the TI Report full screen. It is
 * an on-screen table with its own header and filters, not a download panel, so
 * the dialog links here for it. Old /tint/manager/ti-report and /ti-report
 * URLs redirect here (next.config.mjs) and keep landing on it.
 */
export default async function ReportsHubPage({ searchParams }: { searchParams: SP }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const requested = one(searchParams.r);

  if (requested === "ti-report") {
    const roles = session.user.roles ?? [session.user.role];
    const allPerms = await getAllPermissionsForRoles(roles);
    if (holdsReportTick(allPerms, "reports_ti_report")) {
      const canTiReportExport = allPerms["reports_ti_report"]?.canExport ?? false;
      return (
        <div className="flex h-screen flex-col overflow-hidden bg-white">
          <div className="flex-none border-b border-gray-100 px-4 py-2">
            <Link href="/" className="text-[11px] text-gray-400 transition-colors hover:text-gray-600">
              ← Orbit
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <TIReportContent canExport={canTiReportExport} />
          </div>
        </div>
      );
    }
    // No TI tick → fall through to the dialog, which lists what they DO hold.
  }

  const dateRaw = one(searchParams.date);
  const trendDaysN = parseInt(one(searchParams.trendDays) ?? "", 10);
  const tintParams: ReportParams = {
    date: dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayIst(),
    hide: csvStrs(one(searchParams.hide)),
    operators: csvNums(one(searchParams.operators)),
    includeHold: one(searchParams.includeHold)?.toLowerCase() !== "false",
    smu: csvStrs(one(searchParams.smu)),
    area: csvStrs(one(searchParams.area)),
    trendDays: Number.isFinite(trendDaysN) ? trendDaysN : 7,
  };

  return (
    <ReportsPageDialog
      initialReport={isReportId(requested) && requested !== "ti-report" ? requested : null}
      initialTintParams={tintParams}
    />
  );
}
