// lib/billing/live-rule.test.ts — npx tsx --test lib/billing/live-rule.test.ts (npm run test:billing-live)

import test from "node:test";
import assert from "node:assert/strict";
import {
  PausedFire,
  armsToFire,
  hasMailOrderChange,
  initialCountRequests,
  markerCount,
  mergeCounts,
  syncBodyFromPatch,
  tooManyForSync,
} from "./live-rule";
import { SYNC_MAX_IDS } from "./sync-rule";

const ALL = { picking: true, print: true, telephonic: true, pickDelete: true };

test("syncBodyFromPatch: ids, so_tag flag, mail-order ids, shown per arm (deduped)", () => {
  const b = syncBodyFromPatch(
    { orderIds: [1, 2], tripIds: [5], extra: { mail_order: [501, "502"], so_tag: [7] } },
    { picking: [1, 1, 3], pickDelete: [9] },
  );
  assert.deepEqual(b, {
    orderIds: [1, 2],
    tripIds: [5],
    soTagChanged: true,
    mailOrderIds: [501, 502],
    shown: { pickingIds: [1, 3], printTripIds: [], telephonicOrderIds: [], pickDeleteIds: [9] },
  });
  const plain = syncBodyFromPatch({ orderIds: [], tripIds: [] }, {});
  assert.equal(plain.soTagChanged, false);
  assert.deepEqual(plain.mailOrderIds, []);
});

test("tooManyForSync / hasMailOrderChange", () => {
  assert.equal(tooManyForSync({ orderIds: Array.from({ length: SYNC_MAX_IDS + 1 }, (_, i) => i + 1), tripIds: [] }), true);
  assert.equal(tooManyForSync({ orderIds: [1], tripIds: [2] }), false);
  assert.equal(hasMailOrderChange({ orderIds: [], tripIds: [], extra: { mail_order: [1] } }), true);
  assert.equal(hasMailOrderChange({ orderIds: [1], tripIds: [], extra: { so_tag: [1] } }), false);
});

test("armsToFire: touched AND permitted, fixed order", () => {
  assert.deepEqual(armsToFire({ pickDelete: true, picking: true, print: false }, ALL), ["picking", "pickDelete"]);
  assert.deepEqual(armsToFire({ picking: true }, { ...ALL, picking: false }), []);
});

test("mergeCounts keeps untouched arms, replaces touched ones, ignores junk", () => {
  assert.deepEqual(mergeCounts({ picking: 3, print: 1 }, { print: 2, telephonic: 0 }), { picking: 3, print: 2, telephonic: 0 });
  assert.deepEqual(mergeCounts({ picking: 3 }, { picking: Number.NaN }), { picking: 3 });
});

test("initialCountRequests: one marker per permitted arm; picking carries the day", () => {
  assert.deepEqual(initialCountRequests({ ...ALL, print: false, telephonic: false }, "2026-09-30"), [
    { arm: "picking", url: "/api/billing/picking/marker?date=2026-09-30" },
    { arm: "pickDelete", url: "/api/billing/pick-delete/marker" },
  ]);
  assert.deepEqual(initialCountRequests({ picking: false, print: false, telephonic: false, pickDelete: false }, "x"), []);
});

test("markerCount reads a number or null", () => {
  assert.equal(markerCount({ count: 4, latest: null }), 4);
  assert.equal(markerCount({ count: "4" }), null);
  assert.equal(markerCount(null), null);
});

test("PausedFire: fire now when free; held while paused; exactly once on release", () => {
  const p = new PausedFire();
  assert.equal(p.request(false), true);
  assert.equal(p.release(), false);
  assert.equal(p.request(true), false);
  assert.equal(p.request(true), false);
  assert.equal(p.isPending(), true);
  assert.equal(p.release(), true);
  assert.equal(p.release(), false);
});
