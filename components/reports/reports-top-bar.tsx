"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileDown, SlidersHorizontal } from "lucide-react";
import CustomiseDrawer from "@/components/reports/customise-drawer";
import { PeriodPicker } from "@/components/reports/period-picker";
import { buildReportsHref, buildPrintHref, type ReportParams } from "@/components/reports/report-params";

// The Tint Summary report panel: date · Customise · Download PDF.
//
// 2026-10-01: the live preview that sat under this bar is gone from the hub
// (reports render nothing on screen; the file is produced on click). The name
// "top bar" is historical — this is now the whole panel.
//
// 🔴 THE PDF IS UNCHANGED. Download PDF opens the same standalone print route
// in a new tab, with the same params and ?print=1 auto-print, exactly as the
// old Generate PDF button did (buildPrintHref). Its content, layout and print
// CSS are owned by app/reports/tint-summary/page.tsx and
// components/reports/tint-summary-document.tsx — not this file.
//
// The date and the Customise options are held by the Reports popup
// (onParamsChange) and travel to the PDF in buildPrintHref, so the PDF always
// carries what the panel shows. Without onParamsChange they fall back to the
// /reports URL (buildReportsHref) — no caller does that since 2026-10-01.
export default function ReportsTopBar({
  params,
  roster,
  onParamsChange,
}: {
  params: ReportParams;
  roster: { id: number; name: string | null }[];
  /** When given (the Reports popup), date and Customise changes come back here
   *  and are held in state; without it they go into the /reports URL as before. */
  onParamsChange?: (next: ReportParams) => void;
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const apply = (next: ReportParams) =>
    onParamsChange ? onParamsChange(next) : router.push(buildReportsHref(next));

  return (
    <div className="flex max-w-[560px] flex-col px-6 py-[22px]">
      <h2 className="mb-1 text-[17px] font-bold text-gray-900">Tint Summary</h2>
      <p className="mb-5 text-[12px] leading-relaxed text-gray-400">
        Daily tinting report for one day, as an A4 PDF. Customise chooses the sections and filters.
      </p>

      <div className="mb-3.5 grid max-w-[420px] grid-cols-[96px_1fr] items-center gap-3.5">
        <label htmlFor="ts-date" className="text-[12.5px] text-gray-600">
          Date
        </label>
        <PeriodPicker
          id="ts-date"
          mode="single"
          value={{ from: params.date, to: params.date }}
          onChange={(v) => apply({ ...params, date: v.from })}
        />
      </div>

      <div className="mb-3.5 grid max-w-[420px] grid-cols-[96px_1fr] items-center gap-3.5">
        <span className="text-[12.5px] text-gray-600">Options</span>
        <div>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
          >
            <SlidersHorizontal size={14} />
            Customise
          </button>
        </div>
      </div>

      <div className="pt-4">
        <button
          type="button"
          onClick={() => window.open(buildPrintHref(params), "_blank")}
          className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-brand-600 px-[17px] text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
        >
          <FileDown size={14} />
          Download PDF
        </button>
        <p className="mt-2.5 text-[11.5px] text-gray-400">
          Opens in a new tab and starts the print dialog — choose “Save as PDF”.
        </p>
      </div>

      <CustomiseDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} params={params} roster={roster} onApply={onParamsChange} />
    </div>
  );
}
