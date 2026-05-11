"use client";

import type { Product } from "../types";
import VariantGrid from "./variant-grid";
import { KBD_CLASS } from "./_shared";
import { monogramFor } from "@/lib/place-order/monogram";

// Single-sub-product view — header above a variant grid, no tab bar.
// Used when the page lands directly on a specific sub-product:
//   - PROMISE ENAMEL speed-dial tile (type='sub-product')
//   - Search result of type='sub-product'
//
// Pure presentational; no internal state.

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

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
        <span
          className="w-[28px] h-[28px] rounded-[5px] inline-flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)" }}
        >
          {monogramFor(subProductName)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-gray-900 truncate">{subProductName}</div>
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

      <VariantGrid
        products={products}
        qtyAt={qtyAt}
        onSetQty={onSetQty}
        focusHintBase={focusHintBase}
        onFocused={onFocused}
        onEscape={onEscape}
      />

      <div className="px-5 py-2.5 bg-gray-50/60 border-t border-gray-100 flex items-center gap-3 text-[10.5px] text-gray-500">
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
    </div>
  );
}
