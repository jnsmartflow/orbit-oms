"use client";

// Floor Control — detail panel, the INVOICES section (2026-10-10, Add invoices,
// Phase 2 RECORD ONLY). Sits at the top of the Items tab.
//
//   unsplit → SAP's invoice number only (or "no SAP invoice yet")
//   split   → each invoice with its lines (SKU, description, tins, litres) and
//             ~kg — the OBD's kg shared by litres (lib/order-invoices/entry.ts
//             kgShare; kg per invoice is derived, never stored)
//   stale   → amber "Lines changed in SAP — re-check invoices" + Edit
//
// Reads GET /api/floor/orders/[orderId]/invoices itself (the detail payload does
// not carry invoices), again whenever `refreshKey` moves — floor-page bumps it
// after a save / undo, and with the live feed's change signal for this bill.

import { useEffect, useState } from "react";
import { kgShare, lineLitres } from "@/lib/order-invoices/entry";
import type { SplitView } from "@/lib/order-invoices/split";
import { formatLitres } from "./status-pill";

export function DetailInvoices({
  orderId,
  obdKg,
  canAddInvoices,
  refreshKey,
  onEdit,
}: {
  orderId: number;
  /** The OBD's header kg (board row weightKg); null = unknown → no ~kg. */
  obdKg: number | null;
  /** Edit is offered only with the tick AND a live (not history) panel. */
  canAddInvoices: boolean;
  refreshKey: number;
  onEdit: () => void;
}) {
  const [view, setView] = useState<SplitView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/floor/orders/${orderId}/invoices`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Partial<SplitView> & { error?: string };
        if (cancelled) return;
        if (!res.ok || !Array.isArray(body.invoices)) {
          setError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        setError(null);
        setView(body as SplitView);
      } catch {
        if (!cancelled) setError("Could not load invoices");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, refreshKey]);

  if (error) return <div className="border-b border-[#f0f0f0] px-5 py-2.5 text-[11.5px] text-gray-400">Invoices: {error}</div>;
  if (!view) return null;

  const lineById = new Map(view.activeLines.map((l) => [l.rawLineItemId, l]));
  const obdLitres = view.activeLines.reduce((s, l) => s + (l.volumeLine ?? 0), 0);
  const canEditHere = canAddInvoices && view.blockedReason === null;

  return (
    <div className="border-b border-[#f0f0f0] bg-[#fcfcfd] px-5 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-gray-500">
          Invoices{view.split ? ` · ${view.invoices.length}` : ""}
        </span>
        {canEditHere && (
          <button type="button" onClick={onEdit} className="ml-auto text-[11.5px] font-semibold text-brand-700 hover:underline">
            {view.split ? "Edit invoices" : "Add invoices"}
          </button>
        )}
      </div>

      {view.stale && (
        <div className="mt-2 flex items-center gap-2 rounded-[6px] bg-warn-bg px-2.5 py-1.5 text-[11.5px] text-warn-text">
          Lines changed in SAP — re-check invoices
          {canEditHere && (
            <button type="button" onClick={onEdit} className="ml-auto font-semibold underline">
              Edit
            </button>
          )}
        </div>
      )}

      {!view.split ? (
        <div className="mt-1.5 font-mono text-[12px] text-gray-900">
          {view.sapInvoice?.invoiceNo ?? <span className="font-sans text-gray-400">No SAP invoice yet</span>}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {view.invoices.map((inv) => {
            const litres = inv.lines.reduce((s, l) => {
              const line = lineById.get(l.rawLineItemId);
              return s + (line ? lineLitres(line.volumeLine, line.unitQty, l.qty) : 0);
            }, 0);
            const kg = kgShare(obdKg, litres, obdLitres);
            const tins = inv.lines.reduce((s, l) => s + l.qty, 0);
            return (
              <div key={inv.seq} className="rounded-[6px] border border-gray-200 bg-white">
                <div className="flex items-center gap-2 border-b border-gray-100 px-2.5 py-1.5 text-[11.5px]">
                  <span className="font-mono font-semibold text-gray-900">{inv.invoiceNo}</span>
                  {inv.source === "sap" && (
                    <span className="rounded-[3px] bg-gray-100 px-1 text-[9.5px] font-semibold text-gray-500">SAP</span>
                  )}
                  <span className="ml-auto tabular-nums text-gray-500">
                    {tins} tins · {formatLitres(litres)} L{kg !== null ? ` · ~${Math.round(kg).toLocaleString("en-IN")} kg` : ""}
                  </span>
                </div>
                {inv.lines.map((l) => {
                  const line = lineById.get(l.rawLineItemId);
                  return (
                    <div key={l.rawLineItemId} className="flex items-start gap-2 px-2.5 py-1 text-[11.5px]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-gray-800">
                          {line?.description ?? line?.skuCodeRaw ?? `Line ${l.rawLineItemId} (no longer on the bill)`}
                        </span>
                        {line && <span className="font-mono text-[10px] text-gray-400">{line.skuCodeRaw}</span>}
                      </span>
                      <span className="whitespace-nowrap font-semibold text-gray-700">{l.qty}×</span>
                      <span className="w-[52px] text-right tabular-nums text-gray-400">
                        {line ? `${formatLitres(lineLitres(line.volumeLine, line.unitQty, l.qty))} L` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
