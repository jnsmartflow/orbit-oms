"use client";

// Tint Manager — the 344px left rail: "Needs assignment". One card per OBD still
// waiting for an operator, oldest first (mockup §rail).
//
// The rail is where Assign happens, and it is the ONLY place Remove OBD is
// offered — matching the live server rule that removal is blocked once a job is
// assigned (/api/tint/manager/orders/[id]/remove returns 409 outside
// pending_tint_assignment).

import { useState } from "react";
import { AlertCircle, Eye, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ObdCode } from "@/components/shared/obd-code";
import { OperatorMenu, ageDays, istDateTime } from "./board-bits";
import type { Operator, TintOrder } from "./types";

export function BoardRail({
  rail, operators, onAssign, onRemove, onOpenPanel, onResolveMissing, canRemove,
}: {
  rail:             TintOrder[];
  operators:        Operator[];
  onAssign:         (order: TintOrder, operatorId: number) => void;
  onRemove:         (order: TintOrder) => void;
  onOpenPanel:      (order: TintOrder) => void;
  onResolveMissing: (order: TintOrder) => void;
  canRemove:        boolean;
}) {
  // The open menu carries its TRIGGER ELEMENT, not just an id: OperatorMenu is
  // portalled to document.body and measures its position from that element, so
  // the anchor has to travel with the open-state.
  const [menu, setMenu] = useState<{ orderId: number; anchor: HTMLElement } | null>(null);

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
                    className="text-[12.5px] font-bold text-gray-900 text-left leading-snug hover:text-teal-700 truncate"
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
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border bg-purple-50 text-purple-700 border-purple-200" title="Manually pulled into tint">
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
                    className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-[7px] text-[11px] font-bold py-2 transition-colors"
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
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
