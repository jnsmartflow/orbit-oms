// lib/stock-audit/replay.test.ts — npx tsx --test lib/stock-audit/replay.test.ts
//
// The POST /api/stock-count/audits/[id]/lines idempotency decision (Schema
// v27.80) and its two body checks. Pure.

import test from "node:test";
import assert from "node:assert/strict";
import { decideReplay, parseCountedAt, userAssertionOk } from "./replay";

test("no line holds the clientId → new", () => {
  assert.equal(decideReplay(null, 7, 3), "new");
});

test("MY line in THIS audit → replay (the audit may be closed; the route checks replay first)", () => {
  assert.equal(decideReplay({ auditId: 7, countedById: 3 }, 7, 3), "replay");
});

test("someone else's line, or another audit's → conflict", () => {
  assert.equal(decideReplay({ auditId: 7, countedById: 4 }, 7, 3), "conflict");
  assert.equal(decideReplay({ auditId: 8, countedById: 3 }, 7, 3), "conflict");
});

test("userId assertion: absent passes (old tab), equal passes, anything else fails", () => {
  assert.equal(userAssertionOk(undefined, 3), true);
  assert.equal(userAssertionOk(null, 3), true);
  assert.equal(userAssertionOk(3, 3), true);
  assert.equal(userAssertionOk(4, 3), false);
  assert.equal(userAssertionOk("3", 3), false);
});

test("countedAt: an ISO date-time WITH Z or an offset → Date", () => {
  assert.equal(parseCountedAt("2026-11-04T09:05:00.123Z")?.toISOString(), "2026-11-04T09:05:00.123Z");
  assert.equal(parseCountedAt("2026-11-04T14:35:00+05:30")?.toISOString(), "2026-11-04T09:05:00.000Z");
});

test("countedAt: offset-less, date-only, junk, non-string → null (CORE §3 Date.parse landmine)", () => {
  for (const bad of ["2026-11-04T09:05:00", "2026-11-04", "yesterday", "", 1730710000000, null, undefined]) {
    assert.equal(parseCountedAt(bad), null, String(bad));
  }
  assert.equal(parseCountedAt("2026-13-45T99:99:00Z"), null);
});
