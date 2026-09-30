// lib/push/sw-message.test.ts — npx tsx --test lib/push/sw-message.test.ts (npm run test:push-message)

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PUSH_TAG_PATTERN_SOURCE, parseOrbitPushMessage, parsePushTag } from "./sw-message";

test("parsePushTag: the three picking tags; anything else → null", () => {
  assert.deepEqual(parsePushTag("pick-assigned-17891"), { kind: "assigned", orderId: 17891 });
  assert.deepEqual(parsePushTag("pick-done-5"), { kind: "done", orderId: 5 });
  assert.deepEqual(parsePushTag("pick-cancelled-42"), { kind: "cancelled", orderId: 42 });
  assert.equal(parsePushTag("pick-deleted-42"), null); // the pick-delete push is not a picking trigger
  assert.equal(parsePushTag("orbit-test"), null);
  assert.equal(parsePushTag("pick-done-"), null);
  assert.equal(parsePushTag("pick-done-0"), null);
  assert.equal(parsePushTag("xpick-done-5"), null);
  assert.equal(parsePushTag(undefined), null);
});

test("parseOrbitPushMessage: only { type: 'orbit-push', tag } with a picking tag", () => {
  assert.deepEqual(parseOrbitPushMessage({ type: "orbit-push", tag: "pick-done-9", orderId: 9 }), {
    type: "orbit-push",
    tag: "pick-done-9",
    kind: "done",
    orderId: 9,
  });
  assert.equal(parseOrbitPushMessage({ type: "other", tag: "pick-done-9" }), null);
  assert.equal(parseOrbitPushMessage({ type: "orbit-push", tag: "orbit-test" }), null);
  assert.equal(parseOrbitPushMessage(null), null);
});

test("public/sw.js carries the SAME tag pattern and posts the message after the notification", () => {
  const sw = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  const m = /var PICKING_PUSH_TAG = \/(.+)\/;/.exec(sw);
  assert.ok(m, "PICKING_PUSH_TAG literal not found in sw.js");
  assert.equal(m![1], PUSH_TAG_PATTERN_SOURCE.replace(/\\\\/g, "\\"));
  assert.ok(sw.includes('type: "orbit-push"'));
  // Still push + notificationclick only: no fetch handler, no Cache API (code only — the header
  // comment names both in its own hard rule).
  const code = sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/addEventListener\(\s*["']fetch["']/.test(code), false);
  assert.equal(/\bcaches\./.test(code), false);
});
