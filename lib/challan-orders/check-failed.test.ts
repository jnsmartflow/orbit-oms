// lib/challan-orders/check-failed.test.ts — npx tsx --test lib/challan-orders/check-failed.test.ts
//
// Slice 6c (2026-10-07): the "challan check failed" path, tested WITHOUT a database and
// WITHOUT touching live. The forced-failure flag makes catchChallanObds throw inside its
// try BEFORE its first query, so the fail-closed branch runs with no connection used.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CHALLAN_CHECK_FAILED_STATUS,
  challanCheckForcedToFail,
  checkFailedMessage,
  finalBatchStatus,
} from "./check-failed";
import { catchChallanObds } from "./reconcile";

// process.env.NODE_ENV is typed read-only; tests need to set it.
const env = process.env as Record<string, string | undefined>;

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("finalBatchStatus: normal import is 'completed', a failed check is the flag", () => {
  assert.equal(finalBatchStatus(false), "completed");
  assert.equal(finalBatchStatus(true), CHALLAN_CHECK_FAILED_STATUS);
});

test("checkFailedMessage: the strip's words, singular and plural", () => {
  assert.equal(checkFailedMessage({ batchRef: "BATCH-20261007-031", withheld: 1 }),
    "Import BATCH-20261007-031: 1 bill held — challan check failed — Retry");
  assert.equal(checkFailedMessage({ batchRef: "B", withheld: 12 }), "Import B: 12 bills held — challan check failed — Retry");
});

test("the force flag can NEVER fire in production", () => {
  withEnv({ NODE_ENV: "production", CHALLAN_CHECK_FORCE_FAIL: "1" }, () => assert.equal(challanCheckForcedToFail(), false));
  withEnv({ NODE_ENV: "development", CHALLAN_CHECK_FORCE_FAIL: undefined }, () => assert.equal(challanCheckForcedToFail(), false));
  withEnv({ NODE_ENV: "development", CHALLAN_CHECK_FORCE_FAIL: "1" }, () => assert.equal(challanCheckForcedToFail(), true));
});

test("catchChallanObds fails CLOSED when the link table cannot be read (forced, no DB used)", async () => {
  const saved = { n: process.env.NODE_ENV, f: process.env.CHALLAN_CHECK_FORCE_FAIL };
  env.NODE_ENV = "test";
  process.env.CHALLAN_CHECK_FORCE_FAIL = "1";
  try {
    const r = await catchChallanObds(["9999999101", "9999999102"], 1);
    assert.equal(r.excludeAll, true, "the whole batch is withheld");
    assert.equal(r.excludeSos.size, 0);
    assert.equal(r.excludeObds.size, 0);
    assert.equal(r.results.length, 0, "nothing reconciled, nothing written");
    // What the import then writes on its batch row:
    assert.equal(finalBatchStatus(r.excludeAll), CHALLAN_CHECK_FAILED_STATUS);
  } finally {
    env.NODE_ENV = saved.n;
    if (saved.f === undefined) delete process.env.CHALLAN_CHECK_FORCE_FAIL;
    else process.env.CHALLAN_CHECK_FORCE_FAIL = saved.f;
  }
});

test("an empty batch never reaches the check (no flag, no exclusion)", async () => {
  const r = await catchChallanObds([], 1);
  assert.equal(r.excludeAll, false);
});
