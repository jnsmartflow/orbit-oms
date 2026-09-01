"use client";

import { ChevronRight } from "lucide-react";
import { AgeBadge } from "@/components/picking/card-atoms";
import type { MrnBoardRow, MrnSupervisorTab } from "@/lib/mrn/types";
import { formatCount, formatDateOnly, formatDuration, formatIstTime } from "./format";

// One truck on the supervisor's phone. Drawn to docs/mockups/mrn/02-supervisor-mobile.html
// (S1 / S2 / S3) and typed to the mobile card scale in CLAUDE_UI.md §60.
//
// ⚠️ AgeBadge is IMPORTED from components/picking/card-atoms.tsx, never
// reimplemented. The days→colour scale (0d silent · 1d subtle amber · 2-3d
// solid amber · 4d+ red) lives in that one file "and nowhere else" — §62.1 — and
// a second copy here is exactly what that rule exists to prevent. MRN reads
// `ageDays` off the row, computed server-side in lib/mrn/queries.ts from
// `truckReportingDate`, so the card and the server can never disagree about how
// long a truck has waited.
//
// ⚠️ NOT CardShelf, NOT RouteDot. Both key on OBD concepts — a bill's route, its
// pack shelf — that an MRN simply does not have. Importing them would mean
// passing empty props to satisfy a shape.
//
// The card's ONE line that changes with the tab is the caption's right half and
// the shelf: what a supervisor needs to know about a truck is different before
// he starts it, while he holds it, and after it is signed off.

interface SupervisorCardProps {
  row: MrnBoardRow;
  tab: MrnSupervisorTab;
  /** The signed-in user, so a truck he holds reads "you" rather than his name. */
  viewerId: number | null;
  onOpen: (id: number) => void;
}

export function SupervisorCard({
  row,
  tab,
  viewerId,
  onOpen,
}: SupervisorCardProps): React.JSX.Element {
  // Caption right-half: when did this truck become MY problem.
  let when: string | null;
  if (tab === "checking") {
    const at = formatIstTime(row.unloadingStartAt);
    when = at ? `started ${at}` : "being unloaded";
  } else if (tab === "done") {
    const at = formatIstTime(row.unloadingEndAt);
    when = at ? `done ${at}` : "done";
  } else {
    const on = formatDateOnly(row.truckReportingDate);
    when = on ? `reported ${on}` : null;
  }

  // Where-row right-half.
  let who: string | null = null;
  if (tab === "checking") {
    who =
      viewerId !== null && row.unloadingStartById === viewerId
        ? "you"
        : (row.unloadingStartByName ?? null);
  } else if (tab === "done") {
    who = formatDuration(row.unloadingStartAt, row.unloadingEndAt);
  } else {
    // 🔴 STI, NOT THE DELIVERY NUMBER (owner, 2026-09-01): "just show MRN no
    // and STI no, no need for del no on the supervisor screen."
    //
    // An MRN can now carry several delivery numbers, and the supervisor works
    // the truck as ONE list regardless — he has no tabs, no grouping and no
    // decision that depends on which delivery a line came under. Naming one of
    // several here would have been actively misleading. Same slot, same style,
    // a value that is always singular.
    who = row.stiRefNo ? `STI ${row.stiRefNo}` : null;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      className="mb-2 w-full rounded-[13px] border border-[#eceff2] bg-white px-3.5 py-3 text-left active:bg-gray-50"
    >
      {/* Caption — 11.5px 400, mono for the number (§60). */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11.5px] text-[#98a0aa]">{row.mrnNumber}</span>
        {when && (
          <>
            <span className="text-[#d8dce1]">·</span>
            <span className="truncate text-[11.5px] text-[#98a2b3]">{when}</span>
          </>
        )}
        {/* Only on To check: an age tag on a truck he is already holding, or
            has finished, answers a question nobody is asking. */}
        {tab === "toCheck" && (
          <span className="ml-auto shrink-0">
            <AgeBadge row={{ ageDays: row.ageDays, noDispatchDate: false }} />
          </span>
        )}
      </div>

      {/* Hero — the one line carrying weight (§60's /po refinement principle).
          Source depot left, size of the job right. */}
      <div className="mt-1 flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.25] text-[#1d2939]">
          {row.receivedFrom}
        </span>
        <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[#667085]">
          {row.lineCount} lines
        </span>
      </div>

      {/* Where-row — the numbers he matches against the paper in his hand. */}
      <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[#667085]">
        {row.stiRefNo && (
          <span className="truncate font-mono text-[11.5px]">{row.stiRefNo}</span>
        )}
        {row.stiRefNo && who && <span className="text-[#d8dce1]">·</span>}
        {who && <span className="truncate">{who}</span>}
      </div>

      {/* Shelf — chips + the affordance arrow. */}
      <div className="mt-2 flex items-center gap-1.5">
        {tab === "toCheck" && <Chip>{formatCount(row.totalQtySti)} nos</Chip>}

        {tab === "checking" && (
          <>
            <Chip tone="amber">
              {row.checkedLineCount} of {row.lineCount} checked
            </Chip>
            {row.issueLineCount > 0 && (
              <Chip tone="red">
                {row.issueLineCount} issue{row.issueLineCount === 1 ? "" : "s"}
              </Chip>
            )}
          </>
        )}

        {tab === "done" &&
          (row.issueLineCount > 0 ? (
            <Chip tone="red">
              {row.issueLineCount} issue{row.issueLineCount === 1 ? "" : "s"}
            </Chip>
          ) : (
            <Chip tone="green">All clear</Chip>
          ))}

        <ChevronRight size={15} strokeWidth={2.4} className="ml-auto shrink-0 text-[#cbd2da]" />
      </div>
    </button>
  );
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "amber" | "red" | "green";
}): React.JSX.Element {
  const cls =
    tone === "amber"
      ? "bg-amber-50 text-amber-700"
      : tone === "red"
        ? "bg-red-50 text-red-700"
        : tone === "green"
          ? "bg-green-50 text-green-700"
          : "bg-[#eef1f5] text-[#667085]";
  return (
    <span
      className={`shrink-0 rounded-md px-2 py-[3px] text-[10.5px] font-semibold tabular-nums ${cls}`}
    >
      {children}
    </span>
  );
}
