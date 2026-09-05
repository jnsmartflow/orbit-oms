"use client";

// Tint Manager — the one upgraded detail panel (mockup §panel). 480px slide-in,
// three tabs (Items / Details / Activity), Prev/Next stepping through the whole
// queue — rail cards first, then table rows — without closing.
//
// It supersedes BOTH of the old panels: components/shared/order-detail-panel.tsx
// (whose only live importer was the Kanban) and the local SplitDetailSheet that
// lived inside tint-manager-content.tsx. Neither file is deleted — CORE §3 —
// order-detail-panel.tsx simply loses its last import.
//
// Everything it renders comes from data the board already holds. No fetch of its
// own except OrderAuditHistory's, which owns its own loading.

import { useState } from "react";
import { AlertCircle, History, Loader2, Pause, Scissors, SkipForward, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import { OrderAuditHistory } from "@/components/shared/order-audit-history";
import { humaniseReason } from "@/lib/tint/pause-reasons";
import { OperatorAvatar, OperatorMenu, StatusPill, hhmm, istDateTime } from "./board-bits";
import type { BoardRow, Operator, TintOrder } from "./types";

export type PanelTarget =
  | { kind: "pending"; order: TintOrder }
  | { kind: "row"; row: BoardRow };

type Tab = "items" | "details" | "activity";

export function BoardDetailPanel({
  target, operators, position, busy, error,
  onClose, onPrev, onNext,
  onAssign, onReassignOrder, onReassignSplit,
  onRemove, onResolveMissing, onOpenPauseHistory, onOpenSkipHistory,
  canRemove,
}: {
  target:    PanelTarget;
  operators: Operator[];
  /** "Job 3 of 12" — index and total across the whole walk. */
  position:  { index: number; total: number };
  busy:      boolean;
  /** Server message from a rejected assign/re-assign, shown verbatim. */
  error:     string | null;
  onClose:   () => void;
  onPrev:    () => void;
  onNext:    () => void;
  onAssign:            (order: TintOrder, operatorId: number) => void;
  onReassignOrder:     (row: BoardRow, operatorId: number) => void;
  onReassignSplit:     (row: BoardRow, operatorId: number) => void;
  onRemove:            (order: TintOrder) => void;
  onResolveMissing:    (order: TintOrder) => void;
  onOpenPauseHistory:  (orderId: number, obdNumber: string, siteName: string) => void;
  onOpenSkipHistory:   (orderId: number, obdNumber: string, siteName: string) => void;
  canRemove: boolean;
}) {
  const [tab, setTab] = useState<Tab>("items");
  const [menuOpen, setMenuOpen] = useState(false);

  const isPending = target.kind === "pending";
  const order     = isPending ? target.order : target.row.order;
  const row       = target.kind === "row" ? target.row : null;

  const obdNumber = isPending ? target.order.obdNumber : target.row.obdNumber;
  const siteName  = isPending
    ? (target.order.customer?.customerName ?? target.order.shipToCustomerName ?? "—")
    : target.row.siteName;
  const route     = isPending ? target.order.route : target.row.route;
  const volume    = isPending ? target.order.querySnapshot?.totalVolume ?? null : target.row.volumeLitres;
  const article   = isPending ? (target.order.articleTag ?? target.order.querySnapshot?.articleTag ?? null) : target.row.articleTag;
  const soNumber  = isPending ? target.order.soNumber : target.row.soNumber;
  const orderId   = isPending ? target.order.id : target.row.orderId;

  // Line items: whole orders carry them on the board payload; a split carries
  // its OWN allocation, which is the honest thing to show on a split row.
  const lines: Array<{ code: string; desc: string | null; qty: number }> =
    row?.type === "split" && row.split
      ? row.split.lineItems.map((li) => ({
          code: li.rawLineItem.skuCodeRaw,
          desc: li.rawLineItem.skuDescriptionRaw,
          qty:  li.assignedQty,
        }))
      : (order?.lineItems ?? []).map((li) => ({
          code: li.skuCodeRaw,
          desc: li.skuDescriptionRaw,
          qty:  li.unitQty,
        }));

  // ── Action row ────────────────────────────────────────────────────────────
  // Exactly one primary per state, and only where the server will accept it.
  function renderActions() {
    if (isPending) {
      return (
        <div className="flex gap-2 relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMenuOpen((v) => !v)}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-[7px] text-[11.5px] font-semibold px-3 py-2 inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Assign operator
          </button>
          {canRemove && (
            <button
              type="button"
              onClick={() => onRemove(target.order)}
              className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-[7px] text-[11.5px] font-semibold px-3 py-2 inline-flex items-center gap-1.5"
            >
              <Trash2 size={12} className="text-gray-400" />
              Remove OBD
            </button>
          )}
          {menuOpen && (
            <OperatorMenu
              className="top-[calc(100%+4px)] left-0"
              operators={operators}
              onClose={() => setMenuOpen(false)}
              onPick={(opId) => { setMenuOpen(false); onAssign(target.order, opId); }}
            />
          )}
        </div>
      );
    }

    if (!row) return null;

    if (row.status === "assigned") {
      return (
        <div className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMenuOpen((v) => !v)}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-[7px] text-[11.5px] font-semibold px-3 py-2 inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            Re-assign operator
          </button>
          {menuOpen && (
            <OperatorMenu
              className="top-[calc(100%+4px)] left-0"
              label="Move to"
              operators={operators}
              currentId={row.operatorId}
              onClose={() => setMenuOpen(false)}
              onPick={(opId) => {
                setMenuOpen(false);
                if (row.type === "split") onReassignSplit(row, opId);
                else onReassignOrder(row, opId);
              }}
            />
          )}
        </div>
      );
    }

    // Locked states. The server enforces these too — assign/route.ts returns a
    // 400 outside pending_tint_assignment / tint_assigned — so this is the
    // affordance, not the rule.
    const lockLabel =
      row.status === "paused"       ? "Locked while paused"
      : row.status === "tinting_done" ? "Completed"
      : "Locked — tinting in progress";
    const lockHint =
      row.status === "paused"
        ? "A paused job belongs to its operator until they resume or finish it."
        : row.status === "tinting_done"
        ? "A finished job cannot be moved."
        : "The operator has already started. Moving it now would orphan their elapsed time and progress.";
    return (
      <button
        type="button"
        disabled
        title={lockHint}
        className="bg-gray-100 border border-gray-200 text-gray-400 rounded-[7px] text-[11.5px] font-semibold px-3 py-2 cursor-not-allowed"
      >
        {lockLabel}
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/25 z-[49]" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-[480px] bg-white shadow-[-8px_0_30px_rgba(0,0,0,.12)] z-[50] flex flex-col">

        {/* Header */}
        <div className="px-[18px] pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-gray-500"><ObdCode code={obdNumber} /></span>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-[16px] leading-none">
              <X size={16} />
            </button>
          </div>
          <p className="text-[15px] font-bold text-gray-900 mb-1">{siteName}</p>
          <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
            {route && <span>{route}</span>}
            {volume != null && <><span>·</span><span>{volume} L</span></>}
            {article && <><span>·</span><span>{article}</span></>}
            {row?.type === "split" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-[1px] rounded border bg-violet-50 text-violet-700 border-violet-200">
                <Scissors size={8} /> Split #{row.splitNumber}
              </span>
            )}
            {(isPending ? target.order.priorityLevel <= 2 : row!.isUrgent) && <span title="Urgent">⚡ Urgent</span>}
            {(isPending ? target.order.isKeyCustomer : row!.isKeyCustomer) && <span title="Key customer">★ Key customer</span>}
            {row && <StatusPill status={row.status} at={row.statusAt} pauseCount={row.pauseCount} />}
          </div>
          {isPending && target.order.customerMissing && (
            <button
              type="button"
              onClick={() => onResolveMissing(target.order)}
              className="mt-2 w-full text-left flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 text-[11px] text-amber-800 hover:bg-amber-100 transition-colors"
            >
              <AlertCircle size={13} className="flex-shrink-0 mt-[1px]" />
              <span>Customer master data is missing. Resolve it before assigning — click to open.</span>
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="px-[18px] py-3 border-b border-gray-100">
          {renderActions()}
          {error && (
            <p className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
              {error}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-[18px] border-b border-gray-100">
          {(["items", "details", "activity"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "text-[11.5px] font-semibold px-2 py-[9px] border-b-2 transition-colors capitalize",
                tab === t ? "text-gray-900 border-teal-600" : "text-gray-500 border-transparent hover:text-gray-700",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-[18px] py-3.5 text-[12px] text-gray-600">
          {tab === "items" && (
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr>
                  {["SKU", "Description", "Qty"].map((h) => (
                    <th key={h} className="text-left text-[9.5px] uppercase text-gray-400 font-semibold py-1.5 px-1 border-b border-gray-100">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={3} className="py-4 text-center text-gray-400">No line items on this payload.</td></tr>
                )}
                {lines.map((li, i) => (
                  <tr key={i}>
                    <td className="py-2 px-1 border-b border-gray-50 font-mono text-gray-700">{li.code}</td>
                    <td className="py-2 px-1 border-b border-gray-50 text-gray-700">{li.desc ?? "—"}</td>
                    <td className="py-2 px-1 border-b border-gray-50 text-gray-700">{li.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "details" && (
            <>
              <p className="text-[10px] uppercase tracking-[.05em] text-gray-400 font-semibold mb-2">Reference</p>
              <dl className="grid grid-cols-2 gap-y-2.5 gap-x-4 mb-4">
                <Field label="Site"    value={siteName} />
                <Field label="SO No."  value={soNumber ?? "—"} mono />
                <Field label="Route"   value={route ?? "—"} />
                <Field label="Volume"  value={volume != null ? `${volume} L` : "—"} />
                <Field label="Articles" value={article ?? "—"} />
                <Field label="SMU"     value={(isPending ? target.order.smu : row?.order?.smu ?? row?.split?.smu) ?? "—"} />
                <Field label="OBD date" value={istDateTime(isPending ? target.order.orderDateTime : (row?.order?.orderDateTime ?? row?.split?.orderDateTime ?? null))} />
                <Field label="Delivery" value={(isPending ? target.order.deliveryTypeName : row?.order?.deliveryTypeName ?? row?.split?.deliveryTypeName) ?? "—"} />
              </dl>
              <p className="text-[10px] uppercase tracking-[.05em] text-gray-400 font-semibold mb-2">Audit history</p>
              <OrderAuditHistory orderId={orderId} isOpen />
            </>
          )}

          {tab === "activity" && (
            <>
              <p className="text-[10px] uppercase tracking-[.05em] text-gray-400 font-semibold mb-2">Tint activity</p>

              {row ? (
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3">
                  <OperatorAvatar name={row.operatorName} done={row.status === "tinting_done"} size={28} />
                  <span className="text-[12px] font-semibold text-gray-900 flex-1 truncate">{row.operatorName}</span>
                  <span className="text-[11px] text-gray-400">{hhmm(row.statusAt)}</span>
                </div>
              ) : (
                <p className="text-[11.5px] text-gray-400 mb-3">Not assigned yet — no tint activity.</p>
              )}

              {/* Pause / skip are READ-ONLY here. Tint Manager never triggers
                  pause, resume or skip — those live on the operator's own
                  screen (/api/tint/operator/*, which asserts ownership).
                  This board only ever SEES the state. */}
              {order?.pauseSummary && order.pauseSummary.count > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 mb-2">
                  <p className="text-[10.5px] font-semibold text-amber-800">
                    Paused {order.pauseSummary.count}× · last {istDateTime(order.pauseSummary.lastPausedAt)}
                  </p>
                  <p className="text-[10.5px] text-amber-700">
                    {order.pauseSummary.lastPausedBy} · {humaniseReason(order.pauseSummary.lastReason)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenPauseHistory(orderId, obdNumber, siteName)}
                    className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-amber-800 underline hover:text-amber-900"
                  >
                    <Pause size={9} /> View full pause history →
                  </button>
                </div>
              )}

              {order?.skipSummary && order.skipSummary.count > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-md px-2.5 py-2 mb-2">
                  <p className="text-[10.5px] font-semibold text-gray-700">
                    Skipped {order.skipSummary.count}× · last {istDateTime(order.skipSummary.lastSkippedAt)}
                  </p>
                  <p className="text-[10.5px] text-gray-500">
                    {order.skipSummary.lastSkippedBy} · {order.skipSummary.lastReason}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenSkipHistory(orderId, obdNumber, siteName)}
                    className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-gray-600 underline hover:text-gray-900"
                  >
                    <SkipForward size={9} /> View full skip history →
                  </button>
                </div>
              )}

              {!order?.pauseSummary?.count && !order?.skipSummary?.count && (
                <p className="text-[11.5px] text-gray-400 inline-flex items-center gap-1.5">
                  <History size={11} /> No pauses or skips on this job.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer — Prev/Next walks rail cards then table rows, without closing */}
        <div className="flex items-center justify-between px-[18px] py-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onPrev}
            disabled={position.index <= 0}
            className="bg-white border border-gray-200 text-gray-600 text-[11.5px] font-semibold px-3 py-[7px] rounded-[7px] hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-[11px] text-gray-400">
            Job {position.index + 1} of {position.total}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={position.index >= position.total - 1}
            className="bg-white border border-gray-200 text-gray-600 text-[11.5px] font-semibold px-3 py-[7px] rounded-[7px] hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </aside>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[9.5px] uppercase tracking-wider text-gray-400 mb-0.5">{label}</dt>
      <dd className={cn("text-[11.5px] text-gray-700", mono && "font-mono")}>{value}</dd>
    </div>
  );
}
