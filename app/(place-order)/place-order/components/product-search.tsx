"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Product } from "../types";

// Product search bar — sits above the category grid.
//
// §8.3 keyboard:
//   any letter / digit → filter products in real-time
//   ↓ / ↑              → move highlight through results
//   Enter              → open the highlighted product (parent calls
//                         onSelectProduct → expand parent family +
//                         set active subProduct + focus matching base-row)
//   * or Esc           → blur and clear query (return to grid context)
//
// The `data-place-order-input="search"` marker lets the page-level keyboard
// router know this input is active (so / is treated as a typed character
// here, not the send-confirm trigger).

interface ProductSearchProps {
  products:        Product[];
  query:           string;
  onQueryChange:   (q: string) => void;
  onSelectProduct: (product: Product) => void;
}

export interface ProductSearchHandle {
  focus(): void;
}

const ProductSearch = forwardRef<ProductSearchHandle, ProductSearchProps>(function ProductSearch(
  { products, query, onQueryChange, onSelectProduct },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }), []);

  // Filter products by searchTokens substring. 2+ chars unlocks results;
  // each whitespace-split word must match somewhere in the token blob.
  const matches = useMemo<Product[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const words = q.split(/\s+/).filter(Boolean);
    return products
      .filter((p) => {
        const tokens = p.searchTokens.toLowerCase();
        return words.every((w) => tokens.includes(w));
      })
      .slice(0, 12);
  }, [query, products]);

  // Reset highlight whenever the result pool changes.
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape" || e.key === "*") {
      e.preventDefault();
      onQueryChange("");
      setHighlightedIndex(-1);
      inputRef.current?.blur();
      return;
    }
    if (matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => i < matches.length - 1 ? i + 1 : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => i > 0 ? i - 1 : matches.length - 1);
    } else if (e.key === "Enter") {
      if (highlightedIndex < 0) return;
      const product = matches[highlightedIndex];
      if (!product) return;
      e.preventDefault();
      onSelectProduct(product);
      onQueryChange("");
      setHighlightedIndex(-1);
    }
  }

  return (
    <div className="relative mb-[14px]">
      <span className="absolute left-[14px] top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
        <Search className="w-4 h-4" />
      </span>
      <input
        ref={inputRef}
        type="text"
        data-place-order-input="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type to search products… or press 1–9 below"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full h-[44px] rounded-[10px] border border-gray-200 bg-white pl-[42px] pr-[24px] text-[14px] text-gray-900 placeholder:text-gray-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
      />
      {matches.length > 0 && (
        <div className="absolute left-0 right-0 top-[48px] z-30 bg-white border border-gray-200 rounded-[10px] shadow-lg overflow-hidden max-h-[400px] overflow-y-auto">
          {matches.map((p, i) => {
            const key           = `${p.subProduct}|||${p.baseColour ?? ""}`;
            const isHighlighted = i === highlightedIndex;
            return (
              <button
                key={key}
                type="button"
                onMouseDown={(e) => {
                  // Avoid blurring the input before click registers.
                  e.preventDefault();
                  onSelectProduct(p);
                  onQueryChange("");
                  setHighlightedIndex(-1);
                }}
                className={`w-full flex items-center gap-2 px-4 py-2 text-left border-b border-gray-50 last:border-b-0 ${
                  isHighlighted ? "bg-teal-50" : "hover:bg-gray-50"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-gray-900 truncate">{p.displayName}</span>
                  <span className="block text-[11px] text-gray-400 mt-0.5">
                    {p.family} · {p.subProduct}
                    {p.baseColour ? ` · ${p.baseColour}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default ProductSearch;
