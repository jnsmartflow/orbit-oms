"use client";

import {
  forwardRef, useEffect, useId, useMemo, useState,
  type KeyboardEvent, type MouseEvent,
} from "react";
import { Search } from "lucide-react";
import type { Product } from "../types";
import { searchProducts, type SearchResult } from "@/lib/place-order/queries";
import { monogramFor } from "@/lib/place-order/monogram";
import { getBaseAliasDisplay } from "@/lib/place-order/base-aliases";

// Primary input on /place-order. Live search over the v2 catalog with a
// debounced result list (10 max) and arrow-key navigation. The native
// input ref is forwarded so the page-level keyboard router can refocus
// on Esc-from-cell.

const DEBOUNCE_MS = 80;

export interface BigSearchBarProps {
  query:          string;
  onQueryChange:  (q: string) => void;
  onResultSelect: (result: SearchResult) => void;
  products:       Product[];
}

const BigSearchBar = forwardRef<HTMLInputElement, BigSearchBarProps>(
  function BigSearchBar(
    { query, onQueryChange, onResultSelect, products },
    ref,
  ): React.JSX.Element {
    const listboxId = useId();

    // Debounce the query → results pipeline. Empty query bypasses the
    // debounce so Esc-to-clear is instant.
    const [debouncedQuery, setDebouncedQuery] = useState<string>(query);
    useEffect(() => {
      if (query === "") { setDebouncedQuery(""); return; }
      const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
      return () => clearTimeout(t);
    }, [query]);

    const results = useMemo<SearchResult[]>(
      () => searchProducts(products, debouncedQuery),
      [products, debouncedQuery],
    );

    const [activeIndex, setActiveIndex] = useState<number>(-1);
    useEffect(() => {
      setActiveIndex(results.length > 0 ? 0 : -1);
    }, [results]);

    const showDropdown = query.trim().length >= 2;

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
      // Non-empty query: Tab/Shift+Tab navigate the result list
      // (alias for ↓/↑). Empty query: default browser Tab behaviour.
      if (
        e.key === "Tab" &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        query.length > 0 && results.length > 0
      ) {
        e.preventDefault();
        if (e.shiftKey) setActiveIndex((i) => Math.max(i - 1, 0));
        else            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) =>
          results.length === 0 ? -1 : Math.min(i + 1, results.length - 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        if (activeIndex >= 0 && results[activeIndex]) {
          e.preventDefault();
          onResultSelect(results[activeIndex]);
          onQueryChange("");
        }
        return;
      }
      if (e.key === "Escape") {
        if (query) {
          e.preventDefault();
          onQueryChange("");
        } else {
          (e.target as HTMLInputElement).blur();
        }
      }
    }

    function handleResultMouseDown(
      e: MouseEvent<HTMLButtonElement>,
      result: SearchResult,
    ): void {
      // Avoid blurring the input before click registers — the page-level
      // router may want focus to stay on the search box.
      e.preventDefault();
      onResultSelect(result);
      onQueryChange("");
    }

    return (
      <div className="mb-2 relative">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="w-4 h-4 text-gray-400" />
          </div>
          <input
            ref={ref}
            type="text"
            data-place-order-input="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type product name — gloss, super satin, promise enml…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-activedescendant={
              activeIndex >= 0 ? `${listboxId}-row-${activeIndex}` : undefined
            }
            className="w-full h-[36px] pl-9 pr-[210px] text-[13px] border border-gray-200 rounded-lg bg-white shadow-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 focus:outline-none"
          />
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center text-[11px] text-gray-400 pointer-events-none">
            {query ? (
              <span className="flex items-center gap-1.5">
                <kbd className="font-mono px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">Esc</kbd>
                to clear
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                Type to search ·
                <kbd className="font-mono px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">1-9</kbd>
                from page body for speed dial
              </span>
            )}
          </div>
        </div>

        {showDropdown && (
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden z-20"
          >
            {results.length === 0 ? (
              <div className="px-4 py-3 text-[12px] italic text-gray-400">
                No results — try another keyword
              </div>
            ) : (
              results.map((result, idx) => {
                const isActive = idx === activeIndex;
                let label:      string;
                let breadcrumb: string;
                let monogramSource: string;
                let rowKey:     string;
                switch (result.type) {
                  case "family":
                    label          = result.family;
                    breadcrumb     = `${result.section} · family · ${result.subProductCount} sub-products · ${result.skuCount} SKUs`;
                    monogramSource = result.family;
                    rowKey         = `family-${result.family}`;
                    break;
                  case "sub-product":
                    label          = result.subProductName;
                    breadcrumb     = `${result.section} · ${result.family} · ${result.skuCount} SKUs`;
                    monogramSource = result.subProductName;
                    rowKey         = `sub-${result.family}-${result.subProductName}`;
                    break;
                  case "sub-product-base":
                    label          = `${result.subProductName} · ${result.baseColour}`;
                    breadcrumb     = `${result.section} · ${result.family} · ${result.skuCount === 1 ? "1 SKU" : `${result.skuCount} SKUs`}`;
                    monogramSource = result.subProductName;
                    rowKey         = `subbase-${result.family}-${result.subProductName}-${result.baseColour}`;
                    break;
                }
                // Subtle base alias (display-only). The sub-product-base
                // result carries no `product`, so resolve it from the
                // products list by (subProduct, baseColour).
                let baseAlias: string | null = null;
                if (result.type === "sub-product-base") {
                  const m = products.find(
                    (pp) =>
                      pp.subProduct === result.subProductName &&
                      (pp.baseColour ?? "") === (result.baseColour ?? ""),
                  );
                  baseAlias = m ? getBaseAliasDisplay(m.product, m.baseColour) : null;
                }
                const monogram = monogramFor(monogramSource);
                const isLast   = idx === results.length - 1;

                return (
                  <button
                    key={rowKey}
                    id={`${listboxId}-row-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(e) => handleResultMouseDown(e, result)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors duration-75 border-l-[3px] ${
                      isLast ? "" : "border-b border-gray-100"
                    } ${
                      isActive
                        ? "bg-[#f0fdfa] border-l-teal-600"
                        : "border-l-transparent hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className="w-[28px] h-[28px] rounded-[5px] inline-flex items-center justify-center text-[10px] font-bold text-gray-500 flex-shrink-0"
                      style={{ background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)" }}
                    >
                      {monogram}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span
                        className={`block text-[13px] truncate ${
                          isActive ? "font-semibold text-gray-900" : "font-medium text-gray-700"
                        }`}
                      >
                        {label}{baseAlias && <span className="font-normal text-gray-400"> · {baseAlias}</span>}
                      </span>
                      <span className="block text-[10.5px] text-gray-400 truncate">
                        {breadcrumb}
                      </span>
                    </span>
                    {isActive && (
                      <kbd className="font-mono px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-500 flex-shrink-0">
                        Enter
                      </kbd>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  },
);

export default BigSearchBar;
