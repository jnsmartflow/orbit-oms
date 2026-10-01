"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ReportsDialog } from "@/components/reports/reports-dialog";
import type { ReportParams } from "@/components/reports/report-params";
import type { ReportId } from "@/components/reports/report-catalog";

// The /reports address, for saved links and anyone typing it: the SAME
// ReportsDialog the sidebar opens, always open, over a plain app-coloured
// backdrop. Closing it goes BACK when the person arrived from inside Orbit
// (e.g. the Tint Manager's Reports pill), else to "/", which sends them to
// their own home screen (app/page.tsx → ROLE_REDIRECTS). No second report
// list exists here.
export function ReportsPageDialog({
  initialReport,
  initialTintParams,
}: {
  initialReport: ReportId | null;
  initialTintParams: ReportParams;
}) {
  const router = useRouter();
  const onClose = useCallback(() => {
    let fromOrbit = false;
    try {
      fromOrbit = document.referrer !== "" && new URL(document.referrer).origin === window.location.origin;
    } catch {
      fromOrbit = false;
    }
    if (fromOrbit && window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);
  return (
    <div className="min-h-screen bg-[#f9fafb]">
      <ReportsDialog
        open
        onClose={onClose}
        initialReport={initialReport}
        initialTintParams={initialTintParams}
      />
    </div>
  );
}
