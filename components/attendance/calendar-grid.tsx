"use client";

import type { DayCell } from "@/lib/attendance/calendar";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

interface CalendarGridProps {
  cells: DayCell[];                         // 42 cells from getMonthGrid
  statusByDate: Map<string, string>;        // YYYY-MM-DD → status
  selectedDate: string | null;
  onSelectDate(date: string): void;
}

export function CalendarGrid({
  cells,
  statusByDate,
  selectedDate,
  onSelectDate,
}: CalendarGridProps) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1.5">
        {WEEKDAY_LABELS.map((l, i) => (
          <div
            key={i}
            className="text-center text-[10px] uppercase tracking-wider text-gray-400 font-semibold"
          >
            {l}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const isInteractive = cell.isCurrentMonth && !cell.isFuture;
          const status = statusByDate.get(cell.date);
          const isSelected = cell.date === selectedDate;
          // YYYY-MM-DD → DD numeric
          const dayNum = parseInt(cell.date.slice(8, 10), 10);
          return (
            <button
              key={cell.date}
              type="button"
              disabled={!isInteractive}
              onClick={() => onSelectDate(cell.date)}
              className={cellClass(cell, status, isSelected)}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Layered styling: today's teal-bg overrides any status colour. Selected
// adds a gray-900 ring on top of whatever bg the cell carries — so a
// selected today shows teal-bg + gray-900 ring (visually distinct).
function cellClass(
  cell: DayCell,
  status: string | undefined,
  selected: boolean,
): string {
  const base =
    "aspect-square min-h-[40px] rounded-md flex items-center justify-center text-[12px] tabular-nums select-none transition-colors disabled:cursor-default";

  let bgText: string;
  if (cell.isToday) {
    bgText = "bg-teal-600 text-white font-bold";
  } else if (cell.isFuture || !cell.isCurrentMonth) {
    bgText = "bg-gray-50 text-gray-300 font-medium";
  } else if (status === "PRESENT") {
    bgText = "bg-emerald-100 text-emerald-700 font-semibold";
  } else if (status === "LATE" || status === "HALF_DAY") {
    bgText = "bg-amber-100 text-amber-700 font-semibold";
  } else if (status === "ABSENT" || status === "INCOMPLETE") {
    bgText = "bg-red-100 text-red-700 font-semibold";
  } else if (status === "HOLIDAY" || status === "ON_LEAVE") {
    bgText = "bg-blue-100 text-blue-700 font-semibold";
  } else {
    // Current-month, no summary — past day with no data, or today before checkin
    bgText = "bg-gray-50 text-gray-400 font-medium";
  }

  const ring = selected ? " ring-2 ring-gray-900 ring-offset-2" : "";
  return `${base} ${bgText}${ring}`;
}
