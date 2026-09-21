// lib/trips/load-plan-check.test.ts — Node's built-in runner through tsx:
//   npx tsx --test lib/trips/load-plan-check.test.ts
//
// The Load plan check's comparison, on hand-made days. No rates anywhere.

import test from "node:test";
import assert from "node:assert/strict";
import {
  actualTypeOf,
  compareDay,
  differenceText,
  parseSnapshotCards,
  snapshotCards,
  summariseWeek,
  type BillFact,
  type CheckLimits,
  type SnapshotCard,
  type TripFact,
} from "./load-plan-check";
import type { V2Plan } from "./load-plan-v2";

const LIMITS: CheckLimits = {
  ace: { idealKg: 2000, hardKg: 2300 },
  big: { idealKg: 3000, hardKg: 3500 },
  gc: { idealKg: 1500, hardKg: 1650 },
};
const NAVSARI = 1, VIJALPOR = 2, VAPI = 3;
const NAME: Record<number, string> = { [NAVSARI]: "Navsari", [VIJALPOR]: "Vijalpor", [VAPI]: "Vapi" };

function card(cardNo: number, type: SnapshotCard["type"], billIds: number[], kg = 1000, stops = billIds.length): SnapshotCard {
  const vehicle = type === "ace" || type === "big" || type === "gc" ? type : null;
  return { cardNo, type, vehicle, billIds, kg, stops, places: [] };
}
function bills(list: Array<[number, number, number | null, number?]>): Map<number, BillFact> {
  // [billId, areaId, tripId, kg]
  return new Map(list.map(([billId, areaId, tripId, kg]) => [billId, { billId, areaId, areaName: NAME[areaId], kg: kg ?? 300, tripId }] as const));
}
function trip(tripId: number, type: TripFact["type"], places: Array<[number, number]>, stops = places.length): TripFact {
  return { tripId, type, kg: places.reduce((n, p) => n + p[1], 0), stops, places: places.map(([a, kg]) => ({ areaId: a, areaName: NAME[a], kg })) };
}

// The day: Big card A = Navsari 1, 2, 8 + Vijalpor 3 · Ace card B = Vapi 4, 5
// · Hold 6 · Waiting 7. The planner sent Navsari on trip 100 (a Big), and put
// Vijalpor with Vapi on trip 200 (an Ace, 2,100 kg — over the Ace ideal).
// Bill 6 went nowhere; bill 7 (Waiting) went on trip 200 anyway.
const DAY_CARDS = [card(1, "big", [1, 2, 8, 3], 2400, 4), card(2, "ace", [4, 5], 900, 2), card(3, "hold", [6]), card(4, "waiting", [7])];
const DAY_BILLS = bills([
  [1, NAVSARI, 100], [2, NAVSARI, 100], [8, NAVSARI, 100], [3, VIJALPOR, 200],
  [4, VAPI, 200], [5, VAPI, 200], [6, NAVSARI, null], [7, VAPI, 200],
]);
const DAY_TRIPS = new Map<number, TripFact>([
  [100, trip(100, "big", [[NAVSARI, 1500]], 3)],
  [200, trip(200, "ace", [[VIJALPOR, 300], [VAPI, 1800]], 3)],
]);

test("match by bill: a bill matches when most of its card-mates went on its trip", () => {
  const d = compareDay({ cards: DAY_CARDS, bills: DAY_BILLS, trips: DAY_TRIPS, limits: LIMITS });
  // Judged: the sent bills of truck cards = 1, 2, 8, 3, 4, 5. Vijalpor (3) left its card.
  assert.equal(d.bills.judged, 6);
  assert.equal(d.bills.matched, 5);
  assert.equal(Math.round(d.bills.matchPct!), 83);
  assert.deepEqual([d.bills.planned, d.bills.sent, d.bills.notSent], [8, 7, 1]);
});

test("differences name the places: Vijalpor went with Vapi, not Navsari", () => {
  const d = compareDay({ cards: DAY_CARDS, bills: DAY_BILLS, trips: DAY_TRIPS, limits: LIMITS });
  assert.deepEqual(d.differences.map(differenceText), ["Vijalpor went with Vapi, not Navsari"]);
});

test("trucks, stops and overloads: plan vs actual", () => {
  const d = compareDay({ cards: DAY_CARDS, bills: DAY_BILLS, trips: DAY_TRIPS, limits: LIMITS });
  assert.deepEqual(d.trucks.plan, { ace: 1, big: 1, gc: 0, bulk: 0, direct: 0, total: 2 });
  assert.deepEqual(d.trucks.actual, { ace: 1, big: 1, gc: 0, unknown: 0, total: 2 });
  assert.deepEqual(d.stops, { planSum: 6, planTrucks: 2, actualSum: 6, actualTrucks: 2 });
  assert.deepEqual(d.overIdeal, { plan: 0, actual: 1 }); // trip 200: 2,100 kg on an Ace
  assert.deepEqual(d.overHard, { plan: 0, actual: 0 });
});

test("a bill planned alone matches only if its trip holds no bill planned on another card", () => {
  const cards = [card(1, "big", [1]), card(2, "big", [4])];
  const alone = compareDay({
    cards,
    bills: bills([[1, NAVSARI, 100], [4, VAPI, 200]]),
    trips: new Map([[100, trip(100, "big", [[NAVSARI, 300]])], [200, trip(200, "big", [[VAPI, 300]])]]),
    limits: LIMITS,
  });
  assert.equal(alone.bills.matched, 2);
  const joined = compareDay({
    cards,
    bills: bills([[1, NAVSARI, 100], [4, VAPI, 100]]),
    trips: new Map([[100, trip(100, "big", [[NAVSARI, 300], [VAPI, 300]])]]),
    limits: LIMITS,
  });
  assert.equal(joined.bills.matched, 0);
  assert.deepEqual(joined.differences.map(differenceText), ["Navsari went with Vapi, not on its own", "Vapi went with Navsari, not on its own"]);
  assert.equal(joined.trucks.actual.total, 1);
});

test("the week: sums, match over all judged bills, differences counted in days", () => {
  const d = compareDay({ cards: DAY_CARDS, bills: DAY_BILLS, trips: DAY_TRIPS, limits: LIMITS });
  const w = summariseWeek([d, d, d]);
  assert.equal(w.days, 3);
  assert.equal(w.bills.judged, 18);
  assert.equal(w.bills.matched, 15);
  assert.equal(w.trucks.plan.total, 6);
  assert.deepEqual(w.topDifferences, [{ place: "Vijalpor", wentWith: "Vapi", plannedWith: "Navsari", days: 3 }]);
});

test("snapshot cards: the plan's cards as stored rows — bill ids, kg, stops, places, no rates", () => {
  const plan = {
    mode: "suggest",
    cards: [
      { key: "big:c:1", type: "big", vehicle: "big", side: "South", orderIds: [11, 12], stops: [], kg: 2456.78, stopCount: 2, areaNames: ["Navsari"], flags: {}, reason: "x" },
      { key: "bulk:c:2", type: "bulk", side: "South", orderIds: [13], stops: [], kg: 5000, stopCount: 1, areaNames: ["Chikhli"], flags: {}, reason: "y" },
    ],
  } as unknown as V2Plan;
  const rows = snapshotCards(plan);
  assert.deepEqual(rows, [
    { cardNo: 1, type: "big", vehicle: "big", billIds: [11, 12], kg: 2456.8, stops: 2, places: ["Navsari"] },
    { cardNo: 2, type: "bulk", vehicle: null, billIds: [13], kg: 5000, stops: 1, places: ["Chikhli"] },
  ]);
  // A stored value reads back the same; junk is dropped.
  assert.deepEqual(parseSnapshotCards(JSON.parse(JSON.stringify([...rows, { nope: 1 }, null]))), rows);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["billIds", "cardNo", "kg", "places", "stops", "type", "vehicle"]);
});

test("actual vehicle class from vehicle_master.category", () => {
  assert.equal(actualTypeOf("Tata Ace"), "ace");
  assert.equal(actualTypeOf("Tata 407"), "big");
  assert.equal(actualTypeOf("Eicher 14ft"), "big");
  assert.equal(actualTypeOf("Tempo"), "unknown");
  assert.equal(actualTypeOf(null), "unknown");
});
