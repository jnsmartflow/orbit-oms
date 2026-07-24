"use client";

// Floor Control — Hold report preview + export (design §8, mockup 01-board.html
// `openSheet`). A modal shows the whole sheet on screen; Download triggers the
// browser's own print-to-PDF via window.print(). No PDF library — the print CSS
// (globals.css, #floor-hold-print-area block) isolates this sheet on paper.
//
// The sheet BODY (#floor-hold-print-area) is rendered in the page the whole time
// the modal is open, so window.print() has a real DOM node to reveal. On screen it
// lives inside the modal's scroll area; in print the @media block hides everything
// else and promotes it to the page. @page rules are top-level in globals.css — per
// CORE §3, never nested in @media print; isolation uses visibility:hidden, not
// display:none.

import { useMemo } from "react";
import { buildHoldPdf, bandSummary } from "@/lib/floor/hold-pdf";
import type { FloorHoldRow } from "@/lib/floor/types";

export function PdfPreview({
  rows,
  scope,
  onClose,
}: {
  rows: FloorHoldRow[];
  scope: string;
  onClose: () => void;
}) {
  // Freeze the clock at open time so the on-screen "as on" stamp and the printed
  // one match even if the user lingers before pressing Download.
  const doc = useMemo(() => buildHoldPdf(rows, scope, new Date()), [rows, scope]);
  const summary = bandSummary(doc);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-[680px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0_24px_60px_rgba(0,0,0,0.3)]">
        {/* Modal chrome — hidden in print via the existing global `.print-hide`
            helper (globals.css, challan @media print block). Belt-and-braces
            with the global `body * { visibility:hidden }`: this chrome sits
            OUTSIDE #floor-hold-print-area so it is never revealed anyway. */}
        <div className="print-hide flex items-center border-b border-gray-200 px-5 py-3.5">
          <span className="text-[13px] font-bold text-gray-900">Hold report preview</span>
          <button type="button" onClick={onClose} className="ml-auto text-[15px] leading-none text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {/* The printable sheet */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f9fafb] p-5">
          <div id="floor-hold-print-area" className="mx-auto max-w-[560px] bg-white p-7 text-[11px] text-gray-700">
            <h3 className="text-center text-[15px] font-bold text-gray-900">Orders on hold</h3>
            <div className="mt-1 text-center text-[10.5px] text-gray-500">
              JSW Dulux · Surat Depot · {doc.scopeLabel} · as on {doc.asOn}
            </div>

            {/* Age-band counts */}
            <div className="my-4 flex flex-wrap gap-x-6 gap-y-1.5 border-y border-[#f0f0f0] py-2 text-[10.5px] text-gray-500">
              <span>
                Total <b className="text-gray-900">{doc.total}</b>
              </span>
              {summary.map((s) => (
                <span key={s.label}>
                  {s.label} <b className="text-gray-900">{s.count}</b>
                </span>
              ))}
            </div>

            {/* Banded tables */}
            {doc.bands.map((band) => (
              <div key={band.key} className="mt-3 break-inside-avoid">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-500">
                  {band.label} · {band.rows.length}
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-[9px] uppercase tracking-[0.04em] text-gray-400">
                      <th className="border-b border-gray-200 px-2 py-1 font-medium">OBD</th>
                      <th className="border-b border-gray-200 px-2 py-1 font-medium">Ship to</th>
                      <th className="border-b border-gray-200 px-2 py-1 font-medium">Route</th>
                      <th className="border-b border-gray-200 px-2 py-1 font-medium">Order date</th>
                      <th className="border-b border-gray-200 px-2 py-1 font-medium">Held since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {band.rows.map((r) => (
                      <tr key={r.obdNumber} className="text-[10px]">
                        <td className="border-b border-[#f5f5f5] px-2 py-1 font-mono text-gray-800">{r.obdNumber}</td>
                        <td className="border-b border-[#f5f5f5] px-2 py-1 text-gray-800">{r.shipTo}</td>
                        <td className="border-b border-[#f5f5f5] px-2 py-1">{r.route}</td>
                        <td className="border-b border-[#f5f5f5] px-2 py-1 text-gray-500">{r.orderDate}</td>
                        <td className="border-b border-[#f5f5f5] px-2 py-1 text-gray-500">{r.heldSince}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>

        {/* Footer — hidden in print via the same global `.print-hide` helper. */}
        <div className="print-hide flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-[30px] rounded-[6px] border border-gray-200 bg-white px-[14px] text-[11.5px] text-gray-500 hover:border-gray-300 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="h-[30px] rounded-[6px] bg-teal-600 px-[14px] text-[11.5px] font-semibold text-white hover:bg-teal-700"
          >
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
