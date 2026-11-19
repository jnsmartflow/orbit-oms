// lib/order-invoices/trip-read.test.ts — npx tsx --test lib/order-invoices/trip-read.test.ts
//
// Phase 3 readers A (Schema v27.66): how trip code places an OBD on a trip
// through its invoice rows. Pure — no database. Fixture: order 18648 and the
// stops of trips 605 (L-261006-05: 2478, 2479) and 668 (L-261007-20: 2763).

import test from "node:test";
import assert from "node:assert/strict";
import { deriveObdTripDropId, placeOnStops, placeOnTrips, type StopRow } from "./trip-read";

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

// ── PER-PART SHIP-TO (v27.81, batch 3): placeOnStops ─────────────────────────

const withIds = (o: { id: number; obdNumber: string; invoices: StopRow[] }) => ({
  ...o,
  invoices: o.invoices.map((r) => ({ ...r, id: o.id * 100 + r.seq })),
});
/** placeOnStops' entry without the row lists — what placeOnTrips returns. */
const bare = <E extends { rowIds: number[]; seqs: number[] }>(e: E) => {
  const { rowIds: _r, seqs: _s, ...rest } = e;
  return rest;
};
const byTripThenId = (a: { tripId: number; id: number }, b: { tripId: number; id: number }) => a.tripId - b.tripId || a.id - b.id;

test("placeOnStops IDENTITY: every OBD at ONE stop per trip (every part inherits) → exactly placeOnTrips' entries", () => {
  const orders = [
    withIds(obd(1, [[1, 2478]])),
    withIds(obd(18648, [[1, 2478], [2, 2478], [3, 2478], [4, 2478]])),
    withIds(obd(7, [[1, 2478], [2, 2763]])), // on two TRIPS (legal today — 4 live)
    withIds(obd(9, [[1, null], [2, 2763]])),
  ];
  const stops = placeOnStops(orders, TRIP_OF).map(bare).sort(byTripThenId);
  const trips = placeOnTrips(orders, TRIP_OF).slice().sort(byTripThenId);
  assert.deepEqual(stops, trips);
});

test("placeOnStops: 9110835499's parts at TWO stops of ONE trip → two entries, each with ITS rows (rule 4)", () => {
  // 2478 = the bill's shop, 2479 = part 2's own shop, both on trip 605.
  const tripOf = new Map([...Array.from(TRIP_OF.entries()), [2479, 605] as [number, number]]);
  const out = placeOnStops([withIds(obd(25130, [[1, 2478], [2, 2479]]))], tripOf);
  assert.deepEqual(
    out.map((e) => ({ tripId: e.tripId, tripDropId: e.tripDropId, rowIds: e.rowIds, seqs: e.seqs })),
    [
      { tripId: 605, tripDropId: 2478, rowIds: [2513001], seqs: [1] },
      { tripId: 605, tripDropId: 2479, rowIds: [2513002], seqs: [2] },
    ],
  );
  // placeOnTrips still answers "is it on trip 605" once, at the lowest seq's stop.
  assert.deepEqual(placeOnTrips([withIds(obd(25130, [[1, 2478], [2, 2479]]))], tripOf).map((e) => e.tripDropId), [2478]);
});

test("placeOnStops: rows on stops outside the map are ignored", () => {
  assert.deepEqual(placeOnStops([withIds(obd(3, [[1, 9999]]))], TRIP_OF), []);
});
