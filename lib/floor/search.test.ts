// lib/floor/search.test.ts — npx tsx --test lib/floor/search.test.ts
//
// Split load phase 4 batch 4: the Floor search names every truck part. Pure —
// no database. Fixture: order 22179 / OBD 9110345576, I536233980 part 1
// (row 40777, L-261024-22) and part 2 (row 41213, L-261024-23).

import test from "node:test";
import assert from "node:assert/strict";
import { applySearch, litSeqsOf, parseSearch, partHitsOf, partTargetOf, searchRowSelector, tripSearchHitsOf, type ParsedSearch, type TripSearchRow } from "./search";
import { loadPartText } from "@/lib/order-invoices/load-plan";
import type { FloorSearchHit, FloorSearchPart } from "./types";

const trip = (id: number, number: string): NonNullable<FloorSearchHit["trip"]> => ({ id, number, date: "2026-10-24", status: "released", onLiveDesk: false });
const PART1: FloorSearchPart = { id: 40777, seq: 1, k: 1, n: 2, invoiceNo: "I536233980", target: "trip", trip: trip(1295, "L-261024-22") };
const PART2: FloorSearchPart = { id: 41213, seq: 2, k: 2, n: 2, invoiceNo: "I536233980", target: "trip", trip: trip(1296, "L-261024-23") };
const HIT: FloorSearchHit = {
  orderId: 22179,
  obdNumber: "9110345576",
  invoiceNo: "I536233980",
  matchedInvoiceSeq: 1,
  soNumber: "1047176752",
  dealer: "SIDDHIVINAYAK ELEMTNS",
  workflowStage: "pick_checked",
  dispatchStatus: "dispatch",
  target: "trip",
  trip: trip(1295, "L-261024-22"),
  cis: [],
  cancelRow: null,
};

test("searchRowSelector: one seq → the exact selector the page built before; several → every part", () => {
  assert.equal(searchRowSelector(22179, null), `[data-order-id="22179"]`);
  assert.equal(
    searchRowSelector(18648, [2]),
    `[data-order-id="18648"][data-invoice-seq="2"], [data-order-id="18648"]:not([data-invoice-seq])`,
  );
  assert.equal(
    searchRowSelector(22179, [1, 2]),
    `[data-order-id="22179"][data-invoice-seq="1"], [data-order-id="22179"][data-invoice-seq="2"], [data-order-id="22179"]:not([data-invoice-seq])`,
  );
});

test("litSeqsOf: a hit without parts lights what it did before; with parts, every part", () => {
  assert.deepEqual(litSeqsOf(HIT), [1]);
  assert.equal(litSeqsOf({ ...HIT, matchedInvoiceSeq: null }), null);
  assert.deepEqual(litSeqsOf({ ...HIT, parts: [PART1, PART2] }), [1, 2]);
});

test("partHitsOf: an unsplit / Add-invoices hit (no parts) is returned untouched", () => {
  const out = partHitsOf(HIT);
  assert.equal(out.length, 1);
  assert.equal(out[0], HIT);
});

test("partHitsOf: parts on different trips → one choice per part, each its own trip and seq", () => {
  const out = partHitsOf({ ...HIT, parts: [PART1, PART2] });
  assert.deepEqual(out.map((h) => [h.part?.id, h.target, h.trip?.number, h.matchedInvoiceSeq]), [
    [40777, "trip", "L-261024-22", 1],
    [41213, "trip", "L-261024-23", 2],
  ]);
  assert.ok(out.every((h) => h.parts === undefined));
  // The words the strip prints (search-box.tsx): number + loadPartText + place.
  assert.equal(`${out[1].part!.invoiceNo} ${loadPartText(out[1].part!.k, out[1].part!.n)} · ${out[1].trip!.number}`, "I536233980 part 2 of 2 · L-261024-23");
});

test("partHitsOf: every part in ONE place (both in To plan) stays one hit — both lit there", () => {
  const pool = (p: FloorSearchPart): FloorSearchPart => ({ ...p, target: "floor", trip: null });
  const hit = { ...HIT, target: "floor" as const, trip: null, parts: [pool(PART1), pool(PART2)] };
  assert.deepEqual(partHitsOf(hit), [hit]);
});

test("partTargetOf: the hit's precedence, per part", () => {
  assert.equal(partTargetOf("cancel_ci", { isHeld: false, onLiveTrip: true }), "cancel_ci");
  assert.equal(partTargetOf("hold", { isHeld: false, onLiveTrip: true }), "hold");
  assert.equal(partTargetOf("trip", { isHeld: true, onLiveTrip: false }), "hold");
  assert.equal(partTargetOf("trip", { isHeld: false, onLiveTrip: true }), "trip");
  assert.equal(partTargetOf("trip", { isHeld: false, onLiveTrip: false }), "floor"); // part 1 on a trip, this one waiting
  assert.equal(partTargetOf("tinting", { isHeld: false, onLiveTrip: false }), "tinting");
});

// ── Hotfix 2026-10-26: the strip's trip lines / rail narrowing per truck part ──

const TRIPS = [
  { id: 1295, tripNumber: "L-261024-22", status: "released" },
  { id: 1296, tripNumber: "L-261024-23", status: "released" },
  { id: 605, tripNumber: "L-261006-05", status: "dispatched" },
  { id: 900, tripNumber: "L-261020-05", status: "released" },
  { id: 901, tripNumber: "L-261020-09", status: "cancelled" },
];
const byNumber = (n: string) => TRIPS.find((t) => t.tripNumber === n);

/** The old floor-page.tsx tripHitsFor, verbatim — the unchanged path must match it. */
function oldTripHits(rows: TripSearchRow[], parsed: ParsedSearch) {
  if (parsed.mode === "none") return [];
  const byId = new Map<number, { tripId: number; tripNumber: string; count: number }>();
  for (const r of applySearch(rows, parsed)) {
    if (r.tripDropId === null || !r.tripNumber) continue;
    const t = byNumber(r.tripNumber);
    if (!t || t.status === "cancelled") continue;
    const hit = byId.get(t.id) ?? { tripId: t.id, tripNumber: t.tripNumber, count: 0 };
    hit.count++;
    byId.set(t.id, hit);
  }
  return Array.from(byId.values());
}

const base = (over: Partial<TripSearchRow>): TripSearchRow => ({
  orderId: 1,
  obdNumber: "9110000001",
  dealerName: "Dealer",
  route: null,
  invoiceNo: null,
  soNumber: null,
  dealerInMaster: true,
  tripDropId: null,
  tripNumber: null,
  ...over,
});
const LOAD_ROW = base({
  orderId: 22179,
  obdNumber: "9110345576",
  dealerName: "SIDDHIVINAYAK ELEMTNS",
  invoiceNo: "I536233980",
  soNumber: "1047176752",
  tripDropId: 5815,
  tripNumber: "L-261024-22", // the OBD's derived stop = part 1's
  invoiceRows: [
    { id: 40777, invoiceNo: "I536233980", tripNumber: "L-261024-22", loadRootId: 40777 },
    { id: 41213, invoiceNo: "I536233980", tripNumber: "L-261024-23", loadRootId: 40777 },
  ],
});
const ADD_ROW = base({
  orderId: 18648,
  obdNumber: "9109951956",
  invoiceNo: "I536230716",
  tripDropId: 2600,
  tripNumber: "L-261020-05",
  invoiceRows: [
    { id: 17010, invoiceNo: "I536230716", tripNumber: "L-261020-05" },
    { id: 36798, invoiceNo: "I536230713", tripNumber: "L-261006-05" },
    { id: 36799, invoiceNo: "I536230714", tripNumber: "L-261020-05" },
    { id: 36800, invoiceNo: "I536230715", tripNumber: "L-261006-05" },
  ],
});
const PLAIN = [
  base({ orderId: 2, obdNumber: "9110400001", invoiceNo: "I536234342", tripDropId: 10, tripNumber: "L-261024-22" }),
  base({ orderId: 3, obdNumber: "9110400002", invoiceNo: "I536234343", tripDropId: 11, tripNumber: "L-261020-09" }), // cancelled trip
  base({ orderId: 4, obdNumber: "9110400003", invoiceNo: "I536234344" }), // in To plan
  base({ orderId: 5, obdNumber: "9110400004", invoiceNo: "I536234345", tripDropId: 12, tripNumber: "L-999999-99" }), // not on this desk
];

test("tripSearchHitsOf: I536233980 → BOTH trucks' trips, one bill each (text, numbers and OBD)", () => {
  const want = [
    { tripId: 1295, tripNumber: "L-261024-22", count: 1 },
    { tripId: 1296, tripNumber: "L-261024-23", count: 1 },
  ];
  for (const q of ["I536233980", "536233980", "33980", "9110345576", "siddhivinayak"]) {
    assert.deepEqual(tripSearchHitsOf([LOAD_ROW, ...PLAIN], byNumber, parseSearch(q)), want, q);
  }
  // The old rule saw only part 1's trip — the bug.
  assert.deepEqual(oldTripHits([LOAD_ROW], parseSearch("I536233980")), [want[0]]);
});

test("tripSearchHitsOf: unsplit bills — exactly the old output", () => {
  for (const q of ["I536234342", "234342", "9110400001", "9110400002", "I536234344", "9110400004", "dealer", "", "nothing"]) {
    assert.deepEqual(tripSearchHitsOf(PLAIN, byNumber, parseSearch(q)), oldTripHits(PLAIN, parseSearch(q)), q);
  }
});

test("tripSearchHitsOf: 18648 (Add invoices) — exactly the old output, its derived trip only", () => {
  for (const q of ["I536230716", "I536230713", "30715", "9109951956", "dealer"]) {
    assert.deepEqual(tripSearchHitsOf([ADD_ROW, ...PLAIN], byNumber, parseSearch(q)), oldTripHits([ADD_ROW, ...PLAIN], parseSearch(q)), q);
  }
  assert.deepEqual(tripSearchHitsOf([ADD_ROW], byNumber, parseSearch("I536230713")), [{ tripId: 900, tripNumber: "L-261020-05", count: 1 }]);
});
