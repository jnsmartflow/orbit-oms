"use client";

import type { MrnBoardRow } from "@/lib/mrn/types";
import { formatCount, formatDateOnly, formatIstTime } from "./format";

// One truck on billing's rail. Drawn to docs/mockups/mrn/01-billing-desktop.html
// (.card / .sr / .card-r1…r4).
//
// 🔴 EXACTLY ONE STATUS PILL EXISTS IN THIS MODULE: **Checking**. Nothing
// renders on `open` and nothing renders on `done` — the v2 changelog removed
// the Draft and Done pills on owner instruction, and they must not come back. A
// finished MRN says so with plain grey caption text ("done 10:12") and a
// NEUTRAL chip (All clear / N issues). Those are facts about the receipt, not
// badges competing for attention: a rail where three of four cards wear a pill
// is a rail where the pill means nothing.
//
// 🔴 "reported {date}" IS `truckReportingDate` — NEVER a creation time. The
// mockup drew "reported 11:04", a wall-clock, and that was corrected in design
// §11 OQ-5: the reporting DATE is the day the truck showed up, and it is what
// every screen labelled "reported" shows. Creation time appears in exactly one
// place in this whole module, the detail pane's subtitle.

interface RailCardProps {
  row: MrnBoardRow;
  selected: boolean;
  onSelect: (id: number) => void;
}

export function RailCard({ row, selected, onSelect }: RailCardProps): React.JSX.Element {
  // The third line's caption is the one thing that changes with status, because
  // "what do I most need to know about this truck right now" changes with it.
  let caption: string | null;
  if (row.status === "checking") {
    caption = row.unloadingStartByName ? `with ${row.unloadingStartByName}` : "being checked";
  } else if (row.status === "done") {
    const at = formatIstTime(row.unloadingEndAt);
    caption = at ? `done ${at}` : "done";
  } else {
    const on = formatDateOnly(row.truckReportingDate);
    caption = on ? `reported ${on}` : null;
  }

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
            // looking at and nowhere else.
            "border-teal-600 bg-teal-50"
          : "border-[#e6e9ec] bg-white hover:bg-gray-50")
      }
    >
      {/* Sr no — truck 1, 2, 3… of this mrnDate. Teal when selected. */}
      <span
        className={
          "mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[12px] font-bold tabular-nums " +
          (selected ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500")
        }
      >
        {row.srNo}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11.5px] tracking-[0.02em] text-[#98a0aa]">
            {row.mrnNumber}
          </span>
          {row.status === "checking" && <CheckingPill />}
        </span>

        <span className="mt-[5px] block text-[15px] font-semibold leading-[1.25] text-[#1d2939]">
          {row.receivedFrom}
        </span>

        <span className="mt-[5px] flex items-center gap-[7px] text-[12px] text-[#667085]">
          {row.stiRefNo && (
            <span className="truncate font-mono text-[11.5px]">{row.stiRefNo}</span>
          )}
          {row.stiRefNo && caption && <span className="text-[#d8dce1]">·</span>}
          {caption && <span className="truncate">{caption}</span>}
        </span>

        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip>{row.lineCount} lines</Chip>
          {/* On a finished MRN the outcome replaces the quantity chip: once the
              truck is counted, "did anything go wrong" is the only question
              left. Before that, the STI quantity is what billing is working to. */}
          {row.status === "done" ? (
            row.issueLineCount > 0 ? (
              <Chip tone="warn">
                {row.issueLineCount} issue{row.issueLineCount === 1 ? "" : "s"}
              </Chip>
            ) : (
              <Chip tone="ok">All clear</Chip>
            )
          ) : (
            <Chip>{formatCount(row.totalQtySti)} nos</Chip>
          )}
        </span>
      </span>
    </button>
  );
}

/** The module's ONLY status pill. See this file's header before adding another. */
export function CheckingPill(): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center gap-[5px] rounded-[5px] border border-amber-200 bg-amber-50 px-[7px] py-[3px] text-[10.5px] font-semibold text-amber-700">
      <span className="h-[7px] w-[7px] rounded-full bg-amber-500" aria-hidden="true" />
      Checking
    </span>
  );
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "ok" | "warn";
}): React.JSX.Element {
  const toneClass =
    tone === "ok"
      ? "bg-green-50 text-green-700"
      : tone === "warn"
        ? "bg-orange-50 text-orange-700"
        : "bg-[#eef1f5] text-[#667085]";
  return (
    <span className={`rounded-[5px] px-[7px] py-[3px] text-[10.5px] font-semibold ${toneClass}`}>
      {children}
    </span>
  );
}
