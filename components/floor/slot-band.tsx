"use client";

// Floor Control — a collapsible slot band (design §7.1, All view only). The band
// header IS the slot indicator, so the table inside carries no Slot column. Each
// band has its own progress bar and "N of M done" (done = pick_checked, the
// finish line, §4.2). Contents are FLAT — route grouping inside a band was tried
// and rejected (§7.1).

import { ProgressBar } from "./progress-bar";
import { FloorTable, type FloorTableVariant } from "./floor-table";
import { countByStatus, sumLitres } from "./status-pill";
import type { FloorBoardRow } from "@/lib/floor/types";

export function SlotBand({
  label,
  rows,
  nowMs,
  open,
  onToggle,
  variant,
}: {
  label: string; // "10:30" | … | "No slot"
  rows: FloorBoardRow[];
  nowMs: number;
  open: boolean;
  onToggle: () => void;
  variant: FloorTableVariant;
}) {
  const counts = countByStatus(rows);
  const litres = sumLitres(rows);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 border-y border-gray-200 bg-[#f3f4f6] px-3.5 py-2.5 text-left"
      >
        <span className="w-2.5 text-[11px] text-gray-400">{open ? "▾" : "▸"}</span>
        <span className="w-16 text-[12.5px] font-bold text-gray-900">{label}</span>
        <span className="w-[140px] text-[10.5px] text-gray-500">
          {rows.length} bills · {litres} L
        </span>
        <ProgressBar counts={counts} className="max-w-[290px] flex-1" />
        <span className="w-[92px] text-right text-[11px] font-semibold tabular-nums text-gray-700">
          {counts.done} of {rows.length} done
        </span>
      </button>
      {open && <FloorTable rows={rows} nowMs={nowMs} variant={variant} />}
    </>
  );
}
