// lib/floor/invoice-rows.test.ts — npx tsx --test lib/floor/invoice-rows.test.ts
//
// Add invoices Phase 4 commit 1: one Floor row per invoice. Pure — no database.
// Fixture: order 18648 / OBD 9109951956 as it is live (4 lines, 50 tins,
// 1,000 L, header 1,357 kg, no line kg) and its 4 invoices 716/713/714/715.

import test from "node:test";
import assert from "node:assert/strict";
import { addedInvoiceNosOf, buildInvoiceRows, drawRows, drawRowsOf, type InvoiceLineFacts, type InvoiceRowSource } from "./invoice-rows";

const LINES: InvoiceLineFacts[] = [
  { rawLineItemId: 62850, lineId: 1, skuCodeRaw: "5880380", unitQty: 13, volumeLine: 260, totalWeight: null },
  { rawLineItemId: 62851, lineId: 2, skuCodeRaw: "5963121", unitQty: 12, volumeLine: 240, totalWeight: null },
  { rawLineItemId: 62852, lineId: 3, skuCodeRaw: "9296830", unitQty: 10, volumeLine: 200, totalWeight: null },
  { rawLineItemId: 62853, lineId: 4, skuCodeRaw: "9296830", unitQty: 15, volumeLine: 300, totalWeight: null },
];
const D = new Date("2026-10-05T00:00:00.000Z");
const ROWS: InvoiceRowSource[] = [
  { id: 17010, seq: 1, invoiceNo: "I536230716", invoiceDate: D, lines: [{ rawLineItemId: 62853, qty: 15 }] },
  { id: 17011, seq: 2, invoiceNo: "I536230713", invoiceDate: D, lines: [{ rawLineItemId: 62850, qty: 13 }] },
  { id: 17012, seq: 3, invoiceNo: "I536230714", invoiceDate: D, lines: [{ rawLineItemId: 62851, qty: 12 }] },
  { id: 17013, seq: 4, invoiceNo: "I536230715", invoiceDate: D, lines: [{ rawLineItemId: 62852, qty: 10 }] },
];

test("unsplit (one row) → [] — drawn exactly as before", () => {
  assert.deepEqual(buildInvoiceRows({ rows: [ROWS[0]], activeLines: LINES, obdKg: 1357 }), []);
});

test("18648: tins, litres, ~kg shared by litres (no line kg) — approximate", () => {
  const out = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  assert.deepEqual(out.map((r) => [r.seq, r.invoiceNo, r.tins, r.litres]), [
    [1, "I536230716", 15, 300],
    [2, "I536230713", 13, 260],
    [3, "I536230714", 12, 240],
    [4, "I536230715", 10, 200],
  ]);
  // 1,357 kg × litres / 1,000 L.
  [407.1, 352.82, 325.68, 271.4].forEach((x, i) => assert.ok(Math.abs((out[i].kg ?? 0) - x) < 1e-9, `seq ${i + 1}: ${out[i].kg}`));
  assert.ok(out.every((r) => r.kgExact === false && r.stale === false));
  assert.equal(Math.round(out.reduce((s, r) => s + (r.kg ?? 0), 0)), 1357);
  assert.equal(out[0].invoiceDate, "2026-10-05T00:00:00.000Z");
});

test("kg rule 1: line kg on EVERY line of the invoice → exact, pro rata by tins", () => {
  const withKg = LINES.map((l) => (l.rawLineItemId === 62853 ? { ...l, totalWeight: 390 } : l));
  const out = buildInvoiceRows({ rows: ROWS, activeLines: withKg, obdKg: 1357 });
  assert.deepEqual([out[0].kg, out[0].kgExact], [390, true]);
  // The other invoices' lines carry no kg → rule 3.
  assert.equal(out[1].kgExact, false);
  const part = buildInvoiceRows({
    rows: [ROWS[0], { ...ROWS[1], lines: [{ rawLineItemId: 62853, qty: 5 }] }],
    activeLines: withKg,
    obdKg: 1357,
  });
  assert.deepEqual([part[1].kg, part[1].kgExact], [130, true]);
});

test("kg rule 2: a unit weight for every line's SKU → exact; one missing → rule 3", () => {
  const unit = new Map([["5880380", 26], ["5963121", 25]]);
  const out = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357, unitKgBySku: unit });
  assert.deepEqual([out[1].kg, out[1].kgExact], [13 * 26, true]);
  assert.deepEqual([out[2].kg, out[2].kgExact], [12 * 25, true]);
  assert.equal(out[3].kgExact, false); // 9296830 has no unit weight
});

test("kg rule 3 with no header kg → null", () => {
  const out = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: null });
  assert.ok(out.every((r) => r.kg === null && !r.kgExact));
});

test("stale: a saved line SAP removed, tins that no longer add up, or a half-written row", () => {
  const removed = buildInvoiceRows({ rows: ROWS, activeLines: LINES.slice(0, 3), obdKg: 1357 });
  assert.ok(removed.every((r) => r.stale));
  assert.equal(removed[0].litres, 0); // its only line is gone
  const moved = buildInvoiceRows({ rows: ROWS, activeLines: LINES.map((l) => (l.lineId === 1 ? { ...l, unitQty: 14 } : l)), obdKg: 1357 });
  assert.ok(moved.every((r) => r.stale));
  const half = buildInvoiceRows({ rows: [...ROWS.slice(0, 3), { ...ROWS[3], lines: [] }], activeLines: LINES, obdKg: 1357 });
  assert.ok(half.every((r) => r.stale));
});

test("seq order whatever order the read returns", () => {
  const out = buildInvoiceRows({ rows: ROWS.slice().reverse(), activeLines: LINES, obdKg: 1357 });
  assert.deepEqual(out.map((r) => r.seq), [1, 2, 3, 4]);
  assert.deepEqual(addedInvoiceNosOf(out), ["I536230713", "I536230714", "I536230715"]);
});

test("draw rows: split → one per invoice, key inv:<id>, k of n; unsplit and re-delivery → once", () => {
  const invoiceRows = buildInvoiceRows({ rows: ROWS, activeLines: LINES, obdKg: 1357 });
  const split = drawRowsOf({ orderId: 18648, invoiceRows });
  assert.deepEqual(split.map((d) => [d.key, d.k, d.n, d.first, d.last]), [
    ["inv:17010", 1, 4, true, false],
    ["inv:17011", 2, 4, false, false],
    ["inv:17012", 3, 4, false, false],
    ["inv:17013", 4, 4, false, true],
  ]);
  assert.equal(split[1].invoice?.invoiceNo, "I536230713");
  assert.deepEqual(drawRowsOf({ orderId: 7, invoiceRows: [] }).map((d) => [d.key, d.invoice, d.k, d.n]), [["7", null, 1, 1]]);
  assert.deepEqual(drawRowsOf({ orderId: 18648, invoiceRows, redelivery: { id: 28 } }).map((d) => d.key), ["rd:28"]);
  assert.deepEqual(
    drawRows([{ orderId: 1, invoiceRows: [] }, { orderId: 18648, invoiceRows }, { orderId: 2 }]).map((d) => d.key),
    ["1", "inv:17010", "inv:17011", "inv:17012", "inv:17013", "2"],
  );
});
