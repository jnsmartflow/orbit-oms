// npx tsx --test lib/order-invoices/part-ship-to-read.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shopCountsOf, stopPart } from "./part-ship-to-read";
import type { PartShipToCols } from "@/lib/ship-to/effective";

const INHERIT: PartShipToCols = { shipToOverride: null, shipToOverrideCustomerId: null, shipToText: null, shipToAreaId: null };
const TO_2375: PartShipToCols = { shipToOverride: true, shipToOverrideCustomerId: 2375, shipToText: null, shipToAreaId: null };
const RESET: PartShipToCols = { shipToOverride: false, shipToOverrideCustomerId: null, shipToText: null, shipToAreaId: null };

const OBD = {
  id: 7,
  customerId: 2441,
  shipToOverride: false,
  shipToOverrideCustomerId: null,
  shipToCustomerId: "S1",
  shipToText: null,
  shipToAreaId: null,
};

test("stopPart: nothing own (all live data) → null for every stop", () => {
  const own = new Map<number, PartShipToCols>();
  assert.equal(stopPart([1, 2], own), null);
  assert.equal(stopPart(null, own), null);
  assert.equal(stopPart(undefined, own), null);
});

test("stopPart: the first row on the stop that has its own ship-to", () => {
  const own = new Map<number, PartShipToCols>([[2, TO_2375]]);
  assert.deepEqual(stopPart([1, 2], own), TO_2375);
  assert.equal(stopPart([1], own), null);
});

test("shopCountsOf: every part inheriting → 1 shop", () => {
  const counts = shopCountsOf([OBD], [{ orderId: 7, ...INHERIT }, { orderId: 7, ...INHERIT }]);
  assert.equal(counts.get(7), 1);
});

test("shopCountsOf: part 2 → another dealer → 2 shops", () => {
  const counts = shopCountsOf([OBD], [{ orderId: 7, ...INHERIT }, { orderId: 7, ...TO_2375 }]);
  assert.equal(counts.get(7), 2);
});

test("shopCountsOf: a reset to the bill's own site on an unredirected bill is the same shop", () => {
  const counts = shopCountsOf([OBD], [{ orderId: 7, ...INHERIT }, { orderId: 7, ...RESET }]);
  assert.equal(counts.get(7), 1);
});

test("shopCountsOf: an OBD with no rows read is absent (callers read 1)", () => {
  assert.equal(shopCountsOf([OBD], []).has(7), false);
});
