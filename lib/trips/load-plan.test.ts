// lib/trips/load-plan.test.ts — Node's built-in runner through tsx (no new
// dependency):  npx tsx --test lib/trips/load-plan.test.ts   (npm run test:load-plan)
//
// Every expected result below was worked out BY HAND from the rules in
// lib/trips/load-plan.ts; the working is in the comment above each case.

import test from "node:test";
import assert from "node:assert/strict";
import { planLoads, parseLoadPlanConfig, summarisePlan, type LoadPlanBill, type LoadPlanConfig } from "./load-plan";

// The Upcountry route ids (route_master, read 2026-09-19).
const NAVSARI = 11, VAPI = 12, BHARUCH = 17, CHIKHLI = 21, VANSDA = 13, BARDOLI = 14, KAMREJ = 19, ADAJAN = 9;
const NAME: Record<number, string> = {
  [NAVSARI]: "Navsari", [VAPI]: "Vapi", [BHARUCH]: "Bharuch", [CHIKHLI]: "Chikhli",
  [VANSDA]: "Vansda", [BARDOLI]: "Bardoli", [KAMREJ]: "Kamrej", [ADAJAN]: "Adajan",
};

/** The seeded Upcountry config (sql/2026-09-19-load-plan-config.sql). */
const CONFIG: LoadPlanConfig = {
  smallMaxKg: 2000,
  bigMaxKg: 3000,
  mainRouteIds: [NAVSARI, VAPI, BHARUCH],
  partners: [
    { routeId: CHIKHLI, joins: [VAPI, NAVSARI], pick: "most_space" },
    { routeId: VANSDA, joins: [NAVSARI, VAPI], pick: "in_order" },
    { routeId: BARDOLI, joins: [NAVSARI], pick: "in_order" },
    { routeId: KAMREJ, joins: [BHARUCH], pick: "in_order" },
  ],
};

let nextId = 1;
/** One stop of `kg` on a route, as `bills` bills sharing one stopKey. */
function stop(routeId: number | null, kg: number, bills = 1, key?: string): LoadPlanBill[] {
  const stopKey = key ?? `c:${routeId}-${kg}-${nextId}`;
  return Array.from({ length: bills }, () => ({
    orderId: nextId++,
    routeId,
    routeName: routeId === null ? null : NAME[routeId],
    stopKey,
    weightKg: kg / bills,
  }));
}
const shape = (bills: LoadPlanBill[], config: LoadPlanConfig | null = CONFIG) =>
  planLoads(bills, config, NAME).map((t) => ({ routes: t.routeNames.join(" + "), kg: Math.round(t.kg), kind: t.kind }));

test("(a) the worked example — 9,600 kg into 4 trucks, 3 big, 1 small", () => {
  // Navsari 4,200 as stops 1500/1200/900/600. Largest first, first-fit to 3,000:
  //   1500 → 1500; +1200 → 2700; +900 = 3600 ✗; +600 = 3300 ✗  → full truck 2,700.
  //   Left: 900 + 600 = 1,500 → Navsari's open truck.
  // Vapi 1,300 → open. Bharuch 1,800 → open.
  // Chikhli 700 (most_space over Vapi, Navsari): Vapi free 1,700, Navsari free
  //   1,500 → Vapi → 2,000.
  // Vansda 300 (in_order Navsari, Vapi): Navsari 1,500 + 300 = 1,800 → Navsari.
  // Bardoli 900 → Navsari 1,800 + 900 = 2,700 ≤ 3,000 → Navsari.
  // Kamrej 400 → Bharuch 1,800 + 400 = 2,200.
  // Trucks: Navsari 2,700 Big · Navsari+Vansda+Bardoli 2,700 Big ·
  //         Bharuch+Kamrej 2,200 Big · Vapi+Chikhli 2,000 Small.
  const bills = [
    ...stop(NAVSARI, 1500, 3), ...stop(NAVSARI, 1200, 2), ...stop(NAVSARI, 900), ...stop(NAVSARI, 600),
    ...stop(VAPI, 800, 2), ...stop(VAPI, 500),
    ...stop(CHIKHLI, 700),
    ...stop(VANSDA, 300),
    ...stop(BHARUCH, 1000), ...stop(BHARUCH, 800),
    ...stop(KAMREJ, 400),
    ...stop(BARDOLI, 900),
  ];
  const got = shape(bills);
  assert.deepEqual(
    got.map((t) => t.kind).sort(),
    ["big", "big", "big", "small"],
  );
  assert.deepEqual(new Set(got.map((t) => `${t.routes}|${t.kg}|${t.kind}`)), new Set([
    "Navsari|2700|big",
    "Navsari + Vansda + Bardoli|2700|big",
    "Bharuch + Kamrej|2200|big",
    "Vapi + Chikhli|2000|small",
  ]));
  // Sorted by kg, highest first.
  assert.deepEqual(got.map((t) => t.kg), [2700, 2700, 2200, 2000]);
  const s = summarisePlan(planLoads(bills, CONFIG));
  assert.deepEqual(s, { kg: 9600, trucks: 4, big: 3, small: 1, bulk: 0 });
  // The reasons.
  const plan = planLoads(bills, CONFIG);
  const byRoutes = (r: string) => plan.find((t) => t.routeNames.join(" + ") === r)!;
  assert.equal(byRoutes("Navsari").reason, "Full load of Navsari.");
  assert.equal(byRoutes("Navsari + Vansda + Bardoli").reason, "Vansda and Bardoli fit on the Navsari truck.");
  assert.equal(
    byRoutes("Vapi + Chikhli").reason,
    "Chikhli fits on the Vapi truck. Chikhli picked Vapi because it had more space than Navsari.",
  );
  // Every bill is on exactly one truck.
  assert.equal(plan.flatMap((t) => t.orderIds).length, bills.length);
});

test("(b) Chikhli 2,500 + Vapi 300 → one Big truck, Vapi + Chikhli", () => {
  // Vapi 300 is open; Chikhli 2,500 fits (2,800 ≤ 3,000); no Navsari truck.
  assert.deepEqual(shape([...stop(CHIKHLI, 2500), ...stop(VAPI, 300)]), [
    { routes: "Vapi + Chikhli", kg: 2800, kind: "big" },
  ]);
});

test("(c) Chikhli 2,500 + Vapi 1,800 → two trucks", () => {
  // 1,800 + 2,500 = 4,300 > 3,000 → Chikhli goes on its own.
  const plan = planLoads([...stop(CHIKHLI, 2500), ...stop(VAPI, 1800)], CONFIG);
  assert.deepEqual(plan.map((t) => `${t.routeNames.join(" + ")}|${Math.round(t.kg)}|${t.kind}`), [
    "Chikhli|2500|big",
    "Vapi|1800|small",
  ]);
  assert.equal(plan[0].reason, "No room on the Vapi truck, so Chikhli goes on its own.");
});

test("(d) Chikhli picks the partner with more space", () => {
  // Vapi 1,500 (free 1,500), Navsari 1,000 (free 2,000), Chikhli 500 → Navsari.
  const plan = planLoads([...stop(VAPI, 1500), ...stop(NAVSARI, 1000), ...stop(CHIKHLI, 500)], CONFIG);
  const joined = plan.find((t) => t.routeNames.includes("Chikhli"))!;
  assert.deepEqual(joined.routeNames, ["Navsari", "Chikhli"]);
  assert.equal(Math.round(joined.kg), 1500);
  assert.match(joined.reason, /Chikhli picked Navsari because it had more space than Vapi\./);
});

test("(d2) a tie on free space goes to list order — Vapi first for Chikhli", () => {
  // Vapi 1,000 and Navsari 1,000 both free 2,000; Chikhli's list is [Vapi, Navsari].
  const plan = planLoads([...stop(VAPI, 1000), ...stop(NAVSARI, 1000), ...stop(CHIKHLI, 300)], CONFIG);
  assert.deepEqual(plan.find((t) => t.routeNames.includes("Chikhli"))!.routeNames, ["Vapi", "Chikhli"]);
});

test("(e) a single stop of 3,400 kg is its own BULK truck, never split, not counted", () => {
  // The stop is two bills of 1,700 — they must stay together.
  const bills = [...stop(NAVSARI, 3400, 2), ...stop(NAVSARI, 800)];
  const plan = planLoads(bills, CONFIG);
  const bulk = plan.find((t) => t.kind === "bulk")!;
  assert.equal(Math.round(bulk.kg), 3400);
  assert.equal(bulk.capacityKg, null);
  assert.equal(bulk.orderIds.length, 2);
  assert.equal(bulk.stopCount, 1);
  assert.match(bulk.reason, /over 3,000 kg/);
  // The other Navsari stop is a normal (small) truck.
  assert.deepEqual(plan.filter((t) => t.kind !== "bulk").map((t) => `${t.routeNames.join("+")}|${Math.round(t.kg)}|${t.kind}`), ["Navsari|800|small"]);
  assert.deepEqual(summarisePlan(plan), { kg: 4200, trucks: 1, big: 0, small: 1, bulk: 1 });
});

test("(f) no config → empty result, no crash; a malformed config parses to null", () => {
  assert.deepEqual(planLoads(stop(NAVSARI, 500), null), []);
  assert.equal(parseLoadPlanConfig(null), null);
  assert.equal(parseLoadPlanConfig({ smallMaxKg: 2000 }), null);
  assert.equal(parseLoadPlanConfig({ ...CONFIG, partners: [{ routeId: 21, joins: [12], pick: "biggest" }] }), null);
  assert.equal(parseLoadPlanConfig({ ...CONFIG, smallMaxKg: 4000 }), null); // small bigger than big
  assert.deepEqual(parseLoadPlanConfig(JSON.parse(JSON.stringify(CONFIG))), CONFIG);
});

test("(g) a partner over 3,000 fills a full Big truck first; only its leftover joins", () => {
  // Vansda 4,087 as stops 2119 / 1100 / 868. First-fit to 3,000:
  //   2119 → 2119; +1100 = 3219 ✗; +868 → 2987  → full Vansda truck 2,987.
  //   Leftover 1,100. Navsari 500 open → 500 + 1,100 = 1,600 ≤ 3,000 → joins.
  const plan = planLoads([...stop(VANSDA, 2119), ...stop(VANSDA, 1100), ...stop(VANSDA, 868), ...stop(NAVSARI, 500)], CONFIG);
  assert.deepEqual(plan.map((t) => `${t.routeNames.join(" + ")}|${Math.round(t.kg)}|${t.kind}`), [
    "Vansda|2987|big",
    "Navsari + Vansda|1600|small",
  ]);
  assert.equal(plan[0].reason, "Full load of Vansda.");
  assert.equal(plan[1].reason, "Vansda fits on the Navsari truck.");
});

test("(h) only a main route's LEFTOVER is joinable — no leftover, the partner goes alone", () => {
  // Navsari 3,000 + 3,000: 6,000 is over 3,000 → one full truck of 3,000. The
  // other 3,000 is NOT over 3,000, so it is Navsari's LEFTOVER — its open truck,
  // already at 3,000. Bardoli 900 (3,900) does not fit → own truck, "No room".
  // (So under "fill while over 3,000" a main route with any bills always keeps
  // an open truck; it has none only when it has no bills at all — case b.)
  const a = planLoads([...stop(NAVSARI, 3000), ...stop(NAVSARI, 3000), ...stop(BARDOLI, 900)], CONFIG);
  assert.deepEqual(a.map((t) => `${t.routeNames.join("+")}|${Math.round(t.kg)}`), ["Navsari|3000", "Navsari|3000", "Bardoli|900"]);
  assert.equal(a.find((t) => t.routeNames[0] === "Bardoli")!.reason, "No room on the Navsari truck, so Bardoli goes on its own.");
  // No Navsari bills at all → no open truck → Bardoli has nothing to join.
  const b = planLoads([...stop(BARDOLI, 900)], CONFIG, NAME);
  assert.equal(b[0].reason, "No open Navsari truck to join, so Bardoli goes on its own.");
  // Without the names map it never prints a bare id.
  assert.equal(planLoads([...stop(BARDOLI, 900)], CONFIG)[0].reason, "No open Route 11 truck to join, so Bardoli goes on its own.");
});

test("(i) a route with no partner rule, and route-less bills, go on their own — never mixed", () => {
  const plan = planLoads([...stop(ADAJAN, 600), ...stop(null, 40), ...stop(NAVSARI, 500)], CONFIG);
  assert.deepEqual(plan.map((t) => t.routeNames.join(" + ")).sort(), ["Adajan", "Navsari", "No route"]);
  assert.equal(plan.find((t) => t.routeNames[0] === "Adajan")!.reason, "Adajan has no partner route, so it goes on its own.");
});

test("(j) stable: the same pool in any order gives the same trucks in the same order", () => {
  const bills = [
    ...stop(NAVSARI, 1500, 3), ...stop(NAVSARI, 1200, 2), ...stop(NAVSARI, 900), ...stop(VAPI, 800),
    ...stop(CHIKHLI, 700), ...stop(VANSDA, 300), ...stop(BHARUCH, 1000), ...stop(KAMREJ, 400), ...stop(BARDOLI, 900),
  ];
  const a = planLoads(bills, CONFIG);
  const b = planLoads([...bills].reverse(), CONFIG);
  assert.deepEqual(b, a);
});

test("(k) an unknown weight packs as 0 kg and is counted", () => {
  const bills: LoadPlanBill[] = [
    ...stop(VAPI, 500),
    { orderId: 9001, routeId: VAPI, routeName: "Vapi", stopKey: "c:x", weightKg: null },
    { orderId: 9002, routeId: VAPI, routeName: "Vapi", stopKey: "c:y", weightKg: 0 },
  ];
  const [t] = planLoads(bills, CONFIG);
  assert.equal(Math.round(t.kg), 500);
  assert.equal(t.unknownWeightCount, 2);
  assert.equal(t.orderIds.length, 3);
});
