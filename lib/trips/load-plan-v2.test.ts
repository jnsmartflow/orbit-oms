// lib/trips/load-plan-v2.test.ts — Node's built-in runner through tsx:
//   npx tsx --test lib/trips/load-plan-v2.test.ts
//
// 🔴 EVERY RATE HERE IS MADE UP. Real rates are secret and never go in a
// committed file (CLAUDE_CORE.md §7.19). The fixture rates are odd numbers
// (1437, 2213, …) so no kilo figure in a test can collide with one, which is
// what lets the last test prove no rupee value reaches the output.

import test from "node:test";
import assert from "node:assert/strict";
import {
  planLoadsV2,
  parseLoadPlanV2Config,
  type AreaInfo,
  type AreaRate,
  type LoadPlanV2Config,
  type LoadPlanV2Context,
  type V2Bill,
} from "./load-plan-v2";

// Routes: South = Navsari 11, Vapi 12, Chikhli 21 · North = Bharuch 17,
// Kamrej 19 · Surat = Adajan 9 · Direct = IGT 18.
const ROUTES: Record<number, string> = { 11: "Navsari", 12: "Vapi", 21: "Chikhli", 17: "Bharuch", 19: "Kamrej", 9: "Adajan", 18: "IGT / CROSS" };

const RAW_CONFIG = {
  smallMaxKg: 2000, bigMaxKg: 3000, mainRouteIds: [11, 12, 17], partners: [], // v1 keys, ignored by v2
  routeSides: { "11": "South", "12": "South", "21": "South", "17": "North", "19": "North", "9": "Surat", "18": "Direct" },
  vehicles: {
    ace: { maxKg: 2000, overKg: 50, idealStops: 6, maxStops: 8, dailyCount: 2, nearOnly: false, priority: 1 },
    big: { maxKg: 3000, overKg: 50, idealStops: 5, maxStops: 6, dailyCount: null, nearOnly: false, priority: 2 },
    gc: { maxKg: 1500, overKg: 50, idealStops: 4, maxStops: 4, dailyCount: 3, nearOnly: true, priority: 3 },
  },
  // pairMinTimes, maxPlacesPerTruck, rideAlongBelowKg and sameRoutePairsAlways
  // are left OUT, so the code defaults (V2_DEFAULTS: 1, 6, 300, true) apply.
  bulkKg: 3000, truckPenaltyRs: 613, holdSmallUnlessOverdue: true,
  newArea: { rate: "route_typical", gcAllowed: false, pairs: "same_route" },
};

// Areas (id → name, route) and FAKE rates [gc, ace, big, gcExtra, aceExtra, bigExtra, gcAllowed].
const AREA: Record<number, [string, number]> = {
  101: ["Navsari Town", 11], 102: ["Bilimora", 21], 103: ["Vapi Town", 12], 104: ["Valsad", 12],
  105: ["Bharuch Town", 17], 106: ["Kamrej Town", 19], 107: ["Adajan", 9], 108: ["IGT Area", 18],
  109: ["New Navsari Area", 11], 110: ["Navsari East", 11], 111: ["Navsari West", 11],
};
const R: Record<number, [number, number, number, number, number, number, boolean]> = {
  101: [811, 1037, 1437, 83, 107, 151, true],
  102: [913, 1129, 1531, 87, 109, 157, true],
  103: [1319, 1621, 2213, 91, 113, 163, false],
  104: [1223, 1523, 2111, 89, 111, 159, false],
  105: [1117, 1427, 1913, 93, 117, 167, false],
  106: [607, 719, 1019, 71, 97, 131, true],
  107: [409, 523, 811, 61, 79, 101, true],
  108: [1709, 2017, 2719, 97, 127, 173, false],
  110: [823, 1049, 1447, 83, 107, 151, true],
  111: [827, 1051, 1451, 83, 107, 151, true],
  // 109 has NO rate row — a new area.
};
// Pairs seen together (a < b) → times.
const PAIRS: Array<[number, number, number]> = [
  [101, 102, 5], [101, 103, 3], [101, 104, 2], [103, 104, 6], [102, 103, 1], [101, 110, 4], [105, 106, 4],
  [101, 111, 3],
  // Deliberately NO row for 110–111 (same route) or 102–104 (different routes).
];

function ctx(overrides: Record<string, unknown> = {}): LoadPlanV2Context {
  const config = parseLoadPlanV2Config({ ...RAW_CONFIG, ...overrides }) as LoadPlanV2Config;
  assert.ok(config, "fixture config must parse");
  const rates = new Map<number, AreaRate>();
  Object.keys(R).forEach((k) => {
    const [gc, ace, big, gcx, acex, bigx, ok] = R[Number(k)];
    rates.set(Number(k), { gcRate: gc, aceRate: ace, bigRate: big, gcExtra: gcx, aceExtra: acex, bigExtra: bigx, gcAllowed: ok });
  });
  const pairs = new Map<string, number>();
  PAIRS.forEach(([a, b, n]) => pairs.set(`${a}-${b}`, n));
  const areas = new Map<number, AreaInfo>();
  Object.keys(AREA).forEach((k) => areas.set(Number(k), { name: AREA[Number(k)][0], routeId: AREA[Number(k)][1] }));
  return { config, rates, pairs, areas, routeNames: ROUTES };
}

let nextId = 1;
/** A stop: `bills` bills of `kg` total in one area. */
function stop(areaId: number, kg: number, opts: { bills?: number; overdue?: boolean; key?: string; ageDays?: number } = {}): V2Bill[] {
  const n = opts.bills ?? 1;
  const key = opts.key ?? `c:${areaId}-${nextId}`;
  return Array.from({ length: n }, () => ({
    orderId: nextId++, weightKg: kg / n, stopKey: key, areaId, routeId: AREA[areaId][1],
    overdue: opts.overdue ?? false, ageDays: opts.ageDays ?? 0,
  }));
}
const types = (p: ReturnType<typeof planLoadsV2>) => p.cards.map((c) => c.type);

test("config: the v2 keys parse; a missing required one → null; defaults fill the rest", () => {
  const c = parseLoadPlanV2Config(RAW_CONFIG)!;
  assert.ok(c);
  // Code defaults when the row leaves them out …
  assert.equal(c.pairMinTimes, 1);
  assert.equal(c.maxPlacesPerTruck, 6);
  assert.equal(c.rideAlongBelowKg, 300);
  assert.equal(c.sameRoutePairsAlways, true);
  // … and the row's own value wins when it sets one.
  const o = parseLoadPlanV2Config({ ...RAW_CONFIG, pairMinTimes: 2, maxPlacesPerTruck: 5, rideAlongBelowKg: 200, sameRoutePairsAlways: false })!;
  assert.deepEqual([o.pairMinTimes, o.maxPlacesPerTruck, o.rideAlongBelowKg, o.sameRoutePairsAlways], [2, 5, 200, false]);
  assert.equal(parseLoadPlanV2Config({ ...RAW_CONFIG, pairMinTimes: "two" }), null);
  const { vehicles: _v, ...noVehicles } = RAW_CONFIG;
  assert.equal(parseLoadPlanV2Config(noVehicles), null);
  assert.equal(parseLoadPlanV2Config({ ...RAW_CONFIG, newArea: { rate: "x" } }), null);
  assert.equal(parseLoadPlanV2Config(null), null);
});

test("a heavy stop is split BY BILL into full direct Bigs; the leftover plans normally", () => {
  // One stop, three bills: 2,000 + 1,500 + 1,000 = 4,500 kg — more than one
  // direct Big (3,500). First-fit, heaviest first, to ≤ 3,500: 2,000 → +1,500 =
  // 3,500 ✓ → +1,000 = 4,500 ✗ → a full direct Big of 3,500. Left: 1,000.
  const key = "c:heavy";
  const bills: V2Bill[] = [2000, 1500, 1000].map((kg) => ({ orderId: nextId++, weightKg: kg, stopKey: key, areaId: 101, routeId: 11, overdue: false }));
  const p = planLoadsV2(bills, ctx());
  const split = p.cards.find((c) => /split by bill/.test(c.reason))!;
  assert.equal(split.type, "big");
  assert.equal(Math.round(split.kg), 3500);
  assert.deepEqual(split.orderIds, [bills[0].orderId, bills[1].orderId].sort((x, y) => x - y));
  assert.match(split.reason, /Part of a 4,500 kg stop at Navsari Town/);
  assert.equal(split.stops[0].stopKey, key); // the internal part suffix never leaks
  const rest = p.cards.find((c) => c.orderIds.includes(bills[2].orderId))!;
  assert.notEqual(rest, split);
  assert.equal(Math.round(rest.kg), 1000);
  assert.equal(p.summary.bulk, 0);
});

test("bulk: only a single BILL heavier than a direct Big gets a Bulk card", () => {
  const heavy = stop(101, 3600); // one bill of 3,600 > 3,500
  const p = planLoadsV2([...heavy, ...stop(110, 900)], ctx());
  const bulk = p.cards.find((c) => c.type === "bulk")!;
  assert.deepEqual(bulk.orderIds, [heavy[0].orderId]);
  assert.match(bulk.reason, /One bill over 3,500 kg — hire as needed/);
  assert.equal(p.summary.bulk, 1);
});

test("direct Big: a 3,400 kg dealer is one Big, not bulk and not split", () => {
  const dealer = stop(101, 3400, { bills: 3 });
  const p = planLoadsV2(dealer, ctx());
  assert.equal(p.summary.bulk, 0);
  assert.equal(p.summary.big, 1);
  assert.equal(p.cards[0].orderIds.length, 3);
  assert.match(p.cards[0].reason, /Direct Big \(1 stop, up to 3,500 kg\)/);
});

test("direct Big: 1–2 stops may carry up to directBigMaxKg; 3+ stops keep 3,050", () => {
  // Two stops, 3,300 kg → one direct Big.
  const two = planLoadsV2([...stop(101, 1700), ...stop(110, 1600)], ctx());
  assert.equal(two.summary.trucks, 1);
  // Three stops, 3,300 kg → too heavy for a 3+-stop Big: two trucks.
  const three = planLoadsV2([...stop(101, 1100), ...stop(110, 1100), ...stop(111, 1100)], ctx());
  assert.ok(three.summary.trucks >= 2);
  assert.ok(three.cards.every((c) => c.stopCount <= 2 || c.kg <= 3050));
  // directBigMaxKg 3050 → the old behaviour: a 3,400 kg dealer is split.
  const old = planLoadsV2(stop(101, 3400, { bills: 2 }), ctx({ directBigMaxKg: 3050 }));
  assert.equal(old.summary.trucks, 2);
});

test("direct: a Direct route gets one card of its own, never mixed", () => {
  const p = planLoadsV2([...stop(108, 400), ...stop(108, 300), ...stop(101, 700), ...stop(102, 600)], ctx());
  const direct = p.cards.filter((c) => c.type === "direct");
  assert.equal(direct.length, 1);
  assert.deepEqual(direct[0].areaNames, ["IGT Area"]);
  assert.equal(direct[0].stopCount, 2);
  assert.ok(p.cards.filter((c) => c.type !== "direct").every((c) => !c.areaNames.includes("IGT Area")));
});

test("a stop is never split across trucks", () => {
  // One stop of 4 bills (2,400 kg) plus a 1,000 kg stop: together 3,400 — too
  // heavy for one truck, so they must go separately, the 4 bills together.
  const big = stop(101, 2400, { bills: 4 });
  const p = planLoadsV2([...big, ...stop(110, 1000)], ctx());
  const holder = p.cards.filter((c) => c.orderIds.some((id) => big.some((b) => b.orderId === id)));
  assert.equal(holder.length, 1);
  assert.equal(holder[0].orderIds.filter((id) => big.some((b) => b.orderId === id)).length, 4);
});

test("the pair rule blocks a join: different routes, never seen together", () => {
  // Bilimora (Chikhli) and Valsad (Vapi): no pair row, different routes.
  const p = planLoadsV2([...stop(102, 700), ...stop(104, 700)], ctx());
  assert.equal(p.summary.trucks, 2);
  assert.ok(p.cards.every((c) => c.areaNames.length === 1));
  // Seen together once is enough at the default pairMinTimes = 1 …
  const q = planLoadsV2([...stop(102, 700), ...stop(103, 700)], ctx());
  assert.equal(q.summary.trucks, 1);
  // … but not when the config sets it to 2.
  const r = planLoadsV2([...stop(102, 700), ...stop(103, 700)], ctx({ pairMinTimes: 2 }));
  assert.equal(r.summary.trucks, 2);
});

test("two places on the same route may always share a truck", () => {
  // Navsari East 110 and Navsari West 111: both have pair history, but never
  // with each other. Same route → allowed (default); switched off → not.
  const p = planLoadsV2([...stop(110, 700), ...stop(111, 700)], ctx());
  assert.equal(p.summary.trucks, 1);
  const q = planLoadsV2([...stop(110, 700), ...stop(111, 700)], ctx({ sameRoutePairsAlways: false }));
  assert.equal(q.summary.trucks, 2);
});

test("the places limit: no truck carries more places than maxPlacesPerTruck", () => {
  // Three Navsari-route places of 400 kg (not light, so no ride-along); limit 2.
  const p = planLoadsV2([...stop(101, 400), ...stop(110, 400), ...stop(111, 400)], ctx({ maxPlacesPerTruck: 2 }));
  assert.ok(p.cards.every((c) => c.areaNames.length <= 2));
  assert.equal(p.cards.reduce((n, c) => n + c.stopCount, 0), 3);
});

test("ride-along: a light load joins a load it could not pair with", () => {
  // Valsad 150 kg (< 300) with Bilimora 900 kg: no pair row, different routes —
  // but a light load rides along, ignoring the pair rule.
  const p = planLoadsV2([...stop(102, 900), ...stop(104, 150)], ctx());
  assert.equal(p.summary.trucks, 1);
  assert.equal(p.summary.hold, 0);
  assert.match(p.cards[0].reason, /Valsad rides along/);
  // At 400 kg it is not light: the pair rule applies and they go apart.
  const q = planLoadsV2([...stop(102, 900), ...stop(104, 400)], ctx());
  assert.equal(q.summary.trucks, 2);
});

test("reasons name the PLACES, not the routes", () => {
  // Bilimora (Chikhli route) carries the most; Navsari Town (Navsari route) joined.
  const p = planLoadsV2([...stop(102, 900), ...stop(101, 400)], ctx());
  assert.equal(p.summary.trucks, 1);
  assert.equal(p.cards[0].reason, "Navsari Town joined Bilimora — saves a truck.");
});

test("a new area (no rate row, no pairs) may pair within its own route", () => {
  const p = planLoadsV2([...stop(109, 500), ...stop(101, 700)], ctx());
  assert.equal(p.summary.trucks, 1);
  assert.equal(p.cards[0].flags.newArea, true);
});

test("GC is blocked on a far area (gcAllowed false) and used on a near one", () => {
  // No Aces today. Vapi (far) small load → Big; Navsari (near) small load → GC.
  // Different sides keep them apart: Vapi South, Kamrej North.
  const p = planLoadsV2([...stop(103, 500), ...stop(106, 500)], ctx(), { ace: 0 });
  const vapi = p.cards.find((c) => c.areaNames.includes("Vapi Town"))!;
  const kamrej = p.cards.find((c) => c.areaNames.includes("Kamrej Town"))!;
  assert.equal(vapi.type, "big");
  assert.equal(kamrej.type, "gc");
});

test("an Ace-only load: 7 stops go on the Ace", () => {
  const bills = Array.from({ length: 7 }, (_, i) => stop(101, 150, { key: `c:ace-${i}` })).flat();
  const p = planLoadsV2(bills, ctx(), { ace: 1 });
  assert.equal(p.summary.ace, 1);
  const ace = p.cards.find((c) => c.type === "ace")!;
  assert.equal(ace.stopCount, 7);
  assert.equal(ace.flags.overIdealStops, true); // 7 > Ace ideal 6
  assert.match(ace.reason, /only an Ace carries that many/);
});

test("no Ace left: the 7 stops are re-planned without an Ace, ≤ 6 stops each", () => {
  const bills = Array.from({ length: 7 }, (_, i) => stop(101, 150, { key: `c:noace-${i}` })).flat();
  const p = planLoadsV2(bills, ctx(), { ace: 0 });
  assert.equal(p.summary.ace, 0);
  const trucks = p.cards.filter((c) => c.type === "big" || c.type === "gc");
  assert.ok(trucks.length >= 2);
  assert.ok(trucks.every((c) => c.stopCount <= 6));
  assert.equal(trucks.reduce((n, c) => n + c.stopCount, 0), 7);
  assert.ok(trucks.some((c) => /Re-planned without an Ace/.test(c.reason)));
});

test("too few vehicles: the overdue load gets the truck, the rest wait", () => {
  // Two loads on different sides (can never join), one Big and nothing else.
  const onTime = stop(105, 1600, { key: "c:ontime" }); // North
  const overdue = stop(103, 1600, { key: "c:overdue", overdue: true }); // South
  const p = planLoadsV2([...onTime, ...overdue], ctx(), { ace: 0, gc: 0, big: 1 });
  const truck = p.cards.find((c) => c.type === "big")!;
  assert.deepEqual(truck.areaNames, ["Vapi Town"]);
  const waiting = p.cards.find((c) => c.type === "waiting")!;
  assert.deepEqual(waiting.areaNames, ["Bharuch Town"]);
  // The Waiting card names the CHEAPEST vehicle that would carry what waits —
  // 1,600 kg fits an Ace, which costs less than a Big here.
  assert.match(waiting.reason, /needs 1 more Ace/);
  assert.deepEqual(waiting.needs, { ace: 1 });
  assert.equal(p.summary.waiting, 1);
});

test("hold: a light load with nothing to ride along with, not overdue — not a truck", () => {
  const p = planLoadsV2([...stop(107, 150), ...stop(101, 900)], ctx());
  const hold = p.cards.find((c) => c.type === "hold")!;
  assert.deepEqual(hold.areaNames, ["Adajan"]);
  assert.match(hold.reason, /hold for tomorrow/);
  assert.equal(p.summary.trucks, 1);
  // Overdue → it goes today.
  const q = planLoadsV2([...stop(107, 150, { overdue: true }), ...stop(101, 900)], ctx());
  assert.equal(q.summary.hold, 0);
  assert.equal(q.summary.trucks, 2);
});

test("stop order: farthest first (highest Big rate), back toward Surat", () => {
  // Navsari 101 (Big 1437) · Valsad 104 (2111) · Vapi 103 (2213): all pair ≥ 2.
  const p = planLoadsV2([...stop(101, 400), ...stop(104, 400), ...stop(103, 400)], ctx());
  assert.equal(p.summary.trucks, 1);
  assert.deepEqual(p.cards[0].stops.map((s) => s.areaName), ["Vapi Town", "Valsad", "Navsari Town"]);
});

test("deterministic: the same pool in any order gives the same plan", () => {
  const bills = [
    ...stop(101, 700), ...stop(102, 500), ...stop(103, 900, { bills: 2 }), ...stop(104, 300),
    ...stop(105, 1200), ...stop(106, 800), ...stop(107, 350), ...stop(108, 200), ...stop(110, 450),
  ];
  const a = planLoadsV2(bills, ctx());
  const b = planLoadsV2(bills.slice().reverse(), ctx());
  const c = planLoadsV2(bills.slice(3).concat(bills.slice(0, 3)), ctx());
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

test("no rupee value anywhere in the output", () => {
  const bills = [
    ...stop(101, 700), ...stop(102, 500), ...stop(103, 900), ...stop(104, 300), ...stop(105, 1200),
    ...stop(106, 800), ...stop(107, 150), ...stop(108, 200), ...stop(109, 450), ...stop(110, 3100),
  ];
  const plan = planLoadsV2(bills, ctx(), { ace: 1, gc: 1 });
  const json = JSON.stringify(plan);
  // No field that sounds like money.
  assert.doesNotMatch(json, /rate|cost|saving|penalty|rupee|₹|"rs"/i);
  // No fixture rate, extra or penalty value appears as a number anywhere
  // EXCEPT in the identity and weight fields — bill ids, area ids, stop keys,
  // kilos and counts. Those are not money, and their small numbers can
  // coincide with a made-up extra. Every other number is checked, including
  // any digits inside a reason.
  const secret = new Set<number>([613]);
  Object.keys(R).forEach((k) => R[Number(k)].slice(0, 6).forEach((v) => secret.add(v as number)));
  const SAFE = new Set(["orderIds", "areaId", "stopKey", "key", "kg", "stopCount", "totalKg", "ace", "big", "gc", "trucks", "bulk", "direct", "hold", "waiting"]);
  const scanned = JSON.stringify(plan, (k, v) => (SAFE.has(k) ? undefined : v));
  const numbers = (scanned.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const leaked = numbers.filter((n) => secret.has(n));
  assert.deepEqual(leaked, [], `rate values in output: ${leaked.join(", ")}`);
});

test("light milk run: an Ace takes 9–10 stops only when the load is light", () => {
  const LR = { aceLightRun: { maxStops: 10, maxKg: 1500 } };
  // 10 stops of 120 kg = 1,200 kg → one Ace on a light run, flagged.
  const ten = Array.from({ length: 10 }, (_, i) => stop(101, 120, { key: `c:lr-${i}` })).flat();
  const p = planLoadsV2(ten, ctx(LR), { ace: 1 });
  const ace = p.cards.find((c) => c.type === "ace")!;
  assert.equal(ace.stopCount, 10);
  assert.equal(ace.flags.lightRun, true);
  assert.match(ace.reason, /Light milk run — 10 stops, 1,500 kg or less/);
  // 10 stops of 200 kg = 2,000 kg → too heavy for a light run: no truck over 8 stops.
  const heavy = Array.from({ length: 10 }, (_, i) => stop(101, 200, { key: `c:lh-${i}` })).flat();
  const q = planLoadsV2(heavy, ctx(LR), { ace: 1 });
  assert.ok(q.cards.every((c) => c.stopCount <= 8 && !c.flags.lightRun));
  // Off by default: the same light 10 stops never go on one truck.
  const r = planLoadsV2(ten.map((b) => ({ ...b })), ctx(), { ace: 1 });
  assert.ok(r.cards.every((c) => c.stopCount <= 8 && !c.flags.lightRun));
});

test("config: aceLightRun is optional; a malformed one → null", () => {
  assert.equal(parseLoadPlanV2Config(RAW_CONFIG)!.aceLightRun, null);
  assert.deepEqual(parseLoadPlanV2Config({ ...RAW_CONFIG, aceLightRun: { maxStops: 10, maxKg: 1200 } })!.aceLightRun, { maxStops: 10, maxKg: 1200 });
  assert.equal(parseLoadPlanV2Config({ ...RAW_CONFIG, aceLightRun: { maxStops: 10 } }), null);
});

test("hard limits: hardMaxKg lets a Big carry more; above the rated load it is flagged amber", () => {
  const VEH = RAW_CONFIG.vehicles;
  const hard = { vehicles: { ...VEH, big: { ...VEH.big, hardMaxKg: 5350 } } };
  // Three Navsari-route stops, 4,000 kg: over a normal 3+-stop Big (3,050).
  const bills = [...stop(101, 1400), ...stop(110, 1300), ...stop(111, 1300)];
  const off = planLoadsV2(bills, ctx(), { ace: 0, gc: 0 });
  assert.ok(off.summary.trucks >= 2);
  const on = planLoadsV2(bills.map((b) => ({ ...b })), ctx(hard), { ace: 0, gc: 0 });
  assert.equal(on.summary.trucks, 1);
  assert.equal(on.cards[0].flags.overloaded, true); // 4,000 > rated 3,000 + 50
  assert.equal(on.cards[0].flags.amber, true);
});

test("soft stop charge: stops above the ideal cost extra, so the plan avoids them", () => {
  // Six 400 kg stops in one place (not light, so none rides along — a rider
  // ignores cost by rule); no Aces or GCs. Big ideal 5, max 6.
  const six = () => Array.from({ length: 6 }, (_, i) => stop(101, 400, { key: `c:soft-${i}` })).flat();
  const free = planLoadsV2(six(), ctx(), { ace: 0, gc: 0 });
  assert.equal(free.summary.trucks, 1);
  assert.equal(free.cards[0].flags.amber, true); // 6 stops > ideal 5
  const charged = planLoadsV2(six(), ctx({ stopChargeRs: 100000 }), { ace: 0, gc: 0 });
  assert.ok(charged.cards.every((c) => c.stopCount <= 5 && !c.flags.amber));
  // The soft cost never reaches the output.
  assert.doesNotMatch(JSON.stringify(charged), /100000|charge/i);
});
