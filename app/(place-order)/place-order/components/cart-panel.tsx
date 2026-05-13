"use client";

import { useMemo } from "react";
import type { Bill, CartLine, Customer } from "../types";
import { formatPack, packStep, packToLitres, sortPacks } from "@/lib/place-order/pack";
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
  onRemovePack:    (subProduct: string, baseColour: string | null, pack: string) => void;
  onConfirmSend:   () => void;
  canSend:         boolean;
  // Page-owned ref so Send Email button participates in the Tab cycle
  // wiring (search → tiles → send → wrap).
  sendButtonRef?:  React.RefObject<HTMLButtonElement>;
}

function lineKey(subProduct: string, baseColour: string | null): string {
  return `${subProduct}|||${baseColour ?? ""}`;
}

function billLineKey(billId: number, subProduct: string, baseColour: string | null): string {
  return `${billId}|||${lineKey(subProduct, baseColour)}`;
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

  // Total volume across ALL bills (order-wide, not just active).
  // Post-2026-05-12 flip: packQtys values are UNITS, so the volume
  // calculation is units × litres-per-unit directly (no × packStep
  // factor — that was the boxes→units multiplier in the pre-flip code).
  const totalLitres = useMemo<number>(() => {
    let sum = 0;
    for (const bill of bills) {
      for (const line of bill.lines) {
        for (const pack of Object.keys(line.packQtys)) {
          const units = line.packQtys[pack] ?? 0;
          if (units <= 0) continue;
          sum += units * packToLitres(pack);
        }
      }
    }
    return sum;
  }, [bills]);

  const totalLines  = bills.reduce((acc, b) => acc + b.lines.length, 0);
  const isMultiBill = bills.length > 1;

  // Sub-product groups within the active bill, ordered by max(touchedAt)
  // DESC so the most-recently-touched group floats to the top (matches the
  // mockup's "PROMISE ENML at top with the just-added flash" intent).
  const subProductGroups = useMemo(() => {
    const map = new Map<string, { subProduct: string; lines: CartLine[]; latestTouchedAt: number }>();
    for (const line of activeLines) {
      const t = line.touchedAt ?? 0;
      const existing = map.get(line.subProduct);
      if (existing) {
        existing.lines.push(line);
        if (t > existing.latestTouchedAt) existing.latestTouchedAt = t;
      } else {
        map.set(line.subProduct, { subProduct: line.subProduct, lines: [line], latestTouchedAt: t });
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
          subProductGroups.map((group, gIdx) => {
            const isFirstGroup = gIdx === 0;
            const totalPackRows = group.lines.reduce(
              (acc, l) => acc + Object.keys(l.packQtys).filter((p) => (l.packQtys[p] ?? 0) > 0).length,
              0,
            );
            return (
              <div
                key={group.subProduct}
                className={`mb-4 ${isFirstGroup ? "" : "pt-3 border-t border-gray-100"}`}
              >
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 flex items-center justify-between">
                  <span className="font-semibold">{group.subProduct}</span>
                  <span className="font-mono">{totalPackRows} {totalPackRows === 1 ? "line" : "lines"}</span>
                </div>
                <div>
                  {group.lines.flatMap((line) => {
                    const isFlashed = justAddedKeys[billLineKey(activeBillId, line.subProduct, line.baseColour)] === true;
                    const baseLabel = line.baseColour ?? "Plain";
                    return sortPacks(
                      Object.keys(line.packQtys).filter((p) => (line.packQtys[p] ?? 0) > 0),
                    ).map((pack) => {
                      const units   = line.packQtys[pack] ?? 0;
                      const step    = packStep(formatPack(pack));
                      const isClean = step > 1 && units > 0 && units % step === 0;
                      return (
                        <div
                          key={`${lineKey(line.subProduct, line.baseColour)}|${pack}`}
                          className={`group flex items-center justify-between text-[12.5px] py-1.5 px-1 -mx-1 rounded transition-colors duration-150 hover:bg-gray-50 ${
                            isFlashed ? "animate-cart-flash" : ""
                          }`}
                        >
                          <span className="text-gray-800">
                            {baseLabel} · {formatPack(pack)}
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
                              onClick={() => onRemovePack(line.subProduct, line.baseColour, pack)}
                              aria-label={`Remove ${baseLabel} ${formatPack(pack)}`}
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
