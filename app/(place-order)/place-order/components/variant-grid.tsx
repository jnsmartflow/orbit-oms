"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Product } from "../types";
import { formatPack, packContainerLabel, packStep, sortPacks } from "@/lib/place-order/pack";
import VariantCell, { type CellNavDirection, type VariantCellHandle } from "./variant-cell";

// Base × pack qty matrix. `products` is one row per baseColour for the
// active sub-product. Pack columns are the union of all packs across
// those rows, sorted ascending by ML.
//
// Composes existing variant-cell.tsx (decision D Stage 2) — keyboard
// semantics + ref-driven focus management already proven in production.

export interface VariantGridProps {
  products:          Product[];
  qtyAt:             (subProduct: string, baseColour: string | null, pack: string) => number;
  onSetQty:          (product: Product, pack: string, qty: number) => void;
  focusHintBase?:    string | null;
  onFocused?:        () => void;
  onEscape:          () => void;
  onNextSubProduct?: () => void;    // PageDown from cell → next tab (family/drilled-section only)
  onPrevSubProduct?: () => void;    // PageUp  from cell → previous tab
  onPageChange?:     (direction: -1 | 1) => void;   // `[` / `]` from cell → prev/next page (paginated sub-products only)
}

// v5: base column is fixed-width pixel (was 32% in v4). Pack columns omit
// width on <col> so table-layout:fixed distributes remaining table width
// evenly across them.
const BASE_COL_WIDTH_PX = 160;

// Pagination — sub-products with more bases than the THRESHOLD render
// across pages of PAGE_SIZE each (with the threshold > page-size buffer
// avoiding 1-row trailing pages). Today GLOSS (38 bases) and WS PROTECT
// (16 bases) paginate; all other 194 sub-products render single-page.
//
// Sort note: pagination ships as a MECHANISM only. Which bases land on
// which page is whatever catalog sortOrder returns today (alphabetical).
// Popularity ranking (most-ordered first) is pending a separate
// baseOrderRank migration on mo_order_form_index_v2.
export const VARIANT_GRID_PAGE_SIZE             = 15;
export const VARIANT_GRID_PAGINATION_THRESHOLD  = 17;

export default function VariantGrid({
  products, qtyAt, onSetQty, focusHintBase, onFocused, onEscape,
  onNextSubProduct, onPrevSubProduct, onPageChange,
}: VariantGridProps): React.JSX.Element {
  const packs = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const p of products) for (const pack of p.packs) set.add(pack);
    return sortPacks(Array.from(set));
  }, [products]);

  const cellMatrix = useMemo(() => {
    return products.map((product) =>
      packs.map((pack) => ({
        product,
        pack,
        available: product.packs.includes(pack),
      })),
    );
  }, [products, packs]);

  // 2D ref grid populated via ref callbacks below.
  const cellRefs = useRef<Array<Array<VariantCellHandle | null>>>([]);

  // Tracks the previous focusHintBase across renders. Used to detect the
  // "consumed → null" transition triggered by onFocused?.() inside the
  // effect — without this guard, the post-consumption re-render fires
  // the effect again with focusHintBase=null, defaulting targetRow to 0
  // and stealing focus from whichever base row we just landed on.
  const prevFocusHintRef = useRef<string | null | undefined>(undefined);

  // Auto-focus first available cell on mount / sub-product change / page
  // flip. When focusHintBase is set (search hand-off), target that
  // base-row.
  //
  // Deps key on `viewKey` (string fingerprint of the active sub-product +
  // first visible base) rather than the `products` array directly — the
  // dispatcher rebuilds `filtered` on every parent render, so a reference-
  // keyed dep would re-fire (and steal focus) on every keystroke / qty
  // edit. viewKey is by-value-stable across re-renders of the same slice.
  // Including the first row's baseColour means page flips also change the
  // viewKey → effect fires → first cell of new page focuses.
  const viewKey = `${products[0]?.family ?? ""}|${products[0]?.subProduct ?? ""}|${products[0]?.baseColour ?? ""}`;

  useEffect(() => {
    // Always update the ref so future transitions are detected correctly,
    // including the no-op-skip case below.
    const prevHint = prevFocusHintRef.current;
    prevFocusHintRef.current = focusHintBase;

    // Post-consumption clear: the previous run focused the hinted base
    // and called onFocused?.(), which set focusHintBase back to null and
    // triggered this re-fire. Skip — otherwise we'd default targetRow
    // to 0 and override the row we just focused.
    if (prevHint != null && focusHintBase == null) return;

    if (products.length === 0 || packs.length === 0) return;

    let targetRow = 0;
    if (focusHintBase != null) {
      // Normalize comparison — trim + lowercase — defensive against
      // whitespace / casing drift between search emission and catalog row.
      const normalize = (s: string): string => s.trim().toLowerCase();
      const target = normalize(focusHintBase);
      const idx    = products.findIndex((p) => normalize(p.baseColour ?? "") === target);
      if (idx >= 0) targetRow = idx;
    }

    let targetCol = -1;
    for (let c = 0; c < packs.length; c++) {
      if (cellMatrix[targetRow]?.[c]?.available) { targetCol = c; break; }
    }
    if (targetCol < 0) {
      outer: for (let r = 0; r < products.length; r++) {
        for (let c = 0; c < packs.length; c++) {
          if (cellMatrix[r]?.[c]?.available) { targetRow = r; targetCol = c; break outer; }
        }
      }
    }
    if (targetCol >= 0) {
      cellRefs.current[targetRow]?.[targetCol]?.focus();
    }
    onFocused?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, focusHintBase]);

  // Walk to next available cell in `direction`, skipping NA cells.
  function navigate(direction: CellNavDirection, fromRow: number, fromCol: number): void {
    const rows = products.length;
    const cols = packs.length;
    if (rows === 0 || cols === 0) return;

    if (direction === "left") {
      for (let c = fromCol - 1; c >= 0; c--) {
        if (cellMatrix[fromRow][c].available) {
          cellRefs.current[fromRow]?.[c]?.focus();
          return;
        }
      }
    } else if (direction === "right") {
      for (let c = fromCol + 1; c < cols; c++) {
        if (cellMatrix[fromRow][c].available) {
          cellRefs.current[fromRow]?.[c]?.focus();
          return;
        }
      }
    } else if (direction === "up") {
      for (let r = fromRow - 1; r >= 0; r--) {
        if (cellMatrix[r][fromCol].available) {
          cellRefs.current[r]?.[fromCol]?.focus();
          return;
        }
      }
    } else if (direction === "down" || direction === "enter") {
      for (let r = fromRow + 1; r < rows; r++) {
        if (cellMatrix[r][fromCol].available) {
          cellRefs.current[r]?.[fromCol]?.focus();
          return;
        }
      }
    }
  }

  if (products.length === 0 || packs.length === 0) {
    return (
      <div className="px-5 py-6 text-center text-[11px] text-gray-400 italic">
        No SKUs available for this sub-product.
      </div>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: `${BASE_COL_WIDTH_PX}px` }} />
        {packs.map((p) => (
          <col key={p} style={{ width: "80px" }} />
        ))}
      </colgroup>
      <thead>
        <tr className="bg-gray-100 border-b-2 border-gray-300">
          <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Base · Colour
          </th>
          {packs.map((pack) => {
            const label     = formatPack(pack);
            const container = packContainerLabel(label);
            return (
              <th key={pack} className="text-center px-1 py-2">
                <div className="text-[10.5px] font-semibold text-gray-700">
                  {label}
                  {container !== null && (
                    <> · <span className="font-mono text-gray-400">{container}</span></>
                  )}
                </div>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {products.map((product, rowIdx) => {
          const baseLabel = product.baseColour ?? "Plain";
          const isLastRow = rowIdx === products.length - 1;
          return (
            <tr
              key={`${product.subProduct}|||${product.baseColour ?? ""}`}
              className={`group/row ${isLastRow ? "" : "border-b border-gray-200"} hover:bg-amber-50/30 focus-within:bg-amber-50/70`}
            >
              <td className="px-3 py-2 border-l-[3px] border-l-transparent group-focus-within/row:border-l-amber-500">
                <div className="text-[12px] font-semibold text-gray-900 group-focus-within/row:font-bold">{baseLabel}</div>
              </td>
              {packs.map((pack, colIdx) => {
                const cell    = cellMatrix[rowIdx][colIdx];
                const qty     = cell.available
                  ? qtyAt(product.subProduct, product.baseColour ?? null, pack)
                  : 0;
                const boxSize = packStep(formatPack(pack));
                return (
                  <td key={pack} className="text-center py-1">
                    <VariantCell
                      ref={(handle) => {
                        if (!cellRefs.current[rowIdx]) cellRefs.current[rowIdx] = [];
                        cellRefs.current[rowIdx][colIdx] = handle;
                      }}
                      qty={qty}
                      boxSize={boxSize}
                      isAvailable={cell.available}
                      rowIdx={rowIdx}
                      colIdx={colIdx}
                      onSetQty={(q) => onSetQty(product, pack, q)}
                      onCellNav={navigate}
                      onClose={onEscape}
                      onNextSubProduct={onNextSubProduct}
                      onPrevSubProduct={onPrevSubProduct}
                      onPageChange={onPageChange}
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Pagination chrome ────────────────────────────────────────────────────
// Co-located here because the constants + visuals are tightly coupled to
// the variant grid. Parent panels (sub-product-direct, family-nav-with-
// tabs) own the currentPage state and render these into the card header /
// footer slots.

export interface PaginationIndicatorProps {
  currentPage:   number;        // 0-indexed
  totalPages:    number;
  onPageChange:  (page: number) => void;
}

export function PaginationIndicator({
  currentPage, totalPages, onPageChange,
}: PaginationIndicatorProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 mr-3 flex-shrink-0">
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 0}
        title="Previous page"
        aria-label="Previous page"
        className="text-gray-400 hover:text-teal-600 text-[16px] leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
      >
        ‹
      </button>
      <div className="flex items-center gap-1">
        {Array.from({ length: totalPages }, (_, i) => {
          const isActive = i === currentPage;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPageChange(i)}
              aria-label={`Page ${i + 1}`}
              aria-current={isActive ? "page" : undefined}
              className={`transition-all duration-150 ${
                isActive
                  ? "w-[22px] h-[7px] bg-teal-600 rounded-[4px]"
                  : "w-[7px] h-[7px] bg-gray-300 rounded-full hover:bg-gray-400"
              }`}
            />
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages - 1}
        title="Next page"
        aria-label="Next page"
        className="text-gray-600 hover:text-teal-600 text-[16px] leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600"
      >
        ›
      </button>
      <span className="text-[10px] font-mono text-gray-400 ml-1">
        {currentPage + 1} of {totalPages}
      </span>
    </div>
  );
}

export interface PaginationFooterProps {
  pageStart:    number;         // 0-indexed inclusive
  pageEnd:      number;         // 0-indexed exclusive
  totalItems:   number;
  currentPage:  number;
  totalPages:   number;
}

export function PaginationFooter({
  pageStart, pageEnd, totalItems, currentPage, totalPages,
}: PaginationFooterProps): React.JSX.Element {
  const kbd = "font-mono px-1 bg-white border border-gray-200 rounded text-[9px]";
  return (
    <div className="px-3 py-1 bg-teal-50/40 border-t border-teal-100 flex items-center gap-3 text-[9.5px]">
      <span className="text-gray-500">
        <kbd className={kbd}>Shift+PgDn</kbd>
        {" / "}
        <kbd className={kbd}>Shift+PgUp</kbd>
        {" "}page
      </span>
      <span className="text-gray-300">·</span>
      <span className="text-gray-500">
        <kbd className={kbd}>↓↑←→</kbd>
        {" "}nav
      </span>
      <span className="text-gray-300">·</span>
      <span className="text-gray-500">
        <kbd className={kbd}>+</kbd>
        <span className="mx-0.5">/</span>
        <kbd className={kbd}>−</kbd>
        {" "}box
      </span>
      <span className="text-gray-300">·</span>
      <span className="text-gray-500">
        <kbd className={kbd}>0</kbd>
        <span className="mx-0.5">–</span>
        <kbd className={kbd}>9</kbd>
        {" "}qty
      </span>
      <span className="ml-auto text-teal-700 font-medium">
        Showing bases {pageStart + 1}–{pageEnd} of {totalItems} · Page {currentPage + 1} of {totalPages}
      </span>
    </div>
  );
}
