// lib/picking/live-merge.test.ts — npx tsx --test lib/picking/live-merge.test.ts (npm run test:picking-live)

import test from "node:test";
import assert from "node:assert/strict";
import { applyPickingSync, patchRowFor, pruneSelection, sameRow } from "./live-merge";
import type { PickingQueueResult } from "./queue";
import type { PickingSyncResult } from "./sync";
import type { PickingQueueRow } from "./types";

// Only the fields the merge and PICKING_SPINE read; the rest is opaque.
function r(orderId: number, over: Partial<PickingQueueRow> = {}): PickingQueueRow {
  return {
    orderId,
    obdNumber: `OBD${String(orderId).padStart(4, "0")}`,
    isAssigned: false,
    isDone: false,
    isChecked: false,
    windowSortOrder: 1,
    deliveryType: "Local",
    isKeyCustomer: false,
    priorityLevel: 3,
    obdDateTime: `2026-09-30T0${orderId % 10}:00:00.000Z`,
    ...over,
  } as unknown as PickingQueueRow;
}
function board(rows: PickingQueueRow[], over: Partial<PickingQueueResult> = {}): PickingQueueResult {
  return {
    date: "2026-09-30",
    rows,
    pickDeleted: [],
    waitingSkus: rows.map((x) => ({ orderId: x.orderId, skus: [`S${x.orderId}`] })),
    oilSkus: [],
    heldBack: 1,
    heldBackTrucks: 1,
    heldBackUnplanned: 5,
    ...over,
  } as PickingQueueResult;
}
function sync(over: Partial<PickingSyncResult>): PickingSyncResult {
  return { date: "2026-09-30", patches: [], waitingSkus: [], oilSkus: [], tintTouched: false, ...over };
}
const ids = (rows: PickingQueueRow[]) => rows.map((x) => x.orderId);

test("replace, insert, remove by orderId; re-sorted by the queue's spine (assigned sink last)", () => {
  const data = board([r(1), r(2), r(3)]);
  const res = sync({
    patches: [
      { id: 1, row: r(1, { isAssigned: true }) }, // now assigned → sinks below every waiting row
      { id: 3, row: null }, // left the board
      { id: 4, row: r(4) }, // new waiting bill
    ],
    waitingSkus: [{ orderId: 4, skus: ["S4"] }],
  });
  const out = applyPickingSync(data, res);
  assert.equal(out.dateMismatch, false);
  assert.deepEqual(ids(out.data.rows), [2, 4, 1]);
  assert.deepEqual(out.leftIds, [3]);
  assert.deepEqual(ids(data.rows), [1, 2, 3]); // input untouched
});

test("siblings: patched ids replaced, removed rows dropped, emitted in the new row order", () => {
  const data = board([r(1), r(2), r(3)]);
  const out = applyPickingSync(
    data,
    sync({
      patches: [
        { id: 2, row: r(2, { isAssigned: true }) }, // no longer waiting → no sibling in the answer
        { id: 3, row: null },
      ],
      waitingSkus: [],
    }),
  );
  assert.deepEqual(out.data.waitingSkus, [{ orderId: 1, skus: ["S1"] }]);
});

test("held-back triple replaced only when returned; pickDeleted replaced only when present", () => {
  const data = board([r(1)], { pickDeleted: [{ decisionId: 1 } as never] });
  const same = applyPickingSync(data, sync({ patches: [{ id: 1, row: r(1) }] }));
  assert.equal(same.data.heldBack, 1);
  assert.equal(same.data.heldBackUnplanned, 5);
  assert.equal(same.data.pickDeleted.length, 1);
  const moved = applyPickingSync(
    data,
    sync({ patches: [], heldBack: 0, heldBackTrucks: 0, heldBackUnplanned: 7, pickDeleted: [] }),
  );
  assert.equal(moved.data.heldBack, 0);
  assert.equal(moved.data.heldBackTrucks, 0);
  assert.equal(moved.data.heldBackUnplanned, 7);
  assert.deepEqual(moved.data.pickDeleted, []);
});

test("an answer for another IST day is not merged (full reload instead)", () => {
  const data = board([r(1)]);
  const out = applyPickingSync(data, sync({ date: "2026-10-01", patches: [{ id: 1, row: null }] }));
  assert.equal(out.dateMismatch, true);
  assert.equal(out.data, data);
});

test("a null patch for an id that was never on the board is not reported as left", () => {
  const out = applyPickingSync(board([r(1)]), sync({ patches: [{ id: 9, row: null }] }));
  assert.deepEqual(out.leftIds, []);
  assert.deepEqual(ids(out.data.rows), [1]);
});

test("pruneSelection drops ticks on bills no longer waiting; same set when nothing changes", () => {
  const rows = [r(1), r(2, { isAssigned: true }), r(3)];
  const sel = new Set([1, 2, 9]);
  assert.deepEqual(Array.from(pruneSelection(sel, rows)).sort(), [1]);
  const keep = new Set([1, 3]);
  assert.equal(pruneSelection(keep, rows), keep);
  const empty = new Set<number>();
  assert.equal(pruneSelection(empty, rows), empty);
});

test("patchRowFor / sameRow", () => {
  const res = sync({ patches: [{ id: 1, row: r(1) }, { id: 2, row: null }] });
  assert.deepEqual(patchRowFor(res, 1), r(1));
  assert.equal(patchRowFor(res, 2), null);
  assert.equal(patchRowFor(res, 3), undefined);
  assert.equal(sameRow(r(1), { ...r(1) }), true);
  assert.equal(sameRow(r(1), r(1, { isAssigned: true })), false);
  assert.equal(sameRow(null, undefined), true);
});
