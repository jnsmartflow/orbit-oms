// lib/order-invoices/trip-refusal.test.ts — npx tsx --test lib/order-invoices/trip-refusal.test.ts
//
// Phase 5 commit 2: the "on a trip" refusal, built from the invoice rows. Pure.

import test from "node:test";
import assert from "node:assert/strict";
import { invoiceTripsOf, onTripMessage, type InvoiceTrip } from "./trip-refusal";

const off: InvoiceTrip = { tripDropId: null, tripNumber: null };
const l02: InvoiceTrip = { tripDropId: 7, tripNumber: "L-261015-02" };
const l05: InvoiceTrip = { tripDropId: 9, tripNumber: "L-261015-05" };

test("unsplit / no rows passed: today's sentence from the OBD's own pointer", () => {
  assert.equal(onTripMessage({ tripDropId: 7, tripNumber: "L-261015-02" }), "On trip L-261015-02 — remove it from the trip first");
  assert.equal(onTripMessage({ tripDropId: 7, tripNumber: null }), "On trip (unknown) — remove it from the trip first");
  assert.equal(onTripMessage({ tripDropId: null, tripNumber: null }), null);
  assert.equal(onTripMessage({}), null);
  // One row is not split: the OBD's pointer decides, as before.
  assert.equal(onTripMessage({ tripDropId: 7, tripNumber: "L-261015-02", invoiceTrips: [l02] }), "On trip L-261015-02 — remove it from the trip first");
});

test("split, every invoice on one trip: today's sentence", () => {
  assert.equal(onTripMessage({ tripDropId: 7, tripNumber: "L-261015-02", invoiceTrips: [l02, l02, l02, l02] }), "On trip L-261015-02 — remove it from the trip first");
});

test("split, SOME invoices on a trip: how many and where", () => {
  assert.equal(
    onTripMessage({ tripDropId: 7, tripNumber: "L-261015-02", invoiceTrips: [off, l02, off, l02] }),
    "2 of 4 invoices on L-261015-02 — remove them from the trip first",
  );
  assert.equal(
    onTripMessage({ tripDropId: 7, tripNumber: "L-261015-02", invoiceTrips: [off, off, l02] }),
    "1 of 3 invoices on L-261015-02 — remove it from the trip first",
  );
});

test("split, invoices on TWO trips", () => {
  assert.equal(
    onTripMessage({ tripDropId: 7, tripNumber: "L-261015-02", invoiceTrips: [off, l02, off, l05] }),
    "1 of 4 invoices on L-261015-02, 1 on L-261015-05 — remove them from the trips first",
  );
});

test("split, no invoice on a trip: allowed, whatever the stale OBD pointer says (the rows are the truth)", () => {
  assert.equal(onTripMessage({ tripDropId: 7, tripNumber: "L-261015-02", invoiceTrips: [off, off, off, off] }), null);
});

test("invoiceTripsOf maps the select's rows", () => {
  assert.deepEqual(
    invoiceTripsOf([{ tripDropId: null, tripDrop: null }, { tripDropId: 7, tripDrop: { trip: { tripNumber: "L-261015-02" } } }]),
    [off, l02],
  );
});
