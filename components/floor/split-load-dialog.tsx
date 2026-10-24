"use client";

// Floor Control — SPLIT LOAD (phase 3 commit 2, 2026-10-24): ONE SAP invoice
// row divided across trucks. The approved look and rules:
// docs/mockups/split-load/split-load-mockup.html.
//
// One row per product line of the SOURCE row (the whole bill when it is not
// split, else the ticked part). Truck A … the second-to-last are TYPED; the
// LAST truck takes the REST (auto, red when it goes below 0). "+ Add truck"
// inserts a typed truck before the last; ✕ on Truck C and later; "Split
// evenly". Each truck's tins · litres · kg at the foot — kg by the BOARD's own
// ladder (lib/order-invoices/load-dialog.ts → invoiceKg), "~" when shared.
// Save is enabled only when the SERVER's rule accepts it (splitErrorOf →
// planLoadSplit); the server still decides and its words are shown as they come.
//
// GET / POST /api/floor/orders/[orderId]/load-split. The GET is read HERE on
// open, never taken from the menu's copy: its expectKey must be fresh.
//
// ⚠ A MODAL OVER THE WHOLE PAGE (z-[120], above the detail panel's z-[110]) —
// the add-invoices-dialog.tsx pattern. ⚠ NO KEY LISTENER: floor-page.tsx is the
// single Esc owner (CLAUDE_FLOOR §4.6); it bumps `escSignal`.
//
// PHONE WIDTH: the panel is max-w-full; ONLY the table scrolls sideways (its
// own overflow-x-auto), never the page. Two trucks fit at 360 px.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LoadView } from "@/lib/order-invoices/load-split";
import { loadPartText } from "@/lib/order-invoices/load-plan";
import { MAX_INVOICES } from "@/lib/order-invoices/rules";
import {
  START_TRUCKS,
  addTruck,
  kgFactsOf,
  kgPerTinOf,
  loadRowsOfView,
  removeTruck,
  restOf,
  splitErrorOf,
  splitEvenly,
  startTyped,
  truckName,
  truckTotalOf,
  trucksOf,
  type DialogLine,
  type Typed,
} from "@/lib/order-invoices/load-dialog";
import { formatLitres, formatWeightKg } from "./status-pill";
import { BAR_PRIMARY, BAR_SECONDARY } from "./floor-action-bar";

type View = LoadView & { canEdit: boolean };

function kgText(kg: number | null, exact: boolean): string | null {
  const s = formatWeightKg(kg);
  return s === null ? null : `${exact ? "" : "~"}${s} kg`;
}

export function SplitLoadDialog({
  orderId,
  obdNumber,
  sourceRowId,
  escSignal,
  onClose,
  onSaved,
  onBusyChange,
}: {
  orderId: number;
  obdNumber: string;
  /** The invoice row to divide. null = the bill's own row (unsplit → seq 1 from the GET). */
  sourceRowId: number | null;
  /** Bumped by floor-page's Esc listener. */
  escSignal: number;
  onClose: () => void;
  /** Saved — the caller toasts and reloads the board (the Add invoices refresh). */
  onSaved: (trucks: number) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trucks, setTrucks] = useState(START_TRUCKS);
  const [typed, setTyped] = useState<Typed>([]);
  const [busy, setBusyState] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const setBusy = useCallback(
    (b: boolean) => {
      setBusyState(b);
      onBusyChange(b);
    },
    [onBusyChange],
  );
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/floor/orders/${orderId}/load-split`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Partial<View> & { error?: string };
        if (cancelled) return;
        if (!res.ok || !Array.isArray(body.rows)) {
          setLoadError(body.error ?? `Could not load this bill (HTTP ${res.status})`);
          return;
        }
        setView(body as View);
      } catch {
        if (!cancelled) setLoadError("Could not reach the server — check your connection.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const source = useMemo(() => {
    if (!view) return null;
    if (sourceRowId !== null) return view.rows.find((r) => r.id === sourceRowId) ?? null;
    return view.rows.length === 1 ? view.rows[0] : null;
  }, [view, sourceRowId]);

  // The source row's product lines, in the bill's own line order.
  const lines = useMemo<Array<DialogLine & { name: string; sku: string }>>(() => {
    if (!view || !source) return [];
    const qty = new Map(source.lines.map((l) => [l.rawLineItemId, l.qty]));
    return view.activeLines
      .filter((a) => (qty.get(a.rawLineItemId) ?? 0) > 0)
      .map((a) => ({ rawLineItemId: a.rawLineItemId, tins: qty.get(a.rawLineItemId)!, name: a.description ?? a.skuCodeRaw, sku: a.skuCodeRaw }));
  }, [view, source]);

  // Opening state once the lines are known.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || lines.length === 0) return;
    seeded.current = true;
    setTyped(startTyped(lines));
  }, [lines]);

  const facts = useMemo(() => (view ? kgFactsOf(view.activeLines, view.kg) : null), [view]);
  const rules = useMemo(() => (view ? loadRowsOfView(view.rows) : []), [view]);
  const ready = view !== null && source !== null && typed.length === lines.length && lines.length > 0;

  // Why Save is grey — the bill / row refusal first, then the trucks' own.
  const blocked =
    view === null
      ? null
      : !view.canEdit
        ? "You do not have the Split load tick"
        : view.blockedReason ?? (source ? source.canSplit : "This invoice is no longer on the bill — close and reopen");
  const typedError =
    ready && facts
      ? splitErrorOf({ rows: rules, sourceRowId: source!.id, lines, typed, trucks, active: view!.activeLines })
      : null;
  const reason = blocked ?? typedError;
  const canAddTruck = view !== null && view.rows.length + trucks <= MAX_INVOICES;

  const requestClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);
  const firstEsc = useRef(escSignal);
  useEffect(() => {
    if (escSignal === firstEsc.current) return;
    requestClose();
    // Only a NEW press acts; requestClose is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escSignal]);

  const setCell = (i: number, t: number, raw: string) => {
    setServerError(null);
    setTyped((prev) => prev.map((row, li) => (li === i ? row.map((v, ti) => (ti === t ? raw : v)) : row)));
  };

  const save = async () => {
    if (!ready || reason !== null || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      const res = await fetch(`/api/floor/orders/${orderId}/load-split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "split", sourceRowId: source!.id, expectKey: view!.expectKey, trucks: trucksOf(lines, typed, trucks) }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok !== true) {
        setServerError(body.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      onSaved(trucks);
    } catch {
      setServerError("Could not reach the server — check your connection. Reopen the bill to see whether it saved.");
    } finally {
      setBusy(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const partWord = source && source.n > 1 ? loadPartText(source.k, source.n) : "whole bill";
  const totals = ready && facts ? trucksOf(lines, typed, trucks).map((t) => truckTotalOf(t, facts)) : [];
  const TH = "whitespace-nowrap border-b border-ink-100 px-2 py-2 text-left text-[11px] font-semibold text-ink-600";
  const TD = "border-b border-ink-50 px-2 py-2 align-middle";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={requestClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Split load · ${obdNumber}`}
        className="flex max-h-[calc(100vh-40px)] w-[760px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 border-b border-ink-100 px-4 py-3.5 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold text-ink-900">
              Split load · <span className="font-mono">{source?.invoiceNo ?? obdNumber}</span>
              <span className="font-normal text-ink-600">
                {" "}
                · {partWord}
                {source?.isHeld ? " (held)" : ""}
              </span>
            </h3>
            <p className="mt-0.5 text-[12px] text-ink-500">Same invoice number on every truck · the last truck takes the rest</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            disabled={busy}
            className="ml-auto rounded-md px-2 py-1 text-[16px] text-ink-500 hover:bg-ink-50 hover:text-ink-900"
          >
            ✕
          </button>
        </div>

        {/* ── Body: ONLY this scrolls sideways at phone width ─────────────── */}
        <div className="min-h-0 flex-1 overflow-auto px-2 py-2 sm:px-4">
          {loadError ? (
            <p className="px-2 py-8 text-center text-[13px] text-danger-text">{loadError}</p>
          ) : !ready ? (
            <p className="px-2 py-8 text-center text-[13px] text-ink-500">
              {view && !source ? "This invoice is no longer on the bill — close and reopen." : "Loading…"}
            </p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={`${TH} min-w-[140px]`}>Product</th>
                  <th className={`${TH} text-right`}>Tins here</th>
                  {Array.from({ length: trucks }, (_, t) => (
                    <th key={t} className={`${TH} text-right`}>
                      <span className="inline-flex items-center justify-end gap-1">
                        {truckName(t)}
                        {t === trucks - 1 && <span className="font-normal text-ink-400">(rest)</span>}
                        {t >= 2 && (
                          <button
                            type="button"
                            title={`Remove ${truckName(t)}`}
                            aria-label={`Remove ${truckName(t)}`}
                            disabled={busy}
                            onClick={() => {
                              setTyped((p) => removeTruck(p, t, trucks));
                              setTrucks((n) => n - 1);
                            }}
                            className="text-[12px] text-ink-400 hover:text-danger"
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const perTin = facts ? kgPerTinOf(l.rawLineItemId, facts) : null;
                  return (
                    <tr key={l.rawLineItemId}>
                      <td className={`${TD} max-w-[220px]`}>
                        <span className="block truncate text-ink-900" title={l.name}>
                          {l.name}
                        </span>
                        <span className="block text-[11px] text-ink-500">
                          <span className="font-mono">{l.sku}</span>
                          {perTin !== null && <> · {perTin.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg per tin</>}
                        </span>
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{l.tins}</td>
                      {Array.from({ length: trucks }, (_, t) => {
                        if (t === trucks - 1) {
                          const rest = restOf(l, typed[i]);
                          return (
                            <td key={t} className={`${TD} text-right`}>
                              <span
                                className={`inline-block min-w-[56px] rounded-[6px] px-1.5 py-1 text-right tabular-nums ${
                                  rest < 0 ? "bg-danger-bg font-semibold text-danger-text" : "bg-ink-50 text-ink-600"
                                }`}
                              >
                                {rest}
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td key={t} className={`${TD} text-right`}>
                            <input
                              inputMode="numeric"
                              value={typed[i][t] ?? ""}
                              disabled={busy}
                              onChange={(e) => setCell(i, t, e.target.value)}
                              aria-label={`${truckName(t)}: tins of ${l.name}`}
                              className="h-[30px] w-[56px] rounded-[6px] border border-ink-200 px-1.5 text-right tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-ink-25">
                  <td className="px-2 py-2 font-semibold text-ink-700">Each truck carries</td>
                  <td />
                  {totals.map((x, t) => {
                    const kg = kgText(x.kg, x.kgExact);
                    return (
                      <td key={t} className="px-2 py-2 text-right font-semibold tabular-nums text-ink-900">
                        {x.tins} tins
                        <span className="block text-[11px] font-medium text-ink-600">
                          {formatLitres(x.litres)} L{kg ? ` · ${kg}` : ""}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-ink-100 bg-ink-25 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!ready || busy || !canAddTruck || blocked !== null}
              onClick={() => {
                setTyped((p) => addTruck(p));
                setTrucks((n) => n + 1);
              }}
              className="rounded-[8px] border border-dashed border-brand-600 bg-white px-3 py-1.5 text-[13px] font-semibold text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Add truck
            </button>
            <button
              type="button"
              disabled={!ready || busy || blocked !== null}
              onClick={() => setTyped(splitEvenly(lines, trucks))}
              className="rounded-[8px] border border-ink-200 bg-white px-3 py-1.5 text-[13px] text-ink-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Split evenly
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {(serverError ?? reason) && (
              <span role="status" className="text-[12.5px] text-danger-text">
                {serverError ?? reason}
              </span>
            )}
            <button type="button" onClick={requestClose} disabled={busy} className={BAR_SECONDARY}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={!ready || reason !== null || busy} className={BAR_PRIMARY}>
              {busy ? "Saving…" : "Save split"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * MERGE BACK asks first (owner answer 2, 2026-10-24): "Merge parts 2, 3 back
 * into part 1?" — a merge deletes rows. Centred, focus on Cancel, the scrim is
 * Cancel (the AddToTripConfirm pattern, trip-rail.tsx).
 */
export function LoadMergeConfirm({
  question,
  detail,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  question: string;
  detail: string | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={question}
        className="w-[420px] max-w-full rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[15px] font-semibold text-ink-900">{question}</p>
        {detail && <p className="mt-1 text-[12.5px] text-ink-600">{detail}</p>}
        {error && <p className="mt-2 text-[12.5px] text-danger-text">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className={BAR_SECONDARY}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={BAR_PRIMARY}>
            {busy ? "Merging…" : "Merge back"}
          </button>
        </div>
      </div>
    </div>
  );
}
