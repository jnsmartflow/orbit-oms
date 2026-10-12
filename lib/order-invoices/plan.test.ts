// lib/order-invoices/plan.test.ts — npx tsx --test lib/order-invoices/plan.test.ts
//
// Add invoices save / undo IN PLACE (Schema v27.66): planSplitWrite,
// rowLockReasons, sameLines. Pure — no database. The fixture is the live OBD
// 9109951956 (order 18648) as it stands on 2026-10-12: seq 1 …716 (line 62853,
// 15 tins, copied for L-261006-05), …713 / …714 / …715 one line each.

import test from "node:test";
import assert from "node:assert/strict";
import { planSplitWrite, rowLockReasons, sameLines, type CurrentRow, type RowState, type TargetRow } from "./plan";

const FREE: RowState = { tripNumber: null, isHeld: false, isDispatched: false, copyTrips: [], redeliveryTrips: [], ciNumbers: [] };
const DAY = new Date("2026-10-05T00:00:00.000Z");

function row(id: number, seq: number, invoiceNo: string, lines: [number, number][], state: Partial<RowState> = {}): CurrentRow {
  return {
    ...FREE,
    ...state,
    id,
    seq,
    invoiceNo,
    invoiceDate: DAY,
    source: seq === 1 ? "sap" : "manual",
    lines: lines.map(([rawLineItemId, qty]) => ({ rawLineItemId, qty })),
  };
}

/** Order 18648 today: copy 276 on seq 1, nothing else. */
function live18648(): CurrentRow[] {
  return [
    row(17010, 1, "I536230716", [[62853, 15]], { copyTrips: ["L-261006-05"] }),
    row(36798, 2, "I536230713", [[62850, 13]]),
    row(36799, 3, "I536230714", [[62851, 12]]),
    row(36800, 4, "I536230715", [[62852, 10]]),
  ];
}

function targetOf(rows: CurrentRow[]): TargetRow[] {
  return rows.map((r) => ({ invoiceNo: r.invoiceNo ?? "", invoiceDate: r.seq === 1 ? null : r.invoiceDate, lines: r.lines.map((l) => ({ ...l })) }));
}

// ── rowLockReasons ───────────────────────────────────────────────────────────

test("lock: a free row has no reasons", () => {
  assert.deepEqual(rowLockReasons(FREE), []);
});

test("lock: every kind of state is a reason, in plain English", () => {
  const r = rowLockReasons({
    tripNumber: "L-261007-20",
    isHeld: true,
    isDispatched: true,
    copyTrips: ["L-261006-05"],
    redeliveryTrips: ["L-261007-20"],
    ciNumbers: ["CI-0012", null],
  });
  assert.deepEqual(r, [
    "it has been dispatched",
    "it is on trip L-261007-20",
    "it is on hold",
    "billing copied it for trip L-261006-05",
    "it is re-delivered on trip L-261007-20",
    "it has CI CI-0012",
    "a draft CI is open on it",
  ]);
});

// ── sameLines ────────────────────────────────────────────────────────────────

test("sameLines: order does not matter; tins do", () => {
  const a = [{ rawLineItemId: 1, qty: 2 }, { rawLineItemId: 3, qty: 4 }];
  assert.equal(sameLines(a, [...a].reverse()), true);
  assert.equal(sameLines(a, [{ rawLineItemId: 1, qty: 2 }, { rawLineItemId: 3, qty: 5 }]), false);
  assert.equal(sameLines(a, a.slice(0, 1)), false);
});

// ── planSplitWrite: in place ─────────────────────────────────────────────────

test("same split again: nothing to write", () => {
  const cur = live18648();
  const r = planSplitWrite(cur, targetOf(cur));
  assert.ok(r.ok);
  assert.equal(r.changed, false);
});

test("rows keep their ids: re-lining two free rows updates no row and deletes none", () => {
  const cur = live18648();
  const t = targetOf(cur);
  // Move 2 tins of line 62851 from …714 to …715.
  t[2].lines = [{ rawLineItemId: 62851, qty: 10 }];
  t[3].lines = [{ rawLineItemId: 62852, qty: 10 }, { rawLineItemId: 62851, qty: 2 }];
  const r = planSplitWrite(cur, t);
  assert.ok(r.ok);
  assert.deepEqual(r.plan, { deleteRowIds: [], updates: [], creates: [], relineSeqs: [3, 4] });
});

test("a free row can be re-numbered: one update, same id", () => {
  const cur = live18648();
  const t = targetOf(cur);
  t[3].invoiceNo = "I536230719";
  const r = planSplitWrite(cur, t);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.updates, [{ id: 36800, seq: 4, invoiceNo: "I536230719", invoiceDate: DAY }]);
  assert.deepEqual(r.plan.relineSeqs, []);
});

test("fewer invoices: only the rows past the new count are deleted", () => {
  const cur = live18648();
  const t = targetOf(cur).slice(0, 3);
  t[2].lines = [{ rawLineItemId: 62851, qty: 12 }, { rawLineItemId: 62852, qty: 10 }];
  const r = planSplitWrite(cur, t);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.deleteRowIds, [36800]);
  assert.deepEqual(r.plan.relineSeqs, [3]);
});

test("more invoices: new rows are created at the next seq and lined", () => {
  const cur = live18648();
  const t = targetOf(cur);
  t[3].lines = [{ rawLineItemId: 62852, qty: 6 }];
  t.push({ invoiceNo: "I536230717", invoiceDate: DAY, lines: [{ rawLineItemId: 62852, qty: 4 }] });
  const r = planSplitWrite(cur, t);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.creates, [{ seq: 5, invoiceNo: "I536230717", invoiceDate: DAY }]);
  assert.deepEqual(r.plan.relineSeqs, [4, 5]);
});

test("a locked row may still have its date corrected", () => {
  const cur = live18648();
  cur[1] = { ...cur[1], tripNumber: "L-261007-20" };
  const t = targetOf(cur);
  const newDay = new Date("2026-10-06T00:00:00.000Z");
  t[1].invoiceDate = newDay;
  const r = planSplitWrite(cur, t);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.updates, [{ id: 36798, seq: 2, invoiceNo: "I536230713", invoiceDate: newDay }]);
});

test("seq 1's number and date are never written", () => {
  const cur = live18648();
  const t = targetOf(cur);
  t[0].invoiceDate = new Date("2026-01-01T00:00:00.000Z");
  const r = planSplitWrite(cur, t);
  assert.ok(r.ok);
  assert.equal(r.changed, false);
});

// ── planSplitWrite: refusals ─────────────────────────────────────────────────

test("refuse: changing a copied seq 1's items names the invoice and the trip", () => {
  const cur = live18648();
  const t = targetOf(cur);
  t[0].lines = [{ rawLineItemId: 62853, qty: 14 }];
  t[1].lines = [{ rawLineItemId: 62850, qty: 13 }, { rawLineItemId: 62853, qty: 1 }];
  const r = planSplitWrite(cur, t);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.refusals, [
    "I536230716 cannot be given different items — billing copied it for trip L-261006-05.",
  ]);
});

test("refuse: deleting a row on a re-delivery", () => {
  const cur = live18648();
  cur[3] = { ...cur[3], redeliveryTrips: ["L-261007-20"] };
  const t = targetOf(cur).slice(0, 3);
  t[2].lines = [{ rawLineItemId: 62851, qty: 12 }, { rawLineItemId: 62852, qty: 10 }];
  const r = planSplitWrite(cur, t);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.refusals, ["I536230715 cannot be removed — it is re-delivered on trip L-261007-20."]);
});

test("refuse: re-numbering a held row", () => {
  const cur = live18648();
  cur[2] = { ...cur[2], isHeld: true };
  const t = targetOf(cur);
  t[2].invoiceNo = "I536230718";
  const r = planSplitWrite(cur, t);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.refusals, ["I536230714 cannot be changed to I536230718 — it is on hold."]);
});

test("refuse: every locked row is reported, not just the first", () => {
  const cur = live18648();
  cur[1] = { ...cur[1], tripNumber: "L-261007-20" };
  cur[3] = { ...cur[3], isDispatched: true, ciNumbers: ["CI-0099"] };
  const t = targetOf(cur).slice(0, 2);
  t[1].lines = [{ rawLineItemId: 62850, qty: 13 }, { rawLineItemId: 62851, qty: 12 }, { rawLineItemId: 62852, qty: 10 }];
  const r = planSplitWrite(cur, t);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.refusals, [
    "I536230713 cannot be given different items — it is on trip L-261007-20.",
    "I536230715 cannot be removed — it has been dispatched, it has CI CI-0099.",
  ]);
});

test("a locked row that is left alone does not block an edit elsewhere", () => {
  const cur = live18648();
  cur[1] = { ...cur[1], tripNumber: "L-261007-20", redeliveryTrips: ["L-261007-20"] };
  const t = targetOf(cur);
  t[2].lines = [{ rawLineItemId: 62851, qty: 10 }];
  t[3].lines = [{ rawLineItemId: 62852, qty: 10 }, { rawLineItemId: 62851, qty: 2 }];
  const r = planSplitWrite(cur, t);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.relineSeqs, [3, 4]);
});

test("refuse: FIRST split of an unsplit OBD on a trip — seq 1 goes from all lines to some", () => {
  const cur = [row(500, 1, "I536230001", [], { tripNumber: "L-261012-01" })];
  const t: TargetRow[] = [
    { invoiceNo: "I536230001", invoiceDate: null, lines: [{ rawLineItemId: 1, qty: 5 }] },
    { invoiceNo: "I536230002", invoiceDate: DAY, lines: [{ rawLineItemId: 2, qty: 5 }] },
  ];
  const r = planSplitWrite(cur, t);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.refusals, ["I536230001 cannot be given different items — it is on trip L-261012-01."]);
});

test("first split of a free unsplit OBD: seq 1 re-lined, one row created", () => {
  const cur = [row(500, 1, "I536230001", [])];
  const t: TargetRow[] = [
    { invoiceNo: "I536230001", invoiceDate: null, lines: [{ rawLineItemId: 1, qty: 5 }] },
    { invoiceNo: "I536230002", invoiceDate: DAY, lines: [{ rawLineItemId: 2, qty: 5 }] },
  ];
  const r = planSplitWrite(cur, t);
  assert.ok(r.ok);
  assert.deepEqual(r.plan, { deleteRowIds: [], updates: [], creates: [{ seq: 2, invoiceNo: "I536230002", invoiceDate: DAY }], relineSeqs: [1, 2] });
});

// ── Undo (target: seq 1 only, no lines) ──────────────────────────────────────

const UNDO: TargetRow[] = [{ invoiceNo: "I536230716", invoiceDate: null, lines: [] }];

test("undo: refused on 18648 today — seq 1 is copied, and undo changes its items", () => {
  const r = planSplitWrite(live18648(), UNDO);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.refusals, ["I536230716 cannot be given different items — billing copied it for trip L-261006-05."]);
});

test("undo: a free split deletes the manual rows and clears seq 1's lines", () => {
  const cur = live18648();
  cur[0] = { ...cur[0], copyTrips: [] };
  const r = planSplitWrite(cur, UNDO);
  assert.ok(r.ok);
  assert.deepEqual(r.plan, { deleteRowIds: [36798, 36799, 36800], updates: [], creates: [], relineSeqs: [1] });
});

test("undo: refused when a manual row is locked", () => {
  const cur = live18648();
  cur[0] = { ...cur[0], copyTrips: [] };
  cur[1] = { ...cur[1], redeliveryTrips: ["L-261007-20"] };
  const r = planSplitWrite(cur, UNDO);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.refusals, ["I536230713 cannot be removed — it is re-delivered on trip L-261007-20."]);
});

test("undo: an unsplit OBD has nothing to undo", () => {
  const r = planSplitWrite([row(17010, 1, "I536230716", [], { copyTrips: ["L-261006-05"] })], UNDO);
  assert.ok(r.ok);
  assert.equal(r.changed, false);
});

test("re-run after a half-failure: rows created but not lined → the plan re-lines only those", () => {
  // A dead save left …717 created at seq 5 with no lines; seq 4 already re-lined.
  const cur = live18648();
  cur[3] = { ...cur[3], lines: [{ rawLineItemId: 62852, qty: 6 }] };
  cur.push(row(36801, 5, "I536230717", []));
  const t = targetOf(cur);
  t[4].lines = [{ rawLineItemId: 62852, qty: 4 }];
  const r = planSplitWrite(cur, t);
  assert.ok(r.ok);
  assert.deepEqual(r.plan, { deleteRowIds: [], updates: [], creates: [], relineSeqs: [5] });
});
