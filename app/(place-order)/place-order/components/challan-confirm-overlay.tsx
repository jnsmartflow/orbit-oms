"use client";

import { useEffect } from "react";

// Challan order confirm (Challan orders slice 3, 2026-10-07 — mockup
// docs/mockups/challan-orders/place-order.html state 5). A sibling of
// send-confirm-overlay.tsx with the same shell and keys: Enter or / creates,
// Esc or * cancels. CLAUDE_UI §13: bg-black/40 backdrop, gray-900 confirm (never
// brand). While `busy` the keys and both buttons do nothing — the one guard
// against a double press creating two ORB orders.

interface ChallanConfirmOverlayProps {
  billToName:  string;
  billToCode:  string;
  shipToText:  string;
  dispatch:    string;
  goodsLine:   string;   // "1 line · 36 tins · 18 L"
  goodsDetail: string;   // "Gloss · Black · 500ML ×36"
  busy:        boolean;
  error:       string | null;
  onCreate:    () => void;
  onCancel:    () => void;
}

export default function ChallanConfirmOverlay({
  billToName, billToCode, shipToText, dispatch, goodsLine, goodsDetail, busy, error, onCreate, onCancel,
}: ChallanConfirmOverlayProps): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (busy) return;
      if (e.key === "Enter" || e.key === "/") {
        e.preventDefault();
        onCreate();
      } else if (e.key === "Escape" || e.key === "*") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCreate, onCancel]);

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex gap-2 text-[12px] py-[5px]">
      <span className="w-[70px] shrink-0 text-[10.5px] uppercase tracking-wide text-gray-400 pt-0.5">{k}</span>
      <span className="text-gray-900 min-w-0">{v}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-6">
      <div role="dialog" aria-label="Create challan order" className="w-[470px] max-w-full bg-white rounded-[12px] shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-[14px] font-semibold text-gray-900">Send goods WITHOUT a bill?</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            Creates an Orbit challan order and sends it straight to picking. No email is sent.
          </div>
        </div>

        <div className="mx-5 mt-3.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-[8px] text-[12px] text-amber-700 leading-snug">
          <b>No SAP bill yet.</b> Billing must paste the SAP SO against the ORB number in{" "}
          <b>Billing › Challan orders</b> before the OBD file is imported.
        </div>

        <div className="px-5 pt-3.5 pb-4">
          {row("Bill to", (
            <>
              {billToName}
              <span className="font-mono text-[11px] text-gray-400 ml-1">{billToCode}</span>
              <span className="block text-[11px] text-gray-500 mt-px">The dealer SAP will bill</span>
            </>
          ))}
          {row("Ship to", shipToText)}
          {row("Dispatch", dispatch)}
          {row("Goods", (
            <>
              <span className="font-semibold">{goodsLine}</span>
              <span className="block text-[11px] text-gray-500 mt-px">{goodsDetail}</span>
            </>
          ))}
          {error && (
            <div role="alert" className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-[8px] text-[12px] text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
          <div className="text-[10px] text-gray-400">
            <span className="font-mono bg-white border border-gray-200 rounded px-1.5 py-0.5">Enter</span>
            {" create · "}
            <span className="font-mono bg-white border border-gray-200 rounded px-1.5 py-0.5">Esc</span>
            {" cancel"}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="h-9 px-4 rounded-[8px] text-[13px] text-gray-600 border border-gray-200 hover:bg-white disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={onCreate}
              disabled={busy}
              className={`h-9 px-4 rounded-[8px] text-[13px] font-medium ${
                busy ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-gray-900 text-white hover:bg-gray-800"
              }`}
            >
              {busy ? "Creating…" : "Create challan order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
