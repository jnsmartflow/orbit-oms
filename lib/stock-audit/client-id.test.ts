// lib/stock-audit/client-id.test.ts — npx tsx --test lib/stock-audit/client-id.test.ts
//
// The offline queue's per-entry id (Schema v27.80): shape, normalising, and
// the iOS < 15.4 / insecure-context fallback. Pure.

import test from "node:test";
import assert from "node:assert/strict";
import { isClientId, newClientId, normaliseClientId, uuidFromBytes } from "./client-id";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("isClientId — canonical 8-4-4-4-12 hex, any case; nothing else", () => {
  assert.equal(isClientId("3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b2f"), true);
  assert.equal(isClientId("3F2B8C1E-9D4A-4B7E-8F21-0C6D5E4A3B2F"), true);
  for (const bad of ["", "3f2b8c1e9d4a4b7e8f210c6d5e4a3b2f", "3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b2", "zz2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b2f", 42, null, undefined, {}]) {
    assert.equal(isClientId(bad), false, String(bad));
  }
});

test("normaliseClientId lower-cases a good id and refuses a bad one", () => {
  assert.equal(normaliseClientId("3F2B8C1E-9D4A-4B7E-8F21-0C6D5E4A3B2F"), "3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b2f");
  assert.equal(normaliseClientId("not-a-uuid"), null);
});

test("newClientId uses crypto.randomUUID when present", () => {
  const id = newClientId({ randomUUID: () => "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE" });
  assert.equal(id, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
});

test("fallback: no randomUUID → getRandomValues v4", () => {
  const id = newClientId({
    getRandomValues: <T extends ArrayBufferView | null>(a: T): T => {
      const u = a as unknown as Uint8Array;
      for (let i = 0; i < u.length; i++) u[i] = 0xff;
      return a;
    },
  });
  assert.match(id, V4);
  assert.equal(id, "ffffffff-ffff-4fff-bfff-ffffffffffff");
});

test("fallback: randomUUID that throws (insecure context) → still a v4", () => {
  const id = newClientId({
    randomUUID: () => {
      throw new Error("insecure");
    },
  });
  assert.match(id, V4);
});

test("fallback: no Web Crypto at all → still a v4 (Math.random)", () => {
  assert.match(newClientId({}), V4);
});

test("uuidFromBytes sets version 4 and the RFC variant", () => {
  assert.equal(uuidFromBytes(new Uint8Array(16)), "00000000-0000-4000-8000-000000000000");
  assert.throws(() => uuidFromBytes(new Uint8Array(15)));
});

test("the real runtime id is a v4 and unique across many calls", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(newClientId());
  assert.equal(seen.size, 2000);
  for (const id of Array.from(seen).slice(0, 20)) assert.match(id, V4);
});
