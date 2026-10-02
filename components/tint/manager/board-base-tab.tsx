"use client";

// Tint Manager — the Base tab (2026-10-01, Base tab 4B —
// docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-base-tab.md §B, §H
// step 5, §I). Every NON-tint bill with SMU 74 Decorative Projects / 77 Retail
// Offtake that FLOOR'S live board shows, from GET /api/tint/manager/base
// (lib/tint/base-feed.ts — Floor's getFloorBoard narrowed, never copied; a trip
// bill only on the IST day it joined that trip, owner decision 8).
//
// Rows ARE Floor's FloorBoardRow, so the Status column is Floor's own pill —
// rowStatus() + <StatusPill> from components/floor/status-pill.tsx, unchanged,
// heldBack={false} always (owner decision 6: "Waiting", never "At desk"). A bill
// on a trip carries its trip number exactly as the feed returns it
// (trips.tripNumber, written by lib/trips/number.ts formatTripNumber — letter
// first, e.g. L-261001-17), in Floor's trip-chip style. The number is printed,
// never re-formatted.
//
// A row click selects it into the BASE selection — the page's fourth disjoint
// selection; the bottom bar's primary is then 🕑 Slot (owner decision 2). ⋯ opens
// the detail panel. Fixed table (CLAUDE_UI §27), the board table's typography.

import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import { StatusPill as FloorStatusPill, rowStatus } from "@/components/floor/status-pill";
import type { DispatchSlotValue, DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import type { FloorBoardRow } from "@/lib/floor/types";
import { BoardSlotCell } from "./board-slot-cell";

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD      = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b border-[#f0f0f0] text-[#4b5563]";

// OBD 11 · SMU 5 · Bill to 15 · Ship to 18 · Route 8 · Slot 11 · Vol 6 · Art. 8 ·
// Status 14 · ⋯ 4 = 100.
const COLS = ["11%", "5%", "15%", "18%", "8%", "11%", "6%", "8%", "14%", "4%"] as const;

/** Floor's trip chip (components/floor/floor-table.tsx), carrying the FULL number. */
const TRIP_CHIP = "rounded-[3px] bg-gray-900 px-[5px] py-px font-mono text-[9.5px] font-semibold text-white";

export function BoardBaseTab({
  rows,
  error,
  selected,
  onToggle,
  onOpen,
  windows,
  canSlot,
  slotBusy,
  onSetSlot,
  barUp,
}: {
  /** null while loading. */
  rows:      FloorBoardRow[] | null;
  error:     string | null;
  selected:  Set<number>;
  onToggle:  (row: FloorBoardRow) => void;
  onOpen:    (row: FloorBoardRow) => void;
  windows:   DispatchWindow[];
  /** tint_manager canEdit && tint_slot canEdit — without it the cell is read-only. */
  canSlot:   boolean;
  slotBusy:  boolean;
  onSetSlot: (row: FloorBoardRow, v: DispatchSlotValue) => void;
  barUp:     boolean;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="px-3.5 py-2.5 text-[10.5px] text-gray-400 border-b border-gray-100">
        {rows === null ? "Loading…" : `${rows.length} ${rows.length === 1 ? "bill" : "bills"}`} · Projects / Retail Offtake bills
        on Floor&apos;s board · click to select · a trip bill shows only on the day it joined the trip
      </div>
      {error && <div className="px-3.5 py-2 text-[11px] text-danger-text bg-danger-bg border-b border-danger-bd">{error}</div>}
      <div className={cn("flex-1 overflow-y-auto", barUp && "pb-[96px]")}>
        {rows !== null && rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11.5px] text-gray-400">No Projects / Retail Offtake bills on the floor</div>
        ) : rows !== null ? (
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>OBD</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>SMU</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Bill To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Ship To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Route</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Slot</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10 text-right")}>Vol</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Art.</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Status</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sel = selected.has(r.orderId);
                // Floor's ORIGINAL → REDIRECT pair (CLAUDE_FLOOR §4.9).
                const redirected = r.isShipToOverride && r.customerName !== null && r.shipToOverrideName !== null;
                return (
                  <tr
                    key={r.orderId}
                    onClick={() => onToggle(r)}
                    aria-selected={sel}
                    className={cn(
                      "cursor-pointer",
                      sel ? "bg-brand-50 [&>td:first-child]:shadow-[inset_3px_0_0_theme(colors.brand.600)]" : "hover:bg-gray-50",
                    )}
                  >
                    <td className={TD}><ObdCode code={r.obdNumber} /></td>
                    <td className={cn(TD, "tabular-nums")} title={r.smu ?? undefined}>{r.smuCode ?? "—"}</td>
                    <td className={TD} title={r.billToName ?? undefined}>
                      <span className="text-[11.5px] font-medium text-[#111827]">{r.billToName ?? "—"}</span>
                    </td>
                    <td className={TD} title={redirected ? `${r.customerName} → ship to ${r.shipToOverrideName}` : r.dealerName}>
                      <span className="text-[11.5px] font-medium text-[#111827]">{r.dealerName}</span>
                      {redirected && (
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-brand-800">
                          {r.customerName}
                          <span className="mx-1 opacity-60">→</span>
                          <b className="font-semibold">{r.shipToOverrideName}</b>
                        </div>
                      )}
                    </td>
                    <td className={TD}>{r.route ?? "—"}</td>
                    <td className={TD}>
                      <BoardSlotCell
                        date={r.dispatchTargetDate}
                        windowId={r.windowId}
                        windowTime={r.windowTime}
                        windows={windows}
                        canSlot={canSlot}
                        disabled={slotBusy}
                        onPick={(v) => onSetSlot(r, v)}
                      />
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")}>{r.volumeLitres ?? 0}</td>
                    {/* NULL articleTag means UNKNOWN, never zero (as the Tinting table). */}
                    <td className={cn(TD, "text-[10.5px]")} title={r.articleTag ?? undefined}>
                      <span className="text-[#6b7280]">{r.articleTag ?? "—"}</span>
                    </td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-1.5">
                        <FloorStatusPill status={rowStatus(r)} heldBack={false} />
                        {r.tripNumber && (
                          <span title={`On trip ${r.tripNumber}`} className={TRIP_CHIP}>{r.tripNumber}</span>
                        )}
                      </span>
                    </td>
                    <td className={cn(TD, "px-1 text-center")} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onOpen(r)}
                        title="Bill details"
                        className="rounded-md px-1 text-[15px] leading-5 tracking-[1px] text-ink-400 hover:bg-ink-50 hover:text-ink-900"
                      >
                        ⋯
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
