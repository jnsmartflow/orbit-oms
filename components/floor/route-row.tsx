"use client";

// Floor Control — a collapsible route row (design §7.2, By-route view on a slot
// tab). Parent (FloorBoard) sorts routes worst-first and enforces one-open-at-a-
// time (§7.2). This component just renders one route's collapsed summary line
// (fixed height — 11 routes is always 11 lines) and, when open, its flat table.

import { ProgressBar } from "./progress-bar";
import { FloorTable, type FloorTableVariant } from "./floor-table";
import { countByStatus, sumLitres } from "./status-pill";
import type { FloorSelection } from "@/lib/floor/selection";
import type { FloorBoardRow } from "@/lib/floor/types";

export function RouteRow({
  name,
  rows,
  nowMs,
  open,
  onToggle,
  variant,
  selection,
  onToggleRow,
  onToggleAll,
  onMarkUrgent,
  onOpenDetail,
}: {
  name: string;
  rows: FloorBoardRow[];
  nowMs: number;
  open: boolean;
  onToggle: () => void;
  variant: FloorTableVariant;
  selection?: FloorSelection;
  onToggleRow?: (id: number) => void;
  onToggleAll?: (rows: FloorBoardRow[]) => void;
  onMarkUrgent?: (id: number) => void;
  onOpenDetail?: (id: number) => void;
}) {
  const counts = countByStatus(rows);
  const litres = sumLitres(rows);
  const oldest = rows.reduce((mx, r) => Math.max(mx, r.ageDays ?? 0), 0);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-2.5 border-b border-[#f0f0f0] px-3.5 py-2.5 text-left ${open ? "bg-[#fafafa]" : "bg-white hover:bg-[#fafafa]"}`}
      >
        <span className="w-2.5 text-[11px] text-gray-300">{open ? "▾" : "▸"}</span>
        <span className="flex w-[150px] items-center gap-1.5 text-[12px] font-semibold text-gray-900">
          {name}
          {oldest > 0 && (
            <span className="rounded-[3px] bg-[#f3f4f6] px-[5px] py-px text-[9.5px] font-bold text-[#6b7280]">{oldest}d</span>
          )}
        </span>
        <span className="w-[128px] text-[10.5px] text-gray-400">
          {rows.length} bills · {litres} L
        </span>
        <ProgressBar counts={counts} className="max-w-[300px] flex-1 !bg-[#f3f4f6]" />
        <span className="w-[92px] text-right text-[11px] tabular-nums text-gray-700">
          {counts.done} of {rows.length} done
        </span>
      </button>
      {open && (
        <FloorTable
          rows={rows}
          nowMs={nowMs}
          variant={variant}
          selection={selection}
          onToggleRow={onToggleRow}
          onToggleAll={onToggleAll}
          onMarkUrgent={onMarkUrgent}
          onOpenDetail={onOpenDetail}
        />
      )}
    </>
  );
}
