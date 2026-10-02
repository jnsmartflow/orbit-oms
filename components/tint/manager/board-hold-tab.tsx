"use client";

// Tint Manager — the Hold tab (2026-10-01, tabs build step 7 — plan §A, mockup
// "hold"). Every held TINT bill, any stage, from GET /api/tint/manager/hold
// (Floor's held set + tint facts).
//
// A row click selects it into the HOLD selection (one of the page's three
// disjoint selections); the bottom bar's primary is then **Release** = unhold
// (owner decision 9): the hold clears, the stage does not move — a waiting bill
// returns to the rail, a mid-tint bill keeps tinting and goes to picking when it
// finishes. NOT Floor's Release-with-a-slot, which refuses every tint stage.
//
// Fixed table (CLAUDE_UI §27), the board table's Floor-copied typography.
// "Held since" is Floor's read-side rule (CLAUDE_FLOOR §4.5): the hold EVENT's
// time, "~" when only the arrival date is known.
//
// BASE BILLS (2026-10-01, Base tab 4B — owner §I-7): held non-tint SMU 74/77
// bills are listed here too (a held bill leaves Floor's board, so this is where
// it is released). Their stage cell is FLOOR'S pill, not a tint stage; Release
// works as for any row (unhold). The bar hides the tint-only items for them.

import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import { heldSinceLabel, holdAgeDays } from "@/lib/floor/hold-log";
import type { DispatchSlotValue, DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import type { TintHoldRow } from "./types";
import { StatusPill } from "./board-bits";
import { StatusPill as FloorStatusPill, rowStatus } from "@/components/floor/status-pill";
import { BoardSlotCell } from "./board-slot-cell";

const HEAD_TH = "h-[31px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD      = "px-3.5 py-2 text-[11px] whitespace-nowrap overflow-hidden text-ellipsis border-b border-[#f0f0f0] text-[#4b5563]";

// OBD 11 · Bill to 15 · Ship to 20 · Route 8 · Slot 11 · Held since 10 · Vol 6 ·
// Tint stage 15 · ⋯ 4 = 100.
const COLS = ["11%", "15%", "20%", "8%", "11%", "10%", "6%", "15%", "4%"] as const;

/** A held BASE bill's Floor pill. The row carries only its stage, so the flags
 *  are derived with the SAME rule getFloorBoard and getOrderDetail use
 *  (lib/floor/queries.ts, lib/floor/order-detail.ts): checked includes
 *  dispatched. Then Floor's own rowStatus decides the pill. */
function FloorStageCell({ stage }: { stage: string }) {
  const status = rowStatus({
    isAssigned:   stage === "pick_assigned",
    isDone:       stage === "pick_done",
    isChecked:    stage === "pick_checked" || stage === "dispatched",
    isDispatched: stage === "dispatched",
  });
  return <FloorStatusPill status={status} heldBack={false} />;
}

/** The tint stage, in the board's own pill where one exists. */
function StageCell({ r }: { r: TintHoldRow }) {
  if (!r.isTint) return <FloorStageCell stage={r.workflowStage} />;
  const first = r.operatorName?.split(" ")[0] ?? null;
  if (r.workflowStage === "pending_tint_assignment") {
    return <span className="rounded-[4px] bg-[#f3f4f6] px-2 py-[2px] text-[10px] font-semibold text-[#6b7280]">Waiting</span>;
  }
  if (r.workflowStage === "tint_assigned" || r.workflowStage === "tinting_in_progress") {
    const status = r.workflowStage === "tint_assigned" ? "assigned"
      : r.assignmentStatus === "paused" ? "paused" : "tinting_in_progress";
    return (
      <span className="inline-flex items-center gap-1.5">
        <StatusPill status={status} at={null} pauseCount={0} />
        {first && <span className="text-[10.5px] text-[#9ca3af]">{first}</span>}
      </span>
    );
  }
  // Finished tinting and parked by the hold (pending_support), or further on.
  return <StatusPill status="tinting_done" at={null} pauseCount={0} />;
}

export function BoardHoldTab({
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
  rows:      TintHoldRow[] | null;
  error:     string | null;
  selected:  Set<number>;
  onToggle:  (row: TintHoldRow) => void;
  onOpen:    (row: TintHoldRow) => void;
  windows:   DispatchWindow[];
  canSlot:   boolean;
  slotBusy:  boolean;
  onSetSlot: (row: TintHoldRow, v: DispatchSlotValue) => void;
  barUp:     boolean;
}) {
  const now = new Date();
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="px-3.5 py-2.5 text-[10.5px] text-gray-400 border-b border-gray-100">
        {rows === null ? "Loading…" : `${rows.length} ${rows.length === 1 ? "bill" : "bills"} on hold`} · click to select ·
        Release: a waiting bill goes back to the rail, a mid-tint bill keeps tinting and goes to picking when done
      </div>
      {error && <div className="px-3.5 py-2 text-[11px] text-danger-text bg-danger-bg border-b border-danger-bd">{error}</div>}
      <div className={cn("flex-1 overflow-y-auto", barUp && "pb-[96px]")}>
        {rows !== null && rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11.5px] text-gray-400">No bills on hold</div>
        ) : rows !== null ? (
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>OBD</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Bill To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Ship To</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Route</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Slot</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Held since</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10 text-right")}>Vol</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")}>Stage</th>
                <th className={cn(HEAD_TH, "sticky top-0 bg-white z-10")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sel = selected.has(r.orderId);
                const days = holdAgeDays(r.heldSince, now);
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
                    <td className={TD} title={r.billToName ?? undefined}>
                      <span className="text-[11.5px] font-medium text-[#111827]">{r.billToName ?? "—"}</span>
                    </td>
                    <td className={TD} title={r.originalSiteName ? `${r.originalSiteName} → ship to ${r.dealerName}` : r.dealerName}>
                      <span className="text-[11.5px] font-medium text-[#111827]">{r.dealerName}</span>
                      {/* Floor's ORIGINAL → REDIRECT pair (CLAUDE_FLOOR §4.9). */}
                      {r.originalSiteName && (
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-brand-800">
                          {r.originalSiteName}
                          <span className="mx-1 opacity-60">→</span>
                          <b className="font-semibold">{r.dealerName}</b>
                        </div>
                      )}
                    </td>
                    <td className={TD}>{r.route ?? "—"}</td>
                    <td className={TD}>
                      <BoardSlotCell
                        date={r.dispatchTargetDate}
                        windowId={r.dispatchWindowId}
                        windowTime={r.dispatchWindowTime}
                        windows={windows}
                        canSlot={canSlot}
                        disabled={slotBusy}
                        onPick={(v) => onSetSlot(r, v)}
                      />
                    </td>
                    <td
                      className={cn(TD, "text-[#9ca3af]")}
                      title={r.heldSinceSource === "approx" ? "Approximate — no hold log; the arrival date is shown" : undefined}
                    >
                      {r.heldSinceSource === "approx" ? "~" : ""}{heldSinceLabel(days)}
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")}>{r.volumeLitres ?? 0}</td>
                    <td className={TD}><StageCell r={r} /></td>
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
