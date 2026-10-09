// lib/floor/selection.test.ts — npx tsx --test lib/floor/selection.test.ts
//
// The desk selection rules a pair tick leans on (toggleAllDesk is the merged
// tick's all-or-none) and the bottom bar's invoice/OBD count. Pure.

import test from "node:test";
import assert from "node:assert/strict";
import { selectionCountLabel, toggleAllDesk, type FloorDeskSelection } from "./selection";

const r = (invoiceNo: string | null, partners = 0) => ({ invoiceNo, invoicePartners: Array.from({ length: partners }) });
const row = (orderId: number) => ({ orderId });

test("pair tick (toggleAllDesk over the block): none → all, partial → all, all → none", () => {
  const block = [row(1), row(2)];
  const none: FloorDeskSelection = new Set([9]);
  const all = toggleAllDesk(none, block);
  assert.deepEqual(Array.from(all).sort(), [1, 2, 9]);
  assert.deepEqual(Array.from(toggleAllDesk(new Set([1, 9]), block)).sort(), [1, 2, 9]); // partial fills
  assert.deepEqual(Array.from(toggleAllDesk(all, block)), [9]); // other ticks survive
});

test("a 3-OBD block is toggled whole — no size assumed", () => {
  const block = [row(1), row(2), row(3)];
  assert.deepEqual(Array.from(toggleAllDesk(new Set(), block)).sort(), [1, 2, 3]);
});

test("label: one pair → '1 invoice · 2 OBDs'", () => {
  assert.equal(selectionCountLabel([r("I1", 1), r("I1", 1)]), "1 invoice · 2 OBDs");
});

test("label: a pair plus two single-invoice bills → '3 invoices · 4 OBDs'", () => {
  assert.equal(selectionCountLabel([r("I1", 1), r("I1", 1), r("I2"), r("I3")]), "3 invoices · 4 OBDs");
});

test("label: no multi-OBD invoice in the selection → null (bar keeps 'N selected')", () => {
  assert.equal(selectionCountLabel([r("I2"), r("I3"), r(null)]), null);
  assert.equal(selectionCountLabel([]), null);
});

test("label: a split pair half alone still says it is part of an invoice; un-invoiced bills said apart", () => {
  assert.equal(selectionCountLabel([r("I1", 1)]), "1 invoice · 1 OBD");
  assert.equal(selectionCountLabel([r("I1", 1), r("I1", 1), r(null)]), "1 invoice + 1 not invoiced · 3 OBDs");
});

test("label: a 3-OBD invoice", () => {
  assert.equal(selectionCountLabel([r("I3", 2), r("I3", 2), r("I3", 2)]), "1 invoice · 3 OBDs");
});
