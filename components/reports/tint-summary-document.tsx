import { Inter } from "next/font/google";
import type { TintSummaryData } from "@/lib/reports/tint-summary-data";

// Re-export so existing importers (preview page) keep `{ type TintSummaryData }`
// from this module. Canonical definition lives in lib/reports/tint-summary-data.
export type { TintSummaryData };

// ─────────────────────────────────────────────────────────────────────────────
// Tint Summary — daily report PRINT DOCUMENT.
//
// Pixel-mirror of docs/mockups/MIS Report/tm-daily-report-mockup-FINAL.html.
// Four A4 pages. Brand-blue (#1c3f93) palette — this is a print document, so the
// app's one-teal rule does NOT apply (per task brief + CLAUDE_UI print section).
//
// All visual CSS is the mockup's own, transcribed verbatim and scoped under the
// `.tsr` root so it never collides with Tailwind / app globals. The @page A4 rule
// and print-isolation live top-level in globals.css (#tint-report-print-area).
//
// Font: Inter via next/font/google (NO base64 embed). All four charts are inline
// SVG generated from props — they scale to the data, nothing hardcoded.
// ─────────────────────────────────────────────────────────────────────────────

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Prop shape = the JSON from GET /api/reports/tint-summary (TintSummaryData,
// imported from lib/reports/tint-summary-data above).

// ── Scoped CSS (mockup-verbatim values, every selector prefixed `.tsr`) ───────
const CSS = `
.tsr{--ink:#0b1220;--d1:#1c2533;--d2:#3a4452;--mut:#5b6573;--lt:#94a0b0;--hair:#e7eaf0;--hair2:#d7dce4;--soft:#f7f9fc;--panel:#f8fafc;--acc:#1c3f93;--acc2:#2b56be;--acc-soft:#eaeef7;--acc-fill:#dfe6f4;--alert:#b42318;--alert-soft:#fdeeeb;--amber:#9a5b08;--amber-soft:#fbf2e6;color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-font-smoothing:antialiased;}
.tsr *{box-sizing:border-box;margin:0;padding:0;}
.tsr .tnum{font-variant-numeric:tabular-nums;}
.tsr .page{width:210mm;min-height:297mm;background:#fff;margin:22px auto;box-shadow:0 5px 22px rgba(11,18,32,.12);display:flex;flex-direction:column;padding:0 15mm 13mm;position:relative;}
.tsr .topbar{height:4px;background:var(--acc);margin:0 -15mm;}
.tsr .mast{display:flex;justify-content:space-between;align-items:flex-end;padding:15mm 0 12px;border-bottom:1px solid var(--hair);}
.tsr .wm{font-size:23px;font-weight:800;letter-spacing:-.6px;color:var(--ink);line-height:1;}
.tsr .wm b{color:var(--acc);font-weight:800;}
.tsr .mast .tt{font-size:12px;font-weight:500;color:var(--d2);margin-top:9px;letter-spacing:-.1px;}
.tsr .mast .tt span{color:var(--lt);}
.tsr .mast .R{text-align:right;}
.tsr .mast .R .k{font-size:7.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--lt);font-weight:600;}
.tsr .mast .R .dt{font-size:14px;font-weight:700;margin-top:3px;letter-spacing:-.3px;}
.tsr .mast .R .by{font-size:8px;color:var(--mut);margin-top:9px;line-height:1.6;}
.tsr .lab{font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--d2);margin:34px 0 6px;}
.tsr .desc{font-size:11.5px;color:var(--mut);font-weight:400;line-height:1.45;max-width:600px;margin:0 0 12px;}
.tsr .hero{display:grid;grid-template-columns:1.15fr 1.15fr 1fr 1.2fr;background:var(--panel);border:1px solid var(--hair);border-top:2.5px solid var(--acc);border-radius:7px;overflow:hidden;}
.tsr .hero>div{padding:20px 20px;border-left:1px solid var(--hair);}
.tsr .hero>div:first-child{border-left:none;}
.tsr .k{font-size:9.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--mut);font-weight:700;}
.tsr .v{font-size:38px;font-weight:800;line-height:.95;margin-top:10px;letter-spacing:-1.6px;}
.tsr .v.acc{color:var(--acc);}
.tsr .u{font-size:11.5px;color:var(--mut);margin-top:9px;line-height:1.45;}
.tsr .u b{color:var(--d1);font-weight:700;}
.tsr .prog{height:4px;background:#e4e8ee;border-radius:3px;margin-top:12px;overflow:hidden;}
.tsr .prog>i{display:block;height:100%;background:var(--acc);border-radius:3px;}
.tsr .row{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--hair2);}
.tsr .row>div{padding:18px 18px 16px;border-left:1px solid var(--hair);}
.tsr .row>div:first-child{border-left:none;padding-left:2px;}
.tsr .row .v{font-size:28px;margin-top:8px;letter-spacing:-1px;}
.tsr .row .u{margin-top:5px;}
.tsr .card{border:1px solid var(--hair);border-radius:7px;padding:18px 22px 14px;}
.tsr .card .cap{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--d2);margin-bottom:4px;}
.tsr .card .cap b{color:var(--d2);font-weight:700;}
.tsr .lg{display:flex;gap:16px;font-size:11px;color:var(--mut);}
.tsr .lg i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:5px;}
.tsr .two{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
.tsr .bd{border:1px solid var(--hair);border-radius:7px;padding:20px 20px;display:flex;flex-direction:column;}
.tsr .bd h3{font-size:9.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--d2);font-weight:700;margin-bottom:15px;}
.tsr .br{margin-bottom:19px;}
.tsr .br:last-of-type{margin-bottom:0;}
.tsr .br .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
.tsr .br .nm{font-size:12.5px;font-weight:600;color:var(--d1);}
.tsr .br .mt{font-size:11.5px;color:var(--mut);}
.tsr .br .mt b{color:var(--ink);font-variant-numeric:tabular-nums;font-size:13px;font-weight:700;margin-right:3px;}
.tsr .trk{height:5px;background:#eef1f6;border-radius:3px;overflow:hidden;}
.tsr .trk>i{display:block;height:100%;background:#bcc3ce;border-radius:3px;}
.tsr .trk>i.lead{background:var(--acc);}
.tsr .trk>i.amber{background:#d8941f;}
.tsr .trk>i.red{background:#cf4436;}
.tsr .bd-tot{margin-top:auto;padding-top:13px;border-top:1px solid var(--hair);display:flex;justify-content:space-between;align-items:baseline;}
.tsr .bd-tot .tl{font-size:9px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:var(--mut);}
.tsr .bd-tot .tv{font-size:10.5px;color:var(--mut);}
.tsr .bd-tot .tv b{font-variant-numeric:tabular-nums;color:var(--ink);font-size:13px;font-weight:700;margin-right:3px;}
.tsr .ops{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
.tsr .opc{border:1px solid var(--hair);border-radius:7px;padding:20px 20px;}
.tsr .opc .nm{font-size:15px;font-weight:700;color:var(--ink);letter-spacing:-.2px;}
.tsr .opc .sub{font-size:10.5px;color:var(--lt);margin-top:2px;}
.tsr .opc .stats{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px;}
.tsr .opc .stats .k{font-size:9px;}
.tsr .opc .stats .sv{font-size:21px;font-weight:800;margin-top:4px;letter-spacing:-.6px;}
.tsr .opc .stats .su{font-size:10px;color:var(--lt);}
.tsr table{width:100%;border-collapse:collapse;margin-top:11px;}
.tsr thead th{font-size:9px;letter-spacing:.7px;text-transform:uppercase;color:var(--mut);font-weight:700;text-align:left;padding:0 12px 10px;border-bottom:1.5px solid var(--ink);}
.tsr th.r,.tsr td.r{text-align:right;}
.tsr tbody td{padding:11px 12px;border-bottom:1px solid var(--hair);font-size:11.5px;color:var(--d2);}
.tsr tbody tr:nth-child(even){background:var(--soft);}
.tsr .obd{font-variant-numeric:tabular-nums;color:var(--ink);font-size:9px;}
.tsr .site{font-weight:600;color:var(--ink);}
.tsr .vn,.tsr .tn{font-variant-numeric:tabular-nums;}
.tsr .op{color:var(--mut);}
.tsr .rk{font-variant-numeric:tabular-nums;color:var(--lt);}
.tsr .tag{display:inline-block;font-size:7px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:2.5px 8px;border-radius:4px;}
.tsr .tag.hold{background:var(--alert-soft);color:var(--alert);}
.tsr .tag.assg{background:#eef1f6;color:var(--d2);}
.tsr .agew{color:var(--alert);font-weight:700;}
.tsr .cap2{font-size:10.5px;color:var(--lt);margin:7px 2px 0;}
.tsr .ft{margin-top:auto;padding-top:13px;border-top:1px solid var(--hair);display:flex;justify-content:space-between;font-size:7.5px;color:var(--lt);letter-spacing:.3px;padding-bottom:2px;}
`;

// ── Formatters ───────────────────────────────────────────────────────────────
const IST = "Asia/Kolkata";
const litres = (n: number) => `${Math.round(n).toLocaleString("en-US")} L`;
const intC = (n: number) => Math.round(n).toLocaleString("en-US");

function fmtReportDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: IST, ...o }).format(d);
  return `${f({ weekday: "short" })}, ${f({ day: "numeric" })} ${f({ month: "long" })} ${f({ year: "numeric" })}`;
}
function fmtGenDate(iso: string): string {
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: IST, ...o }).format(d);
  return `${f({ day: "2-digit" })} ${f({ month: "short" })} ${f({ year: "numeric" })}`;
}
function fmtGenTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
function fmtTrendDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: IST, ...o }).format(d);
  return `${f({ weekday: "short" })} ${f({ day: "numeric" })}`;
}
const fmtHour = (h: number) => {
  const ap = h < 12 ? "a" : "p";
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}${ap}`;
};
function niceCeilLitres(v: number): number {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const n of [1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (n * p >= v) return n * p;
  return 10 * p;
}
function evenCeilCount(v: number): number {
  if (v <= 0) return 2;
  let a = Math.ceil(v);
  if (a % 2) a++;      // round up to the next even tick
  if (a <= v) a += 2;  // keep headroom so the tallest bar never touches the top
  return a;
}
const fmtAxisLitres = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(v)));

// Display labels for the API's aging bucket keys.
const AGING_LABELS: Record<string, string> = {
  "<1d": "Under 1 day",
  "1d": "1 day",
  "2-3d": "2–3 days",
  "4-7d": "4–7 days",
  "8+": "8+ days",
};

// ── Reusable bits ────────────────────────────────────────────────────────────
function Mast({ subtitle, reportDateStr, by }: { subtitle: string; reportDateStr: string; by?: React.ReactNode }) {
  return (
    <div className="mast">
      <div className="L">
        <div className="wm"><b>JSW</b> Dulux</div>
        <div className="tt">Tint Manager · Daily Report&nbsp;<span>{subtitle}</span></div>
      </div>
      <div className="R">
        <div className="k">Report date</div>
        <div className="dt">{reportDateStr}</div>
        {by}
      </div>
    </div>
  );
}
function Foot({ left, page, gen }: { left: string; page: number; gen: string }) {
  return (
    <div className="ft">
      <span>{left}</span>
      <span>Page {page} of 4 · {gen}</span>
    </div>
  );
}

// ── Chart 1 — Completion Pace (cumulative-litres area + line) ─────────────────
function PaceChart({ pace }: { pace: TintSummaryData["pace"] }) {
  const PL = 60, PR = 660, PW = PR - PL, BASE = 240, PH = 200;
  const N = pace.length;
  const axis = niceCeilLitres(Math.max(...pace.map((p) => p.cumulativeLitres), 0));
  const x = (i: number) => (N <= 1 ? PL : PL + (i * PW) / (N - 1));
  const y = (v: number) => BASE - (v / axis) * PH;
  const pts = pace.map((p, i) => `${x(i).toFixed(1)},${y(p.cumulativeLitres).toFixed(1)}`);
  const line = pts.join(" ");
  const area = N > 0 ? `${line} ${x(N - 1).toFixed(1)},${BASE} ${x(0).toFixed(1)},${BASE}` : "";
  const last = pace[N - 1];
  const mid = Math.floor((N - 1) / 2);

  // Quietest hour = smallest hour-over-hour increment (data-driven annotation).
  let lullIdx = 1, lullDelta = Infinity;
  for (let i = 1; i < N; i++) {
    const d = pace[i].cumulativeLitres - pace[i - 1].cumulativeLitres;
    if (d < lullDelta) { lullDelta = d; lullIdx = i; }
  }
  const lullHour = N > 1 ? pace[lullIdx].hourIST : 13;
  const lullWord = lullHour >= 12 && lullHour <= 14 ? "Lunch lull" : "Quietest hour";

  return (
    <div className="card">
      <div className="cap">
        <span>Litres tinted through the day</span>
        <span>{lullWord} · <b>{String(lullHour).padStart(2, "0")}:00</b></span>
      </div>
      <svg width="100%" viewBox="0 0 680 280" preserveAspectRatio="xMidYMid meet">
        <line x1="48" y1="40" x2="664" y2="40" stroke="#eef1f6" />
        <line x1="48" y1="140" x2="664" y2="140" stroke="#eef1f6" />
        <line x1="48" y1="240" x2="664" y2="240" stroke="#d7dce4" />
        <text x="40" y="44" textAnchor="end" fontSize="10" fill="#94a0b0">{fmtAxisLitres(axis)}</text>
        <text x="40" y="144" textAnchor="end" fontSize="10" fill="#94a0b0">{fmtAxisLitres(axis / 2)}</text>
        <text x="40" y="244" textAnchor="end" fontSize="10" fill="#94a0b0">0</text>
        {area && <polygon fill="#dfe6f4" fillOpacity="0.6" points={area} />}
        {line && <polyline fill="none" stroke="#1c3f93" strokeWidth="2.6" strokeLinejoin="round" points={line} />}
        {N > 0 && <circle cx={x(0).toFixed(1)} cy={y(pace[0].cumulativeLitres).toFixed(1)} r="3" fill="#1c3f93" />}
        {N > 2 && <circle cx={x(mid).toFixed(1)} cy={y(pace[mid].cumulativeLitres).toFixed(1)} r="3" fill="#1c3f93" />}
        {N > 0 && <circle cx={x(N - 1).toFixed(1)} cy={y(last.cumulativeLitres).toFixed(1)} r="3.6" fill="#1c3f93" />}
        {N > 0 && (
          <text x={x(N - 1).toFixed(1)} y={(y(last.cumulativeLitres) - 9).toFixed(1)} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1c3f93">
            {litres(last.cumulativeLitres)}
          </text>
        )}
        {pace.map((p, i) => (
          <text key={p.hourIST} x={x(i).toFixed(1)} y="262" textAnchor="middle" fontSize="10" fill="#94a0b0">{fmtHour(p.hourIST)}</text>
        ))}
      </svg>
    </div>
  );
}

// ── Chart 2 — Intake vs Completed (grouped bars) ─────────────────────────────
function TrendChart({ trend }: { trend: TintSummaryData["trend"] }) {
  const CL = 48, CR = 664, BASE = 240, PH = 200, BARW = 19;
  const N = trend.length;
  const axis = evenCeilCount(Math.max(...trend.flatMap((t) => [t.intakeCount, t.completedCount]), 0));
  const slot = N > 0 ? (CR - CL) / N : 0;
  const center = (i: number) => CL + slot * (i + 0.5);
  const h = (v: number) => (v / axis) * PH;

  return (
    <div className="card">
      <div className="cap">
        <span className="lg">
          <span><i style={{ background: "#bcc3ce" }} />New intake</span>
          <span><i style={{ background: "#1c3f93" }} />Completed</span>
        </span>
        <span>Taller blue = cleared more than received</span>
      </div>
      <svg width="100%" viewBox="0 0 680 280" preserveAspectRatio="xMidYMid meet">
        <line x1="48" y1="40" x2="664" y2="40" stroke="#eef1f6" />
        <line x1="48" y1="140" x2="664" y2="140" stroke="#eef1f6" />
        <line x1="48" y1="240" x2="664" y2="240" stroke="#d7dce4" />
        <text x="40" y="44" textAnchor="end" fontSize="10" fill="#94a0b0">{axis}</text>
        <text x="40" y="144" textAnchor="end" fontSize="10" fill="#94a0b0">{axis / 2}</text>
        <text x="40" y="244" textAnchor="end" fontSize="10" fill="#94a0b0">0</text>
        {trend.map((t, i) => {
          const c = center(i);
          const closed = t.intakeCount === 0 && t.completedCount === 0;
          if (closed) {
            return <text key={t.date} x={c.toFixed(1)} y="232" textAnchor="middle" fontSize="9" fill="#b8bfc9">closed</text>;
          }
          const gH = h(t.intakeCount), bH = h(t.completedCount);
          return (
            <g key={t.date}>
              <rect x={(c - 21).toFixed(1)} y={(BASE - gH).toFixed(1)} width={BARW} height={gH.toFixed(1)} rx="2" fill="#c4cbd5" />
              <rect x={(c + 2).toFixed(1)} y={(BASE - bH).toFixed(1)} width={BARW} height={bH.toFixed(1)} rx="2" fill="#1c3f93" />
            </g>
          );
        })}
        {trend.map((t, i) => {
          const isToday = i === N - 1;
          return (
            <text key={t.date} x={center(i).toFixed(1)} y="262" textAnchor="middle" fontSize="10"
              fill={isToday ? "#1c3f93" : "#94a0b0"} fontWeight={isToday ? 700 : 400}>
              {isToday ? "Today" : fmtTrendDay(t.date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ── Chart 3 — Aging horizontal bars ──────────────────────────────────────────
function AgingBars({ aging }: { aging: TintSummaryData["aging"] }) {
  const maxCount = Math.max(...aging.map((a) => a.count), 1);
  const colourFor = (bucket: string, count: number): string => {
    if (count === 0) return "";
    if (bucket === "<1d") return "lead";
    if (bucket === "2-3d") return "amber";
    if (bucket === "4-7d" || bucket === "8+") return "red";
    return "";
  };
  return (
    <div className="bd" style={{ display: "block" }}>
      {aging.map((a) => {
        const cls = colourFor(a.bucket, a.count);
        const width = a.count > 0 ? Math.max((a.count / maxCount) * 100, 4) : 2;
        const warn = (a.bucket === "4-7d" || a.bucket === "8+") && a.count > 0;
        return (
          <div className="br" key={a.bucket}>
            <div className="top">
              <span className="nm">{AGING_LABELS[a.bucket] ?? a.bucket}{warn ? " ⚠" : ""}</span>
              <span className="mt"><b>{a.count}</b>OBD · {litres(a.litres)}</span>
            </div>
            <div className="trk"><i className={cls} style={{ width: `${width}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

// ── Two-cut breakdown board (SMU / Area) ─────────────────────────────────────
function CutBoard({ title, rows }: { title: string; rows: Array<{ name: string; count: number; litres: number }> }) {
  const maxL = Math.max(...rows.map((r) => r.litres), 1);
  const totC = rows.reduce((s, r) => s + r.count, 0);
  const totL = rows.reduce((s, r) => s + r.litres, 0);
  return (
    <div className="bd">
      <h3>{title}</h3>
      {rows.map((r, i) => (
        <div className="br" key={r.name}>
          <div className="top">
            <span className="nm">{r.name}</span>
            <span className="mt"><b>{r.count}</b>OBD · {litres(r.litres)}</span>
          </div>
          <div className="trk"><i className={i === 0 ? "lead" : undefined} style={{ width: `${(r.litres / maxL) * 100}%` }} /></div>
        </div>
      ))}
      <div className="bd-tot">
        <span className="tl">Total</span>
        <span className="tv"><b>{totC}</b>OBD · {litres(totL)}</span>
      </div>
    </div>
  );
}

// ── Document ─────────────────────────────────────────────────────────────────
export default function TintSummaryDocument({
  data,
  generatedByName = "Tint Manager",
  hiddenSections,
}: {
  data: TintSummaryData;
  generatedByName?: string;
  /** Section keys to omit (Customise drawer). Default = all visible. */
  hiddenSections?: string[];
}) {
  const reportDateStr = fmtReportDate(data.reportDate);
  const genDate = fmtGenDate(data.generatedAt);
  const genTime = fmtGenTime(data.generatedAt);
  const genFoot = `${genDate} ${genTime} IST`;
  const { summary: s, movement: m } = data;
  const hidden = new Set(hiddenSections ?? []);
  const show = (key: string) => !hidden.has(key);

  return (
    <div id="tint-report-print-area" className={`tsr ${inter.className}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ═══ PAGE 1 — Today's summary + movement + pace ═══ */}
      <div className="page">
        <div className="topbar" />
        <Mast
          subtitle="Surat Depot · Decorative Paints"
          reportDateStr={reportDateStr}
          by={<div className="by">Generated by {generatedByName}<br />{genDate} · {genTime} IST · live snapshot</div>}
        />

        {show("summary") && (<>
        <div className="lab">Today&apos;s summary</div>
        <div className="desc">The whole day in four numbers — what&apos;s left, what got done, what came in, and how much of the load was cleared.</div>
        <div className="hero">
          <div><div className="k">Remaining</div><div className="v">{s.remaining.count}</div><div className="u"><b>{litres(s.remaining.litres)}</b> still to tint</div></div>
          <div><div className="k">Completed today</div><div className="v acc tnum">{s.completed.count}</div><div className="u"><b>{litres(s.completed.litres)}</b> tinted</div></div>
          <div><div className="k">New intake</div><div className="v tnum">{s.intake.count}</div><div className="u"><b>{litres(s.intake.litres)}</b> received</div></div>
          <div>
            <div className="k">Workload cleared</div>
            <div className="v tnum">{s.workloadCleared.pct}%</div>
            <div className="u"><b>{s.workloadCleared.done} of {s.workloadCleared.total}</b> jobs cleared</div>
            <div className="prog"><i style={{ width: `${s.workloadCleared.pct}%` }} /></div>
          </div>
        </div>
        </>)}

        {show("movement") && (<>
        <div className="lab">Today&apos;s movement</div>
        <div className="desc">Like a balance: yesterday&apos;s leftover, plus today&apos;s new orders, minus what got finished, equals what&apos;s still open tonight.</div>
        <div className="row">
          <div><div className="k">Opening</div><div className="v tnum">{m.opening.count}</div><div className="u tnum">{litres(m.opening.litres)}</div></div>
          <div><div className="k">New intake</div><div className="v tnum">{m.intake.count}</div><div className="u tnum">{litres(m.intake.litres)}</div></div>
          <div><div className="k">Completed</div><div className="v tnum">{m.completed.count}</div><div className="u tnum">{litres(m.completed.litres)}</div></div>
          <div><div className="k">Closing</div><div className="v tnum">{m.closing.count}</div><div className="u tnum">{litres(m.closing.litres)}</div></div>
        </div>
        </>)}

        {show("pace") && (<>
        <div className="lab">Completion pace · today (cumulative litres)</div>
        <div className="desc">How the day&apos;s tinting volume built up, hour by hour. A flat stretch means a lull (e.g. the lunch break). Volume is shown instead of order count because a 20 L job and a 500 L job are very different amounts of work.</div>
        <PaceChart pace={data.pace} />
        </>)}

        <Foot left="OrbitOMS · Tint Manager Daily Report" page={1} gen={genFoot} />
      </div>

      {/* ═══ PAGE 2 — Trend + operators + aging ═══ */}
      <div className="page">
        <div className="topbar" />
        <Mast subtitle="Trend & team performance" reportDateStr={reportDateStr} />

        {show("trend") && (<>
        <div className="lab">Intake vs completed · last {data.trend.length} days (OBDs)</div>
        <div className="desc">Are we keeping up? Each day compares orders received (grey) against orders finished (blue). Blue taller than grey means we cleared more than arrived.</div>
        <TrendChart trend={data.trend} />
        </>)}

        {show("operators") && (<>
        <div className="lab">Operator performance · today</div>
        <div className="desc">Each operator&apos;s output for the day — OBDs completed and volume tinted.</div>
        <div className="ops">
          {data.operators.map((o) => (
            <div className="opc" key={o.operatorId}>
              <div className="nm">{o.name ?? "—"}</div>
              <div className="sub">Tint Operator</div>
              <div className="stats">
                <div><div className="k">Jobs</div><div className="sv tnum">{o.jobs}</div><div className="su">completed</div></div>
                <div><div className="k">Volume</div><div className="sv tnum">{litres(o.litres)}</div><div className="su">tinted</div></div>
              </div>
            </div>
          ))}
        </div>
        </>)}

        {show("aging") && (<>
        <div className="lab">Aging of pending work</div>
        <div className="desc">How long the unfinished OBDs have been waiting. Amber and red mean they&apos;ve sat too long and need a push.</div>
        <AgingBars aging={data.aging} />
        <div className="cap2">
          Older buckets in amber / red need a push.
          {data.flags.holdCount > 0 ? ` All ${data.flags.holdCount} Hold OBDs sit in the 2-day-plus range.` : ""}
        </div>
        </>)}

        <Foot left="OrbitOMS · Tint Manager Daily Report" page={2} gen={genFoot} />
      </div>

      {/* ═══ PAGE 3 — Two cuts + top customers ═══ */}
      <div className="page">
        <div className="topbar" />
        <Mast subtitle="Composition of today's tinted volume" reportDateStr={reportDateStr} />

        {show("breakdown") && (<>
        <div className="lab">Today&apos;s completed volume · two cuts</div>
        <div className="desc">The same {s.completed.count} finished OBDs, split two ways — by customer type, and by where they&apos;re being delivered.</div>
        <div className="two">
          <CutBoard title="By business unit (SMU)" rows={data.smu} />
          <CutBoard title="By area / delivery type" rows={data.area} />
        </div>
        </>)}

        {show("topCustomers") && (<>
        <div className="lab">Top customers · by volume today</div>
        <div className="desc">The five sites that took the most paint today.</div>
        <table>
          <thead>
            <tr><th style={{ width: 24 }}>#</th><th>Customer / Site</th><th>Bill-to dealer</th><th className="r">OBD</th><th className="r">Volume</th></tr>
          </thead>
          <tbody>
            {data.topCustomers.map((c, i) => (
              <tr key={c.customerId}>
                <td className="rk">{i + 1}</td>
                <td className="site">{c.name}</td>
                <td className="op">{c.dealer ?? "—"}</td>
                <td className="r vn">{c.obdCount}</td>
                <td className="r vn">{litres(c.litres)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>)}

        <Foot left="OrbitOMS · Tint Manager Daily Report" page={3} gen={genFoot} />
      </div>

      {/* ═══ PAGE 4 — Open + completed registers ═══ */}
      <div className="page">
        <div className="topbar" />
        <Mast subtitle="Open & completed registers" reportDateStr={reportDateStr} />

        {show("openRegister") && (<>
        <div className="lab">Open OBDs · {data.openRegister.length} pending completion</div>
        <div className="desc">Every OBD still to be finished — the action list. Listed first because it needs attention.</div>
        <table>
          <thead>
            <tr><th>OBD No.</th><th>Customer / Site</th><th className="r">Volume</th><th>Status</th><th>Operator</th><th className="r">Age</th></tr>
          </thead>
          <tbody>
            {data.openRegister.map((r) => (
              <tr key={r.obd}>
                <td className="obd">{r.obd}</td>
                <td className="site">{r.site}</td>
                <td className="r vn">{litres(r.litres)}</td>
                <td>{r.isHold ? <span className="tag hold">Hold</span> : <span className="tag assg">{r.status}</span>}</td>
                <td className="op">{r.operator ?? "—"}</td>
                <td className="r">{r.ageDays <= 0 ? "today" : <span className={r.ageDays > 2 ? "agew" : undefined}>{r.ageDays} d</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="cap2">Age in red = pending more than 2 days. Hold OBDs await dealer / stock confirmation.</div>
        </>)}

        {show("completedRegister") && (<>
        <div className="lab">Completed today · {s.completed.count} OBD · {litres(s.completed.litres)}</div>
        <div className="desc">Every OBD finished today, with the exact time the operator marked it done.</div>
        <table>
          <thead>
            <tr><th>OBD No.</th><th>Customer / Site</th><th className="r">Volume</th><th>Operator</th><th className="r">Done at</th></tr>
          </thead>
          <tbody>
            {data.completedRegister.map((r) => (
              <tr key={r.obd}>
                <td className="obd">{r.obd}</td>
                <td className="site">{r.site}</td>
                <td className="r vn">{litres(r.litres)}</td>
                <td className="op">{r.operator ?? "—"}</td>
                <td className="r tn">{r.doneAtIST.slice(11, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="cap2">Done at = time the operator marked the OBD complete (IST).</div>
        </>)}

        <Foot left="OrbitOMS · Tint Manager Daily Report · Surat Depot" page={4} gen={genFoot} />
      </div>
    </div>
  );
}
