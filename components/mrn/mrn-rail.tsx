"use client";

import { Plus } from "lucide-react";
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
      <div className="shrink-0 border-b border-[#f2f4f6] px-[13px] pb-2.5 pt-[11px]">
        {/* ⚠ INERT IN 8a — this is a WRITE trigger and step 8b owns it. It is
            rendered because it anchors the rail's layout and tells the operator
            where creating a truck will live, but it does nothing yet, so it
            wears the DISABLED treatment (UI §10: grey, never faded teal — a
            faded primary reads as broken rather than as waiting).
            ⚠ It is also not teal for a second reason: the selected rail card is
            this surface's one teal element (UI §1). When 8b wires this up, that
            conflict has to be resolved deliberately, not by making both teal. */}
        <button
          type="button"
          disabled
          title="Creating an MRN arrives in the next step"
          className="flex h-9 w-full cursor-not-allowed items-center justify-center gap-[7px] rounded-[9px] border border-gray-200 bg-gray-100 text-[13px] font-semibold text-gray-400"
        >
          <Plus size={15} strokeWidth={2.4} />
          New MRN
        </button>
      </div>

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
