import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTintSummaryData, type TintSummaryParams } from "@/lib/reports/tint-summary-data";
import TintSummaryDocument from "@/components/reports/tint-summary-document";
import PrintButton from "@/components/reports/print-button";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const csvNums = (v?: string) => (v ?? "").split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
const csvStrs = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Full-bleed centred message (loading / empty / error) on the grey print desk.
function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: "flex", minHeight: "60vh", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 460, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1c2533", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#5b6573", lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

// Async body — fetches live data, then renders the document / empty / error state.
async function ReportBody({ params, hidden, generatedByName }: { params: TintSummaryParams; hidden: string[]; generatedByName: string }) {
  let data;
  try {
    data = await getTintSummaryData(params);
  } catch (err) {
    console.error("[reports/tint-summary page] Error:", err);
    return <Notice title="Couldn't load the report" body="Something went wrong gathering the data. Please refresh, or pick another date." />;
  }

  const { intake, completed, remaining } = data.summary;
  if (intake.count === 0 && completed.count === 0 && remaining.count === 0) {
    return (
      <Notice
        title={`No tint activity for ${data.reportDate}`}
        body="No intake, completed, or pending OBDs were found for this date. Try a different date from the date control or the ?date=YYYY-MM-DD parameter."
      />
    );
  }

  return <TintSummaryDocument data={data} hiddenSections={hidden} generatedByName={generatedByName} />;
}

export default async function TintSummaryReportPage({ searchParams }: { searchParams: SP }) {
  // ── Auth gate (mirrors the Tint Manager layout) ──────────────────────────
  const session = await auth();
  if (!session?.user) redirect("/login");
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin") && !roles.includes("operations")) {
    const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
    if (!allowed) redirect("/unauthorized");
  }

  // ── Parse searchParams → typed params ────────────────────────────────────
  const dateRaw = one(searchParams.date);
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined;
  const trendDaysRaw = one(searchParams.trendDays);
  const trendDaysN = trendDaysRaw ? parseInt(trendDaysRaw, 10) : NaN;
  const autoPrint = one(searchParams.print) === "1";

  const params: TintSummaryParams = {
    date,
    operators: csvNums(one(searchParams.operators)),
    includeHold: one(searchParams.includeHold)?.toLowerCase() !== "false",
    smu: csvStrs(one(searchParams.smu)),
    area: csvStrs(one(searchParams.area)),
    trendDays: Number.isFinite(trendDaysN) ? trendDaysN : undefined,
  };
  const hidden = csvStrs(one(searchParams.hide));

  const generatedByName = session.user.name ?? "Tint Manager";

  return (
    <div style={{ background: "#e9ebef", minHeight: "100vh", paddingBottom: 40 }}>
      {/* Toolbar — screen only; isolation rules drop it from the printed sheet. */}
      <div
        className="print-hide"
        style={{
          position: "sticky", top: 0, zIndex: 10, display: "flex", gap: 12, alignItems: "center",
          padding: "10px 16px", background: "#0b1220", color: "#fff",
          fontFamily: "system-ui, sans-serif", fontSize: 13,
        }}
      >
        <strong>Tint Summary</strong>
        <span style={{ opacity: 0.7 }}>{date ? `Report date ${date}` : "Today (IST)"}</span>
        <PrintButton auto={autoPrint} />
      </div>

      <Suspense fallback={<Notice title="Loading the report…" body="Gathering today's tint activity." />}>
        <ReportBody params={params} hidden={hidden} generatedByName={generatedByName} />
      </Suspense>
    </div>
  );
}
