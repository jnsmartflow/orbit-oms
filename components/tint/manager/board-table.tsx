"use client";

// Tint Manager — the flat board table, grouped one section per operator.
//
// ONE table, no tabs and no operator filter chip: every job of a person's sits
// under their own name, in the order "what they're doing now / what's next /
// what's stuck / what's finished" (mockup callout §4). The grouping is a sort,
// not a filter — nothing is hidden by it.
//
// Fixed-table standard, CLAUDE_UI.md §27: table-layout:fixed + <colgroup>
// percentage widths + nowrap/ellipsis cells. Widths come from the locked mockup.

import { Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import { OperatorAvatar, StatusPill } from "./board-bits";
import type { BoardGroup, BoardRow } from "./types";

const COLS = ["3%", "6%", "9%", "9%", "18%", "10%", "6%", "6%", "15%", "18%"] as const;

export function BoardTable({
  groups, selection, onToggleRow, onOpenRow, onReorder, busyKeys,
}: {
  groups:      BoardGroup[];
  selection:   Set<string>;
  onToggleRow: (row: BoardRow) => void;
  onOpenRow:   (row: BoardRow) => void;
  onReorder:   (row: BoardRow, direction: "up" | "down") => void;
  /** Rows with a reorder request in flight — arrows go inert so a double-tap
   *  cannot queue two swaps against a list the first one is about to change. */
  busyKeys:    Set<string>;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-baseline gap-2 px-3.5 py-3 bg-white border-b border-gray-200">
        <span className="text-[12px] font-bold text-gray-900">On the floor</span>
        <span className="text-[10.5px] text-gray-400">
          {total} {total === 1 ? "job" : "jobs"} · grouped by operator
        </span>
        <span
          className="text-[10.5px] text-gray-300 ml-auto"
          title="Finished jobs drop off this board at the end of the day. The full history lives in the Tint Summary report."
        >
          finished jobs show for today only
        </span>
      </div>

      <div className="flex-1 overflow-y-auto bg-white">
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            {COLS.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              {["", "Seq", "OBD", "SO No.", "Site Name", "Route", "Vol", "Art.", "Operator", "Status"].map((h, i) => (
                <th
                  key={i}
                  className="sticky top-0 bg-white text-left text-[10px] font-medium uppercase tracking-[.05em] text-gray-400 h-8 px-2.5 border-b border-[#ebebeb]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {total === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-[11.5px] text-gray-400 py-10">
                  Nothing on the floor. Assign an OBD from the rail to get started.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <GroupSection
                key={g.operatorId}
                group={g}
                selection={selection}
                onToggleRow={onToggleRow}
                onOpenRow={onOpenRow}
                onReorder={onReorder}
                busyKeys={busyKeys}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupSection({
  group, selection, onToggleRow, onOpenRow, onReorder, busyKeys,
}: {
  group:       BoardGroup;
  selection:   Set<string>;
  onToggleRow: (row: BoardRow) => void;
  onOpenRow:   (row: BoardRow) => void;
  onReorder:   (row: BoardRow, direction: "up" | "down") => void;
  busyKeys:    Set<string>;
}) {
  return (
    <>
      <tr className="group/hdr">
        <td colSpan={10} className="bg-gray-50 text-gray-600 text-[10.5px] font-bold px-3.5 py-[5px] border-b border-gray-100">
          {group.operatorName}
          <span className="font-normal text-gray-400 ml-1">
            · {group.rows.length} {group.rows.length === 1 ? "job" : "jobs"} on the floor
          </span>
        </td>
      </tr>
      {group.rows.map((r) => (
        <Row
          key={r.key}
          row={r}
          selected={selection.has(r.key)}
          onToggle={() => onToggleRow(r)}
          onOpen={() => onOpenRow(r)}
          onReorder={onReorder}
          busy={busyKeys.has(r.key)}
        />
      ))}
    </>
  );
}

function Row({
  row, selected, onToggle, onOpen, onReorder, busy,
}: {
  row:       BoardRow;
  selected:  boolean;
  onToggle:  () => void;
  onOpen:    () => void;
  onReorder: (row: BoardRow, direction: "up" | "down") => void;
  busy:      boolean;
}) {
  const cell = "text-[11px] text-gray-700 px-2.5 h-10 border-b border-[#f0f0f0] whitespace-nowrap overflow-hidden text-ellipsis";

  const lockTitle =
    row.status === "paused"      ? "Locked while paused — the job belongs to its operator until they resume or finish it"
    : row.status === "tinting_done" ? "Already done"
    : row.type === "split"       ? "Splits re-assign one at a time, from the detail panel"
    : "In progress — cannot be moved to another operator";

  return (
    <tr className="group cursor-pointer hover:bg-gray-50" onClick={onOpen}>
      {/* checkbox / lock */}
      <td className={cell} onClick={(e) => e.stopPropagation()}>
        {row.selectable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={selected ? "Deselect row" : "Select row"}
            className={cn(
              "w-3.5 h-3.5 border-[1.5px] rounded-[4px] flex items-center justify-center text-[9px] transition-opacity",
              selected
                ? "bg-teal-600 border-teal-600 text-white opacity-100"
                : "bg-white border-gray-300 text-transparent opacity-0 group-hover:opacity-100",
            )}
          >
            ✓
          </button>
        ) : (
          <span className="text-[11px] text-gray-300 opacity-50" title={lockTitle}>🔒</span>
        )}
      </td>

      {/* Seq */}
      <td className={cell} onClick={(e) => e.stopPropagation()}>
        {row.status !== "assigned" || row.seqRank === null ? (
          <span className="text-gray-300 text-[11px]">—</span>
        ) : (
          <span className="flex items-center gap-[5px]">
            <span className="text-[11.5px] font-bold text-gray-700">{row.seqRank}</span>
            <span className={cn(
              "flex flex-col transition-opacity",
              busy ? "opacity-30" : "opacity-0 group-hover:opacity-100",
            )}>
              <button
                type="button"
                disabled={!row.canMoveUp || busy}
                onClick={() => onReorder(row, "up")}
                title={row.canMoveUp ? `Move up in ${row.operatorName.split(" ")[0]}'s queue` : "Already first"}
                className={cn(
                  "w-3.5 h-[11px] flex items-center justify-center text-[9px] leading-none rounded-[2px]",
                  row.canMoveUp && !busy
                    ? "text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                    : "text-gray-300 opacity-25 cursor-default",
                )}
              >
                ▲
              </button>
              <button
                type="button"
                disabled={!row.canMoveDown || busy}
                onClick={() => onReorder(row, "down")}
                title={row.canMoveDown ? `Move down in ${row.operatorName.split(" ")[0]}'s queue` : "Already last"}
                className={cn(
                  "w-3.5 h-[11px] flex items-center justify-center text-[9px] leading-none rounded-[2px]",
                  row.canMoveDown && !busy
                    ? "text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                    : "text-gray-300 opacity-25 cursor-default",
                )}
              >
                ▼
              </button>
            </span>
          </span>
        )}
      </td>

      {/* OBD (+ split tag) */}
      <td className={cn(cell, "text-gray-600")}>
        <span className="inline-flex items-center gap-1">
          <ObdCode code={row.obdNumber} />
          {row.type === "split" && (
            <span
              className="inline-flex items-center gap-[2px] text-[9px] font-semibold px-1 py-[1px] rounded border bg-violet-50 text-violet-700 border-violet-200"
              title={`Split #${row.splitNumber} of this OBD`}
            >
              <Scissors size={8} />
              Split
            </span>
          )}
        </span>
      </td>

      <td className={cn(cell, "font-mono text-gray-400")}>{row.soNumber ?? "—"}</td>

      <td className={cn(cell, "font-semibold text-gray-900")}>
        {row.siteName}
        {row.isUrgent && <span className="text-[10px] ml-1.5" title="Urgent">⚡</span>}
        {row.isKeyCustomer && <span className="text-[10px] ml-1" title="Key customer">★</span>}
        {row.skipCount > 0 && (
          <span className="text-[9px] ml-1.5 font-medium px-1 py-[1px] rounded border bg-gray-50 text-gray-500 border-gray-200" title={`Skipped ${row.skipCount}×`}>
            ↩{row.skipCount}
          </span>
        )}
      </td>

      <td className={cell}>{row.route ?? "—"}</td>
      <td className={cell}>{row.volumeLitres != null ? `${row.volumeLitres} L` : "—"}</td>
      {/* NULL articleTag means UNKNOWN, never zero — only ~40% of live tint OBDs
          carry one at all, so an em dash is the honest render. */}
      <td className={cell} title={row.articleTag ?? undefined}>{row.articleTag ?? "—"}</td>

      <td className={cell}>
        <span className="inline-flex items-center gap-1.5">
          <OperatorAvatar name={row.operatorName} done={row.status === "tinting_done"} />
          {row.operatorName.split(" ")[0]}
        </span>
      </td>

      <td className={cell}>
        <StatusPill status={row.status} at={row.statusAt} pauseCount={row.pauseCount} />
      </td>
    </tr>
  );
}
