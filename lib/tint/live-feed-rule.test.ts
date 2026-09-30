// lib/tint/live-feed-rule.test.ts — npx tsx --test lib/tint/live-feed-rule.test.ts (npm run test:tint-live)
//
// Tint step 3: the narrowing rules of GET /api/live/changes?screen=tint, the tint switch key, the
// screen / face / held / missing parsing, and the two "today" boundaries. The SQL half is proven
// read-only against live data by scripts/parity-tint-classifier.ts.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  decideTintManager,
  decideTintOperator,
  managerStartOfToday,
  operatorSeesAll,
  operatorStartOfToday,
} from "./live-feed-rule";
import {
  HELD_MAX,
  LIVE_FEED_KEY,
  LIVE_FEED_TINT_KEY,
  faceFitsScreen,
  narrowOrderIds,
  parseFace,
  parseHeldIds,
  parseLiveFeedSwitch,
  parseScreen,
  type LiveGroup,
} from "@/lib/live/cursor";

// ── Manager ─────────────────────────────────────────────────────────────────
test("manager: tint ids on the board are kept, non-tint ids are dropped (input order)", () => {
  const d = decideTintManager(
    [7, 3, 9],
    [
      { id: 7, onBoard: false, missing: false }, // a non-tint bill (picking traffic)
      { id: 3, onBoard: true, missing: false },
      { id: 9, onBoard: true, missing: false },
    ],
    [],
    [],
  );
  assert.deepEqual(d.keep, [3, 9]);
  assert.equal(d.missingTouched, false);
});

test("manager: a bill LEAVING the board is kept through held", () => {
  const d = decideTintManager([5], [{ id: 5, onBoard: false, missing: false }], [5, 6], []);
  assert.deepEqual(d.keep, [5]);
});

test("manager: an id the DB no longer returns (deleted) is kept only if held", () => {
  assert.deepEqual(decideTintManager([4], [], [], []).keep, []);
  assert.deepEqual(decideTintManager([4], [], [4], []).keep, [4]);
});

test("manager: missingTouched — customerMissing now, or already on the side list, else false", () => {
  assert.equal(decideTintManager([1], [{ id: 1, onBoard: false, missing: true }], [], []).missingTouched, true);
  // a customer FIX: missing is false now, but the side list shows it
  assert.equal(decideTintManager([2], [{ id: 2, onBoard: false, missing: false }], [], [2]).missingTouched, true);
  assert.equal(decideTintManager([2], [{ id: 2, onBoard: true, missing: false }], [], [8]).missingTouched, false);
  assert.equal(decideTintManager([], [], [], [8]).missingTouched, false);
});

test("manager narrowing: config passes through; no tint id and no config → nothing for you", () => {
  const groups: LiveGroup[] = [
    { entity: "order", ids: [7, 3] },
    { entity: "config", ids: ["obd_visibility_rules"] },
  ];
  assert.deepEqual(narrowOrderIds(groups, new Set([3])), [
    { entity: "order", ids: [3] },
    { entity: "config", ids: ["obd_visibility_rules"] },
  ]);
  assert.deepEqual(narrowOrderIds(groups, new Set()), [{ entity: "config", ids: ["obd_visibility_rules"] }]);
  assert.deepEqual(narrowOrderIds([{ entity: "order", ids: [7] }], new Set()), []);
});

// ── Operator ────────────────────────────────────────────────────────────────
test("operator: his own job kept, another operator's job dropped, held kept", () => {
  // 11 = his job (the SQL returned it), 12 = another operator's job (the SQL did not), 13 = held (leaving him)
  assert.deepEqual(decideTintOperator([12, 11, 13], [11], [13]), [11, 13]);
  assert.deepEqual(decideTintOperator([12], [], []), []);
});

test("operator: the see-all branch mirrors my-orders (operations / admin only, by PRIMARY role)", () => {
  assert.equal(operatorSeesAll("operations"), true);
  assert.equal(operatorSeesAll("admin"), true);
  assert.equal(operatorSeesAll("tint_operator"), false);
  assert.equal(operatorSeesAll(undefined), false);
});

// ── Parsing / switch ────────────────────────────────────────────────────────
test("screen=tint, face=operator only with tint, picker only with picking", () => {
  assert.equal(parseScreen(" Tint "), "tint");
  assert.equal(parseFace(" Operator "), "operator");
  assert.equal(parseFace("manager"), undefined);
  assert.equal(faceFitsScreen("operator", "tint"), true);
  assert.equal(faceFitsScreen("operator", "picking"), false);
  assert.equal(faceFitsScreen("operator", null), false);
  assert.equal(faceFitsScreen("picker", "tint"), false);
  assert.equal(faceFitsScreen("picker", "picking"), true);
  assert.equal(faceFitsScreen(null, "tint"), true);
});

test("held / missing: validated ints, capped at HELD_MAX", () => {
  assert.deepEqual(parseHeldIds("5,5,6"), [5, 6]);
  assert.equal(parseHeldIds("5;6"), null);
  assert.equal(parseHeldIds("1e3"), null);
  assert.equal(parseHeldIds(Array.from({ length: HELD_MAX + 1 }, (_, i) => i + 1).join(",")), null);
});

test("switch: the tint key, OFF unless isEnabled is exactly true, and the global switch is read first", () => {
  assert.equal(LIVE_FEED_TINT_KEY, "live.feed.tint");
  assert.equal(parseLiveFeedSwitch(null), false);
  assert.equal(parseLiveFeedSwitch({ isEnabled: null }), false);
  assert.equal(parseLiveFeedSwitch({ isEnabled: true }), true);
  const src = readFileSync(path.join(__dirname, "..", "live", "feed.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function isTintFeedOn"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /if \(!\(await isLiveFeedOn\(\)\)\) return false;\s*return isSwitchOn\(LIVE_FEED_TINT_KEY\);/);
  assert.notEqual(LIVE_FEED_TINT_KEY, LIVE_FEED_KEY);
});

test("the changes route answers { enabled: false } before any tint narrowing when the switch is off", () => {
  const src = readFileSync(path.join(__dirname, "..", "..", "app", "api", "live", "changes", "route.ts"), "utf8");
  const off = src.indexOf("return NextResponse.json({ enabled: false }");
  assert.ok(off > 0);
  assert.ok(src.indexOf('screen === "tint"\n          ? await isTintFeedOn()') > 0 || /screen === "tint"\s*\?\s*await isTintFeedOn\(\)/.test(src));
  assert.ok(src.indexOf("narrowForTintManager(grouped") > off, "narrowing must come after the switch");
  assert.ok(src.indexOf("narrowForTintOperator(grouped") > off);
});

// ── "Today" ─────────────────────────────────────────────────────────────────
test("today: Manager = server-local midnight, Operator = UTC midnight (as the two routes compute it)", () => {
  const now = new Date("2026-09-30T20:00:00.000Z");
  const m = managerStartOfToday(now);
  assert.equal(m.getHours(), 0);
  assert.equal(m.getMinutes(), 0);
  assert.equal(m.getDate(), now.getDate());
  assert.equal(operatorStartOfToday(now).toISOString(), "2026-09-30T00:00:00.000Z");
});
