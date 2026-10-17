// lib/floor/selection.test.ts — npx tsx --test lib/floor/selection.test.ts
//
// The desk selection rules a pair tick leans on (toggleAllDesk is the merged
// tick's all-or-none) and the bottom bar's invoice/OBD count. Pure.

import test from "node:test";
import assert from "node:assert/strict";
import {
  billsBodyOf,
  deskKeysOf,
  invKey,
  isAllDeskSelected,
  keysForOrders,
  orderIdsInTickOrder,
  reconcileTicks,
  selectionCountLabel,
  selectionUnits,
  toggleAllDesk,
  unitKeys,
  wholeObdReason,
  type FloorDeskSelection,
} from "./selection";

const r = (invoiceNo: string | null, partners = 0) => ({ invoiceNo, invoicePartners: Array.from({ length: partners }) });
const row = (orderId: number) => ({ orderId });

test("pair tick (toggleAllDesk over the block): none → all, partial → all, all → none", () => {
  const block = [row(1), row(2)];
  const none: FloorDeskSelection = new Set([9]);
  const all = toggleAllDesk(none, block);
  assert.deepEqual(Array.from(all).sort(), [1, 2, 9]);
  assert.deepEqual(Array.from(toggleAllDesk(new Set([1, 9]), block)).sort(), [1, 2, 9]); // partial fills
  assert.deepEqual(Array.from(toggleAllDesk(all, block)), [9]); // other ticks survive
});

test("a 3-OBD block is toggled whole — no size assumed", () => {
  const block = [row(1), row(2), row(3)];
  assert.deepEqual(Array.from(toggleAllDesk(new Set(), block)).sort(), [1, 2, 3]);
});

test("label: one pair → '1 invoice · 2 OBDs'", () => {
  assert.equal(selectionCountLabel([r("I1", 1), r("I1", 1)]), "1 invoice · 2 OBDs");
});

test("label: a pair plus two single-invoice bills → '3 invoices · 4 OBDs'", () => {
  assert.equal(selectionCountLabel([r("I1", 1), r("I1", 1), r("I2"), r("I3")]), "3 invoices · 4 OBDs");
});

test("label: no multi-OBD invoice in the selection → null (bar keeps 'N selected')", () => {
  assert.equal(selectionCountLabel([r("I2"), r("I3"), r(null)]), null);
  assert.equal(selectionCountLabel([]), null);
});

test("label: a split pair half alone still says it is part of an invoice; un-invoiced bills said apart", () => {
  assert.equal(selectionCountLabel([r("I1", 1)]), "1 invoice · 1 OBD");
  assert.equal(selectionCountLabel([r("I1", 1), r("I1", 1), r(null)]), "1 invoice + 1 not invoiced · 3 OBDs");
});

test("label: a 3-OBD invoice", () => {
  assert.equal(selectionCountLabel([r("I3", 2), r("I3", 2), r("I3", 2)]), "1 invoice · 3 OBDs");
});

// ── Add invoices Phase 4: a split OBD (one drawn row per invoice) ────────────
const split = (nos: string[]) => ({ invoiceNo: nos[0], invoiceRows: nos.map((invoiceNo) => ({ invoiceNo })) });

test("label: one split OBD → '1 OBD · 4 invoices'", () => {
  assert.equal(selectionCountLabel([split(["I716", "I713", "I714", "I715"])]), "1 OBD · 4 invoices");
});

test("label: a split OBD with plain bills and one not invoiced → OBDs first", () => {
  assert.equal(selectionCountLabel([split(["I716", "I713"]), r("I2"), r(null)]), "3 OBDs · 3 invoices + 1 not invoiced");
});

test("label: a split OBD that is also half of a pair → still OBDs first, each number once", () => {
  assert.equal(selectionCountLabel([{ ...split(["I716", "I713"]), invoicePartners: [{}] }, r("I716", 1)]), "2 OBDs · 2 invoices");
});

test("label: an UNSPLIT bill's empty invoiceRows changes nothing", () => {
  assert.equal(selectionCountLabel([{ ...r("I1", 1), invoiceRows: [] }, { ...r("I1", 1), invoiceRows: [] }]), "1 invoice · 2 OBDs");
});

// ── P5-3: per-invoice ticks ─────────────────────────────────────────────────

// 18648 = OBD 9109951956, invoices 17010..17013 (716 / 713 / 714 / 715).
const INV = [17010, 17011, 17012, 17013].map((id, i) => ({ id, tripDropId: i % 2 === 1 ? 2763 : null, invoiceNo: `I${id}` }));
const SPLIT = { orderId: 18648, invoiceRows: INV };
const PLAIN = { orderId: 7, invoiceRows: [] as typeof INV };

test("units: unsplit by orderId; split by invoice — some ticked = partial, all = whole, none = absent", () => {
  assert.deepEqual(selectionUnits(new Set([7]), [PLAIN, SPLIT]), [{ orderId: 7, invoiceRowIds: null }]);
  assert.deepEqual(selectionUnits(new Set([invKey(17010), invKey(17012)]), [PLAIN, SPLIT]), [
    { orderId: 18648, invoiceRowIds: [17010, 17012] },
  ]);
  assert.deepEqual(selectionUnits(new Set(INV.map((i) => invKey(i.id))), [SPLIT]), [{ orderId: 18648, invoiceRowIds: null }]);
  // A split OBD found by its orderId (ticked before it was split) = whole.
  assert.deepEqual(selectionUnits(new Set([18648]), [SPLIT]), [{ orderId: 18648, invoiceRowIds: null }]);
  // rd: keys are never units.
  assert.deepEqual(selectionUnits(new Set(["rd:28" as const]), [SPLIT, PLAIN]), []);
});

test("billsBodyOf: whole OBDs post exactly what they always did; a partial one names its rows", () => {
  assert.deepEqual(billsBodyOf([{ orderId: 7, invoiceRowIds: null }, { orderId: 18648, invoiceRowIds: null }], "add"), {
    orderIds: [7, 18648],
    action: "add",
  });
  assert.deepEqual(billsBodyOf([{ orderId: 7, invoiceRowIds: null }, { orderId: 18648, invoiceRowIds: [17010, 17012] }], "remove"), {
    orderIds: [7, 18648],
    action: "remove",
    invoiceRowIds: { 18648: [17010, 17012] },
  });
});

test("desk keys: a split OBD → its DRAWN invoices; header tick takes them all; perInvoice false = Phase 4", () => {
  const pool = { orderId: 18648, invoiceRows: [INV[0], INV[2]], invoiceRowsAll: INV };
  assert.deepEqual(deskKeysOf(pool), ["inv:17010", "inv:17012"]);
  assert.deepEqual(deskKeysOf(pool, false), [18648]);
  assert.deepEqual(deskKeysOf(PLAIN), [7]);
  assert.deepEqual(deskKeysOf({ ...SPLIT, redelivery: { id: 28 } }), ["rd:28"]);
  const all = toggleAllDesk(new Set(), [PLAIN, pool]);
  assert.deepEqual(Array.from(all), [7, "inv:17010", "inv:17012"]);
  assert.equal(isAllDeskSelected(all, [PLAIN, pool]), true);
  assert.equal(isAllDeskSelected(new Set([7, invKey(17010)]), [PLAIN, pool]), false);
  assert.deepEqual(Array.from(toggleAllDesk(all, [PLAIN, pool])), []);
});

test("wholeObdReason: the owner's tooltip", () => {
  assert.equal(wholeObdReason([]), null);
  assert.equal(wholeObdReason([{ obdNumber: "9109951956", invoiceCount: 4 }]), "Acts on the whole OBD — tick all 4 invoices");
  assert.equal(
    wholeObdReason([{ obdNumber: "A", invoiceCount: 4 }, { obdNumber: "B", invoiceCount: 2 }]),
    "Acts on whole OBDs — tick every invoice of A, B",
  );
});

test("unitKeys / keysForOrders: a split OBD comes back as invoices, a plain one as its id", () => {
  assert.deepEqual(keysForOrders([7, 18648], [PLAIN, SPLIT]), [7, "inv:17010", "inv:17011", "inv:17012", "inv:17013"]);
  assert.deepEqual(unitKeys([{ orderId: 18648, invoiceRowIds: [17011] }], [SPLIT]), ["inv:17011"]);
});

test("orderIdsInTickOrder: inv keys count for their OBD once, in tick order", () => {
  const sel: FloorDeskSelection = new Set([invKey(17012), 7, invKey(17010), "rd:3" as const]);
  assert.deepEqual(orderIdsInTickOrder(sel, [PLAIN, SPLIT]), [18648, 7]);
});

test("reconcileTicks: drops a ticked invoice that MOVED or left, keeps the rest; counts OBDs", () => {
  const sel = new Set([7, invKey(17010), invKey(17012), "rd:3" as const]);
  // 17012 went on a trip elsewhere; the plain bill unchanged.
  const moved = { ...SPLIT, invoiceRows: INV.map((i) => (i.id === 17012 ? { ...i, tripDropId: 99 } : i)) };
  const r1 = reconcileTicks(sel, [PLAIN, SPLIT], new Map([[18648, moved], [7, PLAIN]]));
  assert.deepEqual(Array.from(r1.next), [7, "inv:17010", "rd:3"]);
  assert.equal(r1.dropped, 1);
  // The OBD left the board → every invoice tick of it goes, counted once.
  const r2 = reconcileTicks(sel, [PLAIN, SPLIT], new Map([[18648, null]]));
  assert.deepEqual(Array.from(r2.next), [7, "rd:3"]);
  assert.equal(r2.dropped, 1);
  // Not asked about → kept; nothing changed → nothing dropped.
  assert.equal(reconcileTicks(sel, [PLAIN, SPLIT], new Map()).dropped, 0);
  assert.equal(reconcileTicks(sel, [PLAIN, SPLIT], new Map([[18648, SPLIT]])).dropped, 0);
  // A plain tick on a bill that is split now → dropped (its invoices tick one by one).
  assert.equal(reconcileTicks(new Set([18648]), [{ orderId: 18648 }], new Map([[18648, SPLIT]])).dropped, 1);
});

test("label: a PARTLY ticked split OBD → '1 OBD · 2 of 4 invoices'", () => {
  const all = ["I716", "I713", "I714", "I715"].map((invoiceNo) => ({ invoiceNo }));
  const two = { invoiceNo: "I716", invoiceRows: [all[0], all[2]], invoiceRowsAll: all };
  assert.equal(selectionCountLabel([two]), "1 OBD · 2 of 4 invoices");
  assert.equal(selectionCountLabel([two, r("I2"), r(null)]), "3 OBDs · 3 of 5 invoices + 1 not invoiced");
  // Every invoice ticked → the Phase 4 label, unchanged.
  assert.equal(selectionCountLabel([{ invoiceNo: "I716", invoiceRows: all }]), "1 OBD · 4 invoices");
});
