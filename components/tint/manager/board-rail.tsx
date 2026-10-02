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
// A CLICK SELECTS THE CARD (step 6, owner decision 2): violet border, brand-50
// fill and a ✓ — no checkbox. Assign ▾, Remove OBD and the rest live on the
// bottom bar now (board-bottom-bar.tsx); the bar's Assign goes through the
// customer-missing interceptor exactly as the card's used to (CLAUDE_TINT §1.5),
// so a card flagged "customer missing" is resolved from there.
//
// The "Tinter Issue pending" list that used to sit under this queue MOVED to
// the TI tab (board-ti-tab.tsx).

import { cn } from "@/lib/utils";
import { ageDays, istDateTime } from "./board-bits";
import { siteNameOf } from "./rows";
import type { TintOrder } from "./types";
import { MissingShipToLine, missingCardCls, useMissingCustomers } from "./missing-customer";

export function BoardRail({
  rail, selected, onToggle, onOpenPanel,
}: {
  rail:        TintOrder[];
  /** The selected rail bills (order ids) — disjoint from the table's. */
  selected:    Set<number>;
  /** A card click — selects / deselects the bill. */
  onToggle:    (order: TintOrder) => void;
  /** The card's ⋯ — the detail panel. Never selects. */
  onOpenPanel: (order: TintOrder) => void;
}) {
  // Missing customer marks (2026-10-02): amber card + orange bar, ship-to tag.
  const missingCtx = useMissingCustomers();
  return (
    // 440px — the mockup's rail width (was 344px before the card redesign).
    <div className="w-[440px] flex-shrink-0 bg-ink-25 border-r border-gray-200 flex flex-col overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-gray-200">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">Needs assignment</p>
        <p className="text-[11px] text-ink-400 mt-0.5">
          {rail.length} waiting · oldest first · click to select · ⋯ for details
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
            const sel  = selected.has(o.id);
            const missingBill = missingCtx.byOrder.get(o.id) ?? null;
            return (
              <div
                key={o.id}
                // Header search (2026-10-02): an opened result scrolls to + flashes this card.
                data-search-key={`rail-${o.id}`}
                role="button"
                tabIndex={0}
                aria-pressed={sel}
                onClick={() => onToggle(o)}
                onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); onToggle(o); } }}
                className={cn(
                  "relative select-none cursor-pointer rounded-[14px] px-5 py-[18px] border transition-[border-color,box-shadow]",
                  sel
                    ? "border-brand-600 bg-brand-50 shadow-[0_0_0_1px_theme(colors.brand.600)]"
                    : "border-ink-100 bg-white hover:border-ink-200 hover:shadow-[0_2px_8px_rgba(27,24,38,0.05)]",
                  !sel && missingCardCls(missingBill, missingCtx.flash.has(o.id)),
                )}
              >
                {/* ── top: site + billed to · litres + articles ───────────── */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="text-[16px] font-bold leading-[1.25] text-ink-900 truncate"
                      title={site.original ? `${site.original} → ship to ${site.site}` : site.site}
                    >
                      {site.site}
                      {/* Icons, not chips (step 6): Floor's exact ★ amber and ⚡ red
                          (board-table.tsx copies the same two). */}
                      {o.isKeyCustomer && <span className="ml-1.5 text-[14px]" style={{ color: "#f59e0b" }} title="Key customer">★</span>}
                      {o.priorityLevel <= 2 && <span className="ml-1 text-[14px]" style={{ color: "#ef4444" }} title="Urgent">⚡</span>}
                    </p>
                    {/* Missing customer: SAP ship-to code + "+ Add Ship to" (replaces the
                        old ⚠ icon; the Assign / Base — No Tint interceptor is unchanged). */}
                    <MissingShipToLine orderId={o.id} className="mt-1" />
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
                    {age !== null && !sel && (
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
                    {/* Selected: the ✓ takes the age chip's place (mockup .card.sel). */}
                    {sel && (
                      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-600 text-[11px] text-white">✓</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenPanel(o); }}
                      className="rounded-md px-[7px] text-[17px] leading-5 tracking-[1px] text-ink-400 hover:bg-ink-50 hover:text-ink-900"
                      title="Bill details"
                    >
                      ⋯
                    </button>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
