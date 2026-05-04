"use client";

import { useState } from "react";

// Public mobile order form for Sales Officers. No DB, no API, no auth —
// builds a mailto: link to the depot's order inbox. Reachable at /order
// (whitelisted in middleware.ts PUBLIC_PATHS).

const ORDER_TO = "surat.order@outlook.com";

type Dispatch = "normal" | "hold" | "urgent";

export default function OrderPage(): React.JSX.Element {
  const [name,     setName]     = useState("");
  const [code,     setCode]     = useState("");
  const [products, setProducts] = useState("");
  const [shipTo,   setShipTo]   = useState("");
  const [dispatch, setDispatch] = useState<Dispatch>("normal");

  const tName     = name.trim();
  const tCode     = code.trim();
  const tProducts = products.trim();
  const tShipTo   = shipTo.trim();

  const canSend = tName.length > 0 && tProducts.length > 0;

  // ── Email derivation ────────────────────────────────────────────────────
  const subject = tCode
    ? `Order — ${tName} ${tCode}`
    : `Order — ${tName}`;

  const bodyLines: string[] = [];
  if (tName) {
    bodyLines.push(tCode ? `Customer: ${tName} (${tCode})` : `Customer: ${tName}`);
  }
  if (dispatch !== "normal") {
    bodyLines.push(`Dispatch: ${dispatch === "hold" ? "Hold" : "Urgent"}`);
  }
  if (tShipTo) {
    bodyLines.push(`Ship To: ${tShipTo}`);
  }
  if (tProducts) {
    if (bodyLines.length > 0) bodyLines.push("");
    bodyLines.push(tProducts);
  }
  const body = bodyLines.join("\n");

  function handleSend(): void {
    if (!canSend) return;
    const url = `mailto:${ORDER_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#f2f2f7] pt-6 pb-12 px-4">
      <div className="max-w-[480px] mx-auto">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-1.5">
            <div className="w-[34px] h-[34px] bg-teal-600 rounded-[9px] flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6" />
                <circle cx="11" cy="11" r="2.2" fill="white" />
                <circle cx="18" cy="11" r="2" fill="white" />
              </svg>
            </div>
            <h1 className="text-[22px] font-semibold text-gray-900 tracking-[-0.5px]">Place Order</h1>
          </div>
          <p className="text-[12px] text-gray-400">JSW Dulux · Surat Depot</p>
        </div>

        {/* Customer */}
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1 mb-2">Customer</p>
          <div className="bg-white rounded-[13px] shadow-sm border border-gray-100 overflow-hidden">
            <label className="block px-4 pt-3 pb-3 border-b border-gray-100">
              <span className="text-[12px] font-medium text-gray-400 block mb-1">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer name"
                className="w-full text-[16px] text-gray-900 bg-transparent border-none outline-none p-0 placeholder:text-gray-300"
              />
            </label>
            <label className="block px-4 pt-3 pb-3">
              <span className="text-[12px] font-medium text-gray-400 block mb-1">Customer Code</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. 12345"
                className="w-full text-[16px] text-gray-900 bg-transparent border-none outline-none p-0 placeholder:text-gray-300"
              />
              <p className="text-[11px] text-gray-400 mt-1">SAP code · 5–7 digits · if known</p>
            </label>
          </div>
        </div>

        {/* Products */}
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1 mb-2">Products</p>
          <div className="bg-white rounded-[13px] shadow-sm border border-gray-100 overflow-hidden">
            <label className="block p-4">
              <textarea
                value={products}
                onChange={(e) => setProducts(e.target.value)}
                rows={8}
                placeholder={"Royale Matt White 1L*10\nAquatech Smooth White 4L*4\nWS Primer Pink 4L*2"}
                className="w-full text-[16px] text-gray-900 bg-transparent border-none outline-none p-0 resize-none placeholder:text-gray-300 leading-relaxed"
              />
              <p className="text-[11px] text-gray-400 mt-2">One product per line · same as your regular email</p>
            </label>
          </div>
        </div>

        {/* Ship To */}
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1 mb-2">Ship To</p>
          <div className="bg-white rounded-[13px] shadow-sm border border-gray-100 overflow-hidden">
            <label className="block p-4">
              <textarea
                value={shipTo}
                onChange={(e) => setShipTo(e.target.value)}
                rows={2}
                placeholder="Site name or alternate delivery address"
                className="w-full text-[16px] text-gray-900 bg-transparent border-none outline-none p-0 resize-none placeholder:text-gray-300 leading-relaxed"
              />
            </label>
          </div>
        </div>

        {/* Dispatch */}
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1 mb-2">Dispatch</p>
          <div className="bg-white rounded-[13px] shadow-sm border border-gray-100 p-3">
            <div className="grid grid-cols-3 gap-2">
              <DispatchChip
                label="Normal"
                selected={dispatch === "normal"}
                onClick={() => setDispatch("normal")}
                selectedCls="border-teal-500 bg-teal-50 text-teal-700 font-semibold"
              />
              <DispatchChip
                label="Hold"
                selected={dispatch === "hold"}
                onClick={() => setDispatch("hold")}
                selectedCls="border-red-300 bg-red-50 text-red-700 font-semibold"
              />
              <DispatchChip
                label="Urgent"
                selected={dispatch === "urgent"}
                onClick={() => setDispatch("urgent")}
                selectedCls="border-amber-300 bg-amber-50 text-amber-700 font-semibold"
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="mb-6">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-1 mb-2">Preview</p>
          <div className="bg-white rounded-[13px] shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-[11px] font-medium text-gray-400 mb-0.5">To</p>
              <p className="text-[13px] text-gray-700">{ORDER_TO}</p>
            </div>
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-[11px] font-medium text-gray-400 mb-0.5">Subject</p>
              {tName ? (
                <p className="font-mono text-[13px] text-gray-800 break-words">{subject}</p>
              ) : (
                <p className="font-mono text-[13px] italic text-gray-300">Subject will appear here</p>
              )}
            </div>
            <div className="px-4 py-3">
              <p className="text-[11px] font-medium text-gray-400 mb-0.5">Body</p>
              {body ? (
                <p className="font-mono text-[13px] text-gray-800 whitespace-pre-wrap break-words">{body}</p>
              ) : (
                <p className="font-mono text-[13px] italic text-gray-300">Body will appear here</p>
              )}
            </div>
          </div>
        </div>

        {/* Send */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={`w-full h-[52px] rounded-[13px] text-[16px] font-semibold transition-colors ${
            canSend
              ? "bg-teal-600 hover:bg-teal-700 text-white"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          Send Order
        </button>
        <p className="text-[11px] text-gray-400 text-center mt-2">
          Opens your mail app · ready to send
        </p>

      </div>
    </main>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

interface DispatchChipProps {
  label:       string;
  selected:    boolean;
  onClick:     () => void;
  selectedCls: string;
}

function DispatchChip({ label, selected, onClick, selectedCls }: DispatchChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-[44px] rounded-[10px] border text-[14px] transition-colors ${
        selected ? selectedCls : "border-gray-200 bg-white text-gray-400"
      }`}
    >
      {label}
    </button>
  );
}
