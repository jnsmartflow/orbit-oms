// lib/trips/find-bill.test.ts — npx tsx --test lib/trips/find-bill.test.ts
//
// Split load phase 4 batch 4: an invoice number names EVERY row it is on.
// Pure (groupInvoiceMatches) — no database. Fixtures: order 18648 (Add
// invoices, four numbers) and order 22179 (I536233980 split across two trucks).

import test from "node:test";
import assert from "node:assert/strict";
import { groupInvoiceMatches } from "./find-bill";

test("18648 (Add invoices): each number → exactly one row — [0] is the row named before", () => {
  const rows = [
    { orderId: 18648, id: 17010, seq: 1, invoiceNo: "I536230716", loadParentId: null },
    { orderId: 18648, id: 36798, seq: 2, invoiceNo: "I536230713", loadParentId: null },
  ];
  for (const r of rows) {
    const m = groupInvoiceMatches([r]);
    assert.deepEqual(Array.from(m.keys()), [18648]);
    assert.deepEqual(m.get(18648), [{ id: r.id, seq: r.seq, invoiceNo: r.invoiceNo, loadParentId: null }]);
  }
});

test("I536233980 (split load): one number → both parts, seq order; [0] is part 1", () => {
  const m = groupInvoiceMatches([
    { orderId: 22179, id: 41213, seq: 2, invoiceNo: "I536233980", loadParentId: 40777 },
    { orderId: 22179, id: 40777, seq: 1, invoiceNo: "I536233980", loadParentId: null },
  ]);
  assert.deepEqual(m.get(22179)!.map((x) => [x.id, x.seq]), [[40777, 1], [41213, 2]]);
  assert.equal(m.get(22179)![0].seq, 1);
});

test("a shared invoice on two OBDs → one entry per OBD; a row with no number is skipped", () => {
  const m = groupInvoiceMatches([
    { orderId: 2, id: 20, seq: 1, invoiceNo: "I536234328", loadParentId: null },
    { orderId: 1, id: 10, seq: 1, invoiceNo: "I536234328", loadParentId: null },
    { orderId: 3, id: 30, seq: 2, invoiceNo: null, loadParentId: null },
  ]);
  assert.deepEqual(Array.from(m.keys()), [1, 2]);
  assert.equal(groupInvoiceMatches([]).size, 0);
});
