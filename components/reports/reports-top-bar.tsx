"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import CustomiseDrawer from "@/components/reports/customise-drawer";
import { buildReportsHref, buildPrintHref, type ReportParams } from "@/components/reports/report-params";

// Top bar for the Tint Summary rail item: Customise (opens the drawer) · date
// control · the single teal CTA (Generate PDF). Date changes and Generate both
// carry the CURRENT params so the preview, drawer, and printed PDF stay in sync.
export default function ReportsTopBar({
  params,
  roster,
}: {
  params: ReportParams;
  roster: { id: number; name: string | null }[];
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-white px-[22px] py-4">
      <div>
        <div className="text-[15px] font-semibold text-gray-900">Tint Summary</div>
        <div className="text-[11px] text-gray-400">Daily tinting report · live preview</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
        >
          <SlidersHorizontal size={14} />
          Customise
        </button>
        <input
          type="date"
          value={params.date}
          onChange={(e) => {
            const d = e.target.value;
            if (d) router.push(buildReportsHref({ ...params, date: d }));
          }}
          className="h-[34px] rounded-lg border border-gray-200 px-2.5 text-[13px] text-gray-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
        />
        <button
          type="button"
          onClick={() => window.open(buildPrintHref(params), "_blank")}
          className="h-[34px] rounded-lg bg-teal-600 px-4 text-[13px] font-semibold text-white hover:bg-teal-700"
        >
          Generate PDF
        </button>
      </div>

      <CustomiseDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} params={params} roster={roster} />
    </div>
  );
}
