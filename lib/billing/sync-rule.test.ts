// lib/billing/sync-rule.test.ts — npx tsx --test lib/billing/sync-rule.test.ts (npm run test:billing-sync)

import test from "node:test";
import assert from "node:assert/strict";
import {
  SYNC_MAX_IDS,
  parseSyncBody,
  pickDeleteTouched,
  pickingTouched,
  printTouched,
  telephonicTouched,
  type OrderFact,
} from "./sync-rule";

const day = { start: new Date("2026-09-29T18:30:00Z"), end: new Date("2026-09-30T18:30:00Z") };
const fact = (id: number, workflowStage: string, soNumber: string | null = null, invoicedAt: string | null = null): OrderFact => ({
  id,
  soNumber,
  workflowStage,
  invoicedAt: invoicedAt ? new Date(invoicedAt) : null,
});

test("parseSyncBody: absent fields are empty; ids de-duplicated", () => {
  const b = parseSyncBody({ orderIds: [3, 3, 4] });
  assert.ok(typeof b !== "string");
  assert.deepEqual(b.orderIds, [3, 4]);
  assert.deepEqual(b.tripIds, []);
  assert.equal(b.soTagChanged, false);
  assert.deepEqual(b.shown, { pickingIds: [], printTripIds: [], printOrderIds: [], telephonicOrderIds: [], pickDeleteIds: [] });
  assert.ok(typeof parseSyncBody(null) !== "string");
});

test("parseSyncBody: rejects non-integers, negatives, oversize lists and a non-boolean soTagChanged", () => {
  assert.equal(typeof parseSyncBody({ orderIds: [1.5] }), "string");
  assert.equal(typeof parseSyncBody({ tripIds: [-1] }), "string");
  assert.equal(typeof parseSyncBody({ mailOrderIds: "1,2" }), "string");
  assert.equal(typeof parseSyncBody({ shown: { pickingIds: [0] } }), "string");
  assert.equal(typeof parseSyncBody({ shown: { printOrderIds: [2.5] } }), "string");
  assert.equal(typeof parseSyncBody({ orderIds: Array.from({ length: SYNC_MAX_IDS + 1 }, (_, i) => i + 1) }), "string");
  assert.equal(typeof parseSyncBody({ soTagChanged: "yes" }), "string");
});

test("picking: touched by a checked / dispatched / cancelled bill or an invoicedAt today; not by other stages", () => {
  assert.equal(pickingTouched([fact(1, "pending_picking")], [], [1], day), false);
  assert.equal(pickingTouched([fact(1, "pick_checked")], [], [1], day), true);
  assert.equal(pickingTouched([fact(1, "dispatched")], [], [1], day), true);
  assert.equal(pickingTouched([fact(1, "cancelled")], [], [1], day), true);
  assert.equal(pickingTouched([fact(1, "pick_done", null, "2026-09-30T05:00:00Z")], [], [1], day), true);
  assert.equal(pickingTouched([fact(1, "pick_done", null, "2026-09-28T05:00:00Z")], [], [1], day), false);
  // a row the open tab shows, whatever its stage now
  assert.equal(pickingTouched([fact(1, "pending_picking")], [1], [1], day), true);
  // an id that no longer exists (no fact) but is shown
  assert.equal(pickingTouched([], [9], [9], day), true);
});

test("pick delete: touched only when the changed bill's SO is carried by ≥ 2 order rows, or it is shown", () => {
  const counts = new Map([["SO-A", 2], ["SO-B", 1]]);
  assert.equal(pickDeleteTouched(counts, [fact(1, "pending_picking", "SO-A")], [], [1]), true);
  assert.equal(pickDeleteTouched(counts, [fact(2, "pending_picking", "SO-B")], [], [2]), false);
  assert.equal(pickDeleteTouched(counts, [fact(3, "pending_picking", null)], [], [3]), false);
  assert.equal(pickDeleteTouched(counts, [fact(2, "pending_picking", "SO-B")], [2], [2]), true);
});

test("telephonic: a tag change, a matched bill, or a shown bill", () => {
  assert.equal(telephonicTouched(false, [], [], [1]), false);
  assert.equal(telephonicTouched(true, [], [], []), true);
  assert.equal(telephonicTouched(false, [1], [], [1]), true);
  assert.equal(telephonicTouched(false, [], [1], [1]), true);
});

test("print: a trip that is or was sent to billing, or a shown trip", () => {
  assert.equal(printTouched([], [], [5], [], [], []), false);
  assert.equal(printTouched([5], [], [5], [], [], []), true);
  assert.equal(printTouched([], [5], [5], [], [], []), true);
  assert.equal(printTouched([], [6], [5], [], [], []), false);
});

test("print v2: a changed bill on a trip on the tab, or a shown bill (stage, hold, finding)", () => {
  // the server found the changed order on a sent trip
  assert.equal(printTouched([], [], [], [41], [], [41]), true);
  // a bill the open tab shows, whatever its trip now
  assert.equal(printTouched([], [], [], [], [41, 42], [42]), true);
  // an order on no Print trip, not shown
  assert.equal(printTouched([], [], [], [], [41], [99]), false);
});
