"use client";

import { useEffect, useMemo, useState } from "react";
import type { Bill, CartLine, Customer } from "../types";
import { formatPack, packStep, packToKg, packToLitres, parsePackKey, sortPacks } from "@/lib/place-order/pack";
import type { EmailCallTarget, EmailDispatch, EmailMarker } from "@/lib/place-order/email";
import { getBaseAliasDisplay } from "@/lib/place-order/base-aliases";
import { emailLineLabel } from "@/lib/place-order/email";

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
  customers:       Customer[];                   // for the ship-to autocomplete
  bills:           Bill[];
  activeBillId:    number;
  justAddedKeys:   Record<string, true>;        // key = `${billId}|||${subProduct}|||${baseColour ?? ""}`
  shipTo:          string;
  dispatch:        EmailDispatch;
  callTarget:      EmailCallTarget;
  marker:          EmailMarker;
  crossDepot:      string | null;
  notes:           string;
  onSetActiveBill: (id: number) => void;
  onAddBill:       () => void;
  onDuplicateBill: (id: number) => void;
  onDeleteBill:    (id: number) => void;
  onShipToChange:  (value: string) => void;
  onDispatchChange:(value: EmailDispatch) => void;
  onCallTargetChange: (value: EmailCallTarget) => void;
  onMarkerChange:  (value: EmailMarker) => void;
  onCrossDepotChange: (value: string | null) => void;
  onNotesChange:   (value: string) => void;
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

// Cross-billing source depots + Notes quick-add presets — same sets the mobile
// /po page uses.
const CROSS_DEPOTS = ["Dahisar", "Ahmedabad", "Rajkot", "Pune"] as const;
const NOTE_PRESETS = ["Pls share DPL", "Pls send stickers"] as const;

// Order-remark options for the 2×2 grid. `stroke` is the idle icon colour
// (switches to teal when active); `paths` are the icon's inner svg elements.
const REMARKS: { value: EmailMarker; label: string; stroke: string; paths: React.JSX.Element }[] = [
  { value: "Truck", label: "Truck", stroke: "#475569",
    paths: (<><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17.5" cy="18" r="1.6" /></>) },
  { value: "Cross Delivery", label: "Cross", stroke: "#2563eb",
    paths: (<><path d="M4 8h11M4 8l3-3M4 8l3 3" /><path d="M20 16H9M20 16l-3-3M20 16l-3 3" /></>) },
  { value: "Bounce", label: "Bounce", stroke: "#2563eb",
    paths: (<><polyline points="9 15 4 10 9 5" /><path d="M4 10h11a5 5 0 0 1 5 5v2" /></>) },
  { value: "DTS", label: "DTS", stroke: "#b45309",
    paths: (<><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /></>) },
];

export default function CartPanel({
  customer, customers, bills, activeBillId, justAddedKeys,
  shipTo, dispatch, callTarget, marker, crossDepot, notes,
  onSetActiveBill, onAddBill, onDuplicateBill, onDeleteBill,
  onShipToChange, onDispatchChange, onCallTargetChange,
  onMarkerChange, onCrossDepotChange, onNotesChange,
  onRemovePack, onConfirmSend, canSend, sendButtonRef,
}: CartPanelProps): React.JSX.Element {

  const activeBill = bills.find((b) => b.id === activeBillId);
  const activeLines: CartLine[] = activeBill?.lines ?? [];

  // Footer total reflects the ACTIVE bill (the footer reads "Total · Bill N").
  // Send still emails every non-empty bill — this is display only.
  // Post-2026-05-12 flip: packQtys values are UNITS, so volume = units ×
  // litres-per-unit (no × packStep). Phase 3.5: keys are composite
  // "<packCode>|<unit>" (parsePackKey handles legacy bare keys). KG packs are
  // excluded from the L total per policy C1 and surfaced separately when > 0.
  const { totalLitres, totalKg } = useMemo<{ totalLitres: number; totalKg: number }>(() => {
    let litres = 0;
    let kg = 0;
    for (const line of activeLines) {
      for (const key of Object.keys(line.packQtys)) {
        const units = line.packQtys[key] ?? 0;
        if (units <= 0) continue;
        const { packCode, unit } = parsePackKey(key);
        litres += units * packToLitres(packCode, unit);
        kg     += units * packToKg(packCode, unit);
      }
    }
    return { totalLitres: litres, totalKg: kg };
  }, [activeLines]);

  const totalLines = activeLines.length;

  // Inline delete-confirm for the active bill (mockup). Reset whenever the
  // active bill changes so the confirm never lingers on the wrong bill.
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setConfirmDelete(false); }, [activeBillId]);

  // Ship-to autocomplete + Notes quick-add open state.
  const [shipFocused,  setShipFocused]  = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // Reuses CustomerSearch's suggestion filter (≥4 chars; digits → code prefix,
  // else name substring; cap 8). Selecting writes "Name (Code)" into shipTo.
  const shipSuggestions = useMemo<Customer[]>(() => {
    const q = shipTo.trim();
    if (q.length < 4) return [];
    const lower = q.toLowerCase();
    const digitsOnly = /^\d+$/.test(q);
    if (digitsOnly) return customers.filter((c) => c.code.includes(q)).slice(0, 8);
    return customers.filter((c) => c.name.toLowerCase().includes(lower)).slice(0, 8);
  }, [shipTo, customers]);

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

      {/* Bill bar — always shown once a customer is locked, so "+ Add" is
          reachable from the single-bill state. Neutral tabs (no teal). */}
      {customer && (
        <div className="px-3 py-[9px] border-b border-gray-100 flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-[8px] p-[3px]">
            {bills.map((bill) => {
              const isActive = bill.id === activeBillId;
              return (
                <button
                  key={bill.id}
                  type="button"
                  onClick={() => onSetActiveBill(bill.id)}
                  className={`text-[12px] px-[11px] py-1 rounded-[6px] whitespace-nowrap transition-colors duration-75 ${
                    isActive
                      ? "bg-white text-gray-900 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Bill {bill.id}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onAddBill}
            title="Add bill"
            aria-label="Add bill"
            className="w-[26px] h-[26px] rounded-[7px] border border-dashed border-gray-300 text-gray-400 hover:text-gray-600 hover:border-gray-400 flex items-center justify-center flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onDuplicateBill(activeBillId)}
            title="Duplicate bill"
            aria-label="Duplicate active bill"
            className="w-[26px] h-[26px] rounded-[7px] text-gray-400 hover:bg-gray-100 hover:text-gray-600 flex items-center justify-center flex-shrink-0"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            type="button"
            disabled={bills.length === 1}
            onClick={() => {
              if (!activeBill) return;
              if (activeBill.lines.length === 0) onDeleteBill(activeBillId);
              else setConfirmDelete(true);
            }}
            title="Delete bill"
            aria-label="Delete active bill"
            className={`w-[26px] h-[26px] rounded-[7px] flex items-center justify-center flex-shrink-0 ${
              bills.length === 1
                ? "text-gray-200 cursor-not-allowed"
                : "text-gray-400 hover:bg-red-50 hover:text-red-600"
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>
      )}

      {/* Inline delete-confirm — only when the active bill has lines. */}
      {confirmDelete && activeBill && (
        <div className="px-[14px] py-[11px] bg-red-50 border-b border-red-100">
          <div className="text-[12.5px] text-red-800">
            Delete <span className="font-bold">Bill {activeBill.id}</span> and its {activeBill.lines.length} {activeBill.lines.length === 1 ? "line" : "lines"}?
          </div>
          <div className="flex gap-2 mt-[9px]">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="flex-1 h-[30px] border border-gray-200 bg-white rounded-[7px] text-[12px] text-gray-700 flex items-center justify-center hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { onDeleteBill(activeBillId); setConfirmDelete(false); }}
              className="flex-1 h-[30px] bg-red-600 text-white rounded-[7px] text-[12px] font-medium flex items-center justify-center hover:bg-red-700"
            >
              Delete bill
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3">
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
                    // Use baseColour when it carries a real variant token, but
                    // fall through on EMPTY string too (not just null) — Interior
                    // WBC has baseColour "" which `??` wouldn't catch, leaving the
                    // name blank ("· 1L"). For empty/null base, use the shared
                    // email label (product ?? subProduct, with de-double) so the
                    // cart line matches the email name ("INTERIOR WBC").
                    const baseLabel =
                      line.baseColour && line.baseColour.trim()
                        ? line.baseColour
                        : emailLineLabel(line.product ?? null, line.baseColour, line.subProduct);
                    const baseAlias = getBaseAliasDisplay(line.product, line.baseColour);
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
                      const step      = packStep(packLabel, line.product ?? line.subProduct);
                      const isClean   = step > 1 && units > 0 && units % step === 0;
                      return (
                        <div
                          key={`${lineKey(line.productId, line.subProduct, line.baseColour)}|${packCompositeKey}`}
                          className={`group flex items-center justify-between text-[12.5px] py-1.5 px-1 -mx-1 rounded transition-colors duration-150 hover:bg-gray-50 ${
                            isFlashed ? "animate-cart-flash" : ""
                          }`}
                        >
                          <span className="text-gray-800">
                            {baseLabel}{baseAlias && <span className="font-normal text-gray-400"> · {baseAlias}</span>} · {packLabel}
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

        {/* ── Order options — always visible (no "More options" collapse) ── */}
        {customer && (
          <>
            {/* Ship to */}
            <div className="px-4 py-[13px] border-t border-gray-100">
              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 mb-2">Ship to</p>
              <div className="relative">
                <span className="absolute left-[11px] top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                </span>
                <input
                  type="text"
                  value={shipTo}
                  onChange={(e) => onShipToChange(e.target.value)}
                  onFocus={() => setShipFocused(true)}
                  onBlur={() => setTimeout(() => setShipFocused(false), 120)}
                  placeholder="Same as billing"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full h-[38px] pl-[34px] pr-3 text-[13px] text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-[9px] bg-white focus:border-teal-500 focus:outline-none"
                />
                {shipFocused && shipSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-[42px] z-30 bg-white border border-gray-200 rounded-[8px] shadow-lg overflow-hidden">
                    {shipSuggestions.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); onShipToChange(`${c.name} (${c.code})`); setShipFocused(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left border-b border-gray-50 last:border-b-0 hover:bg-gray-50"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] text-gray-900 truncate">{c.name}</span>
                          <span className="block text-[11px] text-gray-400 font-mono truncate">
                            {c.code}{c.area && <span className="font-sans"> · {c.area}</span>}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Dispatch */}
            <div className="px-4 py-[13px] border-t border-gray-100">
              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 mb-2">Dispatch</p>
              <div className="flex gap-[7px]">
                {([
                  { value: "Normal", dot: "#0d9488" },
                  { value: "Urgent", dot: "#f59e0b" },
                  { value: "Call",   dot: "#ef4444" },
                ] as const).map((d) => {
                  const on = dispatch === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => { onDispatchChange(d.value); if (d.value !== "Call") onCallTargetChange(null); }}
                      className={`flex-1 h-10 rounded-[9px] border text-[12.5px] flex items-center justify-center gap-1.5 transition-colors ${
                        on ? "border-teal-500 bg-teal-50 text-teal-700 font-medium" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: d.dot }} />
                      {d.value}
                    </button>
                  );
                })}
              </div>
              {dispatch === "Call" && (
                <div className="flex items-center gap-1.5 mt-[9px] px-2.5 py-2 bg-gray-50 rounded-[9px]">
                  <span className="text-[11px] text-gray-400 shrink-0">Call:</span>
                  {(["SO", "Dealer"] as const).map((t) => {
                    const on = (callTarget ?? "SO") === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onCallTargetChange(t)}
                        className={`h-7 px-[13px] rounded-[14px] border text-[11.5px] flex items-center transition-colors ${
                          on ? "border-teal-500 bg-teal-50 text-teal-700 font-medium" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Order remarks */}
            <div className="px-4 py-[13px] border-t border-gray-100">
              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 mb-2">
                Order remarks <span className="text-gray-300 font-medium normal-case tracking-normal">· optional</span>
              </p>
              <div className="grid grid-cols-2 gap-[7px]">
                {REMARKS.map((m) => {
                  const on = marker === m.value;
                  return (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() => {
                        if (marker === m.value) { onMarkerChange(null); onCrossDepotChange(null); }
                        else { onMarkerChange(m.value); if (m.value !== "Cross Delivery") onCrossDepotChange(null); }
                      }}
                      className={`h-[42px] rounded-[9px] border text-[12.5px] flex items-center justify-center gap-[7px] transition-colors ${
                        on ? "border-teal-500 bg-teal-50 text-teal-700 font-medium" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on ? "#0f766e" : m.stroke} strokeWidth="1.8">
                        {m.paths}
                      </svg>
                      {m.label}
                    </button>
                  );
                })}
              </div>
              {marker === "Cross Delivery" && (
                <div className="flex items-center gap-1.5 mt-[9px] px-2.5 py-2 bg-gray-50 rounded-[9px] flex-wrap">
                  <span className="text-[11px] text-gray-400 shrink-0">From:</span>
                  {CROSS_DEPOTS.map((depot) => {
                    const on = crossDepot === depot;
                    return (
                      <button
                        key={depot}
                        type="button"
                        onClick={() => onCrossDepotChange(depot)}
                        className={`h-7 px-[13px] rounded-[14px] border text-[11.5px] flex items-center transition-colors ${
                          on ? "border-teal-500 bg-teal-50 text-teal-700 font-medium" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {depot}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="px-4 py-[13px] border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">
                  Notes <span className="text-gray-300 font-medium normal-case tracking-normal">· optional</span>
                </p>
                <button
                  type="button"
                  onClick={() => setQuickAddOpen((o) => !o)}
                  className="text-[11.5px] font-medium text-teal-600 hover:text-teal-700"
                >
                  Quick add {quickAddOpen ? "▴" : "▾"}
                </button>
              </div>
              <textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder="Add a note…"
                rows={2}
                className="w-full min-h-[44px] px-[11px] py-[9px] text-[13px] text-gray-900 placeholder:text-gray-400 border border-gray-200 rounded-[9px] resize-none focus:border-teal-500 focus:outline-none"
              />
              {quickAddOpen && (
                <div className="flex items-center gap-1.5 mt-[7px] flex-wrap">
                  {NOTE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onNotesChange(notes.trim() ? `${notes.trim()}, ${preset}` : preset)}
                      className="h-7 px-[13px] rounded-[14px] border border-gray-200 bg-white text-[11.5px] text-gray-600 hover:bg-gray-50 flex items-center"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between pt-2 border-t border-gray-200 text-[12px]">
          <span className="text-gray-500">Total · Bill {activeBillId}</span>
          <span className="font-mono text-gray-900 font-semibold">
            {totalLines} {totalLines === 1 ? "line" : "lines"} · {formatLitres(totalLitres)} L
            {/* KG packs are excluded from the L total per policy C1 and
                surfaced as a tail when non-zero. */}
            {totalKg > 0 && ` · ${formatLitres(totalKg)} KG`}
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
