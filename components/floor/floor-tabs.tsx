"use client";

// Floor Control — slot tabs: 10:30 · 12:30 · 16:00 · 18:00 · All (design §7.1).
// Left→right through the day; All sits at the END as the summary. The active
// tab is the ONE teal element on the floor board (CLAUDE_UI §6 / design §7.6) —
// everything else here is grey. Counts are DUE rows only (upcoming is separate).

import type { FloorBoardRow, FloorWindowCount } from "@/lib/floor/types";

export type SlotTabKey = string; // a windowTime ("10:30") or "all"

export function FloorTabs({
  windows,
  dueRows,
  active,
  onSelect,
}: {
  windows: FloorWindowCount[];
  dueRows: FloorBoardRow[];
  active: SlotTabKey;
  onSelect: (key: SlotTabKey) => void;
}) {
  const countFor = (windowId: number) => dueRows.filter((r) => r.windowId === windowId).length;

  const tabs: Array<{ key: SlotTabKey; label: string; count: number }> = [
    ...windows.map((w) => ({ key: w.windowTime, label: w.windowTime, count: countFor(w.id) })),
    { key: "all", label: "All", count: dueRows.length },
  ];

  return (
    <div className="flex items-center gap-0.5 border-b border-gray-200 bg-[#fcfcfd] px-3.5">
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            className={`border-b-2 px-[13px] pb-[7px] pt-[9px] text-[11.5px] ${
              on ? "border-teal-600 font-semibold text-teal-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label} <span className="text-[10px] text-gray-400">{t.count}</span>
          </button>
        );
      })}
    </div>
  );
}
