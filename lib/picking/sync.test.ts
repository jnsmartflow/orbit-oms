// lib/picking/sync.test.ts — npx tsx --test lib/picking/sync.test.ts (npm run test:picking-sync)
// The pure half of POST /api/picking/sync: body validation. The by-id reads are proven against live
// data by scripts/parity-picking-rows.ts.

import test from "node:test";
import assert from "node:assert/strict";
import { PICKING_SYNC_MAX_IDS, parsePickingSyncBody } from "./sync";

test("absent fields are empty; ids de-duplicated", () => {
  const b = parsePickingSyncBody({ orderIds: [5, 5, 6], tripIds: [9] });
  assert.ok(typeof b !== "string");
  assert.deepEqual(b, { orderIds: [5, 6], tripIds: [9], shownIds: [], tintShownIds: [] });
  assert.ok(typeof parsePickingSyncBody(null) !== "string");
});

test("rejects non-integers, zero / negatives, strings and oversize lists", () => {
  assert.equal(typeof parsePickingSyncBody({ orderIds: [1.5] }), "string");
  assert.equal(typeof parsePickingSyncBody({ tripIds: [0] }), "string");
  assert.equal(typeof parsePickingSyncBody({ shownIds: "1,2" }), "string");
  assert.equal(typeof parsePickingSyncBody({ tintShownIds: [-3] }), "string");
  assert.equal(
    typeof parsePickingSyncBody({ orderIds: Array.from({ length: PICKING_SYNC_MAX_IDS + 1 }, (_, i) => i + 1) }),
    "string",
  );
});
