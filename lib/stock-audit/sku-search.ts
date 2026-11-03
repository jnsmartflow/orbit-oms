// lib/stock-audit/sku-search.ts — the stock-count SKU search, run ON THE PHONE
// over the whole catalogue it downloaded once (GET /api/stock-count/catalog).
//
// 🔴 PURE — no Prisma, no server imports, no React. The phone imports it by
// value; lib/stock-audit/catalog.ts (server) imports the row shape and the
// tagged-code rule from here, so the list it ships and the search that reads it
// cannot disagree.
//
// The rules are the old server search's (GET /api/stock-count/skus, removed
// 2026-11-02), unchanged:
//   · q trimmed + upper-cased, at least 4 characters;
//   · matched ANYWHERE in the material (01033071 finds IN01033071);
//   · active only and tagged duplicates (^[0-9]+-) excluded — the server builds
//     the list that way; searchCatalog drops a tagged code too, defensively;
//   · isPrimary first, then material; at most 20.
//
// ⚠️ MATERIAL ONLY. A row carries the SAP code and never a sku_master /
// sku_master_v2 row id (CORE §13, the id-space landmine). The server re-checks
// the code against sku_master_v2 on every save regardless of what this found.

/** A tagged duplicate ("12345-…") — never searchable or resolvable. */
export const TAGGED_CODE = /^[0-9]+-/;

export const SEARCH_MIN_CHARS = 4;
export const SEARCH_MAX_HITS = 20;

/**
 * One catalogue row ON THE WIRE and in localStorage — a compact array, not an
 * object (≈ 96 KB raw / 14 KB gzipped for ~1,700 rows, vs ≈ 214 / 17 as objects):
 *   [material, description, pack, isPrimary 1 | 0]
 * v2 (2026-11-03): the carton-size slot is gone — qty is always pieces. The
 * phone's localStorage key moved to stock_count_catalog_v2 with it.
 */
export type CatalogRow = [string, string, string, 0 | 1];

/** One search hit, as the phone uses it. */
export interface SkuHit {
  material: string;
  description: string;
  pack: string;
}

export function hitOf(r: CatalogRow): SkuHit {
  return { material: r[0], description: r[1], pack: r[2] };
}

/** The typed box → the search key, or null below 4 characters. */
export function searchKey(q: string): string | null {
  const key = q.trim().toUpperCase();
  return key.length >= SEARCH_MIN_CHARS ? key : null;
}

/** Is this a catalogue row the screen should accept as well-formed? */
export function isCatalogRow(v: unknown): v is CatalogRow {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    typeof v[0] === "string" &&
    typeof v[1] === "string" &&
    typeof v[2] === "string" &&
    (v[3] === 0 || v[3] === 1)
  );
}

/** Search the downloaded list. [] below 4 characters. */
export function searchCatalog(rows: readonly CatalogRow[], q: string): SkuHit[] {
  const key = searchKey(q);
  if (key === null) return [];
  const matches = rows.filter((r) => r[0].includes(key) && !TAGGED_CODE.test(r[0]));
  matches.sort((a, b) => b[3] - a[3] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return matches.slice(0, SEARCH_MAX_HITS).map(hitOf);
}
