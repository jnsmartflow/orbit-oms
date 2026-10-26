// lib/floor/search.test.ts — npx tsx --test lib/floor/search.test.ts
//
// Split load phase 4 batch 4: the Floor search names every truck part. Pure —
// no database. Fixture: order 22179 / OBD 9110345576, I536233980 part 1
// (row 40777, L-261024-22) and part 2 (row 41213, L-261024-23).

import test from "node:test";
import assert from "node:assert/strict";
import { litSeqsOf, partHitsOf, partTargetOf, searchRowSelector } from "./search";
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
