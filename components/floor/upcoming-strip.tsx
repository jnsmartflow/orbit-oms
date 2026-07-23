"use client";

// Floor Control — Upcoming strip (design §7.11). A collapsed strip at the bottom
// of the Live board for future-dated rows (zone === "upcoming"): visible but
// locked, auto-graduating at midnight. Read-only (variant="upcoming" → no
// checkbox, no # spine, status reads "for {day}"). Renders nothing when empty.

import { useState } from "react";
import { FloorTable } from "./floor-table";
import type { FloorBoardRow } from "@/lib/floor/types";

export function UpcomingStrip({ rows, nowMs }: { rows: FloorBoardRow[]; nowMs: number }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-t border-gray-200 bg-[#fcfcfd] px-3.5 py-2.5 text-left text-[11px] text-gray-500"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>
          Upcoming <b className="text-gray-700">{rows.length}</b> — locked until their dispatch day
        </span>
      </button>
      {open && <FloorTable rows={rows} nowMs={nowMs} variant="upcoming" />}
    </>
  );
}
