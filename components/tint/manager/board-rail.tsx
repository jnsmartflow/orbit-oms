"use client";

// Tint Manager — the 344px left rail: "Needs assignment". One card per OBD still
// waiting for an operator, oldest first (mockup §rail).
//
// The rail is where Assign happens, and it is the ONLY place Remove OBD is
// offered — matching the live server rule that removal is blocked once a job is
// assigned (/api/tint/manager/orders/[id]/remove returns 409 outside
// pending_tint_assignment).

import { useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Eye, Loader2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import { OperatorMenu, ageDays, istDateTime } from "./board-bits";
import type { BasePendingLine, BasePendingOrder, Operator, TintOrder } from "./types";

export function BoardRail({
  rail, operators, onAssign, onBaseBypass, onRemove, onOpenPanel, onResolveMissing, canRemove,
  basePending, baseDrill, baseLineId, onOpenBase, onBackFromBase, onPickBaseLine,
  onUndoBase, baseUndoBusyId,
}: {
  rail:             TintOrder[];
  operators:        Operator[];
  onAssign:         (order: TintOrder, operatorId: number) => void;
  /**
   * "Base — No Tint": close the bill with no operator and no TI. Offered HERE
   * because every card in this rail is by definition still at
   * `pending_tint_assignment`, which is the only stage the server accepts
   * (/api/tint/manager/base-bypass 400s outside it).
   */
  onBaseBypass:     (order: TintOrder) => void;
  onRemove:         (order: TintOrder) => void;
  onOpenPanel:      (order: TintOrder) => void;
  onResolveMissing: (order: TintOrder) => void;
  canRemove:        boolean;
  // ── Base — No Tint · Tinter Issue pending ────────────────────────────────
  /** Bypassed bills whose TI is still owed. Empty → the section is not drawn. */
  basePending:      BasePendingOrder[];
  /** The bill drilled into. Non-null REPLACES the whole rail with its lines. */
  baseDrill:        BasePendingOrder | null;
  /** The line whose TI form is open on the right, so the rail can mark it. */
  baseLineId:       number | null;
  onOpenBase:       (order: BasePendingOrder) => void;
  onBackFromBase:   () => void;
  onPickBaseLine:   (line: BasePendingLine) => void;
  /** Put a bypassed bill back on the tint rail. Server-guarded — the button is
   *  always offered and the route explains any refusal. */
  onUndoBase:       (order: BasePendingOrder) => void;
  /** orderId with an undo in flight, so its button goes inert. */
  baseUndoBusyId:   number | null;
}) {
  // The open menu carries its TRIGGER ELEMENT, not just an id: OperatorMenu is
  // portalled to document.body and measures its position from that element, so
  // the anchor has to travel with the open-state.
  const [menu, setMenu] = useState<{ orderId: number; anchor: HTMLElement } | null>(null);

  // ── Drilldown: one bypassed bill's tinting lines ──────────────────────────
  // REPLACES the whole rail rather than expanding inside it. The manager is
  // doing one job now — paying off one bill's TI — and leaving the assignment
  // queue visible underneath would invite an assign click mid-task.
  if (baseDrill) {
    return (
      <div className="w-[344px] flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
        <div className="px-3.5 py-3 border-b border-gray-100">
          <button
            type="button"
            onClick={onBackFromBase}
            className="text-[10.5px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-0.5 mb-1.5"
          >
            <ChevronLeft size={12} /> Back to queue
          </button>
          <p className="text-[12px] font-bold text-gray-900 truncate">{baseDrill.siteName}</p>
          <p className="text-[10.5px] text-gray-400 mt-0.5 flex items-center gap-1 flex-wrap">
            <ObdCode code={baseDrill.obdNumber} />
            <span>·</span>
            <span>{baseDrill.coveredLines} of {baseDrill.totalTintingLines} done</span>
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {baseDrill.lines.map((l) => {
            const isOpen = l.rawLineItemId === baseLineId;
            return (
              <button
                key={l.rawLineItemId}
                type="button"
                onClick={() => onPickBaseLine(l)}
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
    );
  }

  return (
    <div className="w-[344px] flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
      <div className="px-3.5 py-3 border-b border-gray-100">
        <p className="text-[12px] font-bold text-gray-900">Needs assignment</p>
        <p className="text-[10.5px] text-gray-400 mt-0.5">
          {rail.length} waiting · oldest first
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {rail.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11.5px] text-gray-400">
            <div className="text-[26px] text-green-600 mb-2">✓</div>
            <b className="text-gray-600">All clear</b>
            <br />
            New OBDs appear here on their own.
          </div>
        ) : (
          rail.map((o) => {
            const age  = ageDays(o.orderDateTime ?? o.obdEmailDate);
            const site = o.customer?.customerName ?? o.shipToCustomerName ?? "—";
            return (
              <div
                key={o.id}
                className="relative border border-gray-200 rounded-[10px] px-[11px] py-2.5 bg-white hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between mb-1.5 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenPanel(o)}
                    className="text-[12.5px] font-bold text-gray-900 text-left leading-snug hover:text-brand-700 truncate"
                  >
                    {site}
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {o.customerMissing && (
                      <button
                        type="button"
                        onClick={() => onResolveMissing(o)}
                        className="text-amber-500 hover:bg-amber-50 rounded p-0.5 transition-colors"
                        title="Customer master data missing — resolve before assigning"
                      >
                        <AlertCircle size={13} />
                      </button>
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => onRemove(o)}
                        className="text-gray-300 hover:text-red-600 transition-colors"
                        title="Remove OBD"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="text-[10.5px] text-gray-500 mb-2 flex items-center gap-1 flex-wrap">
                  <ObdCode code={o.obdNumber} />
                  <span>·</span>
                  <span>{istDateTime(o.orderDateTime)}</span>
                  {o.route && (<><span>·</span><span>{o.route}</span></>)}
                  {o.querySnapshot?.totalVolume != null && (
                    <><span>·</span><span>{o.querySnapshot.totalVolume} L</span></>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mb-2 flex-wrap min-h-[18px]">
                  {o.priorityLevel <= 2 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-[7px] py-[2px] rounded-full border bg-red-50 text-red-700 border-red-200">
                      ⚡ Urgent
                    </span>
                  )}
                  {o.isKeyCustomer && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-[7px] py-[2px] rounded-full border bg-amber-50 text-amber-700 border-amber-200" title="Key customer">
                      ★ Key
                    </span>
                  )}
                  {age !== null && (
                    <span className={cn(
                      "text-[9px] font-semibold px-1.5 py-0.5 rounded border",
                      age === 1 ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-red-50 text-red-700 border-red-200",
                    )}>
                      {age}d
                    </span>
                  )}
                  {o.manualTintEntry && (
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border bg-tint-bg text-tint-700 border-tint-bd" title="Manually pulled into tint">
                      Manual
                    </span>
                  )}
                </div>

                {/* No `relative` here any more: the menu is portalled to
                    document.body, so it needs no positioned ancestor — and a
                    positioned ancestor could not have helped anyway, since the
                    rail's overflow is what was clipping it. */}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={(e) =>
                      setMenu(menu?.orderId === o.id ? null : { orderId: o.id, anchor: e.currentTarget })
                    }
                    className="flex-1 border border-brand-200 bg-white hover:bg-brand-50 text-brand-700 rounded-[7px] text-[11px] font-bold py-2 transition-colors"
                  >
                    Assign ▾
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPanel(o)}
                    className="border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 rounded-[7px] px-2.5 transition-colors"
                    title="View details"
                  >
                    <Eye size={13} />
                  </button>

                  {menu?.orderId === o.id && (
                    <OperatorMenu
                      anchor={menu.anchor}
                      operators={operators}
                      onClose={() => setMenu(null)}
                      onPick={(opId) => { setMenu(null); onAssign(o, opId); }}
                      extraAction={{
                        label: "Base — No Tint",
                        hint:  "No tinting needed — close this bill without an operator",
                        onPick: () => { setMenu(null); onBaseBypass(o); },
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* ── Tinter Issue pending ────────────────────────────────────────────
            Bills a Base — No Tint bypass sent out with their TI still owed.
            Sits BELOW the assignment queue on purpose: assigning today's work
            is the live job, paying off paperwork is the catch-up one, and the
            top of this rail is what the manager reads first. Hidden entirely
            when nothing is owed — an empty section is noise. */}
        {basePending.length > 0 && (
          <>
            <div className="px-1 pt-3 pb-1 mt-1 border-t border-gray-200">
              <p className="text-[12px] font-bold text-gray-900">Tinter Issue pending</p>
              <p className="text-[10.5px] text-gray-400 mt-0.5">
                {basePending.length} {basePending.length === 1 ? "bill" : "bills"} · sent without tinting
              </p>
            </div>
            {basePending.map((o) => (
              // ⚠ The card is a DIV, not a button. Undo sits inside it, and a
              // <button> cannot legally nest inside another <button> — the
              // browser un-nests it and the inner click stops working. The
              // identity block carries the open action instead.
              //
              // Same card shell as the pending cards above — border, radius,
              // padding and hover are copied, not re-invented. The amber left
              // accent is the one difference, marking an outstanding debt.
              <div
                key={o.tintAssignmentId}
                className="border border-gray-200 border-l-[3px] border-l-amber-500 rounded-[10px] px-[11px] py-2.5 bg-white hover:border-gray-300 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onOpenBase(o)}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[12.5px] font-bold text-gray-900 leading-snug truncate">
                      {o.siteName}
                    </span>
                    <ChevronRight size={13} className="text-gray-300 flex-shrink-0 mt-0.5" />
                  </div>
                  <div className="text-[10.5px] text-gray-500 flex items-center gap-1 flex-wrap">
                    <ObdCode code={o.obdNumber} />
                    <span>·</span>
                    <span>{istDateTime(o.bypassedAt)}</span>
                  </div>
                </button>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                    TI {o.coveredLines}/{o.totalTintingLines}
                  </span>
                  {/* Undo is a quiet ghost, never a primary: the expected action
                      on this card is to RECORD the TI, not to unwind the bill.
                      Disabled buttons are grey, never faded primary
                      (CLAUDE_UI.md §10). */}
                  <button
                    type="button"
                    disabled={baseUndoBusyId === o.orderId}
                    onClick={() => onUndoBase(o)}
                    title="Put this bill back on the tint rail. Only possible while no TI has been recorded and nobody has picked it."
                    className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent transition-colors"
                  >
                    {baseUndoBusyId === o.orderId
                      ? <Loader2 size={10} className="animate-spin" />
                      : <Undo2 size={10} />}
                    Undo
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
