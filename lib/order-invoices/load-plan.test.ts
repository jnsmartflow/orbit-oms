// lib/order-invoices/load-plan.test.ts — npx tsx --test lib/order-invoices/load-plan.test.ts
//
// Split load phase 2 (2026-10-24): the pure split / merge / repair plans and
// the guards. Fixture: OBD 9109951956 (order 18648) — 4 active lines, 50 tins,
// SKU 9296830 on TWO lines — as an UNSPLIT bill (seq 1 row 17010, no lines),
// and as the Add-invoices bill it is live (17010 …716 + 36798 …713).

import test from "node:test";
import assert from "node:assert/strict";
import type { ActiveLine } from "./rules";
import {
  LOAD_HALF_WRITTEN,
  LOAD_HOLD_OUT_OF_STEP,
  LOAD_STALE,
  loadBillRefusal,
  loadGroupsOf,
  loadMergeRefusal,
  loadSplitRefusal,
  partLabel,
  planLoadMerge,
  planLoadRepair,
  planLoadSplit,
  remainderLines,
  rowsKey,
  tinsOfRow,
  type LoadBill,
  type LoadFacts,
  type LoadRow,
} from "./load-plan";

const OBD = "9109951956";
const SAP = "I536230716";
const DAY = new Date("2026-10-05T00:00:00.000Z");

const LINES: ActiveLine[] = [
  { rawLineItemId: 62850, lineId: 900001, skuCodeRaw: "5880380", unitQty: 13 },
  { rawLineItemId: 62851, lineId: 900002, skuCodeRaw: "5963121", unitQty: 12 },
  { rawLineItemId: 62852, lineId: 900003, skuCodeRaw: "9296830", unitQty: 10 },
  { rawLineItemId: 62853, lineId: 900004, skuCodeRaw: "9296830", unitQty: 15 },
];

function row(over: Partial<LoadRow> & Pick<LoadRow, "id" | "seq">): LoadRow {
  return {
    source: over.seq === 1 ? "sap" : "load",
    loadParentId: null,
    invoiceNo: SAP,
    invoiceDate: DAY,
    tripDropId: null,
    tripId: null,
    tripNumber: null,
    isHeld: false,
    heldAt: null,
    heldById: null,
    isDispatched: false,
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
    lines: [],
    ...over,
  };
}

const L = (pairs: [number, number][]) => pairs.map(([rawLineItemId, qty]) => ({ rawLineItemId, qty }));

const UNSPLIT = (over: Partial<LoadRow> = {}): LoadRow[] => [row({ id: 17010, seq: 1, ...over })];

/** Truck 1 keeps lines 1 + 2 (25 tins), truck 2 takes lines 3 + 4 (25). */
const TWO_TRUCKS = [
  { lines: L([[62850, 13], [62851, 12], [62852, 0], [62853, 0]]) },
  { lines: L([[62852, 10], [62853, 15]]) },
];

/** After the first split: root 17010 (25 tins) + part 40001 (25 tins). */
const SPLIT_ONCE = (): LoadRow[] => [
  row({ id: 17010, seq: 1, lines: L([[62850, 13], [62851, 12]]) }),
  row({ id: 40001, seq: 2, loadParentId: 17010, lines: L([[62852, 10], [62853, 15]]) }),
];

const BILL: LoadBill = { obdNumber: OBD, isRemoved: false, workflowStage: "pending_support", dispatchStatus: "dispatch" };
const FACTS: LoadFacts = { cis: [], copies: [], freightTripNumber: null, active: LINES };

// ── split ────────────────────────────────────────────────────────────────────

test("first split of an UNSPLIT bill: seq 1 gains truck 1's lines, one 'load' row at seq 2 under it", () => {
  const r = planLoadSplit({ rows: UNSPLIT(), sourceRowId: 17010, trucks: TWO_TRUCKS, active: LINES, obdHeld: false });
  assert.ok(r.ok);
  assert.equal(r.plan.sourceGainsLines, true);
  assert.deepEqual(r.plan.sourceLines, L([[62850, 13], [62851, 12]])); // the 0s are dropped
  assert.deepEqual(r.plan.creates, [
    { seq: 2, loadParentId: 17010, invoiceNo: SAP, invoiceDate: DAY, isHeld: false, heldAt: null, heldById: null, lines: L([[62852, 10], [62853, 15]]) },
  ]);
});

test("first split copies the root's NULL number (SAP not billed yet) and the OBD's hold", () => {
  const heldAt = new Date("2026-10-07T10:00:00.000Z");
  const rows = UNSPLIT({ invoiceNo: null, invoiceDate: null, isHeld: true, heldAt, heldById: 7 });
  const r = planLoadSplit({ rows, sourceRowId: 17010, trucks: TWO_TRUCKS, active: LINES, obdHeld: true });
  assert.ok(r.ok);
  const c = r.plan.creates[0];
  assert.equal(c.invoiceNo, null);
  assert.equal(c.invoiceDate, null);
  assert.deepEqual([c.isHeld, c.heldAt, c.heldById], [true, heldAt, 7]);
});

test("split again of a WAITING part: flat group — the new row's parent is the ROOT, its seq the next free one", () => {
  const r = planLoadSplit({
    rows: SPLIT_ONCE(),
    sourceRowId: 40001,
    trucks: [{ lines: L([[62852, 10], [62853, 5]]) }, { lines: L([[62853, 10]]) }],
    active: LINES,
    obdHeld: false,
  });
  assert.ok(r.ok);
  assert.equal(r.plan.sourceGainsLines, false);
  assert.deepEqual(r.plan.creates.map((c) => [c.seq, c.loadParentId]), [[3, 17010]]);
});

test("a part ON A TRIP cannot be split again; the root on a trip can", () => {
  const rows = SPLIT_ONCE().map((x) => ({ ...x, tripDropId: 2763, tripId: 668, tripNumber: "L-261007-20" }));
  const part = planLoadSplit({ rows, sourceRowId: 40001, trucks: [{ lines: L([[62852, 10]]) }, { lines: L([[62853, 15]]) }], active: LINES, obdHeld: false });
  assert.equal(part.ok, false);
  assert.match((part as { errors: string[] }).errors[0], /on L-261007-20 — only a part on no trip/);
  const root = planLoadSplit({ rows, sourceRowId: 17010, trucks: [{ lines: L([[62850, 13]]) }, { lines: L([[62851, 12]]) }], active: LINES, obdHeld: false });
  assert.ok(root.ok);
  assert.equal(root.plan.creates[0].seq, 3);
});

test("a 1-tin line goes whole on one truck", () => {
  const active: ActiveLine[] = [...LINES.slice(0, 1), { rawLineItemId: 62854, lineId: 900005, skuCodeRaw: "1", unitQty: 1 }];
  const r = planLoadSplit({
    rows: UNSPLIT(),
    sourceRowId: 17010,
    trucks: [{ lines: L([[62850, 13], [62854, 0]]) }, { lines: L([[62854, 1]]) }],
    active,
    obdHeld: false,
  });
  assert.ok(r.ok);
  assert.deepEqual(r.plan.creates[0].lines, L([[62854, 1]]));
});

test("sums wrong: every line not placed exactly is named", () => {
  const r = planLoadSplit({
    rows: UNSPLIT(),
    sourceRowId: 17010,
    trucks: [{ lines: L([[62850, 13], [62851, 12]]) }, { lines: L([[62852, 7], [62853, 16]]) }],
    active: LINES,
    obdHeld: false,
  });
  assert.equal(r.ok, false);
  assert.deepEqual((r as { errors: string[] }).errors, [
    "line 900003 (9296830): 3 of 10 tins not placed",
    "line 900004 (9296830): 16 tins placed but this invoice has only 15",
  ]);
});

test("a truck with 0 tins is refused; a non-whole qty and a foreign line too", () => {
  const r = planLoadSplit({
    rows: SPLIT_ONCE(),
    sourceRowId: 40001,
    trucks: [{ lines: L([[62852, 10], [62853, 15]]) }, { lines: L([[62852, 0]]) }],
    active: LINES,
    obdHeld: false,
  });
  assert.equal(r.ok, false);
  assert.deepEqual((r as { errors: string[] }).errors, ["Truck 2 has no tins"]);
  const bad = planLoadSplit({
    rows: SPLIT_ONCE(),
    sourceRowId: 40001,
    trucks: [{ lines: L([[62852, 10], [62853, 14.5]]) }, { lines: L([[62850, 1]]) }],
    active: LINES,
    obdHeld: false,
  });
  assert.equal(bad.ok, false);
  const errs = (bad as { errors: string[] }).errors;
  assert.ok(errs.some((e) => /Truck 1: line 900004 .* whole number/.test(e)));
  assert.ok(errs.some((e) => /Truck 2: item 62850 is not a line of this invoice/.test(e)));
});

test("a dispatched source is refused; fewer than 2 trucks too", () => {
  const r = planLoadSplit({ rows: UNSPLIT({ isDispatched: true }), sourceRowId: 17010, trucks: TWO_TRUCKS, active: LINES, obdHeld: false });
  assert.equal(r.ok, false);
  assert.match((r as { errors: string[] }).errors[0], /dispatched/);
  const one = planLoadSplit({ rows: UNSPLIT(), sourceRowId: 17010, trucks: TWO_TRUCKS.slice(0, 1), active: LINES, obdHeld: false });
  assert.deepEqual((one as { errors: string[] }).errors, ["A split needs at least 2 trucks"]);
});

test("the 20-rows fuse (MAX_INVOICES) is reused", () => {
  const rows = [row({ id: 1, seq: 1, lines: L([[62850, 1]]) }), ...Array.from({ length: 18 }, (_, i) => row({ id: 100 + i, seq: i + 2, loadParentId: 1, lines: L([[62850, 1]]) }))];
  const r = planLoadSplit({ rows, sourceRowId: 1, trucks: [{ lines: [] }, { lines: [] }, { lines: [] }], active: LINES, obdHeld: false });
  assert.deepEqual((r as { errors: string[] }).errors, ["At most 20 invoices and parts on one bill"]);
});

// ── groups / labels / tins ───────────────────────────────────────────────────

test("loadGroupsOf: root first, part k of n by seq; a lone row is 1 of 1; Add-invoices rows are their own groups", () => {
  const rows = [
    row({ id: 17010, seq: 1, lines: L([[62850, 13]]) }),
    row({ id: 36798, seq: 2, source: "manual", invoiceNo: "I536230713", lines: L([[62851, 12]]) }),
    row({ id: 40001, seq: 3, loadParentId: 17010, lines: L([[62852, 10]]) }),
    row({ id: 40002, seq: 4, loadParentId: 36798, invoiceNo: "I536230713", lines: L([[62853, 15]]) }),
  ];
  const g = loadGroupsOf(rows);
  assert.deepEqual(g.get(17010), { rootId: 17010, k: 1, n: 2 });
  assert.deepEqual(g.get(40001), { rootId: 17010, k: 2, n: 2 });
  assert.deepEqual(g.get(40002), { rootId: 36798, k: 2, n: 2 });
  assert.equal(partLabel(rows, rows[3], OBD), "I536230713 part 2 of 2");
  assert.deepEqual(loadGroupsOf(UNSPLIT()).get(17010), { rootId: 17010, k: 1, n: 1 });
  assert.equal(partLabel(UNSPLIT(), UNSPLIT()[0], OBD), SAP);
});

test("tinsOfRow: an unsplit seq 1 carries every active line; a lineless row of a split OBD carries nothing", () => {
  assert.deepEqual(Array.from(tinsOfRow(UNSPLIT()[0], UNSPLIT(), LINES).entries()), [[62850, 13], [62851, 12], [62852, 10], [62853, 15]]);
  const half = [row({ id: 17010, seq: 1 }), row({ id: 40001, seq: 2, loadParentId: 17010, lines: L([[62850, 1]]) })];
  assert.equal(tinsOfRow(half[0], half, LINES).size, 0);
});

// ── merge ────────────────────────────────────────────────────────────────────

test("merge back to UNSPLIT: the part is deleted and seq 1 goes back to no lines", () => {
  const r = planLoadMerge(SPLIT_ONCE(), [17010, 40001], LINES, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan, { survivorId: 17010, deleteIds: [40001], survivorLines: [], backToUnsplit: true });
});

test("merge on a bill WITH Add-invoices rows keeps lines: the survivor takes the remainder", () => {
  const rows = [
    row({ id: 17010, seq: 1, lines: L([[62850, 13], [62851, 2]]) }),
    row({ id: 36798, seq: 2, source: "manual", invoiceNo: "I536230713", lines: L([[62852, 10], [62853, 15]]) }),
    row({ id: 40001, seq: 3, loadParentId: 17010, lines: L([[62851, 10]]) }),
  ];
  const r = planLoadMerge(rows, [17010, 40001], LINES, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan, { survivorId: 17010, deleteIds: [40001], survivorLines: L([[62850, 13], [62851, 12]]), backToUnsplit: false });
});

test("merge of two parts without the root: the lowest-seq part survives", () => {
  const rows = [
    row({ id: 17010, seq: 1, tripDropId: 2763, tripId: 668, tripNumber: "L-261007-20", lines: L([[62850, 13], [62851, 12]]) }),
    row({ id: 40001, seq: 2, loadParentId: 17010, lines: L([[62852, 10]]) }),
    row({ id: 40002, seq: 3, loadParentId: 17010, lines: L([[62853, 15]]) }),
  ];
  const r = planLoadMerge(rows, [40002, 40001], LINES, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan, { survivorId: 40001, deleteIds: [40002], survivorLines: L([[62852, 10], [62853, 15]]), backToUnsplit: false });
});

test("merge blocked by a copy, a re-delivery, or ANY CI (void included) on a part it would delete", () => {
  const cases: [Partial<LoadRow>, RegExp][] = [
    [{ copyTrips: ["L-261007-20"] }, /billing copied it for trip L-261007-20/],
    [{ redeliveryTrips: ["L-261008-02"] }, /re-delivered on trip L-261008-02/],
    [{ ciNumbers: ["CI-2026-00412 (void)"] }, /it has CI-2026-00412 \(void\)/],
  ];
  for (const [over, re] of cases) {
    const rows = SPLIT_ONCE().map((x) => (x.id === 40001 ? { ...x, ...over } : x));
    const r = planLoadMerge(rows, [17010, 40001], LINES, OBD);
    assert.equal(r.ok, false);
    assert.match((r as { errors: string[] }).errors[0], re);
    assert.match((r as { errors: string[] }).errors[0], /^I536230716 part 2 of 2 cannot be merged — /);
  }
});

test("merge refuses: on a trip, mixed hold, two groups, a lone row", () => {
  const onTrip = SPLIT_ONCE().map((x) => (x.id === 17010 ? { ...x, tripDropId: 2763, tripNumber: "L-261007-20" } : x));
  assert.match((planLoadMerge(onTrip, [17010, 40001], LINES, OBD) as { errors: string[] }).errors[0], /on L-261007-20/);
  const mixed = SPLIT_ONCE().map((x) => (x.id === 40001 ? { ...x, isHeld: true } : x));
  assert.match((planLoadMerge(mixed, [17010, 40001], LINES, OBD) as { errors: string[] }).errors[0], /on hold and some are not/);
  const two = [...SPLIT_ONCE(), row({ id: 36798, seq: 3, source: "manual", lines: [] })];
  assert.match((planLoadMerge(two, [40001, 36798], LINES, OBD) as { errors: string[] }).errors[0], /SAME invoice/);
  assert.match((planLoadMerge(SPLIT_ONCE(), [40001], LINES, OBD) as { errors: string[] }).errors[0], /at least 2/);
});

test("merge on a STALE bill (SAP changed a qty) is allowed and absorbs SAP's new number", () => {
  const rows = [
    row({ id: 17010, seq: 1, lines: L([[62850, 13], [62851, 12]]) }),
    row({ id: 36798, seq: 2, source: "manual", lines: L([[62852, 10]]) }),
    row({ id: 40001, seq: 3, loadParentId: 17010, lines: L([[62853, 15]]) }),
  ];
  const active = LINES.map((a) => (a.rawLineItemId === 62853 ? { ...a, unitQty: 18 } : a));
  assert.equal(loadMergeRefusal(BILL, rows, [17010, 40001], { ...FACTS, active }), null);
  const r = planLoadMerge(rows, [17010, 40001], active, OBD);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.survivorLines, L([[62850, 13], [62851, 12], [62853, 18]]));
});

// ── remainder / rowsKey ──────────────────────────────────────────────────────

test("remainder rule: unitQty − Σ the other rows; over-placed is refused", () => {
  const others = [row({ id: 40001, seq: 2, lines: L([[62852, 10], [62853, 5]]) })];
  assert.deepEqual(remainderLines(LINES, others), { ok: true, lines: L([[62850, 13], [62851, 12], [62853, 10]]) });
  const over = [row({ id: 40001, seq: 2, lines: L([[62852, 11]]) })];
  assert.deepEqual(remainderLines(LINES, over), {
    ok: false,
    errors: ["line 900003 (9296830): the other trucks carry 11 tins but the bill has only 10"],
  });
});

test("rowsKey changes on any move, hold, dispatch or line change — and only then", () => {
  const base = rowsKey(SPLIT_ONCE());
  assert.equal(rowsKey(SPLIT_ONCE().reverse()), base); // order of the read does not matter
  const mut = (f: (r: LoadRow) => LoadRow) => rowsKey(SPLIT_ONCE().map((r) => (r.id === 40001 ? f(r) : r)));
  assert.notEqual(mut((r) => ({ ...r, tripDropId: 2763 })), base);
  assert.notEqual(mut((r) => ({ ...r, isHeld: true })), base);
  assert.notEqual(mut((r) => ({ ...r, isDispatched: true })), base);
  assert.notEqual(mut((r) => ({ ...r, lines: L([[62852, 9], [62853, 16]]) })), base);
  assert.equal(mut((r) => ({ ...r, invoiceNo: "I999999999" })), base);
});

// ── guards ───────────────────────────────────────────────────────────────────

test("guards: bill stages reuse Add invoices' words, but NO SAP-number rule", () => {
  assert.equal(loadBillRefusal({ ...BILL, workflowStage: "cancelled" }), "This bill is cancelled");
  assert.equal(loadBillRefusal({ ...BILL, workflowStage: "dispatched" }), "This bill has already been dispatched");
  assert.equal(loadBillRefusal({ ...BILL, isRemoved: true }), "This bill has been removed");
  const noNumber = UNSPLIT({ invoiceNo: null });
  assert.equal(loadSplitRefusal(BILL, noNumber, noNumber[0], FACTS), null);
});

test("guards: half-written first, then stale; merge is NOT blocked by stale", () => {
  const half = [row({ id: 17010, seq: 1 }), row({ id: 40001, seq: 2, loadParentId: 17010, lines: L([[62850, 1]]) })];
  assert.equal(loadSplitRefusal(BILL, half, half[1], FACTS), LOAD_HALF_WRITTEN);
  assert.equal(loadMergeRefusal(BILL, half, [17010, 40001], FACTS), LOAD_HALF_WRITTEN);
  const stale = SPLIT_ONCE();
  const active = LINES.map((a) => (a.rawLineItemId === 62850 ? { ...a, unitQty: 14 } : a));
  assert.equal(loadSplitRefusal(BILL, stale, stale[0], { ...FACTS, active }), LOAD_STALE);
});

test("guards: a CI DRAFT covering the row blocks the split (its own or whole-OBD); a void one does not", () => {
  const rows = UNSPLIT();
  const draft = { id: 9, ciNumber: null, status: "draft", isVoided: false, orderInvoiceId: null };
  assert.equal(loadSplitRefusal(BILL, rows, rows[0], { ...FACTS, cis: [draft] }), "I536230716 has a CI draft — it cannot be split.");
  const own = { id: 10, ciNumber: "CI-2026-00412", status: "submitted", isVoided: false, orderInvoiceId: 17010 };
  assert.equal(loadSplitRefusal(BILL, rows, rows[0], { ...FACTS, cis: [own] }), "I536230716 has CI-2026-00412 — it cannot be split.");
  assert.equal(loadSplitRefusal(BILL, rows, rows[0], { ...FACTS, cis: [{ ...own, isVoided: true }] }), null);
});

test("guards: an unsplit bill's hold mirror out of step with orders → Repair", () => {
  const rows = UNSPLIT({ isHeld: false });
  assert.equal(loadSplitRefusal({ ...BILL, dispatchStatus: "hold" }, rows, rows[0], FACTS), LOAD_HOLD_OUT_OF_STEP);
  const held = UNSPLIT({ isHeld: true });
  assert.equal(loadSplitRefusal({ ...BILL, dispatchStatus: "hold" }, held, held[0], FACTS), null);
});

test("guards: a billing copy on the source's CURRENT trip refuses; a copy on another trip does not", () => {
  const rows = UNSPLIT({ tripDropId: 2763, tripId: 668, tripNumber: "L-261007-20" });
  const copy = { tripId: 668, orderInvoiceId: 17010, copiedAt: new Date("2026-10-07T09:00:00Z"), tripNumber: "L-261007-20" };
  assert.equal(
    loadSplitRefusal(BILL, rows, rows[0], { ...FACTS, copies: [copy] }),
    "Billing already copied I536230716 for L-261007-20 — split it before billing copies it, or ask billing to take the trip back.",
  );
  assert.equal(loadSplitRefusal(BILL, rows, rows[0], { ...FACTS, copies: [{ ...copy, tripId: 605, tripNumber: "L-261006-05" }] }), null);
});

test("guards: on an active freight trip → refused", () => {
  const rows = UNSPLIT();
  assert.equal(loadSplitRefusal(BILL, rows, rows[0], { ...FACTS, freightTripNumber: "F-261020-01" }), "On freight trip F-261020-01 — remove it there first");
});

test("merge guard: a live CI covering a chosen row (even the survivor) refuses", () => {
  const ci = { id: 11, ciNumber: "CI-2026-00500", status: "submitted", isVoided: false, orderInvoiceId: 17010 };
  assert.match(loadMergeRefusal(BILL, SPLIT_ONCE(), [17010, 40001], { ...FACTS, cis: [ci] }) ?? "", /I536230716 part 1 of 2 has CI-2026-00500/);
});

// ── repair ───────────────────────────────────────────────────────────────────

test("repair (a): a dead first split (parts, no lines anywhere) → parts deleted, bill unsplit again", () => {
  const rows = [row({ id: 17010, seq: 1 }), row({ id: 40001, seq: 2, loadParentId: 17010 })];
  assert.deepEqual(planLoadRepair(rows, LINES, false), { ok: true, plan: { deleteIds: [40001], fill: null, mirrorHeld: null, changed: true } });
});

test("repair (b): a dead split-again (source lost its lines, parts lineless) → parts deleted, source gets its old share back", () => {
  const rows = [
    row({ id: 17010, seq: 1, lines: L([[62850, 13], [62851, 12]]) }),
    row({ id: 40001, seq: 2, loadParentId: 17010 }), // source, lines deleted at step 3
    row({ id: 40002, seq: 3, loadParentId: 17010 }), // new part, never got lines
  ];
  const r = planLoadRepair(rows, LINES, false);
  assert.ok(r.ok);
  // Both are lineless 'load' rows; the lower seq (40001) was the SOURCE — kept.
  assert.deepEqual(r.plan.deleteIds, [40002]);
  assert.deepEqual(r.plan.fill, { rowId: 40001, lines: L([[62852, 10], [62853, 15]]) });
});

test("repair: a dead split-again of a part BEFORE step 3 (source still lined) → every lineless part goes", () => {
  const rows = [...SPLIT_ONCE(), row({ id: 40002, seq: 3, loadParentId: 17010 }), row({ id: 40003, seq: 4, loadParentId: 17010 })];
  assert.deepEqual(planLoadRepair(rows, LINES, false), { ok: true, plan: { deleteIds: [40002, 40003], fill: null, mirrorHeld: null, changed: true } });
});

test("repair: a dead merge whose survivor was a PART (root not chosen) → the survivor is kept and refilled", () => {
  const rows = [
    row({ id: 17010, seq: 1, tripDropId: 2763, lines: L([[62850, 13], [62851, 12]]) }),
    row({ id: 40001, seq: 2, loadParentId: 17010 }), // survivor, lines deleted at merge step 1
    row({ id: 40002, seq: 3, loadParentId: 17010, lines: L([[62853, 15]]) }),
  ];
  const r = planLoadRepair(rows, LINES, false);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.deleteIds, []);
  assert.deepEqual(r.plan.fill, { rowId: 40001, lines: L([[62852, 10]]) });
});

test("repair (b): a dead merge (survivor lost its lines) → it gets the remainder", () => {
  const rows = [
    row({ id: 17010, seq: 1 }),
    row({ id: 36798, seq: 2, source: "manual", lines: L([[62852, 10], [62853, 15]]) }),
    row({ id: 40001, seq: 3, loadParentId: 17010, lines: L([[62851, 12]]) }),
  ];
  const r = planLoadRepair(rows, LINES, false);
  assert.ok(r.ok);
  assert.deepEqual(r.plan.fill, { rowId: 17010, lines: L([[62850, 13]]) });
  assert.deepEqual(r.plan.deleteIds, []);
});

test("repair: an unsplit bill with its hold mirror out of step → mirror; nothing to do → unchanged", () => {
  assert.deepEqual(planLoadRepair(UNSPLIT({ isHeld: false }), LINES, true), { ok: true, plan: { deleteIds: [], fill: null, mirrorHeld: true, changed: true } });
  assert.deepEqual(planLoadRepair(UNSPLIT(), LINES, false), { ok: true, plan: { deleteIds: [], fill: null, mirrorHeld: null, changed: false } });
});

// ── Fix A (owner decision 2026-10-26, second): a whole-bill CI never strands a
// split bill. Merge: only a CI ON a chosen row blocks. Split: a CI on the row,
// or a FULL whole-bill one; a PARTIAL whole-bill CI does not. ──────────────────

const WHOLE = (returnType: string, status = "submitted") => ({ id: 20, ciNumber: status === "draft" ? null : "CI-2026-00900", status, isVoided: false, orderInvoiceId: null, returnType });

test("Fix A merge: a whole-bill CI — PARTIAL, FULL or a draft — does not block", () => {
  for (const ci of [WHOLE("part"), WHOLE("full"), WHOLE("full", "draft"), WHOLE("part", "draft")]) {
    assert.equal(loadMergeRefusal(BILL, SPLIT_ONCE(), [17010, 40001], { ...FACTS, cis: [ci] }), null, JSON.stringify(ci));
  }
});

test("Fix A merge: a CI linked to a chosen row still blocks (PARTIAL or FULL, draft included)", () => {
  for (const returnType of ["part", "full"]) {
    const own = { id: 21, ciNumber: "CI-2026-00901", status: "submitted", isVoided: false, orderInvoiceId: 40001, returnType };
    assert.equal(
      loadMergeRefusal(BILL, SPLIT_ONCE(), [17010, 40001], { ...FACTS, cis: [own] }),
      "I536230716 part 2 of 2 has CI-2026-00901 — it cannot be merged.",
    );
  }
  const draft = { id: 22, ciNumber: null, status: "draft", isVoided: false, orderInvoiceId: 17010, returnType: "part" };
  assert.equal(loadMergeRefusal(BILL, SPLIT_ONCE(), [17010, 40001], { ...FACTS, cis: [draft] }), "I536230716 part 1 of 2 has a CI draft — it cannot be merged.");
});

test("Fix A split: a PARTIAL whole-bill CI is allowed; a FULL one (or a FULL draft) blocks", () => {
  const rows = UNSPLIT();
  assert.equal(loadSplitRefusal(BILL, rows, rows[0], { ...FACTS, cis: [WHOLE("part")] }), null);
  assert.equal(loadSplitRefusal(BILL, rows, rows[0], { ...FACTS, cis: [WHOLE("full")] }), "I536230716 has CI-2026-00900 — it cannot be split.");
  assert.equal(loadSplitRefusal(BILL, rows, rows[0], { ...FACTS, cis: [WHOLE("full", "draft")] }), "I536230716 has a CI draft — it cannot be split.");
  // A part of an already-split bill, same rule.
  const split = SPLIT_ONCE();
  assert.equal(loadSplitRefusal(BILL, split, split[1], { ...FACTS, cis: [WHOLE("part")] }), null);
  assert.equal(loadSplitRefusal(BILL, split, split[1], { ...FACTS, cis: [WHOLE("full")] }), "I536230716 has CI-2026-00900 — it cannot be split.");
});

test("Fix A split: a CI linked to the row blocks whatever its type; another row's CI does not", () => {
  const split = SPLIT_ONCE();
  const onPart = { id: 23, ciNumber: "CI-2026-00902", status: "submitted", isVoided: false, orderInvoiceId: 40001, returnType: "part" };
  assert.equal(loadSplitRefusal(BILL, split, split[1], { ...FACTS, cis: [onPart] }), "I536230716 has CI-2026-00902 — it cannot be split.");
  assert.equal(loadSplitRefusal(BILL, split, split[0], { ...FACTS, cis: [onPart] }), null);
  // A void one never counts.
  assert.equal(loadSplitRefusal(BILL, split, split[1], { ...FACTS, cis: [{ ...onPart, isVoided: true }] }), null);
});
