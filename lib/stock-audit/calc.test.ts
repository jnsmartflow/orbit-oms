// lib/stock-audit/calc.test.ts — npx tsx --test lib/stock-audit/calc.test.ts
//
// The stock-count calculator against chk_stock_audit_lines_total /
// _carton / _nonneg (Schema v27.78): pieces, cartons, loose only, zero refused,
// missing carton refused, big numbers — and the 2026-11-02 rules: screen order
// Stack × Depth × Rows (× Pcs/carton) + Loose, blank factor = 1, all three
// blank = 0/0/0, typed 0 stays 0, and the clientTotal check. Pure — no
// database, no React.

import test from "node:test";
import assert from "node:assert/strict";
import {
  INT4_MAX,
  clientTotalMatches,
  computeTotal,
  formatWorking,
  previewLine,
  resolveFactors,
  validateLineInput,
  type CountWorking,
} from "./calc";

/** The CHECK's own formula, in BigInt, to compare against. */
function checkFormula(w: CountWorking): bigint {
  return (
    BigInt(w.stack) * BigInt(w.rows) * BigInt(w.depth) * BigInt(w.pcsPerCarton ?? 1) + BigInt(w.loose)
  );
}

type Input = Parameters<typeof validateLineInput>[0];

function valid(input: Input) {
  const r = validateLineInput(input);
  if (!r.ok) assert.fail(`expected ok, got ${JSON.stringify(r.errors)}`);
  // Every accepted line must satisfy chk_stock_audit_lines_total exactly.
  assert.ok(r.totalPcs > 0);
  assert.equal(BigInt(r.totalPcs), checkFormula(r.working));
  assert.equal(computeTotal(r.working), r.totalPcs);
  return r;
}

function invalidFields(input: Input): string[] {
  const r = validateLineInput(input);
  assert.equal(r.ok, false, "expected a refusal");
  return r.ok ? [] : r.errors.map((e) => e.field);
}

/** [stack, depth, rows] as saved. */
function saved(r: { working: CountWorking }): number[] {
  return [r.working.stack, r.working.depth, r.working.rows];
}

// ── Order + the full case ─────────────────────────────────────────────────────

test("pieces: Stack 4, Depth 2, Rows 10, Loose 5 → 85, working in screen order", () => {
  const r = valid({ mode: "pieces", stack: 4, depth: 2, rows: 10, loose: 5 });
  assert.equal(r.totalPcs, 85);
  assert.equal(r.working.pcsPerCarton, null);
  assert.deepEqual(saved(r), [4, 2, 10]);
  assert.equal(formatWorking(r.working), "4 × 2 × 10 + 5");
});

test("cartons: same with Pcs/carton 12 → 965, carton factor shown", () => {
  const r = valid({ mode: "cartons", stack: 4, depth: 2, rows: 10, pcsPerCarton: 12, loose: 5 });
  assert.equal(r.totalPcs, 965);
  assert.equal(formatWorking(r.working), "4 × 2 × 10 × 12 + 5");
});

test("loose is shown only when > 0", () => {
  const r = valid({ mode: "cartons", stack: 4, depth: 2, rows: 10, pcsPerCarton: 12, loose: 0 });
  assert.equal(r.totalPcs, 960);
  assert.equal(formatWorking(r.working), "4 × 2 × 10 × 12");
});

test("phone strings are accepted (inputmode=numeric fields)", () => {
  const r = valid({ mode: "cartons", stack: "3", depth: "1", rows: " 2 ", pcsPerCarton: "6", loose: "" });
  assert.equal(r.totalPcs, 36);
});

// ── Blank factors ────────────────────────────────────────────────────────────

test("1. one factor typed: Stack 4, Depth + Rows blank → saved 4/1/1, total 4", () => {
  const r = valid({ mode: "pieces", stack: "4", depth: "", rows: "", loose: "" });
  assert.deepEqual(saved(r), [4, 1, 1]);
  assert.equal(r.totalPcs, 4);
  assert.equal(formatWorking(r.working), "4 × 1 × 1");
});

test("2. two factors typed: Stack 4, Depth blank, Rows 10 → saved 4/1/10, total 40", () => {
  const r = valid({ mode: "pieces", stack: "4", depth: "", rows: "10" });
  assert.deepEqual(saved(r), [4, 1, 10]);
  assert.equal(r.totalPcs, 40);
  assert.equal(formatWorking(r.working), "4 × 1 × 10");
});

test("3. all three blank, Loose 7 → saved 0/0/0 + 7, working '7'", () => {
  const r = valid({ mode: "pieces", stack: "", depth: "", rows: "", loose: "7" });
  assert.deepEqual(saved(r), [0, 0, 0]);
  assert.equal(r.working.loose, 7);
  assert.equal(r.totalPcs, 7);
  assert.equal(formatWorking(r.working), "7");
});

test("4. all three blank and Loose blank → refused, total must be more than 0", () => {
  assert.deepEqual(invalidFields({ mode: "pieces", stack: "", depth: "", rows: "", loose: "" }), ["total"]);
  assert.deepEqual(invalidFields({ mode: "pieces" }), ["total"]);
  const r = validateLineInput({ mode: "pieces" });
  assert.equal(r.ok ? "" : r.errors[0].message, "Total must be more than 0");
});

test("5. typed 0 stays 0: Stack 0, Depth blank, Rows 5, Loose 3 → saved 0/1/5, total 3, working '3'", () => {
  const r = valid({ mode: "pieces", stack: "0", depth: "", rows: "5", loose: "3" });
  assert.deepEqual(saved(r), [0, 1, 5]);
  assert.equal(r.totalPcs, 3);
  assert.equal(formatWorking(r.working), "3");
});

test("6. a typed 0 and nothing else → refused (total 0)", () => {
  assert.deepEqual(invalidFields({ mode: "pieces", stack: "0" }), ["total"]);
  assert.deepEqual(invalidFields({ mode: "pieces", stack: 0, depth: 2, rows: 10, loose: 0 }), ["total"]);
});

test("7. cartons, Stack 1 only, Pcs/carton 12 → 1 × 1 × 1 × 12, total 12", () => {
  const r = valid({ mode: "cartons", stack: "1", depth: "", rows: "", pcsPerCarton: "12" });
  assert.deepEqual(saved(r), [1, 1, 1]);
  assert.equal(r.working.pcsPerCarton, 12);
  assert.equal(r.totalPcs, 12);
  assert.equal(formatWorking(r.working), "1 × 1 × 1 × 12");
});

test("8. cartons with Pcs/carton blank, missing or 0 is still refused — never becomes 1", () => {
  assert.deepEqual(invalidFields({ mode: "cartons", stack: 4 }), ["pcsPerCarton"]);
  assert.deepEqual(invalidFields({ mode: "cartons", stack: 4, depth: 1, rows: 1, pcsPerCarton: "" }), ["pcsPerCarton"]);
  assert.deepEqual(invalidFields({ mode: "cartons", stack: 4, depth: 1, rows: 1, pcsPerCarton: 0 }), ["pcsPerCarton"]);
  // Loose-only in cartons mode still needs it (the carton CHECK).
  assert.deepEqual(invalidFields({ mode: "cartons", loose: 7 }), ["pcsPerCarton"]);
});

test("9. typed 1 and blank 1 give identical saved numbers and working", () => {
  const typed = valid({ mode: "cartons", stack: "4", depth: "1", rows: "1", pcsPerCarton: "12", loose: "2" });
  const blank = valid({ mode: "cartons", stack: "4", depth: "", rows: "", pcsPerCarton: "12", loose: "2" });
  assert.deepEqual(blank.working, typed.working);
  assert.equal(blank.totalPcs, typed.totalPcs);
  assert.equal(formatWorking(blank.working), formatWorking(typed.working));
});

test("10. every accepted case above matches the database CHECK exactly", () => {
  const cases: Input[] = [
    { mode: "pieces", stack: 4, depth: 2, rows: 10, loose: 5 },
    { mode: "cartons", stack: 4, depth: 2, rows: 10, pcsPerCarton: 12, loose: 5 },
    { mode: "pieces", stack: "4" },
    { mode: "pieces", stack: "4", rows: "10" },
    { mode: "pieces", loose: "7" },
    { mode: "pieces", stack: "0", rows: "5", loose: "3" },
    { mode: "cartons", stack: "1", pcsPerCarton: "12" },
    { mode: "cartons", depth: "3", pcsPerCarton: "6", loose: "1" },
    { mode: "pieces", rows: "9" },
  ];
  for (const c of cases) {
    const r = valid(c); // valid() asserts BigInt(total) === the CHECK formula
    assert.equal(formatWorking(r.working).length > 0, true);
  }
});

test("11. size limits still hold after blanks become 1", () => {
  // A huge Stack with Depth + Rows blank: INT4_MAX × 1 × 1 = INT4_MAX → accepted.
  assert.equal(valid({ mode: "pieces", stack: String(INT4_MAX) }).totalPcs, INT4_MAX);
  // … plus 1 loose → over int4 → refused.
  assert.deepEqual(invalidFields({ mode: "pieces", stack: String(INT4_MAX), loose: "1" }), ["total"]);
  // Stack × blank-1s × a carton size that overflows → refused.
  assert.deepEqual(invalidFields({ mode: "cartons", stack: "100000", pcsPerCarton: "100000" }), ["total"]);
  // A single field above int4 is a field error, blank neighbours or not.
  assert.deepEqual(invalidFields({ mode: "pieces", stack: "99999999999" }), ["stack"]);
});

test("resolveFactors: the rule on its own", () => {
  assert.deepEqual(resolveFactors({ stack: null, depth: null, rows: null }), { stack: 0, depth: 0, rows: 0 });
  assert.deepEqual(resolveFactors({ stack: 3, depth: null, rows: null }), { stack: 3, depth: 1, rows: 1 });
  assert.deepEqual(resolveFactors({ stack: null, depth: 0, rows: null }), { stack: 1, depth: 0, rows: 1 });
  assert.deepEqual(resolveFactors({ stack: 2, depth: 3, rows: 4 }), { stack: 2, depth: 3, rows: 4 });
});

// ── Unchanged guards ─────────────────────────────────────────────────────────

test("pieces mode must not carry a carton size", () => {
  assert.deepEqual(invalidFields({ mode: "pieces", stack: 1, depth: 1, rows: 1, pcsPerCarton: 12 }), ["pcsPerCarton"]);
});

test("non-negative whole numbers only, every bad field reported at once", () => {
  const fields = invalidFields({ mode: "pieces", stack: -1, depth: "2a", rows: 1.5, loose: "-3" });
  assert.deepEqual(fields.sort(), ["depth", "loose", "rows", "stack"]);
});

test("unknown mode is refused", () => {
  assert.deepEqual(invalidFields({ mode: "boxes", stack: 1, depth: 1, rows: 1 }), ["mode"]);
});

test("big numbers: exact up to INT4_MAX, refused above it", () => {
  // 46,340 × 1 × 46,340 × 1 + 0 = 2,147,395,600 ≤ INT4_MAX — exact and accepted.
  const r = valid({ mode: "cartons", stack: 46340, depth: 1, rows: 46340, pcsPerCarton: 1 });
  assert.equal(r.totalPcs, 2_147_395_600);
  // Exactly INT4_MAX through loose alone.
  assert.equal(valid({ mode: "pieces", loose: INT4_MAX }).totalPcs, INT4_MAX);
  // Product within int4 but product + loose over it → refused.
  assert.deepEqual(invalidFields({ mode: "pieces", stack: 46340, depth: 1, rows: 46340, loose: 100000 }), ["total"]);
  // Every factor fits, the product does not — refused before any inexact maths.
  assert.deepEqual(
    invalidFields({ mode: "cartons", stack: 100000, depth: 100000, rows: 100000, pcsPerCarton: 100000 }),
    ["total"],
  );
  assert.deepEqual(invalidFields({ mode: "pieces", loose: INT4_MAX + 1 }), ["loose"]);
});

// ── Live preview (the phone) ─────────────────────────────────────────────────

test("previewLine: no total until a box has a value; then the same rule as save", () => {
  assert.equal(previewLine({ mode: "pieces" }).total, null);
  assert.equal(previewLine({ mode: "pieces", stack: "4" }).total, 4);
  assert.equal(previewLine({ mode: "pieces", stack: "4" }).working, "4 × 1 × 1");
  assert.equal(previewLine({ mode: "pieces", loose: "7" }).total, 7);
  assert.equal(previewLine({ mode: "pieces", stack: "0" }).total, 0);
  // Cartons: no total until pcs/carton > 0 — it never defaults to 1.
  assert.equal(previewLine({ mode: "cartons", stack: "4" }).total, null);
  assert.equal(previewLine({ mode: "cartons", stack: "4", pcsPerCarton: "12" }).total, 48);
  // Agrees with validateLineInput whenever that accepts.
  const input: Input = { mode: "cartons", stack: "4", rows: "10", pcsPerCarton: "12", loose: "5" };
  const v = valid(input);
  assert.equal(previewLine(input).total, v.totalPcs);
  assert.equal(previewLine(input).working, formatWorking(v.working));
});

// ── clientTotal (TOTAL_MISMATCH) ─────────────────────────────────────────────

test("clientTotalMatches: equal passes; different, missing or non-number refuses", () => {
  assert.equal(clientTotalMatches(85, 85), true);
  assert.equal(clientTotalMatches(84, 85), false);
  assert.equal(clientTotalMatches(undefined, 85), false); // an older phone sends none
  assert.equal(clientTotalMatches("85", 85), false);
  assert.equal(clientTotalMatches(85.5, 85), false);
  // The old blank-as-0 phone showed 5 for "Stack 4, Depth blank, Rows 10,
  // Loose 5"; the server now saves 45 — refused, never silently changed.
  const r = valid({ mode: "pieces", stack: "4", depth: "", rows: "10", loose: "5" });
  assert.equal(r.totalPcs, 45);
  assert.equal(clientTotalMatches(5, r.totalPcs), false);
});
