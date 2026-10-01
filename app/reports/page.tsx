import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAllPermissionsForRoles, holdsReportTick, type REPORT_PAGE_KEYS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { ReportParams } from "@/components/reports/report-params";
import { TIReportContent } from "@/components/tint/ti-report-content";
import ReportsTopBar from "@/components/reports/reports-top-bar";
import { TripDetailPanel } from "@/components/reports/trip-detail-panel";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const csvNums = (v?: string) => (v ?? "").split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n));
const csvStrs = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIst = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

// Rail items, grouped. Each carries the tick that shows it (lib/permissions.ts
// REPORT_PAGE_KEYS — a new report is registered there AND here). Groups render
// in the order they first appear in this list.
const RAIL_ITEMS = [
  { id: "trip-detail",  label: "Trip Detail",  pageKey: "reports_trip_detail",  group: "Trip" },
  { id: "tint-summary", label: "Tint Summary", pageKey: "reports_tint_summary", group: "Tint" },
  { id: "ti-report",    label: "TI Report",    pageKey: "reports_ti_report",    group: "Tint" },
] as const satisfies readonly {
  id: string;
  label: string;
  pageKey: (typeof REPORT_PAGE_KEYS)[number];
  group: string;
}[];
type ReportId = (typeof RAIL_ITEMS)[number]["id"];

export default async function ReportsHubPage({ searchParams }: { searchParams: SP }) {
  // ── Auth: one tick per report ─────────────────────────────────────────────
  // A report is LISTED when the person holds canView OR canExport on its key
  // (holdsReportTick). Until 2026-10-01 it was canView only; Trip Detail is
  // granted export-only to some people, and a report they can download but not
  // see would be unreachable. No job-title bypass — the superuser / admin
  // all-true arm inside getAllPermissionsForRoles is the only bypass.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const roles = session.user.roles ?? [session.user.role];
  const allPerms = await getAllPermissionsForRoles(roles);

  const canTiReportExport = allPerms["reports_ti_report"]?.canExport ?? false;
  const railItems = RAIL_ITEMS.filter((it) => holdsReportTick(allPerms, it.pageKey));

  // ?r= missing, unknown, or pointing at a report this person cannot see →
  // the first permitted report. 🔴 railItems CAN be empty (no report ticks, or
  // a tick for a report not listed above), so this is optional — it was
  // `railItems[0].id`, which threw a 500 on an empty rail.
  const requested = one(searchParams.r);
  const r: ReportId | null = railItems.find((it) => it.id === requested)?.id ?? railItems[0]?.id ?? null;
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

  // Operator roster for the Customise drawer, only when the panel needs it.
  const operatorRoster =
    r === "tint-summary"
      ? await prisma.users.findMany({
          where: { isActive: true, userRoles: { some: { role: { name: "tint_operator" } } } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  // Delivery types for Trip Detail — the same list, in the same order, as the
  // trip desk's options route (app/api/floor/trips/options). Read here rather
  // than fetched from that route, which gates on `floor` canEdit — a reports
  // holder need not have it.
  const deliveryTypes =
    r === "trip-detail"
      ? await prisma.delivery_type_master.findMany({
          select: { id: true, name: true },
          orderBy: { id: "asc" },
        })
      : [];

  const groups = Array.from(new Set(railItems.map((it) => it.group)));

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
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{g}</div>
              {railItems
                .filter((it) => it.group === g)
                .map((it) => {
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
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {r === null ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <p className="text-[13px] text-gray-400">You do not have access to any reports yet.</p>
          </div>
        ) : r === "trip-detail" ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <TripDetailPanel deliveryTypes={deliveryTypes} />
          </div>
        ) : r === "tint-summary" ? (
          // No live preview (2026-10-01): date, Customise and Download PDF only.
          <div className="min-h-0 flex-1 overflow-auto">
            <ReportsTopBar params={reportParams} roster={operatorRoster} />
          </div>
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
