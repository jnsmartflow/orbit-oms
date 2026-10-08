// lib/floor/sort.test.ts — npx tsx --test lib/floor/sort.test.ts
//
// keepPairsAdjacent / sortFloorRows (2026-10-08): OBDs sharing an invoice sit
// together after the spine sort, at their best-ranked member's place. Pure — no
// database, no React.

import test from "node:test";
import assert from "node:assert/strict";
import { keepPairsAdjacent, sortFloorRows } from "./sort";
import type { FloorBoardRow } from "./types";

// Only the fields the spine and the pair pass read; the rest is opaque.
function b(orderId: number, invoiceNo: string | null, over: Partial<FloorBoardRow> = {}): FloorBoardRow {
  return {
    orderId,
    obdNumber: `OBD${String(orderId).padStart(4, "0")}`,
    invoiceNo,
    windowSortOrder: 1,
    deliveryType: "Local",
    isKeyCustomer: false,
    priorityLevel: 3,
    obdDateTime: `2026-10-08T0${orderId % 10}:00:00.000Z`,
    isAssigned: false,
    ...over,
  } as unknown as FloorBoardRow;
}
const ids = (rows: { orderId: number }[]) => rows.map((r) => r.orderId);

test("a pair already adjacent is unchanged (same array back when nothing groups)", () => {
  const rows = [b(1, null), b(2, "I1"), b(3, "I1"), b(4, null)];
  assert.deepEqual(ids(keepPairsAdjacent(rows)), [1, 2, 3, 4]);
  const solo = [b(1, null), b(2, "I1"), b(3, "I2")];
  assert.equal(keepPairsAdjacent(solo), solo);
});

test("a pair split by priority: both move to the urgent one's position", () => {
  // 5 is urgent (priority 1) and sorts first; its partner 8 (priority 3,
  // the earliest-arriving non-urgent) would otherwise sit at the bottom.
  const rows = [
    b(2, null),
    b(5, "I1", { priorityLevel: 1 }),
    b(3, null),
    b(8, "I1"),
    b(4, null),
  ];
  assert.deepEqual(ids(sortFloorRows(rows)), [5, 8, 2, 3, 4]);
});

test("a pair split by arrival time: the later one is pulled up under the first", () => {
  const rows = [b(1, "I1"), b(2, null), b(3, null), b(4, "I1"), b(5, null)];
  assert.deepEqual(ids(sortFloorRows(rows)), [1, 4, 2, 3, 5]);
});

test("a 3-OBD invoice: all three together, in their own spine order", () => {
  const rows = [b(1, "I3"), b(2, null), b(3, "I3"), b(4, null), b(5, "I3"), b(6, null)];
  assert.deepEqual(ids(sortFloorRows(rows)), [1, 3, 5, 2, 4, 6]);
});

test("a partner not in this list: the row stays where it is", () => {
  // Same invoice as a bill on another list (upcoming half, another stop…).
  const rows = [b(1, null), b(2, "I1"), b(3, null)];
  assert.deepEqual(ids(keepPairsAdjacent(rows)), [1, 2, 3]);
});

test("rows without an invoice and re-delivery rows are untouched and keep their order", () => {
  const rd = { redelivery: { id: 9, attemptNo: 2 } } as Partial<FloorBoardRow>;
  // 4 is a re-delivery row of a bill on invoice I1 — never grouped.
  const rows = [b(1, "I1"), b(2, null), b(3, null), b(4, "I1", rd), b(5, null), b(6, "I1")];
  assert.deepEqual(ids(keepPairsAdjacent(rows)), [1, 6, 2, 3, 4, 5]);
});

test("the result holds exactly the input rows — nothing lost, nothing duplicated", () => {
  const rows = [
    b(1, "I1"), b(2, "I2"), b(3, null), b(4, "I1"), b(5, "I2"), b(6, "I3"),
    b(7, null), b(8, "I3"), b(9, "I1"), b(10, null),
  ];
  const out = sortFloorRows(rows);
  assert.equal(out.length, rows.length);
  assert.equal(new Set(out).size, rows.length);
  for (const r of rows) assert.ok(out.includes(r));
  // and every invoice group is contiguous
  for (const inv of ["I1", "I2", "I3"]) {
    const at = out.map((r, i) => (r.invoiceNo === inv ? i : -1)).filter((i) => i >= 0);
    assert.equal(at[at.length - 1] - at[0], at.length - 1, `${inv} contiguous`);
  }
});
