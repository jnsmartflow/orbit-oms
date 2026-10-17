// lib/order-invoices/trip-link.test.ts — npx tsx --test lib/order-invoices/trip-link.test.ts
//
// Phase 3 commit 2 (Schema v27.66): the derived OBD trip rule, the whole-OBD
// trip move plan, and which invoice row a new copy / re-delivery / CI names.
// Pure — no database. Fixture: order 18648 (rows 17010 / 36798 / 36799 / 36800)
// and trip L-261006-05's stop 2478.

import test from "node:test";
import assert from "node:assert/strict";
import { deriveObdTripDropId, derivePartlyOnTrip, needsDerivedRepair, planRowsTripMove, planWholeObdTripMove, type TripLinkRow } from "./trip-link";
import { linkRowFor, recordObdOf, recordsOfObds } from "./links";

const rows18648 = (drops: (number | null)[]): TripLinkRow[] =>
  [17010, 36798, 36799, 36800].map((id, i) => ({ id, seq: i + 1, tripDropId: drops[i] }));

// ── deriveObdTripDropId ──────────────────────────────────────────────────────

test("derived: no row on a trip → null", () => {
  assert.equal(deriveObdTripDropId(rows18648([null, null, null, null])), null);
  assert.equal(deriveObdTripDropId([]), null);
});

test("derived: an unsplit OBD is its seq-1 row", () => {
  assert.equal(deriveObdTripDropId([{ seq: 1, tripDropId: 2478 }]), 2478);
});

test("derived: the LOWEST seq that has a stop wins, not seq 1 and not the first in the list", () => {
  // Phase 5 shape: 713 + 715 on L-261007-20's stop 2763, 716 + 714 off.
  assert.equal(deriveObdTripDropId(rows18648([null, 2763, null, 2763])), 2763);
  // Rows on two stops: seq 2's beats seq 4's, whatever the list order.
  const mixed = rows18648([null, 2763, null, 2478]).reverse();
  assert.equal(deriveObdTripDropId(mixed), 2763);
});

// ── planWholeObdTripMove ─────────────────────────────────────────────────────

test("move onto a stop: every row updated, OBD derived to that stop", () => {
  assert.deepEqual(planWholeObdTripMove(rows18648([null, null, null, null]), 2478), {
    rowIdsToUpdate: [17010, 36798, 36799, 36800],
    derived: 2478,
    partlyOnTrip: false,
    noRows: false,
  });
});

test("move off any trip: every row cleared, OBD derived to null", () => {
  assert.deepEqual(planWholeObdTripMove(rows18648([2478, 2478, 2478, 2478]), null), {
    rowIdsToUpdate: [17010, 36798, 36799, 36800],
    derived: null,
    partlyOnTrip: false,
    noRows: false,
  });
});

test("rows already on the target are not re-written (a retry after a half-failure)", () => {
  // A dead press left the rows on 2478 and orders off it: the retry writes no
  // row and lands only the orders update.
  const plan = planWholeObdTripMove(rows18648([2478, 2478, 2478, 2478]), 2478);
  assert.deepEqual(plan.rowIdsToUpdate, []);
  assert.equal(plan.derived, 2478);
});

test("rows that drifted apart are all brought onto the target", () => {
  const plan = planWholeObdTripMove(rows18648([2478, null, 2763, 2478]), 2478);
  assert.deepEqual(plan.rowIdsToUpdate, [36798, 36799]);
  assert.equal(plan.derived, 2478);
});

test("an OBD with no invoice rows: orders written alone with the target, flagged", () => {
  assert.deepEqual(planWholeObdTripMove([], 2478), { rowIdsToUpdate: [], derived: 2478, partlyOnTrip: false, noRows: true });
  assert.deepEqual(planWholeObdTripMove([], null), { rowIdsToUpdate: [], derived: null, partlyOnTrip: false, noRows: true });
});

// ── linkRowFor ───────────────────────────────────────────────────────────────

const UNSPLIT = { seq1Id: 500, split: false };
const SPLIT = { seq1Id: 17010, split: true };

test("link: an unsplit OBD → seq 1 for copy, re-delivery and CI", () => {
  assert.equal(linkRowFor(UNSPLIT, "copy"), 500);
  assert.equal(linkRowFor(UNSPLIT, "redelivery"), 500);
  assert.equal(linkRowFor(UNSPLIT, "ci"), 500);
});

test("link: a split OBD → seq 1 for a copy or re-delivery (one row per trip + OBD until PART 7)", () => {
  assert.equal(linkRowFor(SPLIT, "copy"), 17010);
  assert.equal(linkRowFor(SPLIT, "redelivery"), 17010);
});

test("link: a split OBD → NULL for a CI (a whole-OBD CI on seq 1 would mark the wrong row returned)", () => {
  assert.equal(linkRowFor(SPLIT, "ci"), null);
});

test("link: no seq-1 row → NULL for every kind", () => {
  for (const kind of ["copy", "redelivery", "ci"] as const) {
    assert.equal(linkRowFor({ seq1Id: null, split: false }, kind), null);
  }
});

// ── linkRowFor on a trip (P5-4) ──────────────────────────────────────────────

// 18648 with 713 (36798) + 715 (36800) on trip 668, 716 + 714 off any trip.
const SPLIT_ON = {
  seq1Id: 17010,
  split: true,
  rows: [
    { id: 36800, seq: 4, tripId: 668 },
    { id: 17010, seq: 1, tripId: null },
    { id: 36798, seq: 2, tripId: 668 },
    { id: 36799, seq: 3, tripId: null },
  ],
};

test("link on a trip: a split OBD → its LOWEST-seq row on that trip, whatever the list order", () => {
  assert.equal(linkRowFor(SPLIT_ON, "copy", 668), 36798);
  assert.equal(linkRowFor(SPLIT_ON, "redelivery", 668), 36798);
});

test("link on a trip: no row of a split OBD on that trip, or no trip → seq 1", () => {
  assert.equal(linkRowFor(SPLIT_ON, "copy", 605), 17010);
  assert.equal(linkRowFor(SPLIT_ON, "redelivery", null), 17010);
  assert.equal(linkRowFor(SPLIT, "copy", 668), 17010); // rows unknown
});

test("link on a trip: unsplit is always seq 1, CI on a split OBD always NULL", () => {
  const one = { seq1Id: 500, split: false, rows: [{ id: 500, seq: 1, tripId: 605 }] };
  assert.equal(linkRowFor(one, "copy", 605), 500);
  assert.equal(linkRowFor(one, "copy", 668), 500);
  assert.equal(linkRowFor(SPLIT_ON, "ci", 668), null);
});

// ── recordObdOf / recordsOfObds (P5-4 readers) ──────────────────────────────

test("record: the OBD comes through the invoice row; orderId only when the key is NULL", () => {
  assert.equal(recordObdOf({ orderId: 18648, orderInvoice: { orderId: 18648 } }), 18648);
  assert.equal(recordObdOf({ orderId: 1, orderInvoice: { orderId: 18648 } }), 18648);
  assert.equal(recordObdOf({ orderId: 18648, orderInvoice: null }), 18648);
});

test("record: the where reaches records through the invoice row, never orderId", () => {
  assert.deepEqual(recordsOfObds([18648, 7]), { orderInvoice: { orderId: { in: [18648, 7] } } });
});

// ── planRowsTripMove (Phase 5 commit 2 — setRowsTrip's plan) ────────────────

// Rows with the trip of their stop: 2478 is on trip 605, 2763 on trip 668.
const TRIP_OF: Record<number, number> = { 2478: 605, 2763: 668 };
const placed = (drops: (number | null)[]): TripLinkRow[] =>
  rows18648(drops).map((r) => ({ ...r, tripId: r.tripDropId === null ? null : TRIP_OF[r.tripDropId] }));

test("rows: an unsplit OBD moves exactly as the whole-OBD plan did", () => {
  const one: TripLinkRow[] = [{ id: 500, seq: 1, tripDropId: null, tripId: null }];
  assert.deepEqual(planRowsTripMove(one, "all", 2478), { rowIdsToUpdate: [500], derived: 2478, partlyOnTrip: false, noRows: false });
  assert.deepEqual(planRowsTripMove(one, "all", 2478), planWholeObdTripMove(one, 2478));
  const on: TripLinkRow[] = [{ id: 500, seq: 1, tripDropId: 2478, tripId: 605 }];
  assert.deepEqual(planRowsTripMove(on, "all", null, { onlyFromTripId: 605 }), { rowIdsToUpdate: [500], derived: null, partlyOnTrip: false, noRows: false });
});

test("rows: PARTIAL add — 713 + 715 onto stop 2763; the OBD's stop is the lowest seq with one (713's)", () => {
  assert.deepEqual(planRowsTripMove(placed([null, null, null, null]), [36798, 36800], 2763), {
    rowIdsToUpdate: [36798, 36800],
    derived: 2763,
    partlyOnTrip: true,
    noRows: false,
  });
});

test("rows: derived is recomputed from ALL rows, not from the moved ones", () => {
  // 716 already on 2478; 715 joins 2763 → seq 1's stop still wins.
  const plan = planRowsTripMove(placed([2478, null, null, null]), [36800], 2763);
  assert.deepEqual(plan.rowIdsToUpdate, [36800]);
  assert.equal(plan.derived, 2478);
});

test("rows: PARTIAL remove — 715 off; 713 stays, the OBD stays on its stop", () => {
  const plan = planRowsTripMove(placed([null, 2763, null, 2763]), [36800], null, { onlyFromTripId: 668 });
  assert.deepEqual(plan, { rowIdsToUpdate: [36800], derived: 2763, partlyOnTrip: true, noRows: false });
});

test("rows: onlyFromTripId never strips a row on ANOTHER trip (remove / cancel of trip 668)", () => {
  const plan = planRowsTripMove(placed([2478, 2763, null, 2763]), "all", null, { onlyFromTripId: 668 });
  assert.deepEqual(plan.rowIdsToUpdate, [36798, 36800]);
  // 716 is still on 2478 (trip 605) — the OBD now derives to it.
  assert.equal(plan.derived, 2478);
  // Cancelling trip 605 instead leaves 713 + 715 on 668.
  const other = planRowsTripMove(placed([2478, 2763, null, 2763]), "all", null, { onlyFromTripId: 605 });
  assert.deepEqual(other, { rowIdsToUpdate: [17010], derived: 2763, partlyOnTrip: true, noRows: false });
});

test("rows: onlyFromTripId with no row on that trip moves nothing; derived is the rows' own", () => {
  assert.deepEqual(planRowsTripMove(placed([2478, null, null, null]), "all", null, { onlyFromTripId: 668 }), {
    rowIdsToUpdate: [],
    derived: 2478,
    partlyOnTrip: true,
    noRows: false,
  });
});

test("rows: RETRY AFTER A FAILED HALF-WRITE converges — no row re-written, orders gets the derived stop", () => {
  // Add died after the rows: 713 + 715 on 2763, orders.tripDropId still null.
  const rows = placed([null, 2763, null, 2763]);
  assert.equal(needsDerivedRepair(rows, { tripDropId: null, partlyOnTrip: false }), true);
  const retry = planRowsTripMove(rows, [36798, 36800], 2763);
  assert.deepEqual(retry, { rowIdsToUpdate: [], derived: 2763, partlyOnTrip: true, noRows: false });
  // The route's repair call (no rows chosen) lands the same derived stop.
  assert.equal(planRowsTripMove(rows, [], null).derived, 2763);
  assert.deepEqual(planRowsTripMove(rows, [], null).rowIdsToUpdate, []);
  assert.equal(needsDerivedRepair(rows, { tripDropId: 2763, partlyOnTrip: true }), false);

  // Remove died after the rows: rows already off trip 668, orders still on 2763.
  const off = placed([null, null, null, null]);
  assert.equal(needsDerivedRepair(off, { tripDropId: 2763, partlyOnTrip: true }), true);
  assert.deepEqual(planRowsTripMove(off, "all", null, { onlyFromTripId: 668 }), { rowIdsToUpdate: [], derived: null, partlyOnTrip: false, noRows: false });
});

test("rows: ids that are not the OBD's rows are ignored by the plan", () => {
  assert.deepEqual(planRowsTripMove(placed([null, null, null, null]), [999], 2763).rowIdsToUpdate, []);
});

test("rows: an OBD with no rows → orders written alone with the target, flagged", () => {
  assert.deepEqual(planRowsTripMove([], [1], 2478), { rowIdsToUpdate: [], derived: 2478, partlyOnTrip: false, noRows: true });
  assert.equal(needsDerivedRepair([], { tripDropId: 2478, partlyOnTrip: false }), false);
});

// ── "partlyOnTrip" (v27.69 — the dual-written flag) ──────────────────────────

test("partly: only some rows on a stop; unsplit, all-on and all-off are false", () => {
  assert.equal(derivePartlyOnTrip(rows18648([null, 2763, null, 2763])), true);
  assert.equal(derivePartlyOnTrip(rows18648([2763, 2763, 2763, 2763])), false);
  assert.equal(derivePartlyOnTrip(rows18648([null, null, null, null])), false);
  assert.equal(derivePartlyOnTrip([{ seq: 1, tripDropId: 2478 }]), false);
  assert.equal(derivePartlyOnTrip([]), false);
  // On two different stops, none off: not partly (every invoice is on a truck).
  assert.equal(derivePartlyOnTrip(rows18648([2478, 2763, 2478, 2763])), false);
});

test("partly: the last off-trip invoice joining clears the flag; the first leaving sets it", () => {
  assert.equal(planRowsTripMove(placed([null, 2763, 2763, 2763]), [17010], 2763).partlyOnTrip, false);
  assert.equal(planRowsTripMove(placed([2763, 2763, 2763, 2763]), [36800], null, { onlyFromTripId: 668 }).partlyOnTrip, true);
});

test("repair: a stale FLAG alone (stop right) still needs the orders write", () => {
  const rows = placed([null, 2763, null, 2763]);
  assert.equal(needsDerivedRepair(rows, { tripDropId: 2763, partlyOnTrip: false }), true);
});
