// lib/order-invoices/trip-read.test.ts — npx tsx --test lib/order-invoices/trip-read.test.ts
//
// Phase 3 readers A (Schema v27.66): how trip code places an OBD on a trip
// through its invoice rows. Pure — no database. Fixture: order 18648 and the
// stops of trips 605 (L-261006-05: 2478, 2479) and 668 (L-261007-20: 2763).

import test from "node:test";
import assert from "node:assert/strict";
import { deriveObdTripDropId, placeOnTrips, type StopRow } from "./trip-read";

const TRIP_OF = new Map([
  [2478, 605],
  [2479, 605],
  [2763, 668],
]);

const obd = (id: number, rows: [number, number | null][]) => ({
  id,
  obdNumber: `OBD${id}`,
  invoices: rows.map(([seq, tripDropId]): StopRow => ({ seq, tripDropId })),
});

test("derived: lowest seq with a stop; null when none", () => {
  assert.equal(deriveObdTripDropId([{ seq: 3, tripDropId: 2479 }, { seq: 2, tripDropId: 2478 }]), 2478);
  assert.equal(deriveObdTripDropId([{ seq: 1, tripDropId: null }]), null);
});

test("an unsplit OBD on one stop: once, on that stop", () => {
  assert.deepEqual(placeOnTrips([obd(1, [[1, 2478]])], TRIP_OF), [{ id: 1, obdNumber: "OBD1", tripId: 605, tripDropId: 2478 }]);
});

test("a split OBD with every row on the same stop (today's only shape): ONCE, not once per row", () => {
  const out = placeOnTrips([obd(18648, [[1, 2478], [2, 2478], [3, 2478], [4, 2478]])], TRIP_OF);
  assert.deepEqual(out, [{ id: 18648, obdNumber: "OBD18648", tripId: 605, tripDropId: 2478 }]);
});

test("Phase 5 shape — rows on two stops of ONE trip: once, on the lowest-seq row's stop", () => {
  const out = placeOnTrips([obd(18648, [[1, 2479], [2, 2478], [4, 2478]])], TRIP_OF);
  assert.deepEqual(out, [{ id: 18648, obdNumber: "OBD18648", tripId: 605, tripDropId: 2479 }]);
});

test("Phase 5 shape — rows on two TRIPS: once per trip, each on its own stop", () => {
  const out = placeOnTrips([obd(18648, [[1, null], [2, 2763], [3, null], [4, 2478]])], TRIP_OF);
  assert.deepEqual(out, [
    { id: 18648, obdNumber: "OBD18648", tripId: 668, tripDropId: 2763 },
    { id: 18648, obdNumber: "OBD18648", tripId: 605, tripDropId: 2478 },
  ]);
});

test("rows on stops outside the trips asked about are ignored; an OBD with none drops out", () => {
  assert.deepEqual(placeOnTrips([obd(7, [[1, 9999]]), obd(8, [[1, null]])], TRIP_OF), []);
});

test("input order is kept", () => {
  const out = placeOnTrips([obd(2, [[1, 2478]]), obd(1, [[1, 2763]])], TRIP_OF);
  assert.deepEqual(out.map((o) => o.id), [2, 1]);
});
