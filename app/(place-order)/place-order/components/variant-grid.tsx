"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Product } from "../types";
import { formatPack, packContainerLabel, packStep } from "@/lib/place-order/pack";
import {
  bucketColumnsForTab,
  bucketDisplayLabel,
  packHintLabel,
  packNeedsHint,
  packToBucket,
  type BucketColumn,
  type RawPack,
} from "@/lib/place-order/pack-buckets";
import VariantCell, { type CellNavDirection, type VariantCellHandle } from "./variant-cell";
import { getBaseAliasDisplay } from "@/lib/place-order/base-aliases";

// Base × pack qty matrix. `products` is one row per baseColour for the
// active sub-product. Pack columns are the union of all packs across
// those rows, sorted ascending by ML.
//
// Composes existing variant-cell.tsx (decision D Stage 2) — keyboard
// semantics + ref-driven focus management already proven in production.

export interface VariantGridProps {
  products:          Product[];
  qtyAt:             (product: Product, pack: RawPack) => number;
  onSetQty:          (product: Product, pack: RawPack, qty: number) => void;
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
  // Phase 3.5 (2026-05-13): columns are bucket-based, not packCode-based.
  // bucketColumnsForTab walks every SKU in the tab and returns the
  // ordered list of buckets that have at least one mapping SKU
  // (subset of STANDARD_COLUMNS). The grid no longer renders one
  // column per distinct packCode — operators see "1 L · 4 L · 10 L"
  // instead of "1L · 900ML · 3.6L · 4L · 9L · 10L".
  const columns = useMemo<BucketColumn[]>(() => {
    const allPacks: RawPack[] = [];
    for (const p of products) for (const pack of p.packs) allPacks.push(pack);
    return bucketColumnsForTab(allPacks);
  }, [products]);

  interface CellInfo {
    selectedPack: RawPack | null;   // null = no SKU in this row for this bucket
    hintLabel:    string | null;    // "900ML" hint when real pack != bucket
  }

  // For each row × bucket, pick the canonical SKU:
  //   - exact match (e.g. a 1L pack for the 1L bucket) wins over the
  //     non-canonical (900ML in the same bucket)
  //   - first match otherwise
  // Hint label appears below the cell when canonical differs from bucket.
  const cellMatrix = useMemo<CellInfo[][]>(() => {
    return products.map((product) =>
      columns.map((bucket) => {
        const matching = product.packs.filter((p) => packToBucket(p) === bucket);
        if (matching.length === 0) return { selectedPack: null, hintLabel: null };
        const canonical =
          matching.find((p) => formatPack(p.packCode, p.unit) === bucket)
          ?? matching[0];
        return {
          selectedPack: canonical,
          hintLabel: packNeedsHint(canonical, bucket) ? packHintLabel(canonical) : null,
        };
      }),
    );
  }, [products, columns]);

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

    if (products.length === 0 || columns.length === 0) return;

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
    for (let c = 0; c < columns.length; c++) {
      if (cellMatrix[targetRow]?.[c]?.selectedPack) { targetCol = c; break; }
    }
    if (targetCol < 0) {
      outer: for (let r = 0; r < products.length; r++) {
        for (let c = 0; c < columns.length; c++) {
          if (cellMatrix[r]?.[c]?.selectedPack) { targetRow = r; targetCol = c; break outer; }
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
    const cols = columns.length;
    if (rows === 0 || cols === 0) return;

    if (direction === "left") {
      for (let c = fromCol - 1; c >= 0; c--) {
        if (cellMatrix[fromRow][c].selectedPack) {
          cellRefs.current[fromRow]?.[c]?.focus();
          return;
        }
      }
    } else if (direction === "right") {
      for (let c = fromCol + 1; c < cols; c++) {
        if (cellMatrix[fromRow][c].selectedPack) {
          cellRefs.current[fromRow]?.[c]?.focus();
          return;
        }
      }
    } else if (direction === "up") {
      for (let r = fromRow - 1; r >= 0; r--) {
        if (cellMatrix[r][fromCol].selectedPack) {
          cellRefs.current[r]?.[fromCol]?.focus();
          return;
        }
      }
    } else if (direction === "down" || direction === "enter") {
      for (let r = fromRow + 1; r < rows; r++) {
        if (cellMatrix[r][fromCol].selectedPack) {
          cellRefs.current[r]?.[fromCol]?.focus();
          return;
        }
      }
    }
  }

  if (products.length === 0 || columns.length === 0) {
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
        {columns.map((bucket) => (
          <col key={bucket} style={{ width: "80px" }} />
        ))}
      </colgroup>
      <thead>
        <tr className="bg-gray-100 border-b-2 border-gray-300">
          <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Base · Colour
          </th>
          {columns.map((bucket) => {
            const container = packContainerLabel(bucket);
            return (
              <th key={bucket} className="text-center px-1 py-2">
                <div className="text-[10.5px] font-semibold text-gray-700">
                  {bucketDisplayLabel(bucket)}
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
          // Phase 3 row-label fallback (2026-05-13). Filled families
          // often encode the variant in `product` + `displayName`
          // rather than `baseColour` (e.g. a Red Oxide Metal Primer
          // row has baseColour=null, product="RED OXIDE METAL PRIMER",
          // displayName="Metal Primer (Red Oxide)"). Falling back to
          // "Plain" hid that detail. Chain:
          //   baseColour  — explicit colour variant (GLOSS BLACK)
          //   displayName — descriptive label (Aquatech Crackfiller 5mm)
          //   product     — filled-family last resort
          //   subProduct  — ultimate non-null fallback for unmigrated rows
          const baseLabel =
            product.baseColour
            ?? product.displayName
            ?? product.product
            ?? product.subProduct;
          const baseAlias = getBaseAliasDisplay(product.product, product.baseColour);
          const isLastRow = rowIdx === products.length - 1;
          return (
            <tr
              // Phase 3 (2026-05-13): include `product` in the key so
              // filled families where multiple rows share
              // (subProduct, baseColour) but differ in product (e.g.
              // AQUATECH PREP rows: subProduct=AQUATECH, baseColour=null,
              // product=CRACKFILLER 5MM/10MM/20MM) don't collide on the
              // React key. Non-unique keys cause stale-DOM reuse on tab
              // switches, which manifests as rows from a previous tab
              // appearing to "leak" into the active tab.
              key={`${product.subProduct}|||${product.baseColour ?? ""}|||${product.product ?? ""}`}
              className={`group/row ${isLastRow ? "" : "border-b border-gray-200"} hover:bg-amber-50/30 focus-within:bg-amber-50/70`}
            >
              <td className="px-3 py-2 border-l-[3px] border-l-transparent group-focus-within/row:border-l-amber-500">
                <div className="text-[12px] font-semibold text-gray-900 group-focus-within/row:font-bold">{baseLabel}{baseAlias && <span className="font-normal text-gray-400"> · {baseAlias}</span>}</div>
              </td>
              {columns.map((bucket, colIdx) => {
                const cell         = cellMatrix[rowIdx][colIdx];
                const selectedPack = cell.selectedPack;
                const isAvailable  = selectedPack !== null;
                const qty          = isAvailable ? qtyAt(product, selectedPack) : 0;
                const boxSize      = selectedPack
                  ? packStep(formatPack(selectedPack.packCode, selectedPack.unit))
                  : 1;
                return (
                  <td key={bucket} className="text-center py-1 align-top">
                    <VariantCell
                      ref={(handle) => {
                        if (!cellRefs.current[rowIdx]) cellRefs.current[rowIdx] = [];
                        cellRefs.current[rowIdx][colIdx] = handle;
                      }}
                      qty={qty}
                      boxSize={boxSize}
                      isAvailable={isAvailable}
                      rowIdx={rowIdx}
                      colIdx={colIdx}
                      onSetQty={(q) => {
                        if (selectedPack) onSetQty(product, selectedPack, q);
                      }}
                      onCellNav={navigate}
                      onClose={onEscape}
                      onNextSubProduct={onNextSubProduct}
                      onPrevSubProduct={onPrevSubProduct}
                      onPageChange={onPageChange}
                    />
                    {cell.hintLabel && (
                      // Real pack differs from bucket label — show the
                      // raw SAP unit ("900ML", "3.6L", "5KG") under the
                      // cell as low-emphasis hint text. Non-interactive.
                      <div className="text-[9px] text-gray-400 mt-0.5 leading-none font-mono">
                        {cell.hintLabel}
                      </div>
                    )}
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
