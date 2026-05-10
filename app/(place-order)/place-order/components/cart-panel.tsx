"use client";

import { useMemo } from "react";
import type { Bill, CartLine, Customer } from "../types";
import { formatPack, packStep, packToLitres, sortPacks } from "@/lib/place-order/pack";
import type { EmailDispatch, EmailMarker } from "@/lib/place-order/email";

// Cart panel — right pane (360px sticky) per planning doc §9.
// Sections:
//   1. Customer block            (always visible once selected)
//   2. Bill tabs                  — pill row, only when ≥2 bills
//   3. Cart lines per bill        — each bill is its own labelled section
//                                   when ≥2 bills; single bill = no header
//                                   (matches mockup)
//   4. Divider
//   5. Ship To                    — text input, optional
//   6. Dispatch                   — chip group (Normal / Hold / Urgent)
//   7. Marker                     — chip group (Truck / Cross / DTS / None)
//   8. Divider
//   9. Totals                     — "N lines · X.XL total · M bills"
//  10. Send Email button          — gray-900 (UI §10), disabled when empty
//  11. Send hint                  — "/ to send"

interface CartPanelProps {
  customer:        Customer | null;
  bills:           Bill[];
  activeBillId:    number;
  justAddedKeys:   Record<string, true>;       // key = `${billId}|||${subProduct}|||${baseColour ?? ""}`
  shipTo:          string;
  dispatch:        EmailDispatch;
  marker:          EmailMarker;
  onSetActiveBill: (id: number) => void;
  onAddBill:       () => void;
  onShipToChange:  (value: string) => void;
  onDispatchChange:(value: EmailDispatch) => void;
  onMarkerChange:  (value: EmailMarker) => void;
  onRemoveLine:    (billId: number, subProduct: string, baseColour: string | null) => void;
  onConfirmSend:   () => void;
  canSend:         boolean;
}

function lineKey(subProduct: string, baseColour: string | null): string {
  return `${subProduct}|||${baseColour ?? ""}`;
}

function billLineKey(billId: number, subProduct: string, baseColour: string | null): string {
  return `${billId}|||${lineKey(subProduct, baseColour)}`;
}

export default function CartPanel({
  customer, bills, activeBillId, justAddedKeys,
  shipTo, dispatch, marker,
  onSetActiveBill, onAddBill,
  onShipToChange, onDispatchChange, onMarkerChange,
  onRemoveLine, onConfirmSend, canSend,
}: CartPanelProps): React.JSX.Element {

  // Total volume across ALL bills, in litres. Cell qty is in BOXES, so:
  //   litres = qty (boxes) × packStep(label) (units/box) × packToLitres(pack)
  const totalLitres = useMemo<number>(() => {
    let sum = 0;
    for (const bill of bills) {
      for (const line of bill.lines) {
        for (const pack of Object.keys(line.packQtys)) {
          const qty = line.packQtys[pack] ?? 0;
          if (qty <= 0) continue;
          sum += qty * packStep(formatPack(pack)) * packToLitres(pack);
        }
      }
    }
    return sum;
  }, [bills]);

  const totalLines = bills.reduce((acc, b) => acc + b.lines.length, 0);
  const isMultiBill = bills.length > 1;

  const totalLitresLabel = totalLitres % 1 === 0
    ? `${totalLitres}L`
    : `${totalLitres.toFixed(1)}L`;

  return (
    <div className="bg-white border-l border-gray-200 sticky top-[56px] h-[calc(100vh-56px)] overflow-y-auto p-[18px] pb-6">
      {/* Customer block */}
      {customer && (
        <div className="pb-[14px] border-b border-gray-100 mb-[14px]">
          <div className="text-[14px] font-bold text-gray-900">{customer.name}</div>
          <div className="font-mono text-[11px] text-gray-400 mt-[2px]">{customer.code}</div>
        </div>
      )}

      {/* Bill tabs — only when ≥2 bills */}
      {isMultiBill && (
        <div className="flex flex-wrap gap-1 mb-3">
          {bills.map((bill) => {
            const isActive = bill.id === activeBillId;
            return (
              <button
                key={bill.id}
                type="button"
                onClick={() => onSetActiveBill(bill.id)}
                className={`px-3 h-7 rounded-[6px] border text-[11px] font-medium ${
                  isActive
                    ? "bg-teal-50 text-teal-700 border-teal-600"
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                Bill {bill.id}
                {bill.lines.length > 0 && (
                  <span className={`ml-1.5 text-[9px] font-mono ${
                    isActive ? "text-teal-500" : "text-gray-400"
                  }`}>{bill.lines.length}</span>
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

      {/* Empty state when single bill with no lines */}
      {!isMultiBill && bills[0]?.lines.length === 0 && (
        <div className="px-4 py-7 text-center text-[12px] text-gray-400 border border-dashed border-gray-200 rounded-[10px] bg-gray-50/60">
          <div className="text-[13px] font-medium text-gray-600 mb-1">No items yet</div>
          <div>Click a category card or press 1–9 to start.</div>
        </div>
      )}

      {/* Bill sections — labels only show when ≥2 bills (mockup convention) */}
      {(isMultiBill || (bills[0]?.lines.length ?? 0) > 0) && bills.map((bill) => {
        const isActive = bill.id === activeBillId;
        return (
          <div key={bill.id} className="mb-4">
            {isMultiBill && (
              <div className={`text-[10px] uppercase tracking-[0.08em] font-medium px-1.5 py-1 mb-[6px] flex items-center gap-2 border-l-2 rounded-r ${
                isActive
                  ? "bg-teal-50 border-teal-600 text-teal-700"
                  : "border-transparent text-gray-400"
              }`}>
                <span>Bill {bill.id} · {bill.lines.length} line{bill.lines.length === 1 ? "" : "s"}</span>
                {isActive && (
                  <span className="bg-teal-600/15 text-teal-700 text-[9px] px-1.5 py-px rounded font-semibold">
                    active
                  </span>
                )}
              </div>
            )}

            {bill.lines.length === 0 ? (
              isMultiBill ? (
                <div className="text-[11px] text-gray-300 italic px-2 py-1.5">empty</div>
              ) : null /* single-bill empty state rendered above */
            ) : (
              bill.lines.map((line) => (
                <CartLineRow
                  key={lineKey(line.subProduct, line.baseColour)}
                  line={line}
                  isJustAdded={justAddedKeys[billLineKey(bill.id, line.subProduct, line.baseColour)] === true}
                  onRemove={() => onRemoveLine(bill.id, line.subProduct, line.baseColour)}
                />
              ))
            )}
          </div>
        );
      })}

      <div className="h-px bg-gray-100 my-[14px]" />

      {/* Ship To */}
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.06em] text-gray-400 font-medium mb-[6px]">
          Ship To
        </div>
        <input
          type="text"
          value={shipTo}
          onChange={(e) => onShipToChange(e.target.value)}
          placeholder="Site or alternate address"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full h-[34px] border border-gray-200 rounded-[6px] bg-white px-3 text-[12px] text-gray-900 placeholder:text-gray-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
        />
      </div>

      {/* Dispatch */}
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.06em] text-gray-400 font-medium mb-[6px]">
          Dispatch
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-[7px] p-[3px]">
          {(["Normal", "Hold", "Urgent"] as const).map((v) => {
            const isActive = v === dispatch;
            const dotColor =
              v === "Normal" ? "#6b7280" :
              v === "Hold"   ? "#ef4444" :
                               "#f59e0b";
            return (
              <button
                key={v}
                type="button"
                onClick={() => onDispatchChange(v)}
                className={`flex-1 h-7 rounded-[5px] text-[11px] inline-flex items-center justify-center gap-[5px] ${
                  isActive
                    ? "bg-white text-gray-900 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <span className="w-[5px] h-[5px] rounded-full" style={{ background: dotColor }} />
                {v}
              </button>
            );
          })}
        </div>
      </div>

      {/* Marker */}
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.06em] text-gray-400 font-medium mb-[6px]">
          Marker
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-[7px] p-[3px]">
          {(["Truck", "Cross Delivery", "DTS", null] as const).map((v) => {
            const isActive = v === marker;
            const label    = v === null ? "None" : v === "Cross Delivery" ? "Cross" : v;
            return (
              <button
                key={label}
                type="button"
                onClick={() => onMarkerChange(v)}
                className={`flex-1 h-7 rounded-[5px] text-[11px] inline-flex items-center justify-center ${
                  isActive
                    ? "bg-white text-gray-900 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-gray-100 my-[14px]" />

      {/* Totals */}
      <div className="text-[11px] text-gray-500 mb-[10px]">
        <span className="text-gray-900 font-semibold">{totalLines} line{totalLines === 1 ? "" : "s"}</span>
        {" · "}
        <span className="text-gray-900 font-semibold">{totalLitresLabel}</span>
        {" total"}
        {isMultiBill && (
          <>
            {" · "}
            <span className="text-gray-900 font-semibold">{bills.length} bills</span>
          </>
        )}
      </div>

      {/* Send button */}
      <button
        type="button"
        onClick={onConfirmSend}
        disabled={!canSend}
        className={`w-full h-11 rounded-[10px] text-[13.5px] font-medium flex items-center justify-center gap-2 transition-colors ${
          canSend
            ? "bg-gray-900 text-white hover:bg-gray-800"
            : "bg-gray-100 text-gray-400 cursor-not-allowed"
        }`}
      >
        Send Email
      </button>
      <div className="text-center text-[10px] text-gray-400 mt-2">
        {canSend
          ? <><span className="font-mono bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">/</span> to send</>
          : <>Add items to enable · <span className="font-mono bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">/</span> to send</>
        }
      </div>
    </div>
  );
}

interface CartLineRowProps {
  line:        CartLine;
  isJustAdded: boolean;
  onRemove:    () => void;
}

function CartLineRow({ line, isJustAdded, onRemove }: CartLineRowProps): React.JSX.Element {
  const sortedKeys = sortPacks(
    Object.keys(line.packQtys).filter((p) => (line.packQtys[p] ?? 0) > 0),
  );
  const packStr = sortedKeys.map((p) => `${formatPack(p)}×${line.packQtys[p]}`).join(", ");
  return (
    <div className={`group p-2 rounded-[6px] flex items-start gap-2 transition-colors ${
      isJustAdded ? "bg-teal-50" : ""
    }`}>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-gray-900 leading-[1.35]">{line.displayName}</div>
        {line.baseColour && (
          <div className="text-[11px] text-gray-500 mt-[1px]">{line.baseColour}</div>
        )}
        <div className="text-[11px] text-gray-500 mt-[2px] font-mono">{packStr}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-gray-300 hover:text-gray-700 hover:bg-gray-100 rounded px-1 py-0.5 text-[14px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Remove line"
      >
        ×
      </button>
    </div>
  );
}
