// lib/order-invoices/ship-to.test.ts — npx tsx --test lib/order-invoices/ship-to.test.ts
//
// Per-part ship-to (Schema v27.81, 2026-11-19): the pure rules of the part
// writer — the four columns each target writes, "unchanged", the log labels
// and the refusals (C.1 step 0). No database is touched: only pure functions
// are called (the module's Prisma client is lazy and never connects here).

import test from "node:test";
import assert from "node:assert/strict";
import {
  PART_CHANGED,
  PART_NOT_SPLIT,
  isPartUnchanged,
  partColumns,
  partShipToRefusal,
  partStateLabel,
  type PartShipToFacts,
} from "./ship-to";

const FACTS: PartShipToFacts = {
  obdNumber: "9110835499",
  isRemoved: false,
  workflowStage: "pending_support",
  dispatchStatus: "dispatch",
  rowCount: 2,
  label: "I536233980 part 2 of 2",
  row: { isDispatched: false, isHeld: false, tripDropId: null },
  trip: null,
  ci: null,
};

test("partColumns: dealer / typed / reset (own SAP site) / inherit", () => {
  assert.deepEqual(partColumns({ kind: "dealer", customerId: 42 }), {
    shipToOverride: true,
    shipToOverrideCustomerId: 42,
    shipToText: null,
    shipToAreaId: null,
  });
  assert.deepEqual(partColumns({ kind: "typed", text: "  Site at Pal ", areaId: 7 }), {
    shipToOverride: true,
    shipToOverrideCustomerId: null,
    shipToText: "Site at Pal",
    shipToAreaId: 7,
  });
  assert.deepEqual(partColumns({ kind: "reset" }), {
    shipToOverride: false,
    shipToOverrideCustomerId: null,
    shipToText: null,
    shipToAreaId: null,
  });
  assert.deepEqual(partColumns({ kind: "inherit" }), {
    shipToOverride: null,
    shipToOverrideCustomerId: null,
    shipToText: null,
    shipToAreaId: null,
  });
});

test("isPartUnchanged: inherit on an inheriting row is a no-op; reset is NOT inherit", () => {
  const inheriting = partColumns({ kind: "inherit" });
  assert.equal(isPartUnchanged(inheriting, partColumns({ kind: "inherit" })), true);
  assert.equal(isPartUnchanged(inheriting, partColumns({ kind: "reset" })), false);
  assert.equal(isPartUnchanged(partColumns({ kind: "dealer", customerId: 42 }), partColumns({ kind: "dealer", customerId: 42 })), true);
});

test("partStateLabel: inherit / site / dealer id / typed", () => {
  assert.equal(partStateLabel(partColumns({ kind: "inherit" })), "inherit");
  assert.equal(partStateLabel(partColumns({ kind: "reset" })), "site");
  assert.equal(partStateLabel(partColumns({ kind: "dealer", customerId: 42 })), "42");
  assert.equal(partStateLabel(partColumns({ kind: "typed", text: "x", areaId: 1 })), "typed");
});

test("refusals: a part that may change → null", () => {
  assert.equal(partShipToRefusal(FACTS), null);
});

test("refusals: removed / cancelled / dispatched bill / challan-linked / not split", () => {
  assert.deepEqual(partShipToRefusal({ ...FACTS, isRemoved: true }), { status: 404, error: "Order not found" });
  assert.deepEqual(partShipToRefusal({ ...FACTS, workflowStage: "cancelled" }), { status: 409, error: "This bill is cancelled" });
  assert.deepEqual(partShipToRefusal({ ...FACTS, workflowStage: "dispatched" }), { status: 409, error: "This bill has already been dispatched" });
  assert.deepEqual(partShipToRefusal({ ...FACTS, workflowStage: "challan_linked" }), {
    status: 409,
    error: "9110835499 is billed against a challan order — its goods already went out on the challan. It never goes on a trip.",
  });
  // Owner Q8: any OBD with 2+ rows — one row is "not split".
  assert.deepEqual(partShipToRefusal({ ...FACTS, rowCount: 1 }), { status: 409, error: PART_NOT_SPLIT });
});

test("refusals: the part itself — dispatched, returned on a CI", () => {
  assert.match(partShipToRefusal({ ...FACTS, row: { ...FACTS.row, isDispatched: true } })!.error, /part 2 of 2 is dispatched/);
  assert.match(partShipToRefusal({ ...FACTS, ci: { ciNumber: "CI-0042" } })!.error, /returned on CI-0042/);
  assert.match(partShipToRefusal({ ...FACTS, ci: { ciNumber: null } })!.error, /returned on a CI/);
});

test("refusals: on a trip — cancelled trip, held part, a stop that vanished; held OFF a trip is fine", () => {
  const onTrip = { ...FACTS, row: { ...FACTS.row, tripDropId: 3001 }, trip: { status: "planned", tripNumber: "L-261119-02" } };
  assert.equal(partShipToRefusal(onTrip), null);
  assert.equal(partShipToRefusal({ ...onTrip, trip: { status: "cancelled", tripNumber: "L-261119-02" } })!.error, "Cannot change the bills on a cancelled trip.");
  assert.match(partShipToRefusal({ ...onTrip, row: { ...onTrip.row, isHeld: true } })!.error, /is on hold — release it first/);
  assert.equal(partShipToRefusal({ ...onTrip, trip: null })!.error, PART_CHANGED);
  assert.equal(partShipToRefusal({ ...FACTS, row: { ...FACTS.row, isHeld: true } }), null);
});
