// lib/challan-orders/line-match.test.ts — npx tsx --test lib/challan-orders/line-match.test.ts
//
// Slice 7 (2026-10-08): the pure half of the line match. No database.

import test from "node:test";
import assert from "node:assert/strict";
import { computeLineMatch, type MatchSourceLine } from "./line-match";

const L = (lineId: number, skuCodeRaw: string, unitQty: number, skuDescriptionRaw: string | null = null): MatchSourceLine => ({
  lineId,
  skuCodeRaw,
  skuDescriptionRaw,
  unitQty,
});

test("same material and tins → ✅", () => {
  const m = computeLineMatch([L(10, "IN28140071", 2, "DN SATIN 4L")], [L(900001, "IN28140071", 2)], ["9999999011"]);
  assert.equal(m.ok, true);
  assert.equal(m.differing, 0);
  assert.deepEqual(m.lines, [{ material: "IN28140071", product: "DN SATIN 4L", challanTins: 2, sapTins: 2, diff: 0 }]);
});

test("one tin less on SAP → ⚠ with diff −1", () => {
  const m = computeLineMatch([L(10, "IN28140071", 2)], [L(900001, "IN28140071", 1)], ["9999999012"]);
  assert.equal(m.ok, false);
  assert.equal(m.differing, 1);
  assert.equal(m.lines[0].diff, -1);
  assert.equal(m.challanTins, 2);
  assert.equal(m.sapTins, 1);
});

test("part-billing: SAP side summed over two OBDs (20 + 16 = 36) → ✅", () => {
  const m = computeLineMatch([L(10, "A", 36)], [L(900001, "A", 20), L(900001, "A", 16)], ["1", "2"]);
  assert.equal(m.ok, true);
  assert.equal(m.sapTins, 36);
});

test("same material on two lines, even the same lineId, is summed — never de-duplicated", () => {
  const m = computeLineMatch([L(10, "A", 14)], [L(10, "A", 4), L(10, "A", 10)], ["1"]);
  assert.equal(m.ok, true);
  assert.equal(m.lines[0].sapTins, 14);
});

test("material on one side only → ⚠; equal totals do not hide different goods", () => {
  const m = computeLineMatch([L(10, "IN28080071", 4, "DN SAT FIN WHITE 4L")], [L(900001, "IN28140071", 4, "DN SATIN STAY BRIGHT WHITE 4L")], ["7567796328"]);
  assert.equal(m.ok, false);
  assert.equal(m.differing, 2);
  assert.equal(m.challanTins, m.sapTins);
  assert.deepEqual(
    m.lines.map((l) => [l.material, l.challanTins, l.sapTins, l.diff]),
    [["IN28080071", 4, 0, -4], ["IN28140071", 0, 4, 4]],
  );
  // The SAP-only material takes SAP's description.
  assert.equal(m.lines[1].product, "DN SATIN STAY BRIGHT WHITE 4L");
});

test("a 0 / 0 material is dropped and never a difference", () => {
  const m = computeLineMatch([L(10, "A", 3)], [L(900001, "A", 3), L(900003, "FREE", 0)], ["1"]);
  assert.equal(m.ok, true);
  assert.equal(m.lines.length, 1);
});

test("rows keep challan line order, then SAP-only materials", () => {
  const m = computeLineMatch([L(20, "B", 1), L(10, "A", 1)], [L(900002, "C", 1), L(900001, "A", 1), L(900003, "B", 1)], ["1"]);
  assert.deepEqual(m.lines.map((l) => l.material), ["A", "B", "C"]);
});
