// lib/order-invoices/load-dialog.test.ts — npx tsx --test lib/order-invoices/load-dialog.test.ts
//
// Split load phase 3 commit 2 (2026-10-24): the dialog's pure maths (rest per
// line, trucks, totals by the board's kg ladder, why Save is grey) and the
// merge-selection rule. Fixture: OBD 9109951956 — 4 active lines, 50 tins,
// 1,000 L, header 1,357 kg, no SAP line kg, SAP's learned kg per tin.

import test from "node:test";
import assert from "node:assert/strict";
import type { ActiveLine } from "./rules";
import { mergeQuestionOf, mergeRowIdsOf, planLoadMerge, type LoadRow } from "./load-plan";
import {
  addTruck,
  kgFactsOf,
  kgPerTinOf,
  loadRowsOfView,
  onTruck,
  parseTins,
  removeTruck,
  restOf,
  splitErrorOf,
  splitEvenly,
  startTyped,
  truckName,
  truckTotalOf,
  trucksOf,
  type DialogLine,
} from "./load-dialog";

const ACTIVE = [
  { rawLineItemId: 62850, lineId: 900001, skuCodeRaw: "5880380", unitQty: 13, volumeLine: 260 },
  { rawLineItemId: 62851, lineId: 900002, skuCodeRaw: "5963121", unitQty: 12, volumeLine: 240 },
  { rawLineItemId: 62852, lineId: 900003, skuCodeRaw: "9296830", unitQty: 10, volumeLine: 200 },
  { rawLineItemId: 62853, lineId: 900004, skuCodeRaw: "9296830", unitQty: 15, volumeLine: 300 },
];
const RULES_ACTIVE: ActiveLine[] = ACTIVE.map(({ rawLineItemId, lineId, skuCodeRaw, unitQty }) => ({ rawLineItemId, lineId, skuCodeRaw, unitQty }));
const LINES: DialogLine[] = ACTIVE.map((a) => ({ rawLineItemId: a.rawLineItemId, tins: a.unitQty }));
const LEARNED = { "5880380": 27.41, "5963121": 27.111, "9296830": 27.03 } as Record<string, number>;
const KG = {
  obdKg: 1357,
  lines: ACTIVE.map((a) => ({ rawLineItemId: a.rawLineItemId, totalWeight: null, unitKg: LEARNED[a.skuCodeRaw] })),
};

/** The unsplit bill as the GET returns it: seq 1, lines resolved to every active line. */
const VIEW_UNSPLIT = [
  {
    id: 17010, seq: 1, source: "sap", rootId: 17010, invoiceNo: "I536230716", invoiceDate: "2026-10-05T00:00:00.000Z",
    tripDropId: null, tripNumber: null, isHeld: false, isDispatched: false,
    lines: LINES.map((l) => ({ rawLineItemId: l.rawLineItemId, qty: l.tins })),
  },
];

test("parseTins: blank is 0, whole numbers only", () => {
  assert.deepEqual(["", " 7 ", "0", "3.5", "-2", "x"].map(parseTins), [0, 7, 0, null, null, null]);
});

test("start: Truck A takes half rounded up, the last truck the REST", () => {
  const typed = startTyped(LINES);
  assert.deepEqual(typed, [["7"], ["6"], ["5"], ["8"]]);
  assert.deepEqual(LINES.map((l, i) => restOf(l, typed[i])), [6, 6, 5, 7]);
  assert.deepEqual(trucksOf(LINES, typed, 2).map((t) => t.lines.map((l) => l.qty)), [[7, 6, 5, 8], [6, 6, 5, 7]]);
});

test("+ Add truck goes BEFORE the last; ✕ only from Truck C; removing the last makes the one before it the rest", () => {
  let typed = addTruck(startTyped(LINES)); // 3 trucks: A typed, B typed 0, C rest
  assert.deepEqual(typed[0], ["7", "0"]);
  assert.equal(onTruck(LINES, typed, 0, 2, 3), 6);
  typed[0][1] = "4";
  assert.equal(onTruck(LINES, typed, 0, 2, 3), 2);
  assert.deepEqual(removeTruck(typed, 1, 3), typed); // Truck B has no ✕
  assert.deepEqual(removeTruck(typed, 2, 3)[0], ["7"]); // ✕ on the last → B becomes the rest
  typed = addTruck(typed); // 4 trucks
  assert.deepEqual(removeTruck(typed, 2, 4)[0], ["7", "4"]); // ✕ on C (typed) drops C's column
  assert.equal(truckName(3), "Truck D");
});

test("Split evenly: floor(tins / trucks) on every typed truck, the rest on the last", () => {
  const typed = splitEvenly(LINES, 3);
  assert.deepEqual(typed[0], ["4", "4"]);
  assert.equal(onTruck(LINES, typed, 0, 2, 3), 5);
});

test("totals: tins · litres · kg by the BOARD's ladder (learned kg per tin = exact), not the header share", () => {
  const facts = kgFactsOf(ACTIVE, KG);
  const [a, b] = trucksOf(LINES, startTyped(LINES), 2).map((t) => truckTotalOf(t, facts));
  assert.deepEqual([a.tins, a.litres, a.kgExact], [26, 520, true]);
  assert.ok(Math.abs((a.kg ?? 0) - (7 * 27.41 + 6 * 27.111 + 5 * 27.03 + 8 * 27.03)) < 1e-9);
  assert.deepEqual([b.tins, b.litres], [24, 480]);
  assert.equal(kgPerTinOf(62850, facts), 27.41);
  // No line kg and no learned kg → the header kg shared by litres, "~".
  const shared = kgFactsOf(ACTIVE, { obdKg: 1357, lines: [] });
  const s = truckTotalOf(trucksOf(LINES, startTyped(LINES), 2)[0], shared);
  assert.deepEqual([s.kgExact, Math.round((s.kg ?? 0) * 100) / 100], [false, 705.64]);
  assert.equal(kgPerTinOf(62850, shared), null);
  // SAP line kg wins over the learned value (rule 1).
  const lineKg = kgFactsOf(ACTIVE, { obdKg: 1357, lines: ACTIVE.map((x) => ({ rawLineItemId: x.rawLineItemId, totalWeight: x.unitQty * 30, unitKg: 27 })) });
  assert.equal(kgPerTinOf(62851, lineKg), 30);
});

test("why Save is grey: the dialog's words first, then the server's rule", () => {
  const rows = loadRowsOfView(VIEW_UNSPLIT);
  const base = { rows, sourceRowId: 17010, lines: LINES, trucks: 2, active: RULES_ACTIVE };
  assert.equal(splitErrorOf({ ...base, typed: startTyped(LINES) }), null);
  assert.equal(splitErrorOf({ ...base, typed: [["7"], ["6"], ["2.5"], ["8"]] }), "Whole tins only, no negatives.");
  assert.equal(splitErrorOf({ ...base, typed: [["14"], ["6"], ["5"], ["8"]] }), "More tins typed than this invoice has.");
  assert.equal(splitErrorOf({ ...base, typed: [["0"], ["0"], [""], ["0"]] }), "Truck A has no tins.");
  assert.equal(splitErrorOf({ ...base, typed: [["13"], ["12"], ["10"], ["15"]] }), "Truck B has no tins.");
  // A dispatched source → the server's own refusal.
  const sent = loadRowsOfView(VIEW_UNSPLIT.map((r) => ({ ...r, isDispatched: true })));
  assert.match(splitErrorOf({ ...base, rows: sent, typed: startTyped(LINES) }) ?? "", /dispatched/);
});

// ── merge selection (owner answer 1) ────────────────────────────────────────

const row = (o: Partial<LoadRow> & Pick<LoadRow, "id" | "seq">): LoadRow => ({
  source: o.seq === 1 ? "sap" : "load",
  loadParentId: null,
  invoiceNo: "I536230716",
  invoiceDate: null,
  tripDropId: null,
  isHeld: false,
  heldAt: null,
  heldById: null,
  isDispatched: false,
  lines: [{ rawLineItemId: 62850, qty: 1 }],
  ...o,
});
const GROUP = [
  row({ id: 17010, seq: 1 }),
  row({ id: 40001, seq: 2, loadParentId: 17010 }),
  row({ id: 40002, seq: 3, loadParentId: 17010, tripDropId: 2763 }), // on a trip
  row({ id: 40003, seq: 4, loadParentId: 17010 }),
  row({ id: 40004, seq: 5, loadParentId: 17010, isHeld: true }), // held
  row({ id: 36798, seq: 6, source: "manual", invoiceNo: "I536230713" }), // another paper
];

test("merge: ONE part ticked → every waiting part of that invoice with the same hold", () => {
  assert.deepEqual(mergeRowIdsOf(GROUP, [40003]), [17010, 40001, 40003]);
  assert.deepEqual(mergeRowIdsOf(GROUP, [40004]), [40004]); // the only held one → nothing to merge with
  assert.deepEqual(mergeRowIdsOf(GROUP, [36798]), []); // not in a load group
});

test("merge: TWO OR MORE ticked → exactly those", () => {
  assert.deepEqual(mergeRowIdsOf(GROUP, [40003, 40001]), [40003, 40001]);
});

test("merge question: 'Merge parts 2, 4 back into part 1?' from the group's own k", () => {
  const plan = planLoadMerge(GROUP, mergeRowIdsOf(GROUP, [40003]), RULES_ACTIVE.slice(0, 1).map((a) => ({ ...a, unitQty: 6 })), "9109951956");
  assert.ok(plan.ok);
  assert.equal(mergeQuestionOf(GROUP, plan.plan), "Merge parts 2, 4 back into part 1?");
  assert.equal(mergeQuestionOf(GROUP, { survivorId: 40001, deleteIds: [40003] }), "Merge part 4 back into part 2?");
});
