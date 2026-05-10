"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "../types";
import { formatPack, packStep, sortPacks } from "@/lib/place-order/pack";
import VariantCell, { type CellNavDirection, type VariantCellHandle } from "./variant-cell";

// Inline expanded panel — full-width row inside the category grid (planning
// doc §6.7). Header (40×40 photo + family + meta + close) → product chip
// ribbon (when >1 subProduct) → optional filter input (≥6 bases) →
// variant table → bottom keyhint bar.
//
// Variant table rows are baseColours of the active subProduct; columns are
// the union of all packs across those bases, sorted ascending by ML. Each
// cell is "available" iff the row's product entry has the column's pack
// in its packs[] array — otherwise NA per planning doc §7.3.
//
// Phase 5 keyboard model:
//   - First available cell auto-focuses on family / activeSubProduct change
//   - focusHintBase lets the parent target a specific base-row after a
//     search-select hand-off (planning doc §8.3 "first matching base-row")
//   - Cell ←/→/↑/↓ skip NA cells via the cellMatrix walker
//   - Chip ribbon owns 1-9 to switch product (planning doc §8.4 last row)

interface ExpandedPanelProps {
  family:             string;
  imageSlug:          string;
  imageFailed:        boolean;
  products:           Product[];                        // products in this family only
  activeSubProduct:   string;
  onSubProductChange: (subProduct: string) => void;
  qtyAt:              (subProduct: string, baseColour: string | null, pack: string) => number;
  onSetQty:           (product: Product, pack: string, qty: number) => void;
  onClose:            () => void;
  focusHintBase?:     string | null;   // target base-row when auto-focusing (search-select)
  onFocused?:         () => void;      // called after the panel consumes focusHintBase
}

const FILTER_THRESHOLD = 6;

export default function ExpandedPanel({
  family,
  imageSlug,
  imageFailed,
  products,
  activeSubProduct,
  onSubProductChange,
  qtyAt,
  onSetQty,
  onClose,
  focusHintBase,
  onFocused,
}: ExpandedPanelProps): React.JSX.Element {
  const [filter, setFilter] = useState("");
  // 2D ref grid: cellRefs.current[row][col] → VariantCellHandle | null.
  // Populated via the ref-callback inside the .map below. NA cells skip
  // the assignment (they're plain divs with no handle).
  const cellRefs = useRef<Array<Array<VariantCellHandle | null>>>([]);

  // Distinct subProducts in stable order (data is already sorted by sortOrder
  // in the API). Top of array is the auto-active first product.
  const subProducts = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of products) {
      if (!seen.has(p.subProduct)) {
        seen.add(p.subProduct);
        out.push(p.subProduct);
      }
    }
    return out;
  }, [products]);

  // Products belonging to the active subProduct — these are the rows.
  const activeProductRows = useMemo<Product[]>(
    () => products.filter((p) => p.subProduct === activeSubProduct),
    [products, activeSubProduct],
  );

  // Filter applies only when there are ≥6 bases. Substring, case-insensitive,
  // matches against baseColour string. PLAIN rows (baseColour null) are kept.
  const filteredRows = useMemo<Product[]>(() => {
    if (activeProductRows.length < FILTER_THRESHOLD) return activeProductRows;
    const q = filter.trim().toLowerCase();
    if (!q) return activeProductRows;
    return activeProductRows.filter((p) =>
      (p.baseColour ?? "").toLowerCase().includes(q),
    );
  }, [activeProductRows, filter]);

  // Column set: union of packs across all rows of the active subProduct,
  // sorted ascending by ML so 50ML < 1L < 20L.
  const columns = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const p of activeProductRows) {
      for (const pack of p.packs) set.add(pack);
    }
    return sortPacks(Array.from(set));
  }, [activeProductRows]);

  // cellMatrix[row][col] = true when the (row's product, col's pack) combo
  // exists. Used for auto-focus and arrow-nav NA-skip.
  const cellMatrix = useMemo<boolean[][]>(() => {
    return filteredRows.map((row) => {
      const allowed = new Set(row.packs);
      return columns.map((pack) => allowed.has(pack));
    });
  }, [filteredRows, columns]);

  // Reset stale entries when the row count shrinks. We don't proactively
  // null cells — React's ref-callback handles cleanup on unmount — but we
  // do trim the outer array length to match.
  if (cellRefs.current.length > filteredRows.length) {
    cellRefs.current.length = filteredRows.length;
  }

  // Latest-callback ref for onFocused. The parent passes a fresh arrow each
  // render (`() => setFocusHintBase(null)`), so reading via ref keeps the
  // auto-focus effect from re-firing when nothing meaningful has changed.
  const onFocusedRef = useRef(onFocused);
  useEffect(() => { onFocusedRef.current = onFocused; });

  // Prev-tracking refs gate the auto-focus effect to fire ONLY on real
  // transitions: panel-just-opened (family transition), active subProduct
  // change, or focusHintBase newly set by the parent's search-select
  // hand-off. Without these, every cell keystroke would re-trigger the
  // useEffect (via onFocused / cartLines render churn) and yank focus
  // back to the first cell — bug 1 in Phase 5 testing.
  const prevFamilyRef     = useRef<string | null>(null);
  const prevSubProductRef = useRef<string | null>(null);
  const prevHintRef       = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const familyChanged     = prevFamilyRef.current     !== family;
    const subProductChanged = prevSubProductRef.current !== activeSubProduct;
    const hintChanged       = prevHintRef.current       !== focusHintBase;
    const hintNewlySet      = hintChanged && focusHintBase !== undefined && focusHintBase !== null;

    prevFamilyRef.current     = family;
    prevSubProductRef.current = activeSubProduct;
    prevHintRef.current       = focusHintBase;

    // Bail out on noise renders (cart updates, filter changes, etc.).
    if (!familyChanged && !subProductChanged && !hintNewlySet) return;

    function focusCell(r: number, c: number): boolean {
      const handle = cellRefs.current[r]?.[c];
      if (!handle) return false;
      handle.focus();
      onFocusedRef.current?.();
      return true;
    }

    // Hint row first (search-select hand-off).
    let hintRow = -1;
    if (hintNewlySet) {
      hintRow = filteredRows.findIndex((row) => (row.baseColour ?? "") === focusHintBase);
    }
    if (hintRow >= 0) {
      const rowCount = cellMatrix[hintRow]?.length ?? 0;
      for (let c = 0; c < rowCount; c++) {
        if (cellMatrix[hintRow]?.[c] && focusCell(hintRow, c)) return;
      }
    }

    // Fallback: first available cell anywhere.
    for (let r = 0; r < cellMatrix.length; r++) {
      for (let c = 0; c < cellMatrix[r].length; c++) {
        if (cellMatrix[r][c] && focusCell(r, c)) return;
      }
    }
  }, [family, activeSubProduct, focusHintBase, filteredRows, cellMatrix]);

  // Arrow nav across the cellMatrix — walks in the given direction past NA
  // cells until it hits a focusable cell or the edge. "enter" behaves as
  // "down" per planning doc §8.4 (Excel convention).
  function onCellNav(direction: CellNavDirection, fromRow: number, fromCol: number): void {
    const stepR =
      direction === "down" || direction === "enter" ? 1 :
      direction === "up"                             ? -1 :
      0;
    const stepC =
      direction === "right" ? 1 :
      direction === "left"  ? -1 :
      0;
    if (stepR === 0 && stepC === 0) return;

    let r = fromRow + stepR;
    let c = fromCol + stepC;
    while (
      r >= 0 && r < cellMatrix.length &&
      c >= 0 && c < columns.length
    ) {
      if (cellMatrix[r]?.[c]) {
        cellRefs.current[r]?.[c]?.focus();
        return;
      }
      r += stepR;
      c += stepC;
    }
    // Off-grid — focus stays.
  }

  // Chip ribbon 1-9 — switch active subProduct. Active when a chip button
  // has focus (Tab back from cells or click). 1-9 elsewhere is handled by
  // the page router (grid context) or by the cell input (cell context).
  function handleChipKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void {
    if (!/^[1-9]$/.test(e.key)) return;
    const idx = parseInt(e.key, 10) - 1;
    const target = subProducts[idx];
    if (target) {
      e.preventDefault();
      onSubProductChange(target);
    }
  }

  // Header meta — total products + total SKUs (sum of pack counts) for this
  // family, plus active product's row + colour count.
  const totalSkus     = products.reduce((acc, p) => acc + p.packs.length, 0);
  const productCount  = subProducts.length;
  const activeBaseCount = activeProductRows.length;

  return (
    <div className="col-span-full bg-white border border-teal-600 rounded-[12px] shadow-[0_4px_16px_rgba(13,148,136,0.06)] overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 pt-[14px] pb-0 px-[18px]">
        <div className="flex items-center gap-[14px] mb-[10px]">
          <span className="inline-flex items-center gap-[10px]">
            <span className="w-10 h-10 rounded-[8px] overflow-hidden flex items-center justify-center bg-[#fafbfc] border border-gray-100 shrink-0">
              {imageFailed ? (
                <span
                  className="text-white text-[12px] font-bold tracking-wide w-full h-full flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #374151, #111827)" }}
                >
                  {family.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?"}
                </span>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/category-images/${imageSlug}.png`}
                  alt={family}
                  className="max-w-[34px] max-h-[34px] object-contain"
                />
              )}
            </span>
            <span className="text-[14px] font-semibold text-teal-700 tracking-[0.01em]">
              {family}
            </span>
          </span>
          <span className="text-[11px] text-gray-400">
            {totalSkus === 0 ? (
              <span className="italic">Catalog awaiting pack configuration</span>
            ) : (
              <>
                <span className="text-gray-600">{productCount}</span> product{productCount === 1 ? "" : "s"}
                {" · "}
                <span className="text-gray-600">{totalSkus}</span> SKUs
                {" · "}
                <span className="text-gray-600">{activeBaseCount}</span> base{activeBaseCount === 1 ? "" : "s"} for {activeSubProduct}
              </>
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-500 hover:text-gray-900 px-[10px] py-[5px] rounded-[6px] text-[11px] inline-flex items-center gap-[6px] hover:bg-gray-50"
            aria-label="Close panel"
          >
            <span className="text-[14px] leading-none">×</span> close
          </button>
        </div>

        {/* Product chip ribbon — only when >1 subProduct */}
        {subProducts.length > 1 && (
          <div className="-mx-[18px] px-[18px] pb-[10px] border-b border-gray-100 flex items-center gap-[6px] flex-wrap">
            <span className="text-[9px] uppercase tracking-[0.08em] text-gray-400 font-medium mr-1">
              Product
            </span>
            {subProducts.map((sp, i) => {
              const isActive = sp === activeSubProduct;
              return (
                <button
                  key={sp}
                  type="button"
                  onClick={() => onSubProductChange(sp)}
                  onKeyDown={handleChipKeyDown}
                  className={`h-7 px-3 rounded-[6px] border text-[11px] font-medium inline-flex items-center gap-[6px] ${
                    isActive
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {i < 9 && (
                    <span
                      className={`text-[9px] font-mono font-semibold rounded px-[4px] ${
                        isActive ? "bg-white/[.18] text-white" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {i + 1}
                    </span>
                  )}
                  {sp}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Filter row — only when active subProduct has ≥6 bases */}
      {activeProductRows.length >= FILTER_THRESHOLD && (
        <div className="px-[18px] py-2 flex items-center bg-[#fafbfc] border-b border-gray-100 text-[11px] text-gray-400 gap-3">
          <div className="relative ml-auto">
            <svg
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter colours…"
              className="h-[26px] w-[180px] border border-gray-200 rounded-[5px] bg-white pl-7 pr-2 text-[11px] text-gray-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
            />
          </div>
        </div>
      )}

      {/* Variant table */}
      <div className="pt-[6px]">
        {columns.length === 0 ? (
          <div className="flex items-center justify-center min-h-[140px] px-[18px] text-xs text-gray-400 italic">
            No packs configured yet
          </div>
        ) : (
        <table className="w-full border-collapse text-[12px]" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th className="text-left pl-[18px] pr-2 py-[10px] bg-[#fafbfc] border-b border-gray-100 text-[10px] uppercase tracking-[0.06em] text-gray-400 font-medium w-[200px]">
                Base / Colour
              </th>
              {columns.map((pack) => {
                const label = formatPack(pack);
                const step  = packStep(label);
                return (
                  <th
                    key={pack}
                    className="text-center px-2 py-[8px] bg-[#fafbfc] border-b border-gray-100 text-[11px] text-gray-700 font-medium"
                  >
                    <span className="block text-[11.5px] text-gray-900 font-semibold leading-tight">
                      {label}
                    </span>
                    <span className="block text-[9.5px] text-gray-400 font-mono mt-[2px]">
                      box of {step}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-[18px] py-6 text-center text-[12px] text-gray-400 italic"
                >
                  No bases match {`"${filter}"`}.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, rowIdx) => {
                const baseLabel = row.baseColour ?? row.displayName;
                const allowed   = new Set(row.packs);
                if (!cellRefs.current[rowIdx]) cellRefs.current[rowIdx] = [];
                return (
                  <tr key={`${row.subProduct}|||${row.baseColour ?? ""}`} className="border-b border-gray-100 last:border-b-0">
                    <td className="pl-[18px] pr-3 h-[44px] text-[12.5px] font-medium text-gray-900 align-middle">
                      {baseLabel}
                    </td>
                    {columns.map((pack, colIdx) => {
                      const isAvailable = allowed.has(pack);
                      const qty         = qtyAt(row.subProduct, row.baseColour ?? null, pack);
                      return (
                        <td key={pack} className="text-center p-1 align-middle">
                          <VariantCell
                            ref={(handle) => {
                              if (!cellRefs.current[rowIdx]) cellRefs.current[rowIdx] = [];
                              cellRefs.current[rowIdx][colIdx] = handle;
                            }}
                            qty={qty}
                            isAvailable={isAvailable}
                            rowIdx={rowIdx}
                            colIdx={colIdx}
                            onSetQty={(next) => onSetQty(row, pack, next)}
                            onCellNav={onCellNav}
                            onClose={onClose}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        )}
      </div>

      {/* Bottom keyhint bar — live key map for the cell context. */}
      <div className="px-[18px] py-2 bg-[#fafbfc] border-t border-gray-100 text-[10px] text-gray-400 flex items-center gap-[14px] flex-wrap font-mono">
        <span>↑↓←→ move</span>
        <span>Tab next</span>
        <span>Enter ↓</span>
        <span>+/− adjust</span>
        <span>0–9 type qty</span>
        <span>* / Esc close</span>
        <span className="ml-auto italic">/ to send</span>
      </div>
    </div>
  );
}
