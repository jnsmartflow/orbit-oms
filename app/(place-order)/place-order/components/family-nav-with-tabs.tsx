"use client";

import { useEffect, useMemo, useState } from "react";
import type { CartLine, Product } from "../types";
import VariantGrid, {
  VARIANT_GRID_PAGE_SIZE,
  VARIANT_GRID_PAGINATION_THRESHOLD,
  PaginationIndicator,
  PaginationFooter,
} from "./variant-grid";
import SubProductTabBar, { type SubProductTab } from "./sub-product-tab-bar";
import { KBD_CLASS } from "./_shared";
import { monogramFor } from "@/lib/place-order/monogram";

// Family panel — opened when the active state is a family-type tile or a
// family-type search result. Renders header + sub-product tab bar +
// variant grid for the active sub-product. When a family has only one
// sub-product, the tab bar is hidden (matches design-doc behaviour:
// "tabs only when navigating multi-sub-product families").
//
// Pure-ish: useEffect resyncs activeSubProduct upstream if it drifts out
// of the current sub-product list (defensive).

export interface FamilyNavWithTabsProps {
  familyName:           string;
  section:              string;
  products:             Product[];                                                        // ALL rows in this family
  activeSubProduct:     string;
  onSubProductChange:   (subProduct: string) => void;
  qtyAt:                (subProduct: string, baseColour: string | null, pack: string) => number;
  onSetQty:             (product: Product, pack: string, qty: number) => void;
  cartLines:            CartLine[];                                                       // active bill's lines
  speedDialPosition?:   number;
  focusHintBase?:       string | null;
  onFocused?:           () => void;
  onEscape:             () => void;
  onClose:              () => void;
  embedded?:            boolean;                                                          // when true, skip the rounded-xl wrapper + family header (used by SectionLanding)
}

export default function FamilyNavWithTabs({
  familyName, section, products,
  activeSubProduct, onSubProductChange,
  qtyAt, onSetQty, cartLines,
  speedDialPosition,
  focusHintBase, onFocused, onEscape, onClose,
  embedded = false,
}: FamilyNavWithTabsProps): React.JSX.Element {
  // Distinct sub-product names in catalog order (products payload is
  // pre-sorted by sortOrder upstream).
  const subProductNames = useMemo<string[]>(() => {
    const seen  = new Set<string>();
    const order: string[] = [];
    for (const p of products) {
      if (!seen.has(p.subProduct)) {
        seen.add(p.subProduct);
        order.push(p.subProduct);
      }
    }
    return order;
  }, [products]);

  // Defensive: resync upstream if activeSubProduct doesn't match any
  // current sub-product (stale state after family switch).
  useEffect(() => {
    if (subProductNames.length === 0) return;
    if (!subProductNames.includes(activeSubProduct)) {
      onSubProductChange(subProductNames[0]);
    }
  }, [subProductNames, activeSubProduct, onSubProductChange]);

  const tabs = useMemo<SubProductTab[]>(() => {
    return subProductNames.map((name) => {
      const rows         = products.filter((p) => p.subProduct === name);
      const skuCount     = rows.reduce((acc, p) => acc + p.packs.length, 0);
      const hasCartLines = cartLines.some((l) => l.subProduct === name);
      return { name, skuCount, hasCartLines };
    });
  }, [subProductNames, products, cartLines]);

  const filteredProducts = useMemo(
    () => products.filter((p) => p.subProduct === activeSubProduct),
    [products, activeSubProduct],
  );

  const activeCartCount = useMemo(
    () => cartLines.filter((l) => products.some((p) => p.subProduct === l.subProduct)).length,
    [cartLines, products],
  );

  const cartSuffix = activeCartCount > 0 ? ` · ${activeCartCount} in cart` : "";
  const breadcrumb = `${section} · ${subProductNames.length} sub-products${cartSuffix}`;

  const showTabs = subProductNames.length > 1;

  // Pagination — only active when the current sub-product has > THRESHOLD
  // bases. Resets to page 0 on activeSubProduct change (tab switch).
  const isPaginated  = filteredProducts.length > VARIANT_GRID_PAGINATION_THRESHOLD;
  const totalPages   = isPaginated ? Math.ceil(filteredProducts.length / VARIANT_GRID_PAGE_SIZE) : 1;
  const [currentPage, setCurrentPage] = useState<number>(0);
  useEffect(() => { setCurrentPage(0); }, [activeSubProduct]);

  // Search hand-off to a specific base (sub-product-base result) — if
  // the target lives on a different page, flip BEFORE slicing so the
  // target cell appears in the visible slice when variant-grid's
  // auto-focus effect runs. Comparison uses the same trim+lowercase
  // normalisation as variant-grid's focus effect.
  useEffect(() => {
    if (focusHintBase == null || !isPaginated) return;
    const target = focusHintBase.trim().toLowerCase();
    const targetIdx = filteredProducts.findIndex((p) => (p.baseColour ?? "").trim().toLowerCase() === target);
    if (targetIdx === -1) return;
    const targetPage = Math.floor(targetIdx / VARIANT_GRID_PAGE_SIZE);
    if (targetPage !== currentPage) {
      setCurrentPage(targetPage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHintBase, isPaginated, activeSubProduct]);
  const pageIdx   = Math.min(currentPage, totalPages - 1);
  const pageStart = isPaginated ? pageIdx * VARIANT_GRID_PAGE_SIZE : 0;
  const pageEnd   = isPaginated ? Math.min(pageStart + VARIANT_GRID_PAGE_SIZE, filteredProducts.length) : filteredProducts.length;
  const visibleProducts = isPaginated ? filteredProducts.slice(pageStart, pageEnd) : filteredProducts;

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

  // PageDown/PageUp from inside a cell → cycle tabs without leaving the
  // grid. Wrap around at both ends. Undefined when no tabs to switch
  // between (single sub-product family) — cell still intercepts the
  // keys but no-ops.
  const handleNextSubProduct = showTabs
    ? () => {
        const i = subProductNames.indexOf(activeSubProduct);
        const next = ((i < 0 ? -1 : i) + 1 + subProductNames.length) % subProductNames.length;
        onSubProductChange(subProductNames[next]);
      }
    : undefined;
  const handlePrevSubProduct = showTabs
    ? () => {
        const i = subProductNames.indexOf(activeSubProduct);
        const prev = ((i < 0 ? 0 : i) - 1 + subProductNames.length) % subProductNames.length;
        onSubProductChange(subProductNames[prev]);
      }
    : undefined;

  const innerContent = (
    <>
      {showTabs && (
        <SubProductTabBar
          tabs={tabs}
          activeSubProduct={activeSubProduct}
          onSelect={onSubProductChange}
        />
      )}

      <VariantGrid
        products={visibleProducts}
        qtyAt={qtyAt}
        onSetQty={onSetQty}
        focusHintBase={focusHintBase}
        onFocused={onFocused}
        onEscape={onEscape}
        onNextSubProduct={handleNextSubProduct}
        onPrevSubProduct={handlePrevSubProduct}
        onPageChange={handleCellPageChange}
      />

      {isPaginated ? (
        <PaginationFooter
          pageStart={pageStart}
          pageEnd={pageEnd}
          totalItems={filteredProducts.length}
          currentPage={pageIdx}
          totalPages={totalPages}
        />
      ) : (
        <div className="px-3 py-1 bg-gray-50/60 border-t border-gray-100 flex items-center gap-3 text-[9.5px] text-gray-500">
          {showTabs && (
            <>
              <span>
                <kbd className={KBD_CLASS}>1</kbd>
                <span className="mx-0.5">–</span>
                <kbd className={KBD_CLASS}>{subProductNames.length}</kbd>
                {" "}switch
              </span>
              <span className="text-gray-300">·</span>
            </>
          )}
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
    </>
  );

  if (embedded) {
    return innerContent;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
      <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-3">
        <span
          className="w-[24px] h-[24px] rounded-[5px] inline-flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)" }}
        >
          {monogramFor(familyName)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-gray-900 truncate">{familyName} family</div>
          <div className="text-[10px] text-gray-400 truncate">{breadcrumb}</div>
        </div>
        {/* TODO: pagination indicator is hidden in embedded mode (drilled
            WOODCARE) because the card header is skipped there. Today no
            woodcare family exceeds 15 bases so this is dormant. Revisit
            if any drilled family later crosses the threshold. */}
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
      {innerContent}
    </div>
  );
}
