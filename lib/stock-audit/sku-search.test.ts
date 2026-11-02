// lib/stock-audit/sku-search.test.ts — npx tsx --test lib/stock-audit/sku-search.test.ts
//
// The phone's local SKU search: the old server rules (min 4, contained
// anywhere, isPrimary first then material, max 20, tagged excluded). Pure.

import test from "node:test";
import assert from "node:assert/strict";
import { SEARCH_MAX_HITS, isCatalogRow, searchCatalog, type CatalogRow } from "./sku-search";

const ROWS: CatalogRow[] = [
  ["IN01033071", "Velvet Touch 1L", "1 L", 12, 0],
  ["01033071", "Velvet Touch 1L", "1 L", null, 1],
  ["5233221", "Promise Int 4L", "4 L", 4, 1],
  ["12345-01033071", "Tagged twin", "1 L", null, 1],
];

test("below 4 characters → nothing", () => {
  assert.deepEqual(searchCatalog(ROWS, "010"), []);
  assert.deepEqual(searchCatalog(ROWS, " 0 1 "), []);
});

test("contained anywhere, trimmed + upper-cased, isPrimary first, tagged excluded", () => {
  const hits = searchCatalog(ROWS, " 1033071 ");
  assert.deepEqual(hits.map((h) => h.material), ["01033071", "IN01033071"]);
  assert.equal(searchCatalog(ROWS, "in0103").length, 1);
});

test("carton rule: defaultMode cartons only when piecesPerCarton > 0", () => {
  const [h] = searchCatalog(ROWS, "5233221");
  assert.equal(h.piecesPerCarton, 4);
  assert.equal(h.defaultMode, "cartons");
  assert.equal(searchCatalog(ROWS, "01033071")[0].defaultMode, "pieces");
});

test("at most 20 hits", () => {
  const many: CatalogRow[] = Array.from({ length: 50 }, (_, i) => [`99990${String(i).padStart(2, "0")}`, "x", "1 L", null, 0]);
  assert.equal(searchCatalog(many, "9999").length, SEARCH_MAX_HITS);
});

test("isCatalogRow refuses malformed stored rows", () => {
  assert.equal(isCatalogRow(ROWS[0]), true);
  assert.equal(isCatalogRow(["A", "b", "c", 0, 1]), false); // carton size must be > 0 or null
  assert.equal(isCatalogRow(["A", "b", "c", null]), false);
  assert.equal(isCatalogRow({ material: "A" }), false);
});
