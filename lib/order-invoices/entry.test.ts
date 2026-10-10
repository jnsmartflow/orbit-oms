// lib/order-invoices/entry.test.ts — npx tsx --test lib/order-invoices/entry.test.ts
//
// Add invoices modal helpers (2026-10-10): short-number expansion, the kg share,
// line litres, tins left. Pure.

import test from "node:test";
import assert from "node:assert/strict";
import { expandInvoiceNo, kgShare, lineLitres, tinsLeft } from "./entry";

const SAP = "I536230716";

test("expand: a full number, any case, with or without I", () => {
  assert.equal(expandInvoiceNo("I536230713", SAP), "I536230713");
  assert.equal(expandInvoiceNo(" i536230713 ", SAP), "I536230713");
  assert.equal(expandInvoiceNo("536230713", SAP), "I536230713");
});

test("expand: last few digits take SAP's leading digits", () => {
  assert.equal(expandInvoiceNo("713", SAP), "I536230713");
  assert.equal(expandInvoiceNo("0713", SAP), "I536230713");
  assert.equal(expandInvoiceNo("6230799", SAP), "I536230799");
  assert.equal(expandInvoiceNo("1", SAP), "I536230711");
  assert.equal(expandInvoiceNo("I713", SAP), "I536230713");
});

test("expand: nothing usable → empty", () => {
  assert.equal(expandInvoiceNo("", SAP), "");
  assert.equal(expandInvoiceNo("   ", SAP), "");
  assert.equal(expandInvoiceNo("71x", SAP), "");
  assert.equal(expandInvoiceNo("5362307130", SAP), ""); // 10 digits — an OBD, not an invoice
  assert.equal(expandInvoiceNo("713", null), "");
  assert.equal(expandInvoiceNo("713", "ABC"), "");
});

test("kg share: OBD kg divided by litres", () => {
  // The mockup: 1,320 kg over 1,000 L; an invoice of 560 L → 739.2 kg.
  assert.equal(kgShare(1320, 560, 1000), 739.2);
  assert.equal(kgShare(1320, 1000, 1000), 1320);
  assert.equal(kgShare(1320, 0, 1000), 0);
});

test("kg share: unknown when there is nothing to share", () => {
  assert.equal(kgShare(null, 500, 1000), null);
  assert.equal(kgShare(0, 500, 1000), null);
  assert.equal(kgShare(1320, 500, 0), null);
});

test("line litres: pro rata, zero when unknown", () => {
  assert.equal(lineLitres(260, 13, 13), 260);
  assert.equal(lineLitres(260, 13, 5), 100);
  assert.equal(lineLitres(null, 13, 5), 0);
  assert.equal(lineLitres(260, 0, 5), 0);
});

test("tins left: unitQty minus saved papers", () => {
  assert.deepEqual(tinsLeft([13, 12, 10, 15], []), [13, 12, 10, 15]);
  assert.deepEqual(tinsLeft([13, 12, 10, 15], [[13, 0, 0, 15], [0, 12, 0, 0]]), [0, 0, 10, 0]);
});
