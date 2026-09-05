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
// OperatorAvatar is no longer imported here: the Operator column was removed
// 2026-09-05 as redundant — the group header already names the person, and every
// row in a section belongs to them. The avatar still ships in board-bits for the
// rail and the detail panel.
import { StatusPill } from "./board-bits";
import type { BoardGroup, BoardRow } from "./types";

// ── Column widths ────────────────────────────────────────────────────────────
// ☐ 4 · # 4 · OBD 13 · Bill To 18 · Ship To 20 · Route 9 · Vol 6 · Art. 10 ·
// Status 16  = 100.
//
// Derived from Floor's live table (components/floor/floor-table.tsx, the
// interactive+showInvoice arm: 4,4,13,10,20,9,6,10,8,16) rather than re-guessed,
// so the two boards line up column for column where they share one. Every
// shared column keeps its EXACT Floor width — ☐, #, OBD, Ship To, Route, Vol,
// Article, Status — and Bill To takes precisely the 18 freed by dropping
// Invoice (10) and Picker (8), which this board does not have.
//
// ⚠ WIDTHS MAP POSITIONALLY. Moving a column means moving its <col>, its <th>
// and its <td> together; any one left behind shunts every column to its right.
const COLS = ["4%", "4%", "13%", "18%", "20%", "9%", "6%", "10%", "16%"] as const;

// ── Typography, copied from Floor's floor-table.tsx ──────────────────────────
// Floor's four class strings verbatim, so header, cells and pills read
// identically on both boards. Note Floor itself sits a hair off CLAUDE_UI §27's
// stated row sizing — §27 says a 32px header and a 36px data row; Floor uses
// h-[31px] and py-2 (≈33px at 11px text). Floor's actual CSS wins here, because
// matching Floor is the point of this pass; §27's other rules (table-layout
// fixed, colgroup percentages, nowrap/ellipsis) are unchanged and still hold.
const HEAD_TH        = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const HEAD_TH_NARROW = "h-[31px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD             = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b border-[#f0f0f0] text-[#4b5563]";
const TD_NARROW      = "px-1 py-2 text-center text-[11px] border-b border-[#f0f0f0] text-[#4b5563]";

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
              <th className={cn(HEAD_TH_NARROW, "sticky top-0 bg-white z-10")} />
              <th className={cn(HEAD_TH_NARROW, "sticky top-0 bg-white z-10")}>#</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>OBD</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Bill To</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Ship To</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Route</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10 text-right")}>Vol</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Art.</th>
              <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Status</th>
            </tr>
          </thead>
          <tbody>
            {total === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-[11.5px] text-gray-400 py-10">
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
        <td colSpan={9} className="bg-gray-50 text-gray-600 text-[10.5px] font-bold px-3.5 py-[5px] border-b border-gray-100">
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
  return (
    <tr className="group cursor-pointer hover:bg-gray-50" onClick={onOpen}>
      {/* Checkbox. A row that cannot be bulk-selected renders NOTHING here —
          the padlock that used to sit in this cell said "forbidden" on three of
          the four statuses, which is most of a busy board, and the reason is
          already on the row (its Status pill) and in the panel's disabled
          action. An empty cell is the honest affordance: no checkbox, no claim. */}
      <td className={TD_NARROW} onClick={(e) => e.stopPropagation()}>
        {row.selectable && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={selected ? "Deselect row" : "Select row"}
            className={cn(
              "w-3.5 h-3.5 border-[1.5px] rounded-[4px] inline-flex items-center justify-center text-[9px] align-middle transition-opacity",
              selected
                ? "bg-teal-600 border-teal-600 text-white opacity-100"
                : "bg-white border-gray-300 text-transparent opacity-0 group-hover:opacity-100",
            )}
          >
            ✓
          </button>
        )}
      </td>

      {/* # — the queue rank */}
      <td className={cn(TD_NARROW, "text-[10.5px] tabular-nums")} onClick={(e) => e.stopPropagation()}>
        {row.status !== "assigned" || row.seqRank === null ? (
          <span className="text-[#9ca3af]">—</span>
        ) : (
          <span className="inline-flex items-center gap-[5px]">
            <span className="font-semibold text-[#4b5563]">{row.seqRank}</span>
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

      {/* OBD (+ split tag) — Floor's OBD treatment: mono 11.5 medium #111827 */}
      <td className={TD}>
        <span className="inline-flex items-center gap-1">
          <ObdCode code={row.obdNumber} />
          {row.type === "split" && (
            <span
              className="inline-flex items-center gap-[2px] rounded-[3px] px-[5px] py-px text-[9.5px] font-bold bg-[#ede9fe] text-[#6d28d9]"
              title={`Split #${row.splitNumber} of this OBD`}
            >
              <Scissors size={8} />
              Split
            </span>
          )}
        </span>
      </td>

      {/* Bill To — the ORDERING DEALER (import_raw_summary.billToCustomerName),
          a different party from the ship-to site in the next column. It differs
          from ship-to on 873 of 926 live tint OBDs, which is why both are here. */}
      <td className={TD} title={row.billToName ?? undefined}>
        {row.billToName ?? "—"}
      </td>

      {/* Ship To — the site. Floor's dealer-name treatment, ★/⚡ inline-styled
          to Floor's exact amber/red. */}
      <td className={TD} title={row.siteName}>
        <span className="text-[11.5px] font-medium text-[#111827]">{row.siteName}</span>
        {row.isKeyCustomer && <span className="ml-1.5" style={{ color: "#f59e0b" }} title="Key customer">★</span>}
        {row.isUrgent && <span className="ml-1" style={{ color: "#ef4444" }} title="Urgent">⚡</span>}
        {row.skipCount > 0 && (
          <span
            className="ml-1.5 rounded-[3px] px-[5px] py-px text-[9.5px] font-bold bg-[#f3f4f6] text-[#6b7280]"
            title={`Skipped ${row.skipCount}×`}
          >
            ↩{row.skipCount}
          </span>
        )}
      </td>

      <td className={TD}>{row.route ?? "—"}</td>
      <td className={cn(TD, "text-right tabular-nums")}>{row.volumeLitres ?? 0}</td>
      {/* NULL articleTag means UNKNOWN, never zero — only ~40% of live tint OBDs
          carry one at all, so an em dash is the honest render. */}
      <td className={cn(TD, "text-[10.5px]")} title={row.articleTag ?? undefined}>
        <span className="text-[#6b7280]">{row.articleTag ?? "—"}</span>
      </td>

      <td className={TD}>
        <StatusPill status={row.status} at={row.statusAt} pauseCount={row.pauseCount} />
      </td>
    </tr>
  );
}
