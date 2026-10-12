// lib/order-invoices/plan.test.ts — npx tsx --test lib/order-invoices/plan.test.ts
//
// Add invoices save / undo IN PLACE (Schema v27.66) under the owner's "split
// inside the trip" rule (2026-10-12): planSplitWrite, obdStateRefusal,
// sameLines. Pure — no database. The fixture is the live OBD 9109951956
// (order 18648) as it stands on 2026-10-12: seq 1 …716 (line 62853, 15 tins,
// copied for L-261006-05), …713 / …714 / …715 one line each, all off a trip.

import test from "node:test";
import assert from "node:assert/strict";
import {
  obdStateRefusal,
  planSplitWrite,
  sameLines,
  type CurrentRow,
  type ObdFacts,
  type RowState,
  type TargetRow,
} from "./plan";

const FREE: RowState = {
  tripDropId: null,
  isHeld: false,
  heldAt: null,
  heldById: null,
  isDispatched: false,
  copyTrips: [],
  redeliveryTrips: [],
};
const DAY = new Date("2026-10-05T00:00:00.000Z");
const HELD_AT = new Date("2026-10-06T09:15:00.000Z");
const OBD: ObdFacts = { obdNumber: "9109951956", ciNumbers: [] };

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

/** Every row in the same state. */
function allIn(rows: CurrentRow[], state: Partial<RowState>): CurrentRow[] {
  return rows.map((r) => ({ ...r, ...state }));
}

function targetOf(rows: CurrentRow[]): TargetRow[] {
  return rows.map((r) => ({ invoiceNo: r.invoiceNo ?? "", invoiceDate: r.seq === 1 ? null : r.invoiceDate, lines: r.lines.map((l) => ({ ...l })) }));
}

/** An unsplit OBD → split into two invoices. */
const FIRST_SPLIT: TargetRow[] = [
  { invoiceNo: "I536230001", invoiceDate: null, lines: [{ rawLineItemId: 1, qty: 5 }] },
  { invoiceNo: "I536230002", invoiceDate: DAY, lines: [{ rawLineItemId: 2, qty: 5 }] },
];

const UNDO: TargetRow[] = [{ invoiceNo: "I536230716", invoiceDate: null, lines: [] }];

// ── sameLines ────────────────────────────────────────────────────────────────

test("sameLines: order does not matter; tins do", () => {
  const a = [{ rawLineItemId: 1, qty: 2 }, { rawLineItemId: 3, qty: 4 }];
  assert.equal(sameLines(a, [...a].reverse()), true);
  assert.equal(sameLines(a, [{ rawLineItemId: 1, qty: 2 }, { rawLineItemId: 3, qty: 5 }]), false);
  assert.equal(sameLines(a, a.slice(0, 1)), false);
});

// ── first split: allowed on a trip / on hold, new rows inherit ───────────────

test("first split of an unsplit OBD on a trip: allowed, the new row inherits the stop", () => {
  const cur = [row(500, 1, "I536230001", [], { tripDropId: 2478 })];
  const r = planSplitWrite(cur, FIRST_SPLIT, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.creates, [{ seq: 2, invoiceNo: "I536230002", invoiceDate: DAY }]);
  assert.deepEqual(r.plan.inherit, { tripDropId: 2478, isHeld: false, heldAt: null, heldById: null });
  assert.deepEqual(r.plan.relineSeqs, [1, 2]);
});

test("first split of a held OBD: allowed, the new row inherits the hold, heldAt / heldById copied", () => {
  const cur = [row(500, 1, "I536230001", [], { isHeld: true, heldAt: HELD_AT, heldById: 29 })];
  const r = planSplitWrite(cur, FIRST_SPLIT, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.inherit, { tripDropId: null, isHeld: true, heldAt: HELD_AT, heldById: 29 });
});

test("first split of a back-filled hold (no heldAt): the inherited stamp is null too", () => {
  const cur = [row(500, 1, "I536230001", [], { isHeld: true, tripDropId: 2478 })];
  const r = planSplitWrite(cur, FIRST_SPLIT, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.inherit, { tripDropId: 2478, isHeld: true, heldAt: null, heldById: null });
});

test("first split of a free OBD: nothing to inherit", () => {
  const r = planSplitWrite([row(500, 1, "I536230001", [])], FIRST_SPLIT, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan, {
    deleteRowIds: [],
    updates: [],
    creates: [{ seq: 2, invoiceNo: "I536230002", invoiceDate: DAY }],
    inherit: { tripDropId: null, isHeld: false, heldAt: null, heldById: null },
    relineSeqs: [1, 2],
  });
});

test("copy-only: a copied seq 1 does not block — its items may change, the copy stays on it", () => {
  const cur = live18648();
  const t = targetOf(cur);
  t[0].lines = [{ rawLineItemId: 62853, qty: 14 }];
  t[1].lines = [{ rawLineItemId: 62850, qty: 13 }, { rawLineItemId: 62853, qty: 1 }];
  const r = planSplitWrite(cur, t, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.relineSeqs, [1, 2]);
  assert.deepEqual(r.plan.deleteRowIds, []);
});

// ── edit / undo: all rows in one state ──────────────────────────────────────

test("edit when every row is on the same stop and held: allowed; a new row inherits that state", () => {
  const cur = allIn(live18648(), { tripDropId: 2763, isHeld: true });
  const t = targetOf(cur);
  t[3].lines = [{ rawLineItemId: 62852, qty: 6 }];
  t.push({ invoiceNo: "I536230717", invoiceDate: DAY, lines: [{ rawLineItemId: 62852, qty: 4 }] });
  const r = planSplitWrite(cur, t, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.creates, [{ seq: 5, invoiceNo: "I536230717", invoiceDate: DAY }]);
  assert.equal(r.plan.inherit.tripDropId, 2763);
  assert.equal(r.plan.inherit.isHeld, true);
  assert.deepEqual(r.plan.relineSeqs, [4, 5]);
});

test("edit when rows are on different stops: refused, OBD named", () => {
  const cur = live18648();
  cur[1] = { ...cur[1], tripDropId: 2763 };
  const r = planSplitWrite(cur, targetOf(cur), OBD);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.refusals, ["Invoices of 9109951956 are on different trips / holds — move them back together first."]);
});

test("undo when some rows are held and some not: refused", () => {
  const cur = live18648();
  cur[0] = { ...cur[0], copyTrips: [], isHeld: true };
  cur[2] = { ...cur[2], isHeld: true };
  const r = planSplitWrite(cur, UNDO, OBD);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.refusals[0], /are on different trips \/ holds — move them back together first\./);
});

test("undo of a split all on one stop: merges back to seq 1, which keeps the stop", () => {
  const cur = allIn(live18648(), { tripDropId: 2763, copyTrips: [] });
  const r = planSplitWrite(cur, UNDO, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.deleteRowIds, [36798, 36799, 36800]);
  assert.deepEqual(r.plan.relineSeqs, [1]);
  assert.deepEqual(r.plan.updates, []);
});

// ── always refused ───────────────────────────────────────────────────────────

test("any row dispatched: refused (first split, edit and undo)", () => {
  const msg = "Already dispatched — invoices can't be changed.";
  const unsplit = [row(500, 1, "I536230001", [], { isDispatched: true })];
  assert.deepEqual(planSplitWrite(unsplit, FIRST_SPLIT, OBD), { ok: false, refusals: [msg] });
  const cur = allIn(live18648(), { isDispatched: true });
  assert.deepEqual(planSplitWrite(cur, targetOf(cur), OBD), { ok: false, refusals: [msg] });
  assert.deepEqual(planSplitWrite(cur, UNDO, OBD), { ok: false, refusals: [msg] });
});

test("any CI on the OBD, void and draft included: refused, numbers named", () => {
  const ci: ObdFacts = { obdNumber: "9109951956", ciNumbers: ["CI-0012 (void)", null] };
  const r = planSplitWrite([row(500, 1, "I536230001", [])], FIRST_SPLIT, ci);
  assert.deepEqual(r, { ok: false, refusals: ["Has a CI (CI-0012 (void), draft) — invoices can't be changed."] });
});

test("dispatched is reported before CI and before different states", () => {
  const rows: RowState[] = [{ ...FREE, isDispatched: true }, { ...FREE, tripDropId: 9 }];
  assert.equal(obdStateRefusal(rows, { obdNumber: "1", ciNumbers: ["CI-1"] }), "Already dispatched — invoices can't be changed.");
  assert.equal(obdStateRefusal([FREE], OBD), null);
});

// ── the RESTRICT guard ───────────────────────────────────────────────────────

test("deleting a copy-linked row is refused in plain English", () => {
  const cur = live18648();
  cur[3] = { ...cur[3], copyTrips: ["L-261006-05"] };
  const t = targetOf(cur).slice(0, 3);
  t[2].lines = [{ rawLineItemId: 62851, qty: 12 }, { rawLineItemId: 62852, qty: 10 }];
  const r = planSplitWrite(cur, t, OBD);
  assert.deepEqual(r, {
    ok: false,
    refusals: ["I536230715 cannot be removed — billing copied it for trip L-261006-05, and that record stays on it."],
  });
});

test("undo with a re-delivery on a manual row is refused (it would delete that row)", () => {
  const cur = live18648();
  cur[1] = { ...cur[1], redeliveryTrips: ["L-261007-20"] };
  const r = planSplitWrite(cur, UNDO, OBD);
  assert.deepEqual(r, {
    ok: false,
    refusals: ["I536230713 cannot be removed — it is re-delivered on trip L-261007-20, and that record stays on it."],
  });
});

test("a linked row may be re-numbered and re-lined — only its deletion is guarded", () => {
  const cur = live18648();
  cur[3] = { ...cur[3], redeliveryTrips: ["L-261007-20"] };
  const t = targetOf(cur);
  t[3].invoiceNo = "I536230719";
  const r = planSplitWrite(cur, t, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.updates, [{ id: 36800, seq: 4, invoiceNo: "I536230719", invoiceDate: DAY }]);
});

// ── in place, as before ──────────────────────────────────────────────────────

test("same split again: nothing to write", () => {
  const cur = live18648();
  const r = planSplitWrite(cur, targetOf(cur), OBD);
  assert.ok(r.ok);
  assert.equal(r.changed, false);
});

test("rows keep their ids: re-lining two rows updates no row and deletes none", () => {
  const cur = live18648();
  const t = targetOf(cur);
  t[2].lines = [{ rawLineItemId: 62851, qty: 10 }];
  t[3].lines = [{ rawLineItemId: 62852, qty: 10 }, { rawLineItemId: 62851, qty: 2 }];
  const r = planSplitWrite(cur, t, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.deleteRowIds, []);
  assert.deepEqual(r.plan.updates, []);
  assert.deepEqual(r.plan.creates, []);
  assert.deepEqual(r.plan.relineSeqs, [3, 4]);
});

test("fewer invoices: only the rows past the new count are deleted", () => {
  const cur = live18648();
  const t = targetOf(cur).slice(0, 3);
  t[2].lines = [{ rawLineItemId: 62851, qty: 12 }, { rawLineItemId: 62852, qty: 10 }];
  const r = planSplitWrite(cur, t, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.deleteRowIds, [36800]);
  assert.deepEqual(r.plan.relineSeqs, [3]);
});

test("seq 1's number and date are never written", () => {
  const cur = live18648();
  const t = targetOf(cur);
  t[0].invoiceDate = new Date("2026-01-01T00:00:00.000Z");
  const r = planSplitWrite(cur, t, OBD);
  assert.ok(r.ok);
  assert.equal(r.changed, false);
});

test("undo: an unsplit OBD has nothing to undo", () => {
  const r = planSplitWrite([row(17010, 1, "I536230716", [], { copyTrips: ["L-261006-05"] })], UNDO, OBD);
  assert.ok(r.ok);
  assert.equal(r.changed, false);
});

test("re-run after a half-failure: rows created but not lined → the plan re-lines only those", () => {
  const cur = live18648();
  cur[3] = { ...cur[3], lines: [{ rawLineItemId: 62852, qty: 6 }] };
  cur.push(row(36801, 5, "I536230717", []));
  const t = targetOf(cur);
  t[4].lines = [{ rawLineItemId: 62852, qty: 4 }];
  const r = planSplitWrite(cur, t, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.relineSeqs, [5]);
  assert.deepEqual(r.plan.creates, []);
});
