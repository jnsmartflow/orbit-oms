"use client";

import { useRouter } from "next/navigation";

// Top bar for the Tint Summary rail item: a date control + the single teal CTA
// (Generate PDF). Changing the date re-renders the hub (server reads ?date and
// rebuilds the preview). Generate opens the standalone print route in a NEW TAB
// with ?print=1 so its auto-print fires there, leaving the hub untouched.
export default function ReportsTopBar({ date }: { date: string }) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-between px-[22px] py-4 bg-white border-b border-gray-200">
      <div>
        <div className="text-[15px] font-semibold text-gray-900">Tint Summary</div>
        <div className="text-[11px] text-gray-400">Daily tinting report · live preview</div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => {
            const d = e.target.value;
            if (d) router.push(`/reports?r=tint-summary&date=${d}`);
          }}
          className="h-[34px] rounded-lg border border-gray-200 px-2.5 text-[13px] text-gray-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
        />
        <button
          type="button"
          onClick={() => window.open(`/reports/tint-summary?date=${date}&print=1`, "_blank")}
          className="h-[34px] rounded-lg bg-teal-600 px-4 text-[13px] font-semibold text-white hover:bg-teal-700"
        >
          Generate PDF
        </button>
      </div>
    </div>
  );
}
