// Shared, framework-free helpers for the Reports hub URL <-> options round-trip.
// Used by reports-top-bar.tsx + customise-drawer.tsx (client) to build hrefs, and
// the option lists they render. No React / no server imports → safe everywhere.

export interface ReportParams {
  date: string;          // YYYY-MM-DD (IST)
  hide: string[];        // hidden section keys
  operators: number[];   // selected operator ids; [] = all
  includeHold: boolean;  // false → drop Hold OBDs
  smu: string[];         // selected SMU names; [] = all
  area: string[];        // selected delivery-type names; [] = all
  trendDays: number;     // 7 | 14 | 30
}

// 10 toggleable document sections (key must match TintSummaryDocument's gates).
export const SECTION_OPTIONS = [
  { key: "summary", label: "Today's summary" },
  { key: "movement", label: "Today's movement" },
  { key: "pace", label: "Completion pace" },
  { key: "trend", label: "Intake vs completed" },
  { key: "operators", label: "Operator performance" },
  { key: "aging", label: "Aging of pending" },
  { key: "breakdown", label: "Volume breakdown (SMU / Area)" },
  { key: "topCustomers", label: "Top customers" },
  { key: "openRegister", label: "Open OBDs" },
  { key: "completedRegister", label: "Completed today" },
] as const;

export const SMU_OPTIONS = ["Decorative Projects", "Retail Offtake"] as const;

// Delivery-type chips carry their board dot colour (matches the depot convention).
export const AREA_OPTIONS = [
  { value: "Local", dot: "#2563eb" },      // blue
  { value: "Upcountry", dot: "#ea580c" },  // orange
  { value: "IGT", dot: "#0d9488" },        // teal
  { value: "Cross Depot", dot: "#e11d48" }, // rose
] as const;

export const TREND_OPTIONS = [7, 14, 30] as const;

// Only non-default values land in the URL, so a vanilla report stays a clean URL.
function buildSearch(p: ReportParams): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("date", p.date);
  if (p.hide.length) sp.set("hide", p.hide.join(","));
  if (p.operators.length) sp.set("operators", p.operators.join(","));
  if (!p.includeHold) sp.set("includeHold", "false");
  if (p.smu.length) sp.set("smu", p.smu.join(","));
  if (p.area.length) sp.set("area", p.area.join(","));
  if (p.trendDays !== 7) sp.set("trendDays", String(p.trendDays));
  return sp;
}

/** Hub URL carrying the customised options (re-renders the live preview). */
export function buildReportsHref(p: ReportParams): string {
  const sp = buildSearch(p);
  sp.set("r", "tint-summary");
  return `/reports?${sp.toString()}`;
}

/** Standalone print route with the SAME options + auto-print, for a new tab. */
export function buildPrintHref(p: ReportParams): string {
  const sp = buildSearch(p);
  sp.set("print", "1");
  return `/reports/tint-summary?${sp.toString()}`;
}
