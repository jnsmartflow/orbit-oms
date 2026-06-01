// Client-side derivation helpers over the `products` payload from
// /api/place-order/data. The payload is small (~ a few hundred rows) so
// per-click filtering in the browser is fast enough that family,
// sub-product, section, and search views don't need server endpoints.
//
// Decision B (Stage 2): trim 5 originally-spec'd endpoints down to 2 by
// deriving these views client-side. Keep this file pure (no React, no fetch)
// so it's trivial to test and reuse.

import type { Product } from "@/app/(place-order)/place-order/types";

export type SearchResult =
  | { type: "family";           family: string; section: string; subProductCount: number; skuCount: number }
  | { type: "sub-product";      subProductName: string; family: string; section: string; skuCount: number }
  | { type: "sub-product-base"; subProductName: string; baseColour: string; family: string; section: string; skuCount: number };

export type FamilyInSection = {
  family:           string;
  subProductCount:  number;
  skuCount:         number;
};

const SEARCH_RESULT_LIMIT = 10;

// Token scoring used by searchProducts(). Higher = stronger match.
const SCORE_PREFIX_OF_HAYSTACK = 100;   // token at position 0 (e.g. "gl" against "gloss")
const SCORE_WORD_BOUNDARY       = 20;   // token at start of a word inside the haystack
const SCORE_SUBSTRING_INNER     =  5;   // token found inside a word
const SCORE_MULTI_TOKEN_BASE    = 50;   // bonus when 2+ tokens are typed AND a base-colour got hit

export function filterByFamily(products: Product[], familyName: string): Product[] {
  return products.filter((p) => p.family === familyName);
}

export function filterBySubProduct(
  products: Product[],
  family:   string,
  subProductName: string,
): Product[] {
  return products.filter((p) => p.family === family && p.subProduct === subProductName);
}

export function filterBySection(products: Product[], sectionName: string): FamilyInSection[] {
  const map = new Map<string, { subProducts: Set<string>; skuCount: number }>();
  for (const p of products) {
    if (p.section !== sectionName) continue;
    let entry = map.get(p.family);
    if (!entry) {
      entry = { subProducts: new Set(), skuCount: 0 };
      map.set(p.family, entry);
    }
    entry.subProducts.add(p.subProduct);
    entry.skuCount += p.packs.length;
  }
  return Array.from(map.entries())
    .map(([family, info]) => ({
      family,
      subProductCount: info.subProducts.size,
      skuCount:        info.skuCount,
    }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

export function groupBySection(products: Product[]): Record<string, FamilyInSection[]> {
  const sections = new Set(products.map((p) => p.section));
  const out: Record<string, FamilyInSection[]> = {};
  for (const section of Array.from(sections)) {
    out[section] = filterBySection(products, section);
  }
  return out;
}

// All products inside `sectionName`, bucketed by family. Used by
// SectionLanding (3.4.8) when the active state is a section tile.
export function groupProductsByFamily(
  products:    Product[],
  sectionName: string,
): Record<string, Product[]> {
  const out: Record<string, Product[]> = {};
  for (const p of products) {
    if (p.section !== sectionName) continue;
    const bucket = out[p.family];
    if (bucket) bucket.push(p);
    else        out[p.family] = [p];
  }
  return out;
}

// Score a single token against a haystack string. Returns 0 when the
// token isn't found anywhere. Treats positions after a space (and the
// haystack start) as word boundaries.
function scoreToken(token: string, haystack: string): number {
  const idx = haystack.indexOf(token);
  if (idx < 0) return 0;
  if (idx === 0)                  return SCORE_PREFIX_OF_HAYSTACK;
  if (haystack[idx - 1] === " ")  return SCORE_WORD_BOUNDARY;
  return SCORE_SUBSTRING_INNER;
}

// Sum-of-token scores. Returns 0 when ANY token fails to match (all-or-
// nothing AND across tokens), otherwise the total of per-token scores.
function scoreAllTokens(tokens: string[], haystack: string): number {
  let total = 0;
  for (const t of tokens) {
    const s = scoreToken(t, haystack);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

export function searchProducts(products: Product[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  // Aggregate per-family, per-sub-product, per-(sub-product, base) once
  // across the catalog. Tracks counts so result rows can render
  // "{N} SKUs" / "1 SKU" without recomputing.
  const families    = new Map<string, { section: string; subProducts: Set<string>; skuCount: number }>();
  const subProducts = new Map<string, { family: string; section: string; subProductName: string; skuCount: number }>();
  const subBases    = new Map<string, { family: string; section: string; subProductName: string; baseColour: string; skuCount: number; searchTokens: string }>();

  for (const p of products) {
    let fa = families.get(p.family);
    if (!fa) {
      fa = { section: p.section, subProducts: new Set(), skuCount: 0 };
      families.set(p.family, fa);
    }
    fa.subProducts.add(p.subProduct);
    fa.skuCount += p.packs.length;

    const subKey = `${p.family}|||${p.subProduct}`;
    let sp = subProducts.get(subKey);
    if (!sp) {
      sp = { family: p.family, section: p.section, subProductName: p.subProduct, skuCount: 0 };
      subProducts.set(subKey, sp);
    }
    sp.skuCount += p.packs.length;

    if (p.baseColour) {
      const subBaseKey = `${p.family}|||${p.subProduct}|||${p.baseColour}`;
      let sb = subBases.get(subBaseKey);
      if (!sb) {
        sb = {
          family:         p.family,
          section:        p.section,
          subProductName: p.subProduct,
          baseColour:     p.baseColour,
          skuCount:       0,
          searchTokens:   "",
        };
        subBases.set(subBaseKey, sb);
      }
      sb.skuCount += p.packs.length;
      // Accumulate per-row searchTokens so baked aliases (e.g. WS Max
      // "accent"/"rox") are matchable on desktop — same source as mobile.
      if (p.searchTokens) sb.searchTokens = sb.searchTokens ? `${sb.searchTokens} ${p.searchTokens}` : p.searchTokens;
    }
  }

  const scored: Array<{ result: SearchResult; score: number }> = [];

  // Family-level matches — haystack = lower-cased family name only.
  for (const [familyName, entry] of Array.from(families.entries())) {
    const haystack = familyName.toLowerCase();
    const score    = scoreAllTokens(tokens, haystack);
    if (score === 0) continue;
    scored.push({
      score,
      result: {
        type:            "family",
        family:          familyName,
        section:         entry.section,
        subProductCount: entry.subProducts.size,
        skuCount:        entry.skuCount,
      },
    });
  }

  // Sub-product-level — haystack = "family subProduct".
  for (const entry of Array.from(subProducts.values())) {
    const haystack = `${entry.family} ${entry.subProductName}`.toLowerCase();
    const score    = scoreAllTokens(tokens, haystack);
    if (score === 0) continue;
    scored.push({
      score,
      result: {
        type:           "sub-product",
        subProductName: entry.subProductName,
        family:         entry.family,
        section:        entry.section,
        skuCount:       entry.skuCount,
      },
    });
  }

  // Sub-product-base — haystack includes the base colour. Multi-token
  // queries that match a base get a +50 bonus (operator was specific
  // about colour).
  for (const entry of Array.from(subBases.values())) {
    const haystack = `${entry.family} ${entry.subProductName} ${entry.baseColour} ${entry.searchTokens}`.toLowerCase();
    const baseLow  = entry.baseColour.toLowerCase();
    const score    = scoreAllTokens(tokens, haystack);
    if (score === 0) continue;
    let total = score;
    if (tokens.length >= 2 && tokens.some((t) => baseLow.includes(t))) {
      total += SCORE_MULTI_TOKEN_BASE;
    }
    scored.push({
      score: total,
      result: {
        type:           "sub-product-base",
        subProductName: entry.subProductName,
        baseColour:     entry.baseColour,
        family:         entry.family,
        section:        entry.section,
        skuCount:       entry.skuCount,
      },
    });
  }

  // Dedupe by logical identity. The catalog cross-lists some products
  // across taxonomic families (e.g. PROMISE ENAMEL appears under both
  // family=PROMISE in MULTI-USE and family=PROMISE ENAMEL in ENAMELS).
  // Operators identify products by sub-product + base, not by the
  // family classification — so the dedup key drops `family` for the
  // sub-product and sub-product-base scopes. Family-scope keeps family
  // in the key (distinct families remain distinct).
  //
  // Collision policy: keep the higher-scored variant; ties keep the
  // first encountered. The kept result's family/section will be from
  // whichever the operator's query best matched.
  const dedupeKey = (r: SearchResult): string => {
    switch (r.type) {
      case "family":           return `F|${r.family}`;
      case "sub-product":      return `S|${r.subProductName}`;
      case "sub-product-base": return `B|${r.subProductName}|${r.baseColour}`;
    }
  };
  const seen = new Map<string, { result: SearchResult; score: number }>();
  for (const s of scored) {
    const key      = dedupeKey(s.result);
    const existing = seen.get(key);
    if (!existing || s.score > existing.score) {
      seen.set(key, s);
    }
  }

  const deduped = Array.from(seen.values()).sort((a, b) => b.score - a.score);
  return deduped.slice(0, SEARCH_RESULT_LIMIT).map((s) => s.result);
}
