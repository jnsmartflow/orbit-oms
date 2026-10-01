// lib/billing/pick-delete-rule.test.ts — npx tsx --test lib/billing/pick-delete-rule.test.ts (npm run test:pick-delete)

import test from "node:test";
import assert from "node:assert/strict";
import { JS_TRIM_CHARS, PROJECT_SMU_NAMES, compareGroups, markerFromRows, ownerOfSmus, type OpenGroupRow } from "./pick-delete-rule";

test("JS_TRIM_CHARS is exactly the set of UTF-16 code units trim() removes", () => {
  const expected: number[] = [];
  for (let c = 0; c <= 0xffff; c++) {
    if (String.fromCharCode(c).trim() === "") expected.push(c);
  }
  const actual = Array.from(new Set(Array.from(JS_TRIM_CHARS).map((ch) => ch.charCodeAt(0)))).sort((a, b) => a - b);
  assert.deepEqual(actual, expected);
  assert.equal(JS_TRIM_CHARS.length, expected.length); // no duplicates
});

const row = (so: string, ids: number[], latest: string | null, actionable: boolean): OpenGroupRow => ({
  so,
  ids,
  latest: latest === null ? null : new Date(latest),
  actionable,
});

test("markerFromRows: count = actionable rows; latest = max of every row and the decisions clock", () => {
  const rows = [row("A", [1, 2], "2026-09-30T01:00:00Z", true), row("B", [3, 4], "2026-09-30T03:00:00Z", false)];
  assert.deepEqual(markerFromRows(rows, new Date("2026-09-30T02:00:00Z")), { count: 1, latest: "2026-09-30T03:00:00.000Z" });
  assert.deepEqual(markerFromRows(rows, new Date("2026-09-30T04:00:00Z")).latest, "2026-09-30T04:00:00.000Z");
});

test("markerFromRows: no groups and no decisions → { 0, null }; decisions only → their clock", () => {
  assert.deepEqual(markerFromRows([], null), { count: 0, latest: null });
  assert.deepEqual(markerFromRows([], new Date("2026-09-29T10:00:00Z")), { count: 0, latest: "2026-09-29T10:00:00.000Z" });
});

test("compareGroups: oldest first punch first, unknown last, then SO number", () => {
  const g = (soNumber: string, firstPunchAt: string | null) => ({ soNumber, firstPunchAt });
  const sorted = [g("9", null), g("5", "2026-09-30T02:00:00Z"), g("7", "2026-09-30T01:00:00Z"), g("3", "2026-09-30T02:00:00Z"), g("1", null)].sort(
    compareGroups,
  );
  assert.deepEqual(sorted.map((x) => x.soNumber), ["7", "3", "5", "1", "9"]);
});

// ── Owner (2026-10-01, Tint Manager tabs build step 4) ───────────────────────

test("PROJECT_SMU_NAMES is exactly the 74 / 77 names, derived not typed", () => {
  assert.deepEqual([...PROJECT_SMU_NAMES].sort(), ["Decorative Projects", "Retail Offtake"]);
});

test("ownerOfSmus: every twin 74/77 → tint", () => {
  assert.equal(ownerOfSmus(["Decorative Projects", "Retail Offtake"]), "tint");
  assert.equal(ownerOfSmus(["Retail Offtake", "Retail Offtake"]), "tint");
});

test("ownerOfSmus: mixed → billing", () => {
  assert.equal(ownerOfSmus(["Decorative Projects", "Deco Retail"]), "billing");
  assert.equal(ownerOfSmus(["Retail Offtake", "Distributor"]), "billing");
});

test("ownerOfSmus: any null / blank / unknown → billing", () => {
  assert.equal(ownerOfSmus(["Decorative Projects", null]), "billing");
  assert.equal(ownerOfSmus([undefined, "Retail Offtake"]), "billing");
  assert.equal(ownerOfSmus(["Decorative Projects", ""]), "billing");
  assert.equal(ownerOfSmus(["Decorative Projects", "74"]), "billing"); // a code is not a name
});

test("ownerOfSmus: empty is billing (safe side)", () => {
  assert.equal(ownerOfSmus([]), "billing");
});
