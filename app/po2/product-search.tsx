"use client";

// 🔴 THE ONE DOCUMENTED CONTAINMENT EXCEPTION — see the note in po-v2-page.tsx.
// Read-only import of the tested matcher /po already uses. Nothing in lib/ is
// modified, and its whole import graph (keyword-family-map,
// sub-product-descriptors) is lib-only — verified by grep for `app/`.
import { rankProductsForQuery } from "@/lib/place-order/mobile-search";
import {
  FAINT, INK, MUTED, RULE, VIOLET,
  type ApiProduct,
} from "./v2-data";
import V2SearchInput from "./v2-search-input";

// The board's product search. ONE ROW PER PRODUCT — searching "pearl glo"
// returns "Pearl Glo" once, not eleven rows one per base. Tapping it opens the
// same drawer its tile opens, and the bases are chosen in there on big targets.
//
// 🔴 CONTAINMENT — apart from the documented matcher import, this file touches
// only ./v2-data, ./v2-search-input and node_modules.

/** Two characters before anything is searched. One letter matches half the catalog. */
export const MIN_QUERY = 2;

/**
 * The product search field — the ONLY interactive thing in the board header.
 *
 * ⚠ ITS APPEARANCE NOW LIVES IN ./v2-search-input AND IS SHARED WITH BOTH
 * DEALER PICKERS. The 52px white bar with its hairline and soft shadow, the
 * React focus state, the 16px input against a 15px placeholder and the reasons
 * for each of them all moved there verbatim when the pickers stopped carrying a
 * second, mismatched field of their own. Nothing about the board changed; the
 * values simply have one home now. Read that file before adjusting anything
 * here, because a change there is a change on three screens.
 */
export function ProductSearchInput({
  value, onChange, autoFocus = false,
}: {
  value: string; onChange: (next: string) => void; autoFocus?: boolean;
}): React.JSX.Element {
  // 🔴 THE BODY OF THIS MOVED TO ./v2-search-input, VALUE FOR VALUE, and the
  // two dealer pickers now render the same thing instead of a second field
  // that only looked similar. This wrapper stays so the board's call site and
  // this file's export do not move, and so the one genuinely product-specific
  // thing — the placeholder — still lives beside the product search. There is
  // nothing visual left here to tune; tune it over there and all three move.
  return (
    <V2SearchInput
      value={value} onChange={onChange} autoFocus={autoFocus}
      placeholder="Search product"
    />
  );
}

/**
 * One result per PRODUCT, not per menu row.
 *
 * 🔴 THIS REVERSES THE STEP-7 DECISION. Ranking returns menu ROWS, so "pearl
 * glo" came back as eleven near-identical lines, one per base — a second menu
 * to wade through, when the drawer he is about to open is a better menu with
 * bigger targets. Grouping by COALESCE(product, subProduct) — the same key the
 * catalog join uses — collapses those eleven into "Pearl Glo", which opens
 * exactly what its tile opens.
 *
 * Group ORDER comes from each group's BEST-ranked row, so a product whose
 * strongest match sits on its ninth base still ranks by that match rather than
 * by whichever row happened to be first in the payload.
 */
export type V2ProductGroup = {
  /** COALESCE(product, subProduct) — the catalog join key. */
  key:  string;
  /** The best-ranked row in the group; decides position and supplies family. */
  best: ApiProduct;
  rows: ApiProduct[];
};

export function searchProductGroups(products: ApiProduct[], query: string): V2ProductGroup[] {
  if (query.trim().length < MIN_QUERY) return [];
  const ranked = rankProductsForQuery(products, query);

  const groups = new Map<string, V2ProductGroup>();
  for (const row of ranked) {
    const key = row.product ?? row.subProduct;
    const g = groups.get(key);
    // `ranked` is already best-first, so the FIRST row seen for a key is that
    // group's best and Map preserves insertion order — no second sort needed.
    if (g) g.rows.push(row);
    else groups.set(key, { key, best: row, rows: [row] });
  }
  return Array.from(groups.values());
}

/**
 * A clean product name for a group.
 *
 * Catalog `displayName` is per-ROW and often carries the base ("M900 Gloss -
 * 90 Base", "2K PU Matt - Ext Clear"), which would put the base back on a row
 * that is meant to be base-free. A tile's curated label wins where there is
 * one; otherwise the trailing " - {baseColour}" is stripped off the best row.
 */
export function groupDisplayName(group: V2ProductGroup, tileLabel?: string): string {
  if (tileLabel) return tileLabel;
  const { displayName, baseColour } = group.best;
  if (baseColour) {
    const suffix = ` - ${baseColour}`;
    if (displayName.toLowerCase().endsWith(suffix.toLowerCase())) {
      return displayName.slice(0, displayName.length - suffix.length);
    }
  }
  return displayName;
}

export function ProductResults({
  products, query, labelFor, onPick,
}: {
  products: ApiProduct[];
  query: string;
  /** The curated tile label for a group key, when it is one of the 32. */
  labelFor: (key: string) => string | undefined;
  onPick: (group: V2ProductGroup) => void;
}): React.JSX.Element {
  const groups = searchProductGroups(products, query);

  if (groups.length === 0) {
    // No suggestions, no fallback list — an empty result is an answer.
    return (
      <p className="px-4 py-12 text-center text-[13px]" style={{ color: FAINT }}>
        No product matches {query.trim()}
      </p>
    );
  }

  return (
    <div>
      {groups.map((g) => (
        <button
          key={g.key}
          type="button"
          onClick={() => onPick(g)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
          style={{ borderBottom: `1px solid ${RULE}` }}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold" style={{ color: INK }}>
              {groupDisplayName(g, labelFor(g.key))}
            </span>
            {/* Family only. The base is INSIDE the drawer now. */}
            <span className="block truncate text-[12px]" style={{ color: MUTED }}>{g.best.family}</span>
          </span>
          <span
            className="shrink-0 rounded-[10px] bg-white px-3 py-1.5 text-[13px] font-extrabold"
            style={{ border: `1px solid ${RULE}`, color: VIOLET }}
          >
            Add
          </span>
        </button>
      ))}
    </div>
  );
}
