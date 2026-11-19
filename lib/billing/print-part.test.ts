// npx tsx --test lib/billing/print-part.test.ts — per-part ship-to (v27.81, batch 5)
import { test } from "node:test";
import assert from "node:assert/strict";
import { billStatesOf, printShipToName } from "./print";
import type { PartShipToCols } from "@/lib/ship-to/effective";

const OBD = {
  shipToOverride: false,
  shipToOverrideCustomerId: null,
  shipToText: null,
  shipToAreaId: null,
  shipToCustomerName: "SAP NAME",
  shipToOverrideCustomer: null,
};
const REDIRECTED = { ...OBD, shipToOverride: true, shipToOverrideCustomerId: 9, shipToOverrideCustomer: { customerName: "DEALER 9" } };
const TO_2375: PartShipToCols = { shipToOverride: true, shipToOverrideCustomerId: 2375, shipToText: null, shipToAreaId: null };
const RESET: PartShipToCols = { shipToOverride: false, shipToOverrideCustomerId: null, shipToText: null, shipToAreaId: null };
const NAMES = new Map([[2375, "DEALER 2375"]]);

test("printShipToName: an inheriting line is today's expression, byte for byte", () => {
  assert.equal(printShipToName(OBD, null, NAMES), "SAP NAME");
  assert.equal(printShipToName(REDIRECTED, null, NAMES), "DEALER 9");
});

test("printShipToName: a part's own dealer names its own shop", () => {
  assert.equal(printShipToName(OBD, TO_2375, NAMES), "DEALER 2375");
  assert.equal(printShipToName(REDIRECTED, TO_2375, NAMES), "DEALER 2375");
});

test("printShipToName: a part reset to SAP's site shows SAP's name even on a redirected bill", () => {
  assert.equal(printShipToName(REDIRECTED, RESET, NAMES), "SAP NAME");
});

test("billStatesOf: one line per bill → the lines themselves, same order (identity)", () => {
  const rows = [
    { orderId: 2, state: "ready" as const },
    { orderId: 1, state: "copied" as const },
  ];
  const out = billStatesOf(rows);
  assert.deepEqual(out, rows);
  assert.equal(out[0], rows[0]);
});

test("billStatesOf: Q5 — one bill at two stops counts once; copied only when both lines are", () => {
  assert.deepEqual(
    billStatesOf([
      { orderId: 1, state: "copied" as const },
      { orderId: 1, state: "ready" as const },
    ]).map((r) => r.state),
    ["ready"],
  );
  assert.deepEqual(
    billStatesOf([
      { orderId: 1, state: "copied" as const },
      { orderId: 1, state: "copied" as const },
    ]).map((r) => r.state),
    ["copied"],
  );
});
