"use client";

// Floor Control — carry-over banner (design §7.4). Sits above the routes/bands
// when any DUE row was dispatch-dated to an earlier day (ageDays > 0). Individual
// rows carry their own 1d/2d tag; this is the whole-view summary.

import type { FloorBoardRow } from "@/lib/floor/types";

export function CarryoverBanner({ rows }: { rows: FloorBoardRow[] }) {
  if (rows.length === 0) return null;
  const oldest = rows.reduce((mx, r) => Math.max(mx, r.ageDays ?? 0), 0);
  return (
    <div className="flex items-center gap-2 border-b border-[#f0f0f0] bg-[#fafafa] px-3.5 py-2.5 text-[11px] text-gray-500">
      <span>↷</span>
      <span>
        <b className="font-semibold text-gray-900">
          {rows.length} bill{rows.length === 1 ? "" : "s"} carried from an earlier day
        </b>{" "}
        — oldest {oldest} day{oldest === 1 ? "" : "s"}. These already missed a vehicle.
      </span>
    </div>
  );
}
