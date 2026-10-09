// The ONE list of reports the Reports popup shows, grouped by module.
//
// Read by app/api/reports/options/route.ts (which filters it by the person's
// ticks) and, through that route, by components/reports/reports-dialog.tsx —
// whether the dialog was opened from the sidebar or from the /reports page.
// There is no second list: add a report here AND to REPORT_PAGE_KEYS in
// lib/permissions.ts, nowhere else.
//
// Framework-free and import-type only, so it is safe in client and server code.

import type { REPORT_PAGE_KEYS } from "@/lib/permissions";

export type ReportId = "trip-detail" | "freight-report" | "trip-detail-old" | "nts-trips" | "tint-summary" | "ti-report";

export interface ReportCatalogItem {
  id: ReportId;
  label: string;
  pageKey: (typeof REPORT_PAGE_KEYS)[number];
  /** Module, as the popup's first column shows it. Modules render in the order
   *  they first appear in this list. */
  module: string;
}

export const REPORT_CATALOG: readonly ReportCatalogItem[] = [
  { id: "trip-detail",  label: "Trip Detail",  pageKey: "reports_trip_detail",  module: "Trip" },
  // One row per bill in the NTS layout, for MIS (2026-10-04) — every bill with a
  // dispatch date: freight, floor, CI, pick deleted, cancel. Same tick (owner).
  { id: "freight-report", label: "Freight Report", pageKey: "reports_trip_detail", module: "Trip" },
  // Same rows, the old NTS 26-column layout. Same tick — it is the same report
  // in another shape, not a new permission.
  { id: "trip-detail-old", label: "Trip Detail — Old Format", pageKey: "reports_trip_detail", module: "Trip" },
  // One row per Nagadhiraj Floor trip, Smart Flow's Tempo Report layout
  // (2026-10-09). Same tick (owner).
  { id: "nts-trips", label: "NTS Trips", pageKey: "reports_trip_detail", module: "Trip" },
  { id: "tint-summary", label: "Tint Summary", pageKey: "reports_tint_summary", module: "Tint" },
  { id: "ti-report",    label: "TI Report",    pageKey: "reports_ti_report",    module: "Tint" },
];

export function isReportId(v: string | null | undefined): v is ReportId {
  return REPORT_CATALOG.some((r) => r.id === v);
}
