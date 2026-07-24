"use client";

// Floor Control — the filter button + dropdown (design §5.3, mockup 01-board.html
// fbtn/filtersheet). Status (floor only) + Flags, multi-select chips. The button
// carries a count when any filter is active. Client-side only — no refetch.

import { useState } from "react";
import { Filter } from "lucide-react";
import {
  STATUS_OPTIONS,
  FLAG_OPTIONS,
  filterCount,
  EMPTY_FILTERS,
  type FloorFilters,
  type FloorFilterStatus,
  type FloorFilterFlag,
} from "@/lib/floor/filter";

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[5px] border px-[10px] py-1 text-[11px] ${
        on ? "border-gray-900 bg-gray-900 font-semibold text-white" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800"
      }`}
    >
      {label}
    </button>
  );
}

export function FilterSheet({
  filters,
  onChange,
  showStatus,
}: {
  filters: FloorFilters;
  onChange: (f: FloorFilters) => void;
  showStatus: boolean; // Status group only on the Floor tab (design §5.3)
}) {
  const [open, setOpen] = useState(false);
  const count = filterCount(filters);

  const toggleStatus = (s: FloorFilterStatus) =>
    onChange({
      ...filters,
      status: filters.status.includes(s) ? filters.status.filter((x) => x !== s) : [...filters.status, s],
    });
  const toggleFlag = (f: FloorFilterFlag) =>
    onChange({
      ...filters,
      flags: filters.flags.includes(f) ? filters.flags.filter((x) => x !== f) : [...filters.flags, f],
    });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-[30px] items-center gap-1.5 rounded-[7px] border px-[11px] text-[11.5px] ${
          count > 0 || open ? "border-teal-600 bg-[#f0fdfa] font-semibold text-[#0f766e]" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700"
        }`}
      >
        <Filter size={13} />
        Filter
        {count > 0 && <span className="rounded-[3px] bg-teal-600 px-[5px] py-px text-[9.5px] font-bold text-white">{count}</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1.5 w-[300px] rounded-[10px] border border-gray-200 bg-white p-3.5 shadow-lg">
            {showStatus && (
              <div className="mb-3">
                <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-gray-400">Status</div>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_OPTIONS.map(([key, label]) => (
                    <Chip key={key} on={filters.status.includes(key)} label={label} onClick={() => toggleStatus(key)} />
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-gray-400">Flags</div>
              <div className="flex flex-wrap gap-1.5">
                {FLAG_OPTIONS.map(([key, label]) => (
                  <Chip key={key} on={filters.flags.includes(key)} label={label} onClick={() => toggleFlag(key)} />
                ))}
              </div>
            </div>
            {count > 0 && (
              <div className="mt-3 flex justify-end border-t border-gray-100 pt-2.5">
                <button
                  type="button"
                  onClick={() => onChange(EMPTY_FILTERS)}
                  className="rounded-[6px] border border-gray-200 px-3 py-1 text-[11px] text-gray-500 hover:border-gray-300 hover:text-gray-700"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
