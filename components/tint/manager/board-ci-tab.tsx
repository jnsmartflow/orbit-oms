"use client";

// Tint Manager — the CI tab (2026-10-01, tabs build step 7 — plan §A, mockup
// "ci"). Today's cancelled and CI'd TINT bills, from GET
// /api/tint/manager/cancelled (Floor's Cancel & CI feed, tint bills only).
//
// ↺ Restore per row (tint_cancel) → POST /api/tint/manager/restore — the shared
// restore: a tint bill that never finished tinting goes back to the tint rail,
// one that had finished goes to Floor (owner 2026-10-01, plan §J-1). The page
// says which, from the route's answer. A row carrying a live CI (it has a CI
// number — the feed reads only non-voided, non-draft CIs) shows "CI live"
// instead: its return is on billing's desk, and the route refuses it anyway.
//
// BASE BILLS (2026-10-01, Base tab 4B — owner §I-3): a Base bill's CI shows here
// too. Restore stays TINT-ONLY — a Base row never draws the button (the restore
// route refuses it anyway): "CI live" when it carries a live CI, else nothing (a
// Base bill Floor cancelled without a CI is restored from Floor).
//
// Not selectable: the tab's only job is per-row Restore, so there is nothing for
// the bottom bar to do here. Fixed table (CLAUDE_UI §27), board typography.

import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import type { FloorCancelledRow } from "@/lib/floor/types";

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD      = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b border-[#f0f0f0] text-[#4b5563]";

// OBD 11 · Bill to 16 · Ship to 17 · Reason 14 · CI No. 11 · Source 7 · By 8 ·
// When 7 · action 9 = 100.
const COLS = ["11%", "16%", "17%", "14%", "11%", "7%", "8%", "7%", "9%"] as const;

function hhmmIst(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

export function BoardCiTab({
  rows,
  error,
  canRestore,
  restoringId,
  onRestore,
}: {
  /** null while loading. */
  rows:        FloorCancelledRow[] | null;
  error:       string | null;
  /** tint_manager canEdit && tint_cancel canEdit. Without it, no Restore button. */
  canRestore:  boolean;
  restoringId: number | null;
  onRestore:   (row: FloorCancelledRow) => void;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="px-3.5 py-2.5 text-[10.5px] text-gray-400 border-b border-gray-100">
        Tint and Base bills cancelled or returned today · Restore (tint bills only) sends a bill that never finished tinting back to the tint rail
      </div>
      {error && <div className="px-3.5 py-2 text-[11px] text-danger-text bg-danger-bg border-b border-danger-bd">{error}</div>}
      <div className="flex-1 overflow-y-auto">
        {rows === null ? (
          <div className="px-4 py-10 text-center text-[11.5px] text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11.5px] text-gray-400">Nothing cancelled today</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>OBD</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Bill To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Ship To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Reason</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>CI No.</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Source</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>By</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>When</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ciLive = r.ciNumber !== null;
                return (
                  <tr key={r.orderId} data-search-key={`ci-${r.orderId}`} className="hover:bg-gray-50">
                    <td className={TD}><ObdCode code={r.obdNumber} /></td>
                    <td className={TD} title={r.billToName ?? undefined}>
                      <span className="text-[11.5px] font-medium text-[#111827]">{r.billToName ?? "—"}</span>
                    </td>
                    <td className={TD} title={r.dealerName}>
                      <span className="text-[11.5px] font-medium text-[#111827]">{r.dealerName}</span>
                    </td>
                    <td className={TD} title={r.remark ? `${r.reason ?? ""} · ${r.remark}` : r.reason ?? undefined}>
                      {r.reason ?? "—"}
                      {r.remark && <span className="text-[#9ca3af]"> · {r.remark}</span>}
                    </td>
                    <td className={cn(TD, "font-mono")}>
                      {r.ciNumber ?? <span className="font-sans text-[#9ca3af]">— no CI</span>}
                    </td>
                    <td className={TD}>
                      {r.ciSourceLabel ? (
                        <span className="rounded-[4px] bg-ink-50 px-1.5 py-[2px] text-[10px] font-semibold text-ink-700">{r.ciSourceLabel}</span>
                      ) : (
                        <span className="rounded-[4px] bg-gray-100 px-1.5 py-[2px] text-[10px] font-semibold text-gray-500">Cancel</span>
                      )}
                    </td>
                    <td className={cn(TD, "text-[#9ca3af]")}>{r.byName ?? "—"}</td>
                    <td className={cn(TD, "text-[#9ca3af] tabular-nums")}>{hhmmIst(r.at)}</td>
                    <td className={cn(TD, "text-right")}>
                      {ciLive ? (
                        <span className="text-[10.5px] text-[#9ca3af]" title="The return is on billing's desk — it can't be restored here">CI live</span>
                      ) : canRestore && r.isTint ? (
                        <button
                          type="button"
                          disabled={restoringId !== null}
                          onClick={() => onRestore(r)}
                          className="rounded-md border border-ink-200 bg-white px-2 py-1 text-[10.5px] font-semibold text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                        >
                          {restoringId === r.orderId ? "…" : "↺ Restore"}
                        </button>
                      ) : null}
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
