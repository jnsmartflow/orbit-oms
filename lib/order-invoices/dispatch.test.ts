// lib/order-invoices/dispatch.test.ts — npx tsx --test lib/order-invoices/dispatch.test.ts
//
// Add invoices 6.4 (2026-10-19): the OBD done rule and the per-invoice
// dispatch plan. Pure — no database. Fixture: order 18648 (rows 17010 / 36798 /
// 36799 / 36800 = …716 / 713 / 714 / 715).

import test from "node:test";
import assert from "node:assert/strict";
import { mirrorDispatchedArgs, obdDone, planRowsDispatch, rowDone, staleLoadRefusal, type DoneRow } from "./dispatch";

const NOS = ["I536230716", "I536230713", "I536230714", "I536230715"];
const rows = (dispatched: boolean[], held: boolean[] = [false, false, false, false]): DoneRow[] =>
  [17010, 36798, 36799, 36800].map((id, i) => ({ id, seq: i + 1, invoiceNo: NOS[i], isDispatched: dispatched[i], isHeld: held[i] }));
const CHECKED = { workflowStage: "pick_checked" };

test("done rule: every row dispatched → done; one open → not", () => {
  assert.equal(obdDone(rows([true, true, true, true]), []), true);
  assert.equal(obdDone(rows([true, true, false, true]), []), false);
  assert.equal(obdDone([], []), false);
});

test("done rule: a FULL CI on an invoice (its own or whole-OBD) counts as done", () => {
  const r = rows([true, true, false, true]);
  assert.equal(rowDone(r[2], [{ orderInvoiceId: 36799 }]), true);
  assert.equal(obdDone(r, [{ orderInvoiceId: 36799 }]), true);
  assert.equal(obdDone(r, [{ orderInvoiceId: 36800 }]), false); // another invoice's CI
  assert.equal(obdDone(rows([false, false, false, true]), [{ orderInvoiceId: null }]), true);
});

test("done rule: every row returned on CIs and NONE shipped → not dispatched (the extra guard)", () => {
  const cis = [17010, 36798, 36799, 36800].map((id) => ({ orderInvoiceId: id }));
  assert.equal(obdDone(rows([false, false, false, false]), cis), false);
});

test("done rule: unsplit identity — one row, row == OBD", () => {
  const one: DoneRow[] = [{ id: 500, seq: 1, invoiceNo: "I1", isDispatched: true, isHeld: false }];
  assert.equal(obdDone(one, []), true);
  assert.equal(obdDone([{ ...one[0], isDispatched: false }], []), false);
});

test("plan partial: 713 + 715 on the dispatched trip ship; the OBD waits for 716 + 714", () => {
  const p = planRowsDispatch(rows([false, false, false, false], [true, false, true, false]), [36798, 36800], CHECKED, []);
  assert.deepEqual(p.rowIdsToUpdate, [36798, 36800]);
  assert.deepEqual(p.refused, []);
  assert.equal(p.obdToDispatched, false);
});

test("plan: the last open invoice ships → the OBD becomes dispatched", () => {
  const p = planRowsDispatch(rows([true, true, false, true]), [36799], CHECKED, []);
  assert.deepEqual(p.rowIdsToUpdate, [36799]);
  assert.equal(p.obdToDispatched, true);
});

test("plan: a held row blocks only itself (refused, never dispatched)", () => {
  const p = planRowsDispatch(rows([false, false, false, false], [true, false, false, false]), [17010, 36798], CHECKED, []);
  assert.deepEqual(p.rowIdsToUpdate, [36798]);
  assert.deepEqual(p.refused.map((x) => x.error), ["I536230716 is on hold — it does not go"]);
  assert.equal(p.obdToDispatched, false);
});

test("plan: retry after a half-write — rows already dispatched, OBD behind → only the orders write", () => {
  const p = planRowsDispatch(rows([true, true, true, true]), [36799], CHECKED, []);
  assert.deepEqual(p.rowIdsToUpdate, []);
  assert.equal(p.obdToDispatched, true);
  const again = planRowsDispatch(rows([true, true, true, true]), [36799], { workflowStage: "dispatched" }, []);
  assert.deepEqual(again.rowIdsToUpdate, []);
  assert.equal(again.obdToDispatched, false);
});

test("mirror: the unsplit row follows its OBD, never a held row", () => {
  const at = new Date("2026-10-19T06:00:00.000Z");
  assert.deepEqual(mirrorDispatchedArgs(500, 7, at), {
    where: { orderId: 500, isDispatched: false, isHeld: false },
    data: { isDispatched: true, dispatchedAt: at, dispatchedById: 7 },
  });
});

// ── Split load, Phase 4 batch 2 (F6): a stale split-load bill does not go ──
// Live: order 22179 / OBD 9110345576, I536233980 part 1 (40777, L-261024-22)
// and part 2 (41213, 'load', L-261024-23).

const LOAD_ROWS: DoneRow[] = [
  { id: 40777, seq: 1, invoiceNo: "I536233980", isDispatched: false, isHeld: false, loadParentId: null },
  { id: 41213, seq: 2, invoiceNo: "I536233980", isDispatched: false, isHeld: false, loadParentId: 40777 },
];
const LOAD_OBD = { workflowStage: "pick_checked", obdNumber: "9110345576" };

test("stale split load: every chosen row is refused in 'part k of n' words, nothing moves, the OBD stays", () => {
  const p = planRowsDispatch(LOAD_ROWS, [41213], LOAD_OBD, [], true);
  assert.deepEqual(p.rowIdsToUpdate, []);
  assert.equal(p.obdToDispatched, false);
  assert.deepEqual(p.refused, [
    {
      rowId: 41213,
      invoiceNo: "I536233980",
      error: "I536233980 part 2 of 2 — SAP changed this bill after it was split. Take the parts off their trips, merge them back, split again.",
    },
  ]);
  assert.equal(staleLoadRefusal("I536233980 part 1 of 2"), planRowsDispatch(LOAD_ROWS, [40777], LOAD_OBD, [], true).refused[0].error);
  // A part already dispatched is not refused again.
  const gone = LOAD_ROWS.map((r) => (r.id === 40777 ? { ...r, isDispatched: true } : r));
  assert.deepEqual(planRowsDispatch(gone, [40777], LOAD_OBD, [], true).refused, []);
});

test("not stale: planRowsDispatch is byte-identical with or without the new argument (18648 and the split load)", () => {
  const cases: Array<[DoneRow[], number[]]> = [
    [rows([false, false, true, false], [false, true, false, false]), [17010, 36798]],
    [LOAD_ROWS, [40777]],
  ];
  for (const [r, ids] of cases) {
    assert.deepEqual(planRowsDispatch(r, ids, CHECKED, [], false), planRowsDispatch(r, ids, CHECKED, []));
  }
  assert.deepEqual(planRowsDispatch(LOAD_ROWS, [40777], LOAD_OBD, []).rowIdsToUpdate, [40777]);
});
