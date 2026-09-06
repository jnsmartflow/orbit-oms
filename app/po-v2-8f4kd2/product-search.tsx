"use client";

import { Search, X } from "lucide-react";
// 🔴 THE ONE DOCUMENTED CONTAINMENT EXCEPTION — see the note in po-v2-page.tsx.
// Read-only import of the tested matcher /po already uses. Nothing in lib/ is
// modified, and its whole import graph (keyword-family-map,
// sub-product-descriptors) is lib-only — verified by grep for `app/`.
import { rankProductsForQuery } from "@/lib/place-order/mobile-search";
import { INK, RULE, SEARCH_BG, VIOLET, type ApiProduct } from "./v2-data";

// The board's product search. One row per MENU ROW, not per product — so
// Promise SmartChoice arrives as its five rows and Gloss as its thirty-eight.
// That is deliberate and matches /po: a searched result should land the
// salesman on a SPECIFIC thing, not on another menu to choose from.
//
// 🔴 CONTAINMENT — apart from the documented matcher import, this file touches
// only ./v2-data and node_modules.

/** Two characters before anything is searched. One letter matches half the catalog. */
export const MIN_QUERY = 2;

/**
 * The product search field. 16px — iOS Safari zooms the page on focus below
 * that (CLAUDE_UI.md §55). The clear button is how the salesman gets back to
 * the tile board.
 */
export function ProductSearchInput({
  value, onChange, autoFocus = false,
}: {
  value: string; onChange: (next: string) => void; autoFocus?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-[12px] px-3" style={{ background: SEARCH_BG }}>
      <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2.5} />
      <input
        type="text"
        inputMode="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search product"
        className="min-w-0 flex-1 bg-transparent py-3 text-[16px] outline-none placeholder:text-neutral-400"
        style={{ color: INK }}
      />
      {value.length > 0 && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#DEDCE3" }}
        >
          <X className="h-3 w-3 text-white" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/**
 * Rank the FULL payload — all 471 menu rows, not the 32 tiles. The tiles are a
 * curated shortcut; search is the way to everything else, which is the only
 * reason the board can afford to be short.
 */
export function searchProducts(products: ApiProduct[], query: string): ApiProduct[] {
  if (query.trim().length < MIN_QUERY) return [];
  return rankProductsForQuery(products, query);
}

export function ProductResults({
  products, query, onPick,
}: {
  products: ApiProduct[];
  query: string;
  onPick: (row: ApiProduct) => void;
}): React.JSX.Element {
  const results = searchProducts(products, query);

  if (results.length === 0) {
    // No suggestions, no fallback list — an empty result is an answer.
    return (
      <p className="px-4 py-12 text-center text-[13px] text-neutral-400">
        No product matches {query.trim()}
      </p>
    );
  }

  return (
    <div>
      {results.map((row) => (
        <ProductResultRow key={row.id} row={row} onPick={() => onPick(row)} />
      ))}
    </div>
  );
}

function ProductResultRow({ row, onPick }: {
  row: ApiProduct; onPick: () => void;
}): React.JSX.Element {
  // The base is dropped from the sub-line when the headline already carries it
  // — "2K PU Matt - 90 Base" does not need "Sadolin · 90 Base" underneath.
  const base = row.baseColour;
  const showBase =
    base !== null && !row.displayName.toUpperCase().includes(base.toUpperCase());
  const sub = [row.family, showBase ? base : null].filter(Boolean).join(" · ");

  return (
    // The whole row is the target; the Add button is an affordance inside it,
    // not a second action, so a mis-tap next to it still opens the drawer.
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      style={{ borderBottom: `1px solid ${RULE}` }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold" style={{ color: INK }}>
          {row.displayName}
        </span>
        <span className="block truncate text-[12px] text-neutral-400">{sub}</span>
      </span>
      <span
        className="shrink-0 rounded-[10px] bg-white px-3 py-1.5 text-[13px] font-extrabold"
        style={{ border: `1px solid ${RULE}`, color: VIOLET }}
      >
        Add
      </span>
    </button>
  );
}
