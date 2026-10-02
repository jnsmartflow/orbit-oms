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
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import { InvoiceLines, ObdDateLine } from "@/components/floor/bill-ref-cells";
import { formatSmu } from "./board-bits";
import type { BasePendingLine, BasePendingOrder } from "./types";

// Same four class strings as board-table.tsx (themselves Floor's floor-table.tsx).
const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD      = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b border-[#f0f0f0] text-[#4b5563]";

// 2026-10-02 (owner): the Tint / Base table's columns, then the TI ones —
// OBD 11 · Invoice 9 · SMU 4 · Bill to 13 · Ship to 17 · Route 8 · Vol 5 · Art. 8 ·
// Lines 12 · TI 8 · ⋯ 5 = 100.
const COLS = ["11%", "9%", "4%", "13%", "17%", "8%", "5%", "8%", "12%", "8%", "5%"] as const;

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
  selected,
  onToggle,
  barUp,
  history = false,
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
  /** Selected bills, by tintAssignmentId (2026-10-02 bulk TI). */
  selected:   Set<number>;
  onToggle:   (order: BasePendingOrder) => void;
  /** The bottom bar is up — pad the list so its last row clears the bar. */
  barUp:      boolean;
  /** History (2026-10-02): the rows are bills with TI WRITTEN on that day —
   *  read-only (no selection, no ⋯); Lines shows the sampling numbers used and
   *  the TI column who wrote it, when. */
  history?:   boolean;
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
  // Bulk TI (2026-10-02, owner): the Tint / Base table's columns and cells, then
  // the TI-specific Lines · TI · ⋯. A row click SELECTS (the page's fifth
  // disjoint selection) — the bottom bar then offers WHT 5 / 20 / 25, + New shade
  // and ↶ Undo Base. Enter TI and Undo moved into the row ⋯ menu, unchanged.
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="px-3.5 py-2.5 text-[10.5px] text-gray-400 border-b border-gray-100">
        {history
          ? <>{pending.length} &quot;Base — No Tint&quot; {pending.length === 1 ? "bill" : "bills"} with a TI written that day · read only</>
          : <>{pending.length} {pending.length === 1 ? "bill" : "bills"} sent as &quot;Base — No Tint&quot; that still owe a TI · click to select</>}
      </div>
      <div className={cn("flex-1 overflow-y-auto", barUp && "pb-[96px]")}>
        {pending.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11.5px] text-gray-400">
            <div className="text-[26px] text-green-600 mb-2">✓</div>
            <b className="text-gray-600">{history ? "No TI written that day" : "No TI owed"}</b>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              {COLS.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>OBD</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Invoice</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>SMU</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Bill To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Ship To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Route</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10 text-right")}>Vol</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Art.</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Lines</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>TI</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")} />
              </tr>
            </thead>
            <tbody>
              {pending.map((o) => {
                const sel = selected.has(o.tintAssignmentId);
                const owed = owedLines(o);
                return (
                  <tr
                    key={o.tintAssignmentId}
                    data-search-key={`ti-${o.tintAssignmentId}`}
                    onClick={history ? undefined : () => onToggle(o)}
                    aria-selected={history ? undefined : sel}
                    className={cn(
                      history ? "cursor-default" : "cursor-pointer",
                      sel ? "bg-brand-50 [&>td:first-child]:shadow-[inset_3px_0_0_theme(colors.brand.600)]" : "hover:bg-gray-50",
                    )}
                  >
                    <td className={TD}>
                      <ObdCode code={o.obdNumber} />
                      {/* Floor's date line — the shared bill-ref cell. */}
                      <ObdDateLine iso={o.obdDateTime} isEmailTime={o.isEmailTime} />
                    </td>
                    <td className={TD}>
                      <InvoiceLines invoiceNo={o.invoiceNo} invoiceDate={o.invoiceDate} />
                    </td>
                    <td className={cn(TD, "tabular-nums")} title={o.smu ?? undefined}>
                      {o.smuCode ?? formatSmu(o.smu) ?? "—"}
                    </td>
                    <td className={TD} title={o.billToName ?? undefined}>
                      <span className="text-[11.5px] font-medium text-[#111827]">{o.billToName ?? "—"}</span>
                    </td>
                    <td className={TD} title={o.originalSiteName ? `${o.originalSiteName} → ship to ${o.shipToName}` : o.shipToName}>
                      <span className="text-[11.5px] font-medium text-[#111827]">{o.shipToName}</span>
                      {/* Floor's ORIGINAL → REDIRECT pair (CLAUDE_FLOOR §4.9). TI itself
                          stays on the original site (plan decision 12). */}
                      {o.originalSiteName && (
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-brand-800">
                          {o.originalSiteName}<span className="mx-1 opacity-60">→</span><b className="font-semibold">{o.shipToName}</b>
                        </div>
                      )}
                    </td>
                    <td className={TD}>{o.route ?? "—"}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{o.totalVolume ?? "—"}</td>
                    {/* NULL articleTag means UNKNOWN, never zero (as the Tint table). */}
                    <td className={cn(TD, "text-[10.5px]")} title={o.articleTag ?? undefined}>
                      <span className="text-[#6b7280]">{o.articleTag ?? "—"}</span>
                    </td>
                    {history ? (
                      <td className={cn(TD, "font-mono text-[11px] text-[#4b5563]")} title={(o.tiSamplingNos ?? []).join(" · ")}>
                        {(o.tiSamplingNos ?? []).join(" · ") || "—"}
                      </td>
                    ) : (
                      <td className={cn(TD, "text-[11px] text-[#4b5563]")} title={packList(owed.map((l) => l.packCode))}>
                        {packList(owed.map((l) => l.packCode)) || "—"}
                      </td>
                    )}
                    <td className={TD} title={history && o.tiWrittenBy ? `TI by ${o.tiWrittenBy}` : undefined}>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                        TI {o.coveredLines}/{o.totalTintingLines}
                      </span>
                      {history && (
                        <div className="mt-0.5 truncate text-[10px] text-[#9ca3af]">
                          {o.tiWrittenBy ?? "—"} · {o.tiWrittenAt ? new Date(o.tiWrittenAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : "—"}
                        </div>
                      )}
                    </td>
                    <td className={cn(TD, "px-1 text-center overflow-visible")} onClick={(e) => e.stopPropagation()}>
                      {!history && (
                        <RowMenu
                          busy={undoBusyId === o.orderId}
                          onEnter={() => onOpen(o)}
                          onUndo={() => onUndo(o)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** The lines this bill still owes (no TI row on this assignment yet). */
export function owedLines(o: BasePendingOrder): BasePendingLine[] {
  return o.lines.filter((l) => !l.hasTiEntry);
}

/** "20 L ×3 · 1 L" — the per-tin packs of a set of lines, counted, in first-seen
 *  order. Unknown packs read "?". Shared by the Lines column, the bar and the
 *  bulk confirm. */
export function packList(packs: Array<string | null>): string {
  const counts = new Map<string, number>();
  for (const p of packs) {
    const k = p ?? "?";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([p, n]) => (n > 1 ? `${p} ×${n}` : p)).join(" · ");
}

/** The row ⋯ — Enter TI (today's per-line screen) and ↶ Undo Base, unchanged. */
function RowMenu({ busy, onEnter, onUndo }: { busy: boolean; onEnter: () => void; onUndo: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Enter TI by hand / Undo Base"
        className="rounded-md px-1 text-[15px] leading-5 tracking-[1px] text-ink-400 hover:bg-ink-50 hover:text-ink-900"
      >
        {busy ? <Loader2 size={12} className="inline animate-spin" /> : "⋯"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-[210px] overflow-hidden rounded-[8px] border border-gray-200 bg-white text-left shadow-lg">
            <button
              type="button"
              onClick={() => { setOpen(false); onEnter(); }}
              className="block w-full px-3 py-2 text-left text-[11.5px] text-gray-700 hover:bg-gray-50"
            >
              Enter TI
              <span className="block text-[10.5px] text-gray-400">Line by line, today&apos;s screen</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setOpen(false); onUndo(); }}
              title="Put this bill back on the tint rail. Only possible while no TI has been recorded and nobody has picked it."
              className="flex w-full items-start gap-1.5 px-3 py-2 text-left text-[11.5px] text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              <Undo2 size={12} className="mt-[2px]" />
              <span>
                Undo Base
                <span className="block text-[10.5px] text-gray-400">Back to the Needs-assignment rail</span>
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
