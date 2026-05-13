"use client";

import { useMemo } from "react";
import type { Bill, CartLine, Customer } from "../types";
import { formatPack, packStep, packToKg, packToLitres, parsePackKey, sortPacks } from "@/lib/place-order/pack";
import type { EmailDispatch, EmailMarker } from "@/lib/place-order/email";

// Cart panel — right pane (340px) per v4 mockup. Renders ONLY the active
// bill's lines, grouped by sub-product. Multi-bill workflow preserved
// via the bill tabs strip + Add button at the top.
//
// Removal is per-pack (mockup × on each pack-row). The handler routes
// through the page's setQty pathway (qty=0 deletes the pack key,
// removing the CartLine entirely when no packs remain) — same code path
// as a manual cell entry, so mailto: parity holds.

interface CartPanelProps {
  customer:        Customer | null;
  bills:           Bill[];
  activeBillId:    number;
  justAddedKeys:   Record<string, true>;        // key = `${billId}|||${subProduct}|||${baseColour ?? ""}`
  shipTo:          string;
  dispatch:        EmailDispatch;
  marker:          EmailMarker;
  onSetActiveBill: (id: number) => void;
  onAddBill:       () => void;
  onShipToChange:  (value: string) => void;
  onDispatchChange:(value: EmailDispatch) => void;
  onMarkerChange:  (value: EmailMarker) => void;
  // Phase 3 (2026-05-13): productId is the first arg so the parent
  // can resolve the exact catalog row even for filled families where
  // multiple rows share (subProduct, baseColour). Pre-Phase-3 legacy
  // cart lines pass undefined; the parent falls back to the legacy
  // (subProduct, baseColour) lookup.
  onRemovePack:    (productId: number | undefined, subProduct: string, baseColour: string | null, pack: string) => void;
  onConfirmSend:   () => void;
  canSend:         boolean;
  // Page-owned ref so Send Email button participates in the Tab cycle
  // wiring (search → tiles → send → wrap).
  sendButtonRef?:  React.RefObject<HTMLButtonElement>;
}

// Phase 3 (2026-05-13): productId is the canonical cart-line identity.
// Falls back to (subProduct, baseColour) for pre-Phase-3 localStorage
// drafts that pre-date the cutover — those lines never match the flash
// keys (which are productId-only) so they just don't flash, which is
// fine for legacy carts.
function lineKey(productId: number | undefined, subProduct: string, baseColour: string | null): string {
  if (productId !== undefined) return `id:${productId}`;
  return `${subProduct}|||${baseColour ?? ""}`;
}

function billLineKey(billId: number, productId: number | undefined, subProduct: string, baseColour: string | null): string {
  return `${billId}|||${lineKey(productId, subProduct, baseColour)}`;
}

function formatLitres(l: number): string {
  if (Math.abs(l - Math.round(l)) < 0.05) return String(Math.round(l));
  return l.toFixed(1);
}

export default function CartPanel({
  customer, bills, activeBillId, justAddedKeys,
  shipTo, dispatch, marker,
  onSetActiveBill, onAddBill,
  onShipToChange, onDispatchChange, onMarkerChange,
  onRemovePack, onConfirmSend, canSend, sendButtonRef,
}: CartPanelProps): React.JSX.Element {

  const activeBill = bills.find((b) => b.id === activeBillId);
  const activeLines: CartLine[] = activeBill?.lines ?? [];

  // Total volume + KG across ALL bills (order-wide, not just active).
  // Post-2026-05-12 flip: packQtys values are UNITS, so the volume
  // calculation is units × litres-per-unit directly (no × packStep
  // factor — that was the boxes→units multiplier in the pre-flip code).
  //
  // Phase 3.5 (2026-05-13): keys are composite "<packCode>|<unit>"
  // (parsePackKey handles legacy bare keys too). KG packs are
  // excluded from the L total per policy C1 and accumulated
  // separately into totalKg — surfaced as "+ Y KG" on the totals
  // line when > 0.
  const { totalLitres, totalKg } = useMemo<{ totalLitres: number; totalKg: number }>(() => {
    let litres = 0;
    let kg = 0;
    for (const bill of bills) {
      for (const line of bill.lines) {
        for (const key of Object.keys(line.packQtys)) {
          const units = line.packQtys[key] ?? 0;
          if (units <= 0) continue;
          const { packCode, unit } = parsePackKey(key);
          litres += units * packToLitres(packCode, unit);
          kg     += units * packToKg(packCode, unit);
        }
      }
    }
    return { totalLitres: litres, totalKg: kg };
  }, [bills]);

  const totalLines  = bills.reduce((acc, b) => acc + b.lines.length, 0);
  const isMultiBill = bills.length > 1;

  // Cart groups within the active bill, ordered by max(touchedAt) DESC
  // so the most-recently-touched group floats to the top.
  //
  // Phase 3.5 (2026-05-13): grouping key is `${family}|||${tab}` where
  // `tab = uiGroup ?? subProduct`. Headers render "FAMILY · tab" so
  // operators immediately see which family the items belong to. Two
  // families that happen to share a tab name (e.g. WS MAX vs some
  // future MAX) stay in separate sections.
  interface CartGroup {
    family:           string;
    tab:              string;          // uiGroup or subProduct fallback
    lines:            CartLine[];
    latestTouchedAt:  number;
  }
  const cartGroups = useMemo<CartGroup[]>(() => {
    const map = new Map<string, CartGroup>();
    for (const line of activeLines) {
      const tab = line.uiGroup ?? line.subProduct;
      const key = `${line.family}|||${tab}`;
      const t   = line.touchedAt ?? 0;
      const existing = map.get(key);
      if (existing) {
        existing.lines.push(line);
        if (t > existing.latestTouchedAt) existing.latestTouchedAt = t;
      } else {
        map.set(key, { family: line.family, tab, lines: [line], latestTouchedAt: t });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latestTouchedAt - a.latestTouchedAt);
  }, [activeLines]);

  return (
    <aside className="w-[340px] bg-white border-l border-gray-200 flex flex-col flex-shrink-0 sticky top-[52px] h-[calc(100vh-52px)]">
      {customer && (
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="text-[13px] font-semibold text-gray-900 truncate">{customer.name}</div>
          <div className="text-[10.5px] text-gray-400 font-mono truncate">{customer.code}</div>
        </div>
      )}

      {isMultiBill && (
        <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-1">
          {bills.map((bill) => {
            const isActive = bill.id === activeBillId;
            return (
              <button
                key={bill.id}
                type="button"
                onClick={() => onSetActiveBill(bill.id)}
                className={`px-3 h-7 rounded-[6px] border text-[11px] font-medium transition-colors duration-75 ${
                  isActive
                    ? "bg-teal-50 text-teal-700 border-teal-600"
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                Bill {bill.id}
                {bill.lines.length > 0 && (
                  <span className={`ml-1.5 text-[9px] font-mono ${isActive ? "text-teal-500" : "text-gray-400"}`}>
                    {bill.lines.length}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onAddBill}
            className="px-3 h-7 rounded-[6px] border border-dashed border-gray-300 text-[11px] text-gray-400 hover:bg-gray-50 hover:text-gray-600"
            aria-label="Add bill"
          >
            + Add
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {activeLines.length === 0 ? (
          <div className="text-[11.5px] text-gray-400 italic">
            {customer ? "No items yet — search or tap a tile to add." : "Select a customer to start."}
          </div>
        ) : (
          cartGroups.map((group, gIdx) => {
            const isFirstGroup = gIdx === 0;
            const totalPackRows = group.lines.reduce(
              (acc, l) => acc + Object.keys(l.packQtys).filter((p) => (l.packQtys[p] ?? 0) > 0).length,
              0,
            );
            // Header format "FAMILY · tab" — except when family and
            // tab happen to be identical (e.g. a single-sub-product
            // family with subProduct = family name), in which case
            // just the family avoids the visual duplicate.
            const headerLabel = group.family === group.tab
              ? group.family
              : `${group.family} · ${group.tab}`;
            return (
              <div
                key={`${group.family}|||${group.tab}`}
                className={`mb-4 ${isFirstGroup ? "" : "pt-3 border-t border-gray-100"}`}
              >
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 flex items-center justify-between">
                  <span className="font-semibold">{headerLabel}</span>
                  <span className="font-mono">{totalPackRows} {totalPackRows === 1 ? "line" : "lines"}</span>
                </div>
                <div>
                  {group.lines.flatMap((line) => {
                    const isFlashed = justAddedKeys[billLineKey(activeBillId, line.productId, line.subProduct, line.baseColour)] === true;
                    // Phase 3.5 (2026-05-13): match the row-label chain
                    // used by variant-grid so filled families display
                    // their real variant ("Crackfiller 5mm", "Metal
                    // Primer (Red Oxide)") instead of the
                    // baseColour=null fallback "Plain". CartLine
                    // already carries displayName + product + subProduct
                    // (populated at add-to-cart in place-order-page).
                    const baseLabel =
                      line.baseColour
                      ?? line.displayName
                      ?? line.product
                      ?? line.subProduct;
                    return sortPacks(
                      Object.keys(line.packQtys).filter((p) => (line.packQtys[p] ?? 0) > 0),
                    ).map((packCompositeKey) => {
                      const units   = line.packQtys[packCompositeKey] ?? 0;
                      // Phase 3.5 (2026-05-13): packQtys keys are
                      // composite "<packCode>|<unit>". Parse first so
                      // formatPack picks the right unit and packStep
                      // looks up the formatted label correctly.
                      const { packCode, unit } = parsePackKey(packCompositeKey);
                      const packLabel = formatPack(packCode, unit);
                      const step      = packStep(packLabel);
                      const isClean   = step > 1 && units > 0 && units % step === 0;
                      return (
                        <div
                          key={`${lineKey(line.productId, line.subProduct, line.baseColour)}|${packCompositeKey}`}
                          className={`group flex items-center justify-between text-[12.5px] py-1.5 px-1 -mx-1 rounded transition-colors duration-150 hover:bg-gray-50 ${
                            isFlashed ? "animate-cart-flash" : ""
                          }`}
                        >
                          <span className="text-gray-800">
                            {baseLabel} · {packLabel}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-gray-700">
                              ×{units}
                              {isClean && (
                                <span className="font-normal text-gray-400 ml-1">
                                  · {units / step} box
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => onRemovePack(line.productId, line.subProduct, line.baseColour, packCompositeKey)}
                              aria-label={`Remove ${baseLabel} ${packLabel}`}
                              className="text-gray-300 hover:text-red-500 text-[14px] leading-none opacity-0 group-hover:opacity-100 transition-opacity duration-100"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    });
                  })}
                </div>
              </div>
            );
          })
        )}
        {activeLines.length > 0 && (
          <div className="text-[10.5px] text-gray-300 italic mt-2">
            + search or tap a tile to add more
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 space-y-2">
        <details className="text-[10.5px]">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-900 select-none flex items-center justify-between list-none [&::-webkit-details-marker]:hidden">
            <span>More options · ship-to, dispatch, marker</span>
            <span className="text-gray-400">▾</span>
          </summary>
          <div className="mt-2 space-y-2">
            <input
              type="text"
              value={shipTo}
              onChange={(e) => onShipToChange(e.target.value)}
              placeholder="Ship to (same as customer)"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full h-[28px] px-2 text-[11px] border border-gray-200 rounded bg-white focus:border-teal-500 focus:outline-none"
            />
            <div className="flex items-center gap-1">
              {(["Normal", "Hold", "Urgent"] as const).map((v) => {
                const isActive = v === dispatch;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onDispatchChange(v)}
                    className={`flex-1 px-2 py-1 text-[10.5px] font-medium rounded transition-colors duration-75 ${
                      isActive
                        ? "bg-gray-900 text-white"
                        : "bg-white border border-gray-200 text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1">
              {(["Truck", "Cross Delivery", "DTS", null] as const).map((v) => {
                const isActive = v === marker;
                const label    = v === null ? "None" : v === "Cross Delivery" ? "Cross" : v;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onMarkerChange(v)}
                    className={`flex-1 px-2 py-1 text-[10.5px] font-medium rounded transition-colors duration-75 ${
                      isActive
                        ? "bg-gray-900 text-white"
                        : "bg-white border border-gray-200 text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </details>

        <div className="flex items-center justify-between pt-2 border-t border-gray-200 text-[12px]">
          <span className="text-gray-500">Total</span>
          <span className="font-mono text-gray-900 font-semibold">
            {totalLines} {totalLines === 1 ? "line" : "lines"} · {formatLitres(totalLitres)} L
            {/* Phase 3.5 (2026-05-13): KG packs are excluded from the
                L total per policy C1 and surfaced as a tail when
                non-zero. WRP / Waterblock 2K / cement-paste SKUs land
                here. */}
            {totalKg > 0 && ` · ${formatLitres(totalKg)} KG`}
            {isMultiBill && ` · ${bills.length} bills`}
          </span>
        </div>

        <button
          ref={sendButtonRef}
          type="button"
          onClick={onConfirmSend}
          disabled={!canSend}
          className={`w-full h-[40px] text-[14px] font-medium rounded-lg flex items-center justify-center gap-2 transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1 ${
            canSend
              ? "bg-teal-600 hover:bg-teal-700 text-white"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Send Email
        </button>
      </div>
    </aside>
  );
}
