"use client";

import type { MrnBoardRow } from "@/lib/mrn/types";
import { StatusPill } from "./status-pill";

// One truck on billing's rail — mockup 09-billing-desktop-v9.html, frame S.
//
// 🔴 FOUR LINES, AND ONLY FOUR (2026-08-26). MRN number · received-from with the
// status pill · STI ref · line count. Everything else that used to ride along
// was REMOVED, deliberately, and must not creep back:
//
//   • the trailing caption — "done 10:12" / "with Ramesh K." / "reported 17 Aug".
//     Three different sentences in one slot meant the operator had to READ the
//     card to find out what kind of card it was. The pill says it at a glance.
//   • the "All clear" / "N issues" chip — absorbed into the pill, which now
//     reads "Done · 4 issues" and carries the same fact in the same place the
//     eye already goes.
//   • the "{n} nos" STI quantity chip — a number nobody picks a truck by. The
//     line count stayed because it is a size cue; the quantity is detail-pane
//     work.
//
// The old rule this replaces said rail cards should have NO pill on open and
// NO pill on done, because "a rail where three of four cards wear a pill is a
// rail where the pill means nothing". That held while the card carried a chip
// AND a caption AND a pill — three signals fighting. With the other two gone the
// pill is the only status signal left, so it covers all four states. See
// components/mrn/status-pill.tsx, which owns every one of them.
//
// 🔴 THE ORDER OF THE CARDS IS THE SERVER'S — `srNo` ASC since 2026-08-26, truck
// 1 at the top (lib/mrn/queries.ts). This component never re-sorts: two sort
// rules for one list is how a rail starts disagreeing with the numbering the
// operator reads off the badges.

interface RailCardProps {
  row: MrnBoardRow;
  selected: boolean;
  onSelect: (id: number) => void;
}

export function RailCard({ row, selected, onSelect }: RailCardProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      className={
        "mb-2 flex w-full gap-2.5 rounded-[10px] border px-[11px] py-2.5 pl-[9px] text-left transition-colors " +
        (selected
          ? // THE one teal element on this board (UI §1 / §10). Nothing else
            // here is teal — not the New MRN button, not the table's segmented
            // filter — so the operator's eye lands on the truck they are
            // looking at and nowhere else. Unchanged by the 2026-08-26 trim.
            "border-teal-600 bg-teal-50"
          : "border-[#e6e9ec] bg-white hover:bg-gray-50")
      }
    >
      {/* Sr no — truck 1, 2, 3… of this mrnDate, and now also the rail's sort
          key top-to-bottom. Teal when selected. */}
      <span
        className={
          "mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[12px] font-bold tabular-nums " +
          (selected ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500")
        }
      >
        {row.srNo}
      </span>

      <span className="min-w-0 flex-1">
        {/* 1 — the MRN number, quietest thing on the card. It is what you quote
            on the phone, not what you scan the rail for. */}
        <span className="block truncate font-mono text-[10.5px] tracking-[0.02em] text-gray-400">
          {row.mrnNumber}
        </span>

        {/* 2 — where it came from, the loudest thing on the card, with the
            status pill opposite it. `min-w-0 truncate` on the left half so a
            long source can never squeeze the pill, which is shrink-0. */}
        <span className="mt-[3px] flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[16px] font-bold leading-[1.2] text-gray-900">
            {row.receivedFrom}
          </span>
          <StatusPill row={row} />
        </span>

        {/* 3 — the STI ref, the thing billing actually matches against paper. */}
        <span className="mt-[4px] block truncate font-mono text-[12px] text-gray-500">
          {row.stiRefNo ?? "—"}
        </span>

        {/* 4 — size of the job, as a chip. RAW line count, not distinct SKUs:
            two lines can legitimately carry the same SKU (queries.ts counts
            rows).

            ⚠ The chip scale is the module's existing one — rounded-[5px],
            px-[7px] py-[3px], 10.5px — shared with status-pill.tsx:89, NOT a
            new one invented here. If that scale ever changes, both move. */}
        <span className="mt-[6px] block">
          <span className="inline-flex items-center rounded-[5px] bg-gray-100 px-[7px] py-[3px] text-[10.5px] text-gray-600">
            <b className="font-bold">{row.lineCount}</b>&nbsp;lines
          </span>
        </span>
      </span>
    </button>
  );
}
