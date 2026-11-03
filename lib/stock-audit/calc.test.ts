// lib/stock-audit/calc.test.ts — npx tsx --test lib/stock-audit/calc.test.ts
//
// The one-box qty rule against chk_stock_audit_lines_qty ("qty" > 0) and the
// int4 column (Schema v27.79). Pure — no database, no React.

import test from "node:test";
import assert from "node:assert/strict";
import { INT4_MAX, validateQty } from "./calc";

test("good values — digits strings and integers", () => {
  assert.deepEqual(validateQty("1"), { ok: true, qty: 1 });
  assert.deepEqual(validateQty(" 965 "), { ok: true, qty: 965 });
  assert.deepEqual(validateQty("007"), { ok: true, qty: 7 });
  assert.deepEqual(validateQty(4142), { ok: true, qty: 4142 });
});

test("blank → Enter the quantity", () => {
  for (const raw of [undefined, null, "", "   "]) {
    assert.deepEqual(validateQty(raw), { ok: false, message: "Enter the quantity" });
  }
});

test("zero is refused (the CHECK is qty > 0)", () => {
  assert.equal(validateQty("0").ok, false);
  assert.equal(validateQty(0).ok, false);
  assert.equal(validateQty("000").ok, false);
});

test("negative, decimal and non-digit input refused", () => {
  for (const raw of ["-5", -5, "1.5", 1.5, "12a", "1e3", "１２", NaN, Infinity, true, {}, [3]]) {
    assert.equal(validateQty(raw).ok, false, `accepted ${String(raw)}`);
  }
});

test("int4 edge: INT4_MAX accepted, one more refused", () => {
  assert.deepEqual(validateQty(String(INT4_MAX)), { ok: true, qty: INT4_MAX });
  assert.deepEqual(validateQty(INT4_MAX), { ok: true, qty: INT4_MAX });
  assert.deepEqual(validateQty(String(INT4_MAX + 1)), { ok: false, message: "Qty is too large" });
  assert.deepEqual(validateQty(INT4_MAX + 1), { ok: false, message: "Qty is too large" });
  assert.equal(validateQty("99999999999999999999").ok, false);
});
