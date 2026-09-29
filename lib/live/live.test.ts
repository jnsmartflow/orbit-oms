// lib/live/live.test.ts — Node's built-in runner through tsx (no new dependency):
//   npx tsx --test lib/live/live.test.ts   (npm run test:live)
//
// The PURE half of the live change feed: cursor encode/decode/compare, the
// next-cursor rule, the pruned-past rule, grouping + de-dupe, topic and limit
// parsing, and the kill-switch parsing. No database.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createHeadCache,
  HEAD_CACHE_TTL_MS,
  compareCursor,
  compareDecimal,
  decodeCursor,
  encodeCursor,
  groupChanges,
  horizonCursor,
  isPrunedPast,
  nextCursor,
  parseLimit,
  parseLiveFeedSwitch,
  parseTopics,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type LiveRow,
} from "./cursor";

const row = (txId: string, seq: string, entity: string, entityId: string): LiveRow => ({ txId, seq, entity, entityId });

// ── cursor format ───────────────────────────────────────────────────────────
test("encode/decode round-trip, v1 prefix, leading zeros normalised", () => {
  const c = { txId: "123456789012", seq: "42" };
  assert.equal(encodeCursor(c), "v1.123456789012.42");
  assert.deepEqual(decodeCursor("v1.123456789012.42"), c);
  assert.deepEqual(decodeCursor(" v1.007.0 "), { txId: "7", seq: "0" });
  assert.equal(encodeCursor({ txId: "0007", seq: "000" }), "v1.7.0");
});

test("decode rejects anything that is not a well-formed v1 cursor", () => {
  for (const bad of ["", "v2.1.2", "v1.1", "v1.-1.2", "v1.1.2.3", "v1.a.2", "1.2", "v1.123456789012345678901.1", null, undefined]) {
    assert.equal(decodeCursor(bad as string | null | undefined), null, String(bad));
  }
});

test("64-bit xid8 values compare correctly as decimal strings (no BigInt needed)", () => {
  assert.equal(compareDecimal("9", "10"), -1);
  assert.equal(compareDecimal("18446744073709551615", "18446744073709551614"), 1);
  assert.equal(compareDecimal("0005", "5"), 0);
  assert.equal(compareCursor({ txId: "10", seq: "1" }, { txId: "9", seq: "999" }), 1, "txId first");
  assert.equal(compareCursor({ txId: "10", seq: "2" }, { txId: "10", seq: "11" }), -1, "then seq");
});

// ── the next cursor ─────────────────────────────────────────────────────────
test("page not full → jump to (horizon, 0)", () => {
  const after = { txId: "100", seq: "5" };
  const returned = [row("101", "7", "order", "1"), row("104", "9", "order", "2")];
  assert.deepEqual(nextCursor({ after, returned, more: false, horizonTxId: "110" }), horizonCursor("110"));
});

test("page full (more) → continue right after the last row returned, not the horizon", () => {
  const after = { txId: "100", seq: "5" };
  const returned = [row("101", "7", "order", "1"), row("104", "9", "order", "2")];
  assert.deepEqual(nextCursor({ after, returned, more: true, horizonTxId: "110" }), { txId: "104", seq: "9" });
});

test("nothing new and a horizon behind the cursor → the cursor never moves backwards", () => {
  const after = { txId: "200", seq: "3" };
  assert.deepEqual(nextCursor({ after, returned: [], more: false, horizonTxId: "150" }), after);
});

test("nothing new → cursor advances to the horizon", () => {
  const after = { txId: "100", seq: "5" };
  assert.deepEqual(nextCursor({ after, returned: [], more: false, horizonTxId: "130" }), { txId: "130", seq: "0" });
});

// ── pruned past ─────────────────────────────────────────────────────────────
test("a cursor at or below the prune watermark is too old; above it is fine; no watermark is fine", () => {
  assert.equal(isPrunedPast({ txId: "50", seq: "1" }, "60"), true);
  assert.equal(isPrunedPast({ txId: "60", seq: "999" }, "60"), true, "inclusive — a batch may stop mid-transaction");
  assert.equal(isPrunedPast({ txId: "61", seq: "0" }, "60"), false);
  assert.equal(isPrunedPast({ txId: "1", seq: "0" }, null), false);
});

// ── grouping ────────────────────────────────────────────────────────────────
test("group by entity, de-duplicate ids, keep first-seen order, canonical entity order", () => {
  const rows = [
    row("1", "1", "trip", "9"),
    row("1", "2", "order", "5"),
    row("1", "3", "order", "3"),
    row("2", "4", "order", "5"),
    row("2", "5", "config", "route_master"),
    row("2", "6", "trip", "9"),
  ];
  assert.deepEqual(groupChanges(rows), [
    { entity: "order", ids: [5, 3] },
    { entity: "trip", ids: [9] },
    { entity: "config", ids: ["route_master"] },
  ]);
});

test("no rows → no groups", () => {
  assert.deepEqual(groupChanges([]), []);
});

// ── params ──────────────────────────────────────────────────────────────────
test("topics: default all; unknown ignored; nothing known → null (400)", () => {
  assert.deepEqual(parseTopics(null), ["order", "trip", "config"]);
  assert.deepEqual(parseTopics(""), ["order", "trip", "config"]);
  assert.deepEqual(parseTopics("trip, order ,order"), ["order", "trip"]);
  assert.deepEqual(parseTopics("ORDER,nonsense"), ["order"]);
  assert.equal(parseTopics("nonsense"), null);
});

test("limit: default 500, capped at 1000, at least 1, junk → default", () => {
  assert.equal(parseLimit(null), DEFAULT_LIMIT);
  assert.equal(parseLimit("50"), 50);
  assert.equal(parseLimit("5000"), MAX_LIMIT);
  assert.equal(parseLimit("0"), 1);
  assert.equal(parseLimit("-3"), 1);
  assert.equal(parseLimit("2.5"), DEFAULT_LIMIT);
  assert.equal(parseLimit("abc"), DEFAULT_LIMIT);
});

// ── the switch ──────────────────────────────────────────────────────────────
test("live.feed switch: ON only for isEnabled === true", () => {
  assert.equal(parseLiveFeedSwitch({ isEnabled: true }), true);
  assert.equal(parseLiveFeedSwitch({ isEnabled: false }), false);
  assert.equal(parseLiveFeedSwitch({ isEnabled: null }), false);
  assert.equal(parseLiveFeedSwitch(null), false, "absent row → OFF");
  assert.equal(parseLiveFeedSwitch(undefined), false);
});

// ── the head cache (7a) ─────────────────────────────────────────────────────
function clock(start = 1_000_000) {
  const c = { t: start };
  return { c, now: () => c.t };
}

test("head cache: a caller AT the remembered head within the TTL is a hit, with the cached lag", () => {
  const { c, now } = clock();
  const cache = createHeadCache(now);
  cache.remember({ txId: "500", seq: "0" }, 2);
  c.t += HEAD_CACHE_TTL_MS - 1;
  assert.deepEqual(cache.hit({ txId: "500", seq: "0" }), { lagSeconds: 2 });
  assert.deepEqual(cache.hit({ txId: "0500", seq: "000" }), { lagSeconds: 2 }, "same cursor, different spelling");
});

test("head cache: expires at the TTL — the next call must read live_changes", () => {
  const { c, now } = clock();
  const cache = createHeadCache(now);
  cache.remember({ txId: "500", seq: "0" }, 0);
  c.t += HEAD_CACHE_TTL_MS;
  assert.equal(cache.hit({ txId: "500", seq: "0" }), null);
});

test("head cache: a caller BEHIND or AHEAD of the head is never answered from cache", () => {
  const { now } = clock();
  const cache = createHeadCache(now);
  cache.remember({ txId: "500", seq: "0" }, 0);
  assert.equal(cache.hit({ txId: "499", seq: "9" }), null, "behind → it may have changes to collect");
  assert.equal(cache.hit({ txId: "500", seq: "1" }), null, "ahead → not the remembered head");
  assert.equal(cache.hit({ txId: "600", seq: "0" }), null);
});

test("head cache: empty until something is remembered; clear() empties it; clock stepping back → miss", () => {
  const { c, now } = clock();
  const cache = createHeadCache(now);
  assert.equal(cache.hit({ txId: "1", seq: "0" }), null);
  cache.remember({ txId: "1", seq: "0" }, 0);
  cache.clear();
  assert.equal(cache.hit({ txId: "1", seq: "0" }), null);
  cache.remember({ txId: "1", seq: "0" }, 0);
  c.t -= 1;
  assert.equal(cache.hit({ txId: "1", seq: "0" }), null);
});

test("head cache cannot skip: a hit never advances — the caller keeps its own cursor, so a change committed during the TTL is read on the first call after it", () => {
  // Simulated timeline. Horizon H=500 at t0; a transaction 505 commits at t0+2s.
  const { c, now } = clock();
  const cache = createHeadCache(now);
  const head = { txId: "500", seq: "0" };
  cache.remember(head, 0);
  c.t += 2_000;
  // During the TTL the caller is told "no changes" and KEEPS cursor 500.0.
  assert.ok(cache.hit(head));
  let callerCursor = head; // the route returns encodeCursor(after) — unchanged
  c.t += HEAD_CACHE_TTL_MS;
  assert.equal(cache.hit(callerCursor), null, "after the TTL the route reads live_changes again");
  // The uncached read returns every row after 500.0 below the new horizon (510): row 505.7.
  const returned = [row("505", "7", "order", "42")];
  callerCursor = nextCursor({ after: callerCursor, returned, more: false, horizonTxId: "510" });
  assert.deepEqual(groupChanges(returned), [{ entity: "order", ids: [42] }]);
  assert.deepEqual(callerCursor, { txId: "510", seq: "0" });
});
