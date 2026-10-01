"use client";

// Tint Manager — the left rail: "Needs assignment". One card per OBD still
// waiting for an operator, oldest first (mockup §rail). It stays on the left
// whichever tab is open (tabs build, 2026-10-01).
//
// The rail is where Assign happens, and it is the ONLY place Remove OBD is
// offered — matching the live server rule that removal is blocked once a job is
// assigned (/api/tint/manager/orders/[id]/remove returns 409 outside
// pending_tint_assignment).
//
// CARD (redesigned 2026-10-01, tabs build step 5 — the locked mockup
// docs/mockups/tint-manager/tint-manager-tabs-mockup.html, .card):
//   top    — the ship-to SITE (16px bold; the redirect when one is set) and
//            "billed to {dealer}" under it; litres (big, tabular) and the
//            article tag on the right (NULL → em dash, CLAUDE_TINT §1.3);
//   strip  — OBD | SMU code | route | arrival · age chip · ⋯ (the detail panel).
//   No slot or other chips on the card.
// Assign ▾ and Remove OBD stay on the card until build step 6 moves them to the
// bottom bar and makes a click select the card.
//
// The "Tinter Issue pending" list that used to sit under this queue MOVED to
// the TI tab (board-ti-tab.tsx).

import { useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OperatorMenu, ageDays, istDateTime } from "./board-bits";
import { siteNameOf } from "./rows";
import type { Operator, TintOrder } from "./types";

export function BoardRail({
  rail, operators, onAssign, onBaseBypass, onRemove, onOpenPanel, onResolveMissing, canRemove,
  onMenuOpenChange,
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
  /** Live feed (tint step 4): the operator menu opened / closed, so the page can
   *  hold its reload while a manager is picking an operator. Optional. */
  onMenuOpenChange?: (open: boolean) => void;
}) {
  // The open menu carries its TRIGGER ELEMENT, not just an id: OperatorMenu is
  // portalled to document.body and measures its position from that element, so
  // the anchor has to travel with the open-state.
  const [menu, setMenu] = useState<{ orderId: number; anchor: HTMLElement } | null>(null);
  const menuOpen = menu !== null;
  useEffect(() => { onMenuOpenChange?.(menuOpen); }, [menuOpen, onMenuOpenChange]);

  return (
    // 440px — the mockup's rail width (was 344px before the card redesign).
    <div className="w-[440px] flex-shrink-0 bg-ink-25 border-r border-gray-200 flex flex-col overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-gray-200">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">Needs assignment</p>
        <p className="text-[11px] text-ink-400 mt-0.5">
          {rail.length} waiting · oldest first · ⋯ for details
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-3">
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
            const site = siteNameOf(o, o.shipToOverrideName);
            const vol  = o.querySnapshot?.totalVolume ?? null;
            const art  = o.articleTag ?? o.querySnapshot?.articleTag ?? null;
            return (
              <div
                key={o.id}
                className="relative border border-ink-100 rounded-[14px] px-5 py-[18px] bg-white hover:border-ink-200 hover:shadow-[0_2px_8px_rgba(27,24,38,0.05)] transition-[border-color,box-shadow]"
              >
                {/* ── top: site + billed to · litres + articles ───────────── */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="text-[16px] font-bold leading-[1.25] text-ink-900 truncate"
                      title={site.original ? `${site.original} → ship to ${site.site}` : site.site}
                    >
                      {site.site}
                    </p>
                    <p className="text-[13px] text-ink-500 mt-1 truncate">billed to {o.billToName ?? "—"}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <b className="block text-[18px] font-bold tabular-nums text-ink-900">
                      {vol !== null ? `${vol.toLocaleString("en-IN")} L` : "—"}
                    </b>
                    <span className="text-[13px] text-ink-500">{art ?? "—"}</span>
                  </div>
                </div>

                {/* ── strip: OBD | SMU | route | arrival · age · ⋯ ──────────── */}
                <div className="flex items-center mt-3.5 pt-3 border-t border-gray-200 text-[13px] text-ink-700">
                  <span className="font-mono">{o.obdNumber}</span>
                  <span className="pl-3 ml-3 border-l border-ink-100 font-bold" title={o.smu ?? undefined}>
                    {o.smuCode ?? "—"}
                  </span>
                  <span className="pl-3 ml-3 border-l border-ink-100 truncate min-w-0">{o.route ?? "—"}</span>
                  <span className="ml-auto pl-3 flex items-center gap-2 text-ink-500 flex-shrink-0">
                    {istDateTime(o.orderDateTime)}
                    {age !== null && (
                      // The mockup's threshold: 3 days and older is red, newer amber.
                      // Classes are the old card's, copied (no warn border token).
                      <span className={cn(
                        "text-[10.5px] font-semibold px-1.5 py-px rounded-[5px] border",
                        age >= 3 ? "bg-red-50 text-red-700 border-red-200"
                                 : "bg-amber-50 text-amber-700 border-amber-200",
                      )}>
                        {age}d
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenPanel(o)}
                      className="rounded-md px-[7px] text-[17px] leading-5 tracking-[1px] text-ink-400 hover:bg-ink-50 hover:text-ink-900"
                      title="Bill details"
                    >
                      ⋯
                    </button>
                  </span>
                </div>

                {/* ── actions — UNTIL STEP 6 moves them to the bottom bar ────── */}
                {/* No `relative` here: the menu is portalled to document.body,
                    so it needs no positioned ancestor — and the rail's overflow
                    is what used to clip it. */}
                <div className="flex items-center gap-1.5 mt-3">
                  <button
                    type="button"
                    onClick={(e) =>
                      setMenu(menu?.orderId === o.id ? null : { orderId: o.id, anchor: e.currentTarget })
                    }
                    className="flex-1 border border-ink-100 bg-white hover:bg-brand-50 text-brand-700 rounded-[7px] text-[11px] font-semibold py-2 transition-colors"
                  >
                    Assign ▾
                  </button>
                  {o.customerMissing && (
                    <button
                      type="button"
                      onClick={() => onResolveMissing(o)}
                      className="border border-amber-200 bg-amber-50 text-amber-700 rounded-[7px] px-2.5 py-2 transition-colors"
                      title="Customer master data missing — resolve before assigning"
                    >
                      <AlertCircle size={13} />
                    </button>
                  )}
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(o)}
                      className="border border-gray-200 bg-white text-gray-400 hover:text-red-600 rounded-[7px] px-2.5 py-2 transition-colors"
                      title="Remove OBD"
                    >
                      <X size={13} />
                    </button>
                  )}

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
      </div>
    </div>
  );
}
