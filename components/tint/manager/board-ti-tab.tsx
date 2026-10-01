"use client";

// Tint Manager — the TI tab (2026-10-01, tabs build step 5 — plan §A, mockup
// docs/mockups/tint-manager/tint-manager-tabs-mockup.html "TI").
//
// The bills a "Base — No Tint" bypass sent out that still owe their Tinter
// Issue (GET /api/tint/manager/base-pending, CLAUDE_TINT §1.12). This list and
// its line drill used to live in the rail, under the assignment queue
// (board-rail.tsx); they MOVED here — the rail is now only "Needs assignment".
// Nothing about the data or the actions changed:
//   - "Enter TI" opens the bill's lines (the old rail drilldown, now inside
//     this pane); picking a line shows the page's BaseTiPanel beside them;
//   - "Undo" is the page's onUndoBase (POST /api/tint/manager/base-bypass/undo),
//     server-guarded, so the button is always offered and the route explains a
//     refusal.
// The table follows the board table's Floor-copied typography (board-table.tsx)
// and the fixed-layout rule (CLAUDE_UI §27).

import { ChevronLeft, Loader2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import { istDateTime } from "./board-bits";
import type { BasePendingLine, BasePendingOrder } from "./types";

// Same four class strings as board-table.tsx (themselves Floor's floor-table.tsx).
const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD      = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b border-[#f0f0f0] text-[#4b5563]";

// OBD · Ship to · Bill to · Sent · TI · actions = 100. (The mockup's Vol
// column is left out: base-pending carries no bill volume — see step 5 notes.)
const COLS = ["13%", "26%", "22%", "14%", "9%", "16%"] as const;

export function BoardTiTab({
  pending,
  drill,
  lineId,
  panel,
  undoBusyId,
  onOpen,
  onBack,
  onPickLine,
  onUndo,
}: {
  pending:    BasePendingOrder[];
  /** The bill whose lines are open, or null for the list. */
  drill:      BasePendingOrder | null;
  /** The line whose TI form is open, so its row is marked. */
  lineId:     number | null;
  /** The page's BaseTiPanel for the open line, or null when none is picked. */
  panel:      ReactNode;
  undoBusyId: number | null;
  onOpen:     (order: BasePendingOrder) => void;
  onBack:     () => void;
  onPickLine: (line: BasePendingLine) => void;
  onUndo:     (order: BasePendingOrder) => void;
}) {
  // ── Drilldown: one bypassed bill's tinting lines + the TI form ────────────
  // The manager is paying off one bill's paperwork now; the list steps aside.
  if (drill) {
    return (
      <div className="flex-1 flex overflow-hidden bg-white">
        <div className="w-[300px] flex-shrink-0 border-r border-gray-200 flex flex-col overflow-hidden">
          <div className="px-3.5 py-3 border-b border-gray-100">
            <button
              type="button"
              onClick={onBack}
              className="text-[10.5px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-0.5 mb-1.5"
            >
              <ChevronLeft size={12} /> Back to TI list
            </button>
            <p className="text-[12px] font-bold text-gray-900 truncate">{drill.siteName}</p>
            <p className="text-[10.5px] text-gray-400 mt-0.5 flex items-center gap-1 flex-wrap">
              <ObdCode code={drill.obdNumber} />
              <span>·</span>
              <span>{drill.coveredLines} of {drill.totalTintingLines} done</span>
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {drill.lines.map((l) => {
              const isOpen = l.rawLineItemId === lineId;
              return (
                <button
                  key={l.rawLineItemId}
                  type="button"
                  onClick={() => onPickLine(l)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors",
                    // Selected treatment copied from the operator screen's line
                    // cards (CLAUDE_UI.md §34) so the two read the same.
                    isOpen ? "bg-gray-100 border-l-[3px] border-l-gray-900" : "bg-white hover:bg-gray-50",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[11px] text-gray-500 truncate">{l.skuCodeRaw}</span>
                    {l.hasTiEntry ? (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 border border-green-200 text-green-700 flex-shrink-0">✓</span>
                    ) : (
                      <span className="text-[9px] font-semibold text-amber-700 flex-shrink-0">Pending</span>
                    )}
                  </div>
                  <div className="text-[12px] font-semibold text-gray-900 truncate mt-0.5">
                    {l.skuDescriptionRaw ?? "—"}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {l.unitQty} qty{l.packCode ? ` · ${l.packCode}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        {panel ?? (
          <div className="flex-1 flex items-center justify-center text-[11.5px] text-gray-400">
            Pick a line to record its Tinter Issue.
          </div>
        )}
      </div>
    );
  }

  // ── The list ──────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="px-3.5 py-2.5 text-[10.5px] text-gray-400 border-b border-gray-100">
        {pending.length} {pending.length === 1 ? "bill" : "bills"} sent as &quot;Base — No Tint&quot; that still owe a TI
      </div>
      <div className="flex-1 overflow-y-auto">
        {pending.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11.5px] text-gray-400">
            <div className="text-[26px] text-green-600 mb-2">✓</div>
            <b className="text-gray-600">No TI owed</b>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              {COLS.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>OBD</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Ship To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Bill To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Sent</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>TI</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")} />
              </tr>
            </thead>
            <tbody>
              {pending.map((o) => (
                <tr key={o.tintAssignmentId} className="hover:bg-gray-50">
                  <td className={TD}><ObdCode code={o.obdNumber} /></td>
                  <td className={TD} title={o.siteName}>
                    <span className="text-[11.5px] font-medium text-[#111827]">{o.siteName}</span>
                  </td>
                  <td className={TD} title={o.billToName ?? undefined}>
                    <span className="text-[#9ca3af]">{o.billToName ?? "—"}</span>
                  </td>
                  <td className={cn(TD, "text-[#9ca3af]")}>{istDateTime(o.bypassedAt)}</td>
                  <td className={TD}>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                      TI {o.coveredLines}/{o.totalTintingLines}
                    </span>
                  </td>
                  <td className={cn(TD, "text-right")}>
                    <span className="inline-flex items-center gap-1.5">
                      {/* Enter TI is this tab's job, so it is the row's one
                          filled button (CLAUDE_UI §10). */}
                      <button
                        type="button"
                        onClick={() => onOpen(o)}
                        className="rounded-md bg-brand-600 hover:bg-brand-700 text-white px-2 py-1 text-[10.5px] font-semibold transition-colors"
                      >
                        Enter TI
                      </button>
                      {/* Undo is a quiet ghost, never a primary; disabled is grey
                          (CLAUDE_UI §10). */}
                      <button
                        type="button"
                        disabled={undoBusyId === o.orderId}
                        onClick={() => onUndo(o)}
                        title="Put this bill back on the tint rail. Only possible while no TI has been recorded and nobody has picked it."
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent transition-colors"
                      >
                        {undoBusyId === o.orderId ? <Loader2 size={10} className="animate-spin" /> : <Undo2 size={10} />}
                        Undo
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
