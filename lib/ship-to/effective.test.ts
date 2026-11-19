// lib/ship-to/effective.test.ts — npx tsx --test lib/ship-to/effective.test.ts
//
// Per-part ship-to (Schema v27.81, 2026-11-19): the tri-state on a part (NULL =
// inherit, TRUE = own redirect, FALSE = own reset to SAP's site), the OBD's NULL
// flag read as false, and "how many shops" by drop-key equality. Pure.
// Fixture shape: OBD 9110835499 split into 2 load parts.

import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveDropInput,
  effectiveShipTo,
  isInheriting,
  partShopKey,
  partsShopCount,
  type PartShipToCols,
} from "./effective";
import { computeDropKey } from "@/lib/trips/drop-key";

const OBD = {
  customerId: 501,
  shipToCustomerId: "1100123",
  shipToCustomerName: "SHREE AAIJI HARDWARE",
  shipToOverride: false as boolean | null,
  shipToOverrideCustomerId: null as number | null,
  shipToText: null as string | null,
  shipToAreaId: null as number | null,
};
const INHERIT: PartShipToCols = { shipToOverride: null, shipToOverrideCustomerId: null, shipToText: null, shipToAreaId: null };
const OWN_DEALER = (id: number): PartShipToCols => ({ shipToOverride: true, shipToOverrideCustomerId: id, shipToText: null, shipToAreaId: null });
const OWN_TYPED: PartShipToCols = { shipToOverride: true, shipToOverrideCustomerId: null, shipToText: "Site at Pal", shipToAreaId: 7 };
const OWN_RESET: PartShipToCols = { shipToOverride: false, shipToOverrideCustomerId: null, shipToText: null, shipToAreaId: null };

test("isInheriting: NULL flag, null part and no part inherit; TRUE / FALSE do not", () => {
  assert.equal(isInheriting(INHERIT), true);
  assert.equal(isInheriting(null), true);
  assert.equal(isInheriting(undefined), true);
  assert.equal(isInheriting(OWN_DEALER(9)), false);
  assert.equal(isInheriting(OWN_RESET), false);
});

test("effectiveShipTo: an inheriting part takes the OBD's columns, own=false", () => {
  const obd = { ...OBD, shipToOverride: true, shipToOverrideCustomerId: 777 };
  assert.deepEqual(effectiveShipTo(obd, INHERIT), {
    shipToOverride: true,
    shipToOverrideCustomerId: 777,
    shipToText: null,
    shipToAreaId: null,
    own: false,
  });
  assert.deepEqual(effectiveShipTo(obd), effectiveShipTo(obd, INHERIT));
});

test("effectiveShipTo: TRUE part is its own redirect; FALSE part is its own reset even when the OBD is redirected", () => {
  const obd = { ...OBD, shipToOverride: true, shipToOverrideCustomerId: 777 };
  assert.deepEqual(effectiveShipTo(obd, OWN_DEALER(42)), {
    shipToOverride: true,
    shipToOverrideCustomerId: 42,
    shipToText: null,
    shipToAreaId: null,
    own: true,
  });
  assert.deepEqual(effectiveShipTo(obd, OWN_TYPED), {
    shipToOverride: true,
    shipToOverrideCustomerId: null,
    shipToText: "Site at Pal",
    shipToAreaId: 7,
    own: true,
  });
  assert.deepEqual(effectiveShipTo(obd, OWN_RESET), {
    shipToOverride: false,
    shipToOverrideCustomerId: null,
    shipToText: null,
    shipToAreaId: null,
    own: true,
  });
});

test("effectiveShipTo: the OBD's NULL flag (live DDL drift) reads as false", () => {
  const r = effectiveShipTo({ ...OBD, shipToOverride: null }, INHERIT);
  assert.equal(r.shipToOverride, false);
  assert.equal(r.own, false);
});

test("effectiveDropInput: keeps every other field; an inheriting part keys exactly like the OBD", () => {
  const inp = effectiveDropInput(OBD, INHERIT);
  assert.equal(inp.shipToCustomerName, "SHREE AAIJI HARDWARE");
  assert.equal(inp.customerId, 501);
  assert.equal(computeDropKey(inp), computeDropKey(OBD));
  assert.equal(partShopKey(OBD, INHERIT), "c:501");
  assert.equal(partShopKey(OBD), "c:501");
});

test("effectiveDropInput: own dealer → c:<dealer>; own typed → t: key; own reset on a redirected OBD → back to c:<customer>", () => {
  assert.equal(partShopKey(OBD, OWN_DEALER(42)), "c:42");
  assert.equal(partShopKey(OBD, OWN_TYPED), "t:501/7/site at pal");
  const redirected = { ...OBD, shipToOverride: true, shipToOverrideCustomerId: 777 };
  assert.equal(partShopKey(redirected, INHERIT), "c:777");
  assert.equal(partShopKey(redirected, OWN_RESET), "c:501");
});

test("partsShopCount — 9110835499 today: two inheriting parts → 1 shop", () => {
  assert.equal(partsShopCount(OBD, [INHERIT, INHERIT]), 1);
});

test("partsShopCount — 9110835499 with part 2's own dealer → 2 shops", () => {
  assert.equal(partsShopCount(OBD, [INHERIT, OWN_DEALER(42)]), 2);
});

test("partsShopCount — same shop by key even when spelled differently (redirect to the bill's own customer)", () => {
  assert.equal(partsShopCount(OBD, [INHERIT, OWN_DEALER(501)]), 1);
  assert.equal(partsShopCount(OBD, [OWN_RESET, INHERIT]), 1);
  assert.equal(partsShopCount(OBD, []), 0);
});
