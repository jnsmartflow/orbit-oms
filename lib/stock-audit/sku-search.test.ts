// lib/stock-audit/sku-search.test.ts — npx tsx --test lib/stock-audit/sku-search.test.ts
//
// The phone's local SKU search: min 4, contained anywhere, active first then
// isPrimary first then material, max 20, tagged excluded. v3 rows (2026-11-04)
// carry an isActive slot; inactive rows are searchable. Pure.

import test from "node:test";
import assert from "node:assert/strict";
import { SEARCH_MAX_HITS, isCatalogRow, searchCatalog, type CatalogRow } from "./sku-search";

const ROWS: CatalogRow[] = [
  ["IN01033071", "Velvet Touch 1L", "1 L", 0, 1],
  ["01033071", "Velvet Touch 1L", "1 L", 1, 1],
  ["5233221", "Promise Int 4L", "4 L", 1, 1],
  ["12345-01033071", "Tagged twin", "1 L", 1, 1],
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

test("a hit is material, description, pack and active", () => {
  assert.deepEqual(searchCatalog(ROWS, "5233221"), [
    { material: "5233221", description: "Promise Int 4L", pack: "4 L", active: true },
  ]);
});

test("an inactive row is still returned, flagged active: false", () => {
  const rows: CatalogRow[] = [["5908364", "DN AQUATECH DAMP PROTECT 2IN1 4L", "4L", 1, 0]];
  assert.deepEqual(searchCatalog(rows, "5908364"), [
    { material: "5908364", description: "DN AQUATECH DAMP PROTECT 2IN1 4L", pack: "4L", active: false },
  ]);
});

test("an inactive row sorts after an active row with the same match — even a primary one", () => {
  const rows: CatalogRow[] = [
    ["IN59083641", "inactive primary", "4L", 1, 0],
    ["59083642", "active non-primary", "4L", 0, 1],
    ["59083643", "active primary", "4L", 1, 1],
  ];
  // active first (primary before non-primary), the inactive row last.
  assert.deepEqual(searchCatalog(rows, "590836").map((h) => h.material), ["59083643", "59083642", "IN59083641"]);
});

test("at most 20 hits", () => {
  const many: CatalogRow[] = Array.from({ length: 50 }, (_, i) => [`99990${String(i).padStart(2, "0")}`, "x", "1 L", 0, 1]);
  assert.equal(searchCatalog(many, "9999").length, SEARCH_MAX_HITS);
});

test("isCatalogRow refuses malformed stored rows", () => {
  assert.equal(isCatalogRow(ROWS[0]), true); // the v3 5-slot row is accepted
  assert.equal(isCatalogRow(["A", "b", "c", 1, 0]), true); // inactive
  assert.equal(isCatalogRow(["A", "b", "c", 1]), false); // the v2 4-slot row is refused
  assert.equal(isCatalogRow(["A", "b", "c", 12, 1]), false); // a v1 row (carton size in slot 4) is refused
  assert.equal(isCatalogRow(["A", "b", "c", 2, 1]), false); // isPrimary is 0 or 1
  assert.equal(isCatalogRow(["A", "b", "c", 1, 2]), false); // isActive is 0 or 1
  assert.equal(isCatalogRow(["A", "b", "c"]), false);
  assert.equal(isCatalogRow({ material: "A" }), false);
});
