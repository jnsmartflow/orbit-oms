"use client";

import { useEffect, useMemo } from "react";
import type { CartLine, Product } from "../types";
import VariantGrid from "./variant-grid";
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
        products={filteredProducts}
        qtyAt={qtyAt}
        onSetQty={onSetQty}
        focusHintBase={focusHintBase}
        onFocused={onFocused}
        onEscape={onEscape}
        onNextSubProduct={handleNextSubProduct}
        onPrevSubProduct={handlePrevSubProduct}
      />

      <div className="px-5 py-2.5 bg-gray-50/60 border-t border-gray-100 flex items-center gap-3 text-[10.5px] text-gray-500">
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
    </>
  );

  if (embedded) {
    return innerContent;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
        <span
          className="w-[28px] h-[28px] rounded-[5px] inline-flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)" }}
        >
          {monogramFor(familyName)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-gray-900 truncate">{familyName} family</div>
          <div className="text-[10.5px] text-gray-400 truncate">{breadcrumb}</div>
        </div>
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
