// lib/order-invoices/trip-link.test.ts — npx tsx --test lib/order-invoices/trip-link.test.ts
//
// Phase 3 commit 2 (Schema v27.66): the derived OBD trip rule, the whole-OBD
// trip move plan, and which invoice row a new copy / re-delivery / CI names.
// Pure — no database. Fixture: order 18648 (rows 17010 / 36798 / 36799 / 36800)
// and trip L-261006-05's stop 2478.

import test from "node:test";
import assert from "node:assert/strict";
import { deriveObdTripDropId, planWholeObdTripMove, type TripLinkRow } from "./trip-link";
import { linkRowFor } from "./links";

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
    noRows: false,
  });
});

test("move off any trip: every row cleared, OBD derived to null", () => {
  assert.deepEqual(planWholeObdTripMove(rows18648([2478, 2478, 2478, 2478]), null), {
    rowIdsToUpdate: [17010, 36798, 36799, 36800],
    derived: null,
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
  assert.deepEqual(planWholeObdTripMove([], 2478), { rowIdsToUpdate: [], derived: 2478, noRows: true });
  assert.deepEqual(planWholeObdTripMove([], null), { rowIdsToUpdate: [], derived: null, noRows: true });
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
