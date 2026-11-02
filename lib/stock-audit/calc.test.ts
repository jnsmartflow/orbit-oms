// lib/stock-audit/calc.test.ts — npx tsx --test lib/stock-audit/calc.test.ts
//
// The stock-count calculator against chk_stock_audit_lines_total /
// _carton / _nonneg (Schema v27.78): pieces, cartons, loose only, zero refused,
// missing carton refused, big numbers. Pure — no database, no React.

import test from "node:test";
import assert from "node:assert/strict";
import { INT4_MAX, computeTotal, formatWorking, validateLineInput, type CountWorking } from "./calc";

/** The CHECK's own formula, in BigInt, to compare against. */
function checkFormula(w: CountWorking): bigint {
  return (
    BigInt(w.stack) * BigInt(w.rows) * BigInt(w.depth) * BigInt(w.pcsPerCarton ?? 1) + BigInt(w.loose)
  );
}

function valid(input: Parameters<typeof validateLineInput>[0]) {
  const r = validateLineInput(input);
  if (!r.ok) assert.fail(`expected ok, got ${JSON.stringify(r.errors)}`);
  return r;
}

function invalidFields(input: Parameters<typeof validateLineInput>[0]): string[] {
  const r = validateLineInput(input);
  assert.equal(r.ok, false, "expected a refusal");
  return r.ok ? [] : r.errors.map((e) => e.field);
}

test("pieces: stack × rows × depth + loose, no carton factor", () => {
  const r = valid({ mode: "pieces", stack: 4, rows: 10, depth: 2, loose: 5 });
  assert.equal(r.totalPcs, 85);
  assert.equal(r.working.pcsPerCarton, null);
  assert.equal(computeTotal(r.working), 85);
  assert.equal(BigInt(r.totalPcs), checkFormula(r.working));
  assert.equal(formatWorking(r.working), "4 × 10 × 2 + 5");
});

test("cartons: the carton factor is multiplied in and shown", () => {
  const r = valid({ mode: "cartons", stack: 4, rows: 10, depth: 2, pcsPerCarton: 12, loose: 5 });
  assert.equal(r.totalPcs, 965);
  assert.equal(BigInt(r.totalPcs), checkFormula(r.working));
  assert.equal(formatWorking(r.working), "4 × 10 × 2 × 12 + 5");
});

test("loose is shown only when > 0", () => {
  const r = valid({ mode: "cartons", stack: 4, rows: 10, depth: 2, pcsPerCarton: 12, loose: 0 });
  assert.equal(r.totalPcs, 960);
  assert.equal(formatWorking(r.working), "4 × 10 × 2 × 12");
});

test("loose only: blank stack/rows/depth read as 0, working is the loose count", () => {
  const r = valid({ mode: "pieces", stack: "", rows: "", depth: "", loose: "7" });
  assert.equal(r.totalPcs, 7);
  assert.deepEqual(
    [r.working.stack, r.working.rows, r.working.depth, r.working.loose],
    [0, 0, 0, 7],
  );
  assert.equal(BigInt(r.totalPcs), checkFormula(r.working));
  assert.equal(formatWorking(r.working), "7");
});

test("phone strings are accepted (inputmode=numeric fields)", () => {
  const r = valid({ mode: "cartons", stack: "3", rows: " 2 ", depth: "1", pcsPerCarton: "6", loose: "" });
  assert.equal(r.totalPcs, 36);
});

test("zero total is refused (Smart Flow: totalPcs > 0)", () => {
  assert.deepEqual(invalidFields({ mode: "pieces", stack: 0, rows: 10, depth: 2, loose: 0 }), ["total"]);
  assert.deepEqual(invalidFields({ mode: "pieces" }), ["total"]);
});

test("cartons without pcs per carton is refused — missing, blank or 0", () => {
  assert.deepEqual(invalidFields({ mode: "cartons", stack: 1, rows: 1, depth: 1 }), ["pcsPerCarton"]);
  assert.deepEqual(invalidFields({ mode: "cartons", stack: 1, rows: 1, depth: 1, pcsPerCarton: "" }), ["pcsPerCarton"]);
  assert.deepEqual(invalidFields({ mode: "cartons", stack: 1, rows: 1, depth: 1, pcsPerCarton: 0 }), ["pcsPerCarton"]);
});

test("pieces mode must not carry a carton size", () => {
  assert.deepEqual(invalidFields({ mode: "pieces", stack: 1, rows: 1, depth: 1, pcsPerCarton: 12 }), ["pcsPerCarton"]);
});

test("non-negative whole numbers only, every bad field reported at once", () => {
  const fields = invalidFields({ mode: "pieces", stack: -1, rows: 1.5, depth: "2a", loose: "-3" });
  assert.deepEqual(fields.sort(), ["depth", "loose", "rows", "stack"]);
});

test("unknown mode is refused", () => {
  assert.deepEqual(invalidFields({ mode: "boxes", stack: 1, rows: 1, depth: 1 }), ["mode"]);
});

test("big numbers: exact up to INT4_MAX, refused above it", () => {
  // 46,340 × 46,340 × 1 × 1 + 0 = 2,147,395,600 ≤ INT4_MAX — exact and accepted.
  const r = valid({ mode: "cartons", stack: 46340, rows: 46340, depth: 1, pcsPerCarton: 1 });
  assert.equal(r.totalPcs, 2_147_395_600);
  assert.equal(BigInt(r.totalPcs), checkFormula(r.working));

  // Exactly INT4_MAX through loose alone.
  assert.equal(valid({ mode: "pieces", loose: INT4_MAX }).totalPcs, INT4_MAX);

  // Product within int4 but product + loose over it → refused (int4 overflow on INSERT).
  assert.deepEqual(invalidFields({ mode: "pieces", stack: 46340, rows: 46340, depth: 1, loose: 100000 }), ["total"]);

  // Every factor fits, the product does not — refused before any inexact maths.
  assert.deepEqual(
    invalidFields({ mode: "cartons", stack: 100000, rows: 100000, depth: 100000, pcsPerCarton: 100000 }),
    ["total"],
  );

  // A single field above int4.
  assert.deepEqual(invalidFields({ mode: "pieces", loose: INT4_MAX + 1 }), ["loose"]);
  assert.deepEqual(invalidFields({ mode: "pieces", stack: "99999999999" }), ["stack"]);
});
