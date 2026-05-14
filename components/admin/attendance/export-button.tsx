"use client";

import { Download } from "lucide-react";

/**
 * Trigger a CSV download for the given date by navigating to the
 * export endpoint. The browser handles the file save via the
 * Content-Disposition header. No JS state to manage.
 *
 * Pass `undefined` (or omit) to let the server pick today's IST date —
 * the endpoint computes `istDateString()` server-side, which is timezone-
 * aware and reliably IST regardless of the Vercel UTC runtime. Avoiding
 * client-side date computation here removes a fragility surface.
 */
export function triggerCsvExport(date?: string): void {
  const url = date
    ? `/api/admin/attendance/export?date=${encodeURIComponent(date)}`
    : `/api/admin/attendance/export`;
  window.location.assign(url);
}

interface ExportButtonProps {
  date: string;
  className?: string;
}

/**
 * Inline export button — useful where UniversalHeader's built-in
 * download icon isn't enough. The dashboard wires onDownload directly
 * via triggerCsvExport, but this component is exported for any future
 * placement (e.g. an empty-state CTA).
 */
export function ExportButton({ date, className }: ExportButtonProps) {
  return (
    <button
      type="button"
      onClick={() => triggerCsvExport(date)}
      className={
        className ??
        "h-8 px-3 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-[12px] font-medium flex items-center gap-1.5 transition-colors"
      }
    >
      <Download className="w-3.5 h-3.5" />
      Export CSV
    </button>
  );
}
