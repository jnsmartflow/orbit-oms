"use client";

// Tint Manager — the header search's RESULTS DROPDOWN (2026-10-02, round 2
// step 2). Rendered by UniversalHeader directly under its search box
// (`searchDropdown`), inside the box's `relative` wrapper, so it hangs from the
// box and widens with it (`searchExpanded`).
//
// The page decides everything — what matched (lib/tint/search.ts → Floor's
// matcher), the groups and their order, the active row, and what opening a row
// does. This file only DRAWS: groups in tab order (Needs assignment, Tint, Base,
// TI, Hold, CI, Delete, then "Not on Tint Manager"), each row = OBD (mono, the
// matched part highlighted) · bill-to · ship-to · one context bit · status pill.
//
// Keyboard (↑ / ↓ / Enter) is the page's, through the input's onSearchKeyDown;
// Escape is the header's own (clears the box → the page closes this). A
// mousedown outside the box + dropdown closes it; the input itself is inside
// the shared wrapper, so clicking back into the box keeps it open.

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface SearchResultRow {
  key:       string;
  obd:       string;
  /** [start, end) of the OBD to highlight, or null (a name / code hit). */
  highlight: [number, number] | null;
  billTo:    string | null;
  shipTo:    string | null;
  context:   string | null;
  pill:      React.ReactNode;
  /** False for a "Not on Tint Manager" row — shown, not opened. */
  openable:  boolean;
}

export interface SearchResultGroup {
  key:   string;
  label: string;
  rows:  SearchResultRow[];
}

export function SearchDropdown({
  groups, activeKey, loadingFallback, onPick, onHover, onClose,
}: {
  groups:          SearchResultGroup[];
  activeKey:       string | null;
  /** The server fallback is still loading — its group shows a quiet line. */
  loadingFallback: boolean;
  onPick:          (row: SearchResultRow) => void;
  onHover:         (key: string) => void;
  onClose:         () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Outside click closes — "outside" = beyond the box + dropdown wrapper.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const wrap = ref.current?.parentElement;
      if (wrap && !wrap.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  // Keep the active row in view as ↑ / ↓ move it.
  useEffect(() => {
    if (!activeKey) return;
    ref.current?.querySelector(`[data-result-key="${CSS.escape(activeKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1.5 max-h-[70vh] w-[560px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-xl border border-ink-100 bg-white py-1 shadow-[0_12px_32px_rgba(27,24,38,0.14)]"
    >
      {total === 0 && !loadingFallback && (
        <p className="px-4 py-5 text-center text-[12px] text-ink-400">No bill matches</p>
      )}
      {groups.map((g) => (g.rows.length === 0 && !(g.key === "find" && loadingFallback) ? null : (
        <div key={g.key} className="py-1">
          <div className="flex items-center justify-between px-4 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[.06em] text-ink-400">
            <span>{g.label}</span>
            {g.rows.length > 0 && <span className="tabular-nums">{g.rows.length}</span>}
          </div>
          {g.key === "find" && loadingFallback && g.rows.length === 0 && (
            <p className="px-4 py-2 text-[11.5px] text-ink-400">Looking in other bills…</p>
          )}
          {g.rows.map((r) => {
            const on = r.key === activeKey;
            return (
              <button
                key={r.key}
                type="button"
                data-result-key={r.key}
                onMouseEnter={() => onHover(r.key)}
                onClick={() => onPick(r)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2 text-left",
                  on ? "bg-brand-50" : "hover:bg-ink-25",
                  !r.openable && "cursor-default",
                )}
              >
                <span className="w-[92px] flex-shrink-0 font-mono text-[12px] text-ink-900">
                  {r.highlight ? (
                    <>
                      {r.obd.slice(0, r.highlight[0])}
                      <mark className="rounded-[2px] bg-brand-100 px-px text-brand-800">{r.obd.slice(r.highlight[0], r.highlight[1])}</mark>
                      {r.obd.slice(r.highlight[1])}
                    </>
                  ) : r.obd}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-ink-900">
                    {r.billTo ?? "—"}<span className="mx-1 text-ink-400">·</span>{r.shipTo ?? "—"}
                  </span>
                  {r.context && <span className="block truncate text-[11px] text-ink-500">{r.context}</span>}
                </span>
                <span className="flex-shrink-0">{r.pill}</span>
              </button>
            );
          })}
        </div>
      )))}
    </div>
  );
}
