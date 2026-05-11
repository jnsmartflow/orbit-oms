"use client";

import { useEffect, useState } from "react";
import type { Product } from "../types";
import VariantGrid, {
  VARIANT_GRID_PAGE_SIZE,
  VARIANT_GRID_PAGINATION_THRESHOLD,
  PaginationIndicator,
  PaginationFooter,
} from "./variant-grid";
import { KBD_CLASS } from "./_shared";
import { monogramFor } from "@/lib/place-order/monogram";

// Single-sub-product view — header above a variant grid, no tab bar.
// Used when the page lands directly on a specific sub-product:
//   - PROMISE ENAMEL speed-dial tile (type='sub-product')
//   - Search result of type='sub-product'
//
// Owns pagination state (currentPage) when products.length > THRESHOLD.
// Resets to page 0 whenever subProductName changes.

export interface SubProductDirectProps {
  subProductName:     string;
  family:             string;
  section:            string;
  products:           Product[];        // pre-filtered to this sub-product (parent's filterBySubProduct)
  qtyAt:              (subProduct: string, baseColour: string | null, pack: string) => number;
  onSetQty:           (product: Product, pack: string, qty: number) => void;
  cartCount:          number;           // distinct cart lines for this sub-product
  speedDialPosition?: number;           // 1-9 when entered via speed dial; undefined when via search
  focusHintBase?:     string | null;
  onFocused?:         () => void;
  onEscape:           () => void;       // forwarded to VariantGrid (cell Esc → search)
  onClose:            () => void;       // × button → page collapses active state to idle
}

export default function SubProductDirect({
  subProductName, family, section, products,
  qtyAt, onSetQty, cartCount, speedDialPosition,
  focusHintBase, onFocused, onEscape, onClose,
}: SubProductDirectProps): React.JSX.Element {
  const skuCount = products.reduce((acc, p) => acc + p.packs.length, 0);
  const cartSuffix = cartCount > 0 ? ` · ${cartCount} in cart` : "";
  const breadcrumb = `${section} · ${family} family · ${skuCount} SKUs${cartSuffix}`;

  // Pagination — only active when this sub-product has > THRESHOLD bases.
  const isPaginated  = products.length > VARIANT_GRID_PAGINATION_THRESHOLD;
  const totalPages   = isPaginated ? Math.ceil(products.length / VARIANT_GRID_PAGE_SIZE) : 1;
  const [currentPage, setCurrentPage] = useState<number>(0);
  // Reset to page 0 whenever the sub-product identity changes.
  useEffect(() => { setCurrentPage(0); }, [subProductName]);

  // Search hand-off to a specific base (sub-product-base result) may
  // target a base that lives on a different page. Flip the page BEFORE
  // variant-grid slices, so the target cell is in the visible slice
  // when variant-grid's auto-focus effect runs. Comparison uses the
  // same trim+lowercase normalisation as variant-grid's focus effect.
  useEffect(() => {
    if (focusHintBase == null || !isPaginated) return;
    const target = focusHintBase.trim().toLowerCase();
    const targetIdx = products.findIndex((p) => (p.baseColour ?? "").trim().toLowerCase() === target);
    if (targetIdx === -1) return;
    const targetPage = Math.floor(targetIdx / VARIANT_GRID_PAGE_SIZE);
    if (targetPage !== currentPage) {
      setCurrentPage(targetPage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHintBase, isPaginated]);
  // Clamp page index defensively (rare: products array shrunk while paged).
  const pageIdx   = Math.min(currentPage, totalPages - 1);
  const pageStart = isPaginated ? pageIdx * VARIANT_GRID_PAGE_SIZE : 0;
  const pageEnd   = isPaginated ? Math.min(pageStart + VARIANT_GRID_PAGE_SIZE, products.length) : products.length;
  const visibleProducts = isPaginated ? products.slice(pageStart, pageEnd) : products;

  function handlePageChange(page: number): void {
    setCurrentPage(Math.max(0, Math.min(page, totalPages - 1)));
  }

  // Cell-keyboard bridge — `[` / `]` from a focused cell. No-op when this
  // sub-product isn't paginated (the cell's preventDefault still
  // suppresses the literal bracket from leaking into the qty input).
  function handleCellPageChange(direction: -1 | 1): void {
    if (!isPaginated) return;
    handlePageChange(pageIdx + direction);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
      <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-3">
        <span
          className="w-[24px] h-[24px] rounded-[5px] inline-flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)" }}
        >
          {monogramFor(subProductName)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-gray-900 truncate">{subProductName}</div>
          <div className="text-[10px] text-gray-400 truncate">{breadcrumb}</div>
        </div>
        {isPaginated && (
          <PaginationIndicator
            currentPage={pageIdx}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        )}
        {speedDialPosition !== undefined && (
          <div className="text-[10px] text-gray-400 flex items-center gap-1.5 flex-shrink-0">
            <kbd className="font-mono px-1.5 py-0.5 bg-gray-100 rounded text-[9.5px]">
              {speedDialPosition}
            </kbd>
            <span>active</span>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-2 text-gray-300 hover:text-gray-500 text-[18px] flex-shrink-0"
        >
          ×
        </button>
      </div>

      <VariantGrid
        products={visibleProducts}
        qtyAt={qtyAt}
        onSetQty={onSetQty}
        focusHintBase={focusHintBase}
        onFocused={onFocused}
        onEscape={onEscape}
        onPageChange={handleCellPageChange}
      />

      {isPaginated ? (
        <PaginationFooter
          pageStart={pageStart}
          pageEnd={pageEnd}
          totalItems={products.length}
          currentPage={pageIdx}
          totalPages={totalPages}
        />
      ) : (
        <div className="px-3 py-1 bg-gray-50/60 border-t border-gray-100 flex items-center gap-3 text-[9.5px] text-gray-500">
          <span>
            <kbd className={KBD_CLASS}>↓↑←→</kbd>
            {" "}nav
          </span>
          <span className="text-gray-300">·</span>
          <span>
            <kbd className={KBD_CLASS}>0</kbd>
            <span className="mx-0.5">–</span>
            <kbd className={KBD_CLASS}>9</kbd>
            {" "}qty
          </span>
          <span className="text-gray-300">·</span>
          <span>
            <kbd className={KBD_CLASS}>Esc</kbd>
            {" "}back to search
          </span>
        </div>
      )}
    </div>
  );
}
