// lib/order-invoices/copy-plan.test.ts — npx tsx --test lib/order-invoices/copy-plan.test.ts
//
// Add invoices P5-5 (2026-10-23): per-invoice copies. Pure — no database.
// Fixture: order 18648 (rows 17010 / 36798 / 36799 / 36800 = …716 / 713 / 714 /
// 715, split 12 Oct), copy 276 on trip 605 (6 Oct, on 17010).

import test from "node:test";
import assert from "node:assert/strict";
import { badSentNo, copyCovers, coveringCopy, isWholeObdCopy, planCopyRows, splitAtOf } from "./copy-plan";

const SPLIT_AT = new Date("2026-10-12T13:58:24.350Z");
const ROWS = [
  { seq: 1, createdAt: new Date("2026-10-10T07:48:09.972Z") },
  { seq: 2, createdAt: SPLIT_AT },
  { seq: 3, createdAt: SPLIT_AT },
  { seq: 4, createdAt: SPLIT_AT },
];
const COPY_276 = { tripId: 605, orderInvoiceId: 17010, copiedAt: new Date("2026-10-06T05:33:21.523Z") };

test("split moment: the earliest seq ≥ 2 row; never split → null", () => {
  assert.deepEqual(splitAtOf(ROWS), SPLIT_AT);
  assert.equal(splitAtOf([ROWS[0]]), null);
});

test("copy 276 (before the split) is a whole-OBD copy: it covers 713 and 715 on its trip", () => {
  assert.equal(isWholeObdCopy(COPY_276, SPLIT_AT), true);
  assert.equal(copyCovers(COPY_276, 36798, SPLIT_AT), true);
  assert.equal(copyCovers(COPY_276, 36800, SPLIT_AT), true);
  assert.equal(coveringCopy([COPY_276], 36798, SPLIT_AT, (t) => t === 605), COPY_276);
  assert.equal(coveringCopy([COPY_276], 36798, SPLIT_AT, (t) => t === 668), null); // another trip
});

test("a copy AFTER the split covers only the invoice it names", () => {
  const c = { tripId: 605, orderInvoiceId: 36798, copiedAt: new Date("2026-10-23T06:00:00.000Z") };
  assert.equal(copyCovers(c, 36798, SPLIT_AT), true);
  assert.equal(copyCovers(c, 36800, SPLIT_AT), false);
});

test("unsplit: the copy names seq 1 — identical to the per-OBD rule", () => {
  const c = { tripId: 1, orderInvoiceId: 500, copiedAt: new Date() };
  assert.equal(copyCovers(c, 500, null), true);
  assert.equal(isWholeObdCopy(c, null), false);
  assert.deepEqual(planCopyRows({ split: false, seq1Id: 500, here: [] }, null), [{ orderInvoiceId: 500, invoiceNo: null }]);
  assert.deepEqual(planCopyRows({ split: false, seq1Id: null, here: [] }, null), []);
});

test("bulk on a split bill: one row per invoice on the trip not copied yet", () => {
  const here = [
    { id: 36798, invoiceNo: "I536230713", copied: true },
    { id: 36800, invoiceNo: "I536230715", copied: false },
  ];
  assert.deepEqual(planCopyRows({ split: true, seq1Id: 17010, here }, null), [{ orderInvoiceId: 36800, invoiceNo: "I536230715" }]);
});

test("Copy inv on a split bill: only the invoices whose number went on the clipboard", () => {
  const here = [
    { id: 36798, invoiceNo: "I536230713", copied: false },
    { id: 36800, invoiceNo: " I536230715 ", copied: false },
  ];
  assert.deepEqual(planCopyRows({ split: true, seq1Id: 17010, here }, new Set(["I536230715"])), [
    { orderInvoiceId: 36800, invoiceNo: " I536230715 " },
  ]);
  assert.equal(badSentNo(here, new Set(["I536230713", "I536230715"])), null);
  assert.equal(badSentNo(here, new Set(["I536230716"])), "I536230716"); // not on this trip
  assert.equal(badSentNo([{ ...here[0], copied: true }], new Set(["I536230713"])), "I536230713"); // copied already
});
