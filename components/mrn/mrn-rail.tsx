"use client";

import type { MrnBoardRow } from "@/lib/mrn/types";
import { RailCard } from "./rail-card";

// Billing's left rail — ONE FLAT LIST, newest Sr no on top.
//
// 🔴 NO Open / Done / All TABS. They were removed on owner instruction (the
// mockup's own v2 changelog is the record). Status is a per-card treatment, not
// a filter: a depot does four trucks a day, and splitting four cards across
// three tabs hides work behind a click for no gain. Do not add them back, and
// do not add a status filter to the header instead — same decision, different
// costume.
//
// Ordering is the SERVER's (srNo DESC, lib/mrn/queries.ts). This component
// never re-sorts: two sort rules for one list is how a rail starts disagreeing
// with the numbering the operator reads off the cards.

interface MrnRailProps {
  dateLabel: string;
  rows: MrnBoardRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
  error: string | null;
  /** True when a search query is filtering the list — changes the empty copy. */
  filtered: boolean;
}

// ⚠ THE "NEW MRN" CTA IS NOT HERE ANY MORE (2026-08-22). It moved to the
// header's Row 2 — the date strip — where it sits opposite the date stepper
// (components/mrn/billing-board.tsx, via UniversalHeader's `leftExtra` slot).
// The rail now starts straight into its caption and cards. The teal rule went
// with it unchanged: teal only while nothing is selected.

export function MrnRail({
  dateLabel,
  rows,
  selectedId,
  onSelect,
  loading,
  error,
  filtered,
}: MrnRailProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-col border-r border-[#eceff2] bg-white">
      <div className="shrink-0 px-3.5 pb-[3px] pt-[11px] text-[10px] font-semibold uppercase tracking-[0.07em] text-gray-400">
        Trucks · {dateLabel}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-[11px] pb-2.5 pt-1">
        {loading ? (
          <p className="px-1 py-2 text-[12px] text-gray-400">Loading…</p>
        ) : error ? (
          <p className="px-1 py-2 text-[12px] text-red-600">{error}</p>
        ) : rows.length === 0 ? (
          <p className="px-1 py-2 text-[12px] leading-relaxed text-gray-400">
            {filtered
              ? "No truck on this date matches that search."
              : "No trucks on this date yet."}
          </p>
        ) : (
          rows.map((row) => (
            <RailCard
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
