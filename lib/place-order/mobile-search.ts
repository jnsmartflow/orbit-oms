// Mobile /order product ranking. Historically the mobile suggestion list was a
// boolean AND-substring filter with NO ranking — it returned matches in catalog
// (sortOrder) order. This module adds a relevance score + STABLE sort while
// keeping the exact same match SET, so existing queries return the same products
// just better-ordered.
//
// Weights mirror the desktop scorer (lib/place-order/queries.ts) so both surfaces
// rank consistently:
//   prefix-of-haystack 100 · word-boundary 20 · inner-substring 5 ·
//   +50 multi-token base bonus · +30 sub-product-name prefix · +2 WS-Dustproof tiebreak.
//
// Pure (no React, no fetch) so it is shared by the route and unit/sim harnesses.

import { isVariantQualifierTab } from "@/lib/place-order/sub-product-descriptors";
import { getFamilyDefaultForQuery } from "@/lib/place-order/keyword-family-map";

const SCORE_PREFIX_OF_HAYSTACK   = 100;
const SCORE_WORD_BOUNDARY        =  20;
const SCORE_SUBSTRING_INNER      =   5;
const SCORE_MULTI_TOKEN_BASE     =  50;
const SCORE_SUBPRODUCT_PREFIX    =  30;   // a query token is a prefix of the sub-product name
const SCORE_TOKEN_START          =  40;   // a query word BEGINS a comma-token ("protect dustproof") — above a mid-token word-boundary ("damp protect")
const SCORE_WS_DUSTPROOF_TIEBREAK =  2;   // nudges WS Dustproof above tied WS siblings (e.g. "ws")

// True when any query word begins a comma-delimited searchToken or the
// displayName. This is why "protect" ranks the WS Protect line (tokens
// "PROTECT DUSTPROOF" / "PROTECT RAINPROOF" begin with it) above Damp Protect
// (whose "protect" is the 2nd word of "DAMP PROTECT" — a word-boundary, not a start).
function startsAnyToken(searchTokens: string, displayName: string, words: string[]): boolean {
  const toks = searchTokens.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  toks.push((displayName ?? "").trim().toLowerCase());
  return words.some((w) => toks.some((t) => t.startsWith(w)));
}

// Minimum fields the ranker reads. Generic so callers keep their own Product type.
type Rankable = {
  family:       string;
  subProduct:   string;
  baseColour:   string | null;
  displayName:  string;
  searchTokens: string;
  sortOrder:    number;
};

// Bare 1-2 digit query tokens ("3", "9", "90") — see scoreToken below.
const SHORT_DIGIT_TOKEN = /^\d{1,2}$/;

// True when the haystack character immediately before `idx` is not part of a
// word (undefined/space/comma/"("/"-"/etc). Deliberately a non-alphanumeric
// test, not space-only — searchTokens joins on bare commas ("brush,double,
// super,2 inch,dulux") with no space, so a space-only test would miss those
// word starts.
function isWordStart(haystack: string, idx: number): boolean {
  if (idx === 0) return true;
  return !/[a-z0-9]/i.test(haystack[idx - 1]);
}

function scoreToken(token: string, haystack: string): number {
  if (SHORT_DIGIT_TOKEN.test(token)) {
    // Bare 1-2 digit tokens must only score at a word start — a mid-word hit
    // (e.g. "3" inside the SAP material code "6472113", which searchTokens
    // carries per v2-catalog-seed-from-preview.ts step 7.8) must NOT count,
    // or a query like "brush 3" leaks unrelated rows via their baked-in
    // codes. indexOf() only finds the FIRST occurrence, which can be
    // mid-word even when a later, legitimate word-start occurrence exists
    // elsewhere in the haystack — so every occurrence is scanned and the
    // best-scoring one wins.
    let best = 0;
    let idx  = haystack.indexOf(token);
    while (idx !== -1) {
      if (idx === 0) return SCORE_PREFIX_OF_HAYSTACK;
      if (isWordStart(haystack, idx) && SCORE_WORD_BOUNDARY > best) best = SCORE_WORD_BOUNDARY;
      idx = haystack.indexOf(token, idx + 1);
    }
    return best;
  }
  const idx = haystack.indexOf(token);
  if (idx < 0)                   return 0;
  if (idx === 0)                 return SCORE_PREFIX_OF_HAYSTACK;
  if (haystack[idx - 1] === " ") return SCORE_WORD_BOUNDARY;
  return SCORE_SUBSTRING_INNER;
}

/**
 * Filter + rank products for a mobile search query. Returns the SAME set the
 * old AND-substring filter returned (a word must appear in
 * `searchTokens + displayName + baseColour`), ordered by relevance with a
 * stable fallback to the input (catalog/sortOrder) order.
 */
export function rankProductsForQuery<T extends Rankable>(products: T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const scored: Array<{ p: T; total: number; i: number }> = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    // Haystack is a set-equivalent superset of the old `searchTokens + productLabel`:
    // it always contains displayName + baseColour, so includes() matches identically.
    const haystack = `${p.searchTokens ?? ""} ${p.displayName ?? ""} ${p.baseColour ?? ""}`.toLowerCase();

    let total = 0;
    let matched = true;
    for (const w of words) {
      const s = scoreToken(w, haystack);
      if (s === 0) { matched = false; break; }
      total += s;
    }
    if (!matched) continue;

    // Colour-base bonus — SKIP for variant-qualifier tabs (SmartChoice / Primer):
    // their baseColour is a product/variant label ("Interior", "Int Primer", …),
    // not a colour, so a generic "int"/"ext"/"interior" token must not earn a
    // colour match (it used to flip "promise int" → SmartChoice above the
    // emulsion). Real-colour bases on every other family are unaffected.
    const baseLow = (p.baseColour ?? "").toLowerCase();
    if (
      words.length >= 2 &&
      !isVariantQualifierTab(p.family, p.subProduct) &&
      words.some((w) => baseLow.includes(w))
    ) total += SCORE_MULTI_TOKEN_BASE;

    const subLow = (p.subProduct ?? "").toLowerCase();
    if (words.some((w) => subLow.startsWith(w))) total += SCORE_SUBPRODUCT_PREFIX;

    if (startsAnyToken(p.searchTokens ?? "", p.displayName ?? "", words)) total += SCORE_TOKEN_START;

    if (p.family === "WS" && p.subProduct === "DUSTPROOF") total += SCORE_WS_DUSTPROOF_TIEBREAK;

    scored.push({ p, total, i });
  }

  // Score DESC; ties keep the input order (catalog/sortOrder) — stable.
  scored.sort((a, b) => (b.total - a.total) || (a.i - b.i));

  // Keyword-family promotion (whole-query match only, e.g. "VT"/"VELVET TOUCH"):
  // float the mapped family's matched rows to the top in natural tab order
  // (sortOrder asc); every other match stays BELOW in its normal ranked order.
  // Promote-only — nothing is dropped. No-op when the query maps to no family.
  const family = getFamilyDefaultForQuery(query);
  if (family) {
    const inFamily = scored.filter((s) => s.p.family === family)
      .sort((a, b) => a.p.sortOrder - b.p.sortOrder);
    const rest = scored.filter((s) => s.p.family !== family);
    return [...inFamily, ...rest].map((s) => s.p);
  }
  return scored.map((s) => s.p);
}
