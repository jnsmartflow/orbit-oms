// ── The 2K PU SKUs that ship with a hardener ────────────────────────────────
//
// WHAT A HARDENER IS, AND WHY IT IS NOT ON THE BILL. A 2K (two-component) PU
// product cures only when it is mixed with its hardener, so the tin never
// leaves the depot alone — the picker physically fetches a hardener alongside
// it. SAP does not print that hardener as a line: it is not separately priced
// and not separately invoiced, it rides the parent product's own code. So the
// bill a picker reads is, on these SKUs, one item short of what he must
// actually carry to the truck. That gap is the whole reason this file exists.
//
// ⚠ MATCHED ON `skuCodeRaw` — THE SAP CODE, THE NATURAL KEY — AND DELIBERATELY
// NOT ON sku_master_v2. This is the natural-key rule from docs/CLAUDE_CORE.md
// §13 (and §7.1.c): the SAP code is present on every raw line, never null, and
// identical across every catalog table, whereas a catalog row may not exist at
// all — roughly 27% of live active SAP codes resolve in NEITHER catalog table.
// A catalog-driven flag (a column on sku_master_v2, a `category` match, a
// description LIKE) would therefore show NOTHING for any code that is not
// mastered, and it would do so silently: the picker would see an ordinary line
// and leave the hardener on the shelf. Matching the raw code cannot fail that
// way. It also means the flag is unaffected by a future catalog cleanup.
//
// ADDING A CODE HERE IS THE WHOLE EDIT. There is no DB table, no column, no
// seed row and no admin screen behind this — the list is code, it deploys with
// the app, and the only change a new 2K PU SKU needs is one more string below.
// That is deliberate: the set is small, it changes when the product range
// changes (rarely, and via Chandresh), and a table would have bought an admin
// CRUD surface nobody asked for.
//
// ⚠ ONE HARDENER PER ONE UNIT IS THE ONLY RULE. The quantity is a straight
// mirror of the parent line's own quantity — 4 tins of a 2K PU means 4
// hardeners. There is no per-SKU ratio today and no caller may invent one. If a
// SKU ever ships 1 hardener per 2 units (or a hardener of a named pack size),
// THIS FILE is where that lives: the set becomes a Map from code to a ratio,
// `needsHardener` grows a sibling that returns it, and
// lib/picking/group-lines.ts multiplies instead of mirroring. Nothing on either
// board should learn about ratios — the payload already carries a computed qty.

/**
 * The SAP material codes that ship with a hardener.
 *
 * Stored UPPERCASE so the lookup in `needsHardener()` can normalise once and
 * compare directly. All 25 were SELECT-verified present, `isActive` and
 * `isPrimary` in `sku_master_v2` on 2026-09-02 — but the flag does not depend
 * on that and keeps working if a code is ever retired from the catalog.
 */
export const HARDENER_SKU_CODES: ReadonlySet<string> = new Set([
  "5600816",
  "5600825",
  "5794058",
  "5826211",
  "5826214",
  "5826253",
  "5826256",
  "5841498",
  "5841501",
  "5841504",
  "5841507",
  "5841678",
  "5841681",
  "5841684",
  "IN35200181",
  "IN35200381",
  "IN35200481",
  "IN35200581",
  "IN35200681",
  "IN35201081",
  "IN35201181",
  "IN35201281",
  "IN35201381",
  "IN35201581",
  "IN35201781",
]);

/**
 * Does this SAP code ship with a hardener?
 *
 * Takes the RAW code straight off `import_raw_line_items.skuCodeRaw`, which is
 * typed non-null in the schema but arrives from an external SAP export — so
 * this trims surrounding whitespace and upper-cases before the lookup rather
 * than trusting the source's casing. Null/undefined/blank is simply `false`;
 * a line with no code is a line nothing can be decided about.
 */
export function needsHardener(skuCodeRaw: string | null | undefined): boolean {
  if (!skuCodeRaw) return false;
  return HARDENER_SKU_CODES.has(skuCodeRaw.trim().toUpperCase());
}
