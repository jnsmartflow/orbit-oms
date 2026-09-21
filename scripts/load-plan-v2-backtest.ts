// scripts/load-plan-v2-backtest.ts — LOCAL ONLY, READ-ONLY (2026-09-21).
//
//   NODE_PATH=node_modules npx tsx scripts/load-plan-v2-backtest.ts
//
// Replays real Upcountry days through the v2 engine and compares the plan with
// the trucks that actually went.
//
// INPUT: docs/data/load-plan/load_plan_backtest_history.csv — 233 days of real
// trucks from NTS records (date, tripNo, vehicleClass, stopKey, areaId,
// routeId, kg). 🔴 That file is .gitignore'd and must never be committed; this
// script only reads it. The rates, pairs and config come from the database,
// READ-ONLY, through lib/floor/load-plan-v2-loader.ts.
//
// 🔴 RATES ARE SECRET. This prints to the terminal only, writes no file, and
// never prints a rupee amount: cost is shown ONLY as plan ÷ actual, both priced
// with the same rate table. Example days show areas, kg, stops and vehicle.
//
// Each day: the pool is every row of that date (a row is a bill; rows sharing
// a stopKey are one stop; nobody is overdue), planned with Ace = 2, GC = 3,
// Big unlimited.

import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { loadPlanV2Context } from "@/lib/floor/load-plan-v2-loader";
import { kgCap, makePricer, planLoadsV2, V2_DEFAULTS, type LoadPlanV2Context, type V2Bill, type V2Card, type VehicleType } from "@/lib/trips/load-plan-v2";

const HISTORY = path.join(process.cwd(), "docs/data/load-plan/load_plan_backtest_history.csv");
const COUNTS = { ace: 2, gc: 3 } as const;
const LIGHT_KG = 5_600;
const HEAVY_KG = 27_000;
/** History "trucks" lighter than this are record noise — not counted as trucks. */
const NOISE_TRUCK_KG = 20;
/**
 * The owner's revised values (2026-09-21) for keys the LIVE config row still
 * sets to the old numbers — a row value overrides a code default, so this run
 * applies them explicitly and says so in its header.
 */
const RUN_OVERRIDES = { pairMinTimes: V2_DEFAULTS.pairMinTimes, maxPlacesPerTruck: V2_DEFAULTS.maxPlacesPerTruck };

interface Row { date: string; tripNo: string; vehicleClass: string; stopKey: string; areaId: number; routeId: number; kg: number }

function readHistory(): Row[] {
  if (!fs.existsSync(HISTORY)) throw new Error(`History file not found: ${HISTORY}`);
  const lines = fs.readFileSync(HISTORY, "utf8").replace(/\r/g, "").trim().split("\n");
  const head = lines[0].split(",");
  const col = (n: string) => {
    const i = head.indexOf(n);
    if (i < 0) throw new Error(`History file has no "${n}" column`);
    return i;
  };
  const c = { date: col("date"), tripNo: col("tripNo"), vehicleClass: col("vehicleClass"), stopKey: col("stopKey"), areaId: col("areaId"), routeId: col("routeId"), kg: col("kg") };
  return lines.slice(1).map((l) => {
    const f = l.split(",");
    return { date: f[c.date], tripNo: f[c.tripNo], vehicleClass: f[c.vehicleClass], stopKey: f[c.stopKey], areaId: Number(f[c.areaId]), routeId: Number(f[c.routeId]), kg: Number(f[c.kg]) };
  });
}

// ── Stats helpers ───────────────────────────────────────────────────────────
const sorted = (xs: number[]) => xs.slice().sort((a, b) => a - b);
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
const med = (xs: number[]) => quantile(xs, 0.5);
const f0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "—");
const pct = (n: number) => (Number.isFinite(n) ? `${n.toFixed(0)}%` : "—");
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

// ── One truck, actual or planned, in the terms both sides share ─────────────
interface Truck { vehicle: string; areaIds: number[]; kg: number; stops: number; routeId: number | null; /** Places the pair rule and places limit apply to (plan: riders excluded). Default: all. */ coreAreaIds?: number[] }

/** The vehicle a truck is priced and measured as. "other" (and bulk / direct / hold / waiting in a plan) → Big. */
const asVehicle = (v: string): VehicleType => (v === "ace" || v === "gc" ? v : "big");

async function main() {
  const rows = readHistory();
  const ctx = await loadPlanV2Context("Upcountry");
  if (!ctx) {
    console.log("v2 is not set up in the database (config, rates or pairs missing) — nothing to backtest.");
    return;
  }
  const liveRow = { pairMinTimes: ctx.config.pairMinTimes, maxPlacesPerTruck: ctx.config.maxPlacesPerTruck };
  ctx.config = { ...ctx.config, ...RUN_OVERRIDES };
  const price = makePricer(ctx);
  const V = ctx.config.vehicles;
  const areaName = (id: number) => ctx.areas.get(id)?.name ?? `Area ${id}`;

  const byDate = new Map<string, Row[]>();
  rows.forEach((r) => byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]));
  const dates = Array.from(byDate.keys()).sort();

  interface Day { date: string; kg: number; type: "light" | "normal" | "heavy"; actual: Truck[]; plan: Truck[]; cards: V2Card[]; actualCost: number; planCost: number; breaks: Breaks }
  interface Breaks { kg: number; stops: number; gc: number; pair: number; places: number }
  const days: Day[] = [];
  let noiseTrucks = 0;

  for (const date of dates) {
    const dayRows = byDate.get(date)!;
    const kg = dayRows.reduce((n, r) => n + r.kg, 0);
    const type = kg < LIGHT_KG ? "light" : kg > HEAVY_KG ? "heavy" : "normal";

    // What actually went: group by tripNo.
    const trips = new Map<string, Row[]>();
    dayRows.forEach((r) => trips.set(r.tripNo, [...(trips.get(r.tripNo) ?? []), r]));
    const actualAll: Truck[] = Array.from(trips.values()).map((rs) => ({
      vehicle: rs[0].vehicleClass,
      areaIds: Array.from(new Set(rs.map((r) => r.areaId))),
      kg: rs.reduce((n, r) => n + r.kg, 0),
      stops: new Set(rs.map((r) => r.stopKey)).size,
      routeId: rs[0].routeId,
    }));
    // Record noise (a "truck" under 20 kg) is not a truck. Its bills stay in
    // the day's pool and are planned like any other.
    const actual = actualAll.filter((t) => t.kg >= NOISE_TRUCK_KG);
    noiseTrucks += actualAll.length - actual.length;

    // The plan.
    const bills: V2Bill[] = dayRows.map((r, i) => ({ orderId: i + 1, weightKg: r.kg, stopKey: r.stopKey, areaId: r.areaId, routeId: r.routeId, overdue: false }));
    const planOut = planLoadsV2(bills, ctx, COUNTS);
    const plan: Truck[] = planOut.cards.map((c) => ({
      vehicle: c.type,
      areaIds: Array.from(new Set(c.stops.map((s) => s.areaId).filter((a): a is number => a !== null))),
      kg: c.kg,
      stops: c.stopCount,
      routeId: null,
    }));

    // Cost, both sides priced with the SAME table. A plan's BULK card (one bill
    // heavier than a direct Big) is priced honestly as ⌈kg ÷ direct-Big kg⌉ Bigs;
    // a direct card as a Big; a HOLD as a Big too (it still has to go).
    const bulkTrucks = (kg: number) => Math.ceil(kg / kgCap(ctx.config, "big", 1));
    const costOf = (t: Truck) => {
      const one = price(t.areaIds, asVehicle(t.vehicle), t.routeId);
      return t.vehicle === "bulk" ? one * bulkTrucks(t.kg) : one;
    };
    const actualCost = actual.reduce((n, t) => n + costOf(t), 0);
    const planCost = plan.reduce((n, t) => n + costOf(t), 0);

    days.push({ date, kg, type, actual, plan, cards: planOut.cards, actualCost, planCost, breaks: limitBreaks(planOut.cards, ctx) });
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const isTruck = (v: string) => v === "ace" || v === "big" || v === "gc";
  const planTrucks = (d: Day) => d.plan.filter((t) => t.vehicle !== "hold");
  /** Trucks a plan needs: a bulk card is ⌈kg ÷ 3,000⌉ of them. */
  const planTruckCount = (d: Day) => planTrucks(d).reduce((n, t) => n + (t.vehicle === "bulk" ? Math.ceil(t.kg / kgCap(ctx.config, "big", 1)) : 1), 0);
  const line = "─".repeat(78);
  console.log(line);
  console.log(`LOAD PLAN v2 BACKTEST — ${days.length} days, ${rows.length.toLocaleString("en-US")} bills, Ace ${COUNTS.ace} / GC ${COUNTS.gc} / Big unlimited`);
  console.log(`Rules: pairMinTimes ${ctx.config.pairMinTimes} · same route always · places ≤ ${ctx.config.maxPlacesPerTruck} · ride-along < ${ctx.config.rideAlongBelowKg} kg · direct Big (1–2 stops) ≤ ${ctx.config.directBigMaxKg} kg · heavy stops split by bill`);
  console.log(`       (live config row still says pairMinTimes ${liveRow.pairMinTimes}, maxPlacesPerTruck ${liveRow.maxPlacesPerTruck} — overridden for this run)`);
  console.log(`History: ${noiseTrucks} "trucks" under ${NOISE_TRUCK_KG} kg ignored as record noise (their bills are still planned)`);
  console.log(line);

  const section = (title: string, ds: Day[]) => {
    if (ds.length === 0) return;
    const aT = ds.flatMap((d) => d.actual);
    const pAll = ds.flatMap((d) => d.plan);
    const pT = pAll.filter((t) => isTruck(t.vehicle));
    const aCount = ds.reduce((n, d) => n + d.actual.length, 0);
    const pCount = ds.reduce((n, d) => n + planTruckCount(d), 0);
    const mix = (ts: Truck[], keys: string[]) => keys.map((k) => `${k} ${ts.filter((t) => t.vehicle === k).length}`).join(" · ");
    const fill = (t: Truck) => (t.kg / V[asVehicle(t.vehicle)].maxKg) * 100;
    const aCost = ds.reduce((n, d) => n + d.actualCost, 0);
    const pCost = ds.reduce((n, d) => n + d.planCost, 0);
    const br = ds.reduce((b, d) => ({ kg: b.kg + d.breaks.kg, stops: b.stops + d.breaks.stops, gc: b.gc + d.breaks.gc, pair: b.pair + d.breaks.pair, places: b.places + d.breaks.places }), { kg: 0, stops: 0, gc: 0, pair: 0, places: 0 });

    console.log(`\n${title} — ${ds.length} days, ${f0(ds.reduce((n, d) => n + d.kg, 0))} kg`);
    console.log(`  Trucks            actual ${f0(aCount)}  ·  plan ${f0(pCount)}  (median day: actual ${f0(med(ds.map((d) => d.actual.length)))}, plan ${f0(med(ds.map((d) => planTruckCount(d))))})  [bulk counted as ⌈kg ÷ direct-Big kg⌉]`);
    console.log(`  Vehicle mix       actual: ${mix(aT, ["ace", "big", "gc", "other"])}`);
    console.log(`                    plan:   ${mix(pAll, ["ace", "big", "gc", "bulk", "direct", "waiting"])}  (+ hold ${pAll.filter((t) => t.vehicle === "hold").length}, not trucks)`);
    console.log(`  Stops / truck     actual median ${f0(med(aT.map((t) => t.stops)))} · 90% ${f0(quantile(aT.map((t) => t.stops), 0.9))} · max ${f0(Math.max(...aT.map((t) => t.stops)))}`);
    console.log(`                    plan   median ${f0(med(pT.map((t) => t.stops)))} · 90% ${f0(quantile(pT.map((t) => t.stops), 0.9))} · max ${f0(Math.max(...pT.map((t) => t.stops)))}`);
    console.log(`  kg / truck        actual median ${f0(med(aT.map((t) => t.kg)))} (fill ${pct(med(aT.map(fill)))})  ·  plan median ${f0(med(pT.map((t) => t.kg)))} (fill ${pct(med(pT.map(fill)))})`);
    console.log(`  Limit breaks      kg ${br.kg} · stops ${br.stops} · GC off-area ${br.gc} · pair rule ${br.pair} · places ${br.places}   (must all be 0)`);
    // Context, not a pass/fail: how often the REAL trucks went outside the
    // same v2 limits. A plan that keeps them all needs more trucks than one
    // that does not.
    const ab = truckBreaks(aT, ctx);
    const outside = aT.filter((t) => { const b = truckBreaks([t], ctx); return b.kg + b.stops + b.gc + b.pair + b.places > 0; }).length;
    console.log(`  Actual vs limits  ${outside} of ${aT.length} real trucks (${pct((outside / aT.length) * 100)}) outside them: kg ${ab.kg} · stops ${ab.stops} · GC off-area ${ab.gc} · pair rule ${ab.pair} · places ${ab.places}`);
    console.log(`  Estimated cost    plan = ${pct((pCost / aCost) * 100)} of actual  (same rate table; bulk = ⌈kg ÷ direct-Big kg⌉ Bigs; holds priced as a Big)`);
  };

  section("ALL DAYS", days);
  section("LIGHT days (< 5.6 t)", days.filter((d) => d.type === "light"));
  section("NORMAL days", days.filter((d) => d.type === "normal"));
  section("HEAVY days (> 27 t)", days.filter((d) => d.type === "heavy"));

  // ── Three example days: the median-kg day of each type ────────────────────
  for (const t of ["light", "normal", "heavy"] as const) {
    const ds = days.filter((d) => d.type === t).sort((a, b) => a.kg - b.kg);
    if (ds.length === 0) continue;
    const d = ds[(ds.length - 1) >> 1];
    console.log(`\n${line}\nEXAMPLE — ${t.toUpperCase()} DAY ${d.date} · ${f0(d.kg)} kg · actual ${d.actual.length} trucks · plan ${planTruckCount(d)} trucks${d.plan.some((x) => x.vehicle === "hold") ? " + hold" : ""}\n${line}`);
    const fmt = (vehicle: string, names: string[], kg: number, stops: number) =>
      `${pad(vehicle, 7)} ${pad(names.join(" + ").slice(0, 44), 44)} ${pad(f0(kg), 6)} kg  ${stops} st`;
    console.log("ACTUAL");
    d.actual
      .slice()
      .sort((a, b) => b.kg - a.kg)
      .forEach((x) => console.log("  " + fmt(x.vehicle, x.areaIds.map(areaName), x.kg, x.stops)));
    console.log("PLAN");
    d.cards.forEach((c) => {
      console.log("  " + fmt(c.type, c.areaNames, c.kg, c.stopCount));
      console.log(`          ↳ ${c.reason}`);
    });
  }
  console.log(`\n${line}`);
}

/**
 * The plan's limit breaks, checked INDEPENDENTLY of the engine (its own rules,
 * re-derived from the context), per truck card.
 */
function limitBreaks(cards: V2Card[], ctx: LoadPlanV2Context): { kg: number; stops: number; gc: number; pair: number; places: number } {
  return truckBreaks(
    cards
      .filter((c) => c.type === "ace" || c.type === "big" || c.type === "gc")
      .map((c) => ({
        vehicle: c.type,
        areaIds: Array.from(new Set(c.stops.map((s) => s.areaId).filter((a): a is number => a !== null))),
        // Ride-along places are exempt from the pair rule and the places limit.
        coreAreaIds: Array.from(new Set(c.stops.filter((s) => !s.ridesAlong).map((s) => s.areaId).filter((a): a is number => a !== null))),
        kg: c.kg,
        stops: c.stopCount,
        routeId: null,
      })),
    ctx,
  );
}

/** The same limits, for any trucks — used on the plan AND on what actually went ("other" measured as a Big). */
function truckBreaks(trucks: Truck[], ctx: LoadPlanV2Context): { kg: number; stops: number; gc: number; pair: number; places: number } {
  const V = ctx.config.vehicles;
  const withPairs = new Set<number>();
  Array.from(ctx.pairs.keys()).forEach((k) => k.split("-").forEach((x) => withPairs.add(Number(x))));
  const routeOf = (id: number) => ctx.areas.get(id)?.routeId ?? null;
  const gcOk = (id: number) => ctx.rates.get(id)?.gcAllowed ?? ctx.config.newArea.gcAllowed;
  const pairOk = (a: number, b: number) => {
    if (a === b) return true;
    const sameRoute = routeOf(a) !== null && routeOf(a) === routeOf(b);
    if (sameRoute && (ctx.config.sameRoutePairsAlways || !withPairs.has(a) || !withPairs.has(b))) return true;
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    return (ctx.pairs.get(k) ?? 0) >= ctx.config.pairMinTimes;
  };
  const out = { kg: 0, stops: 0, gc: 0, pair: 0, places: 0 };
  trucks.forEach((c) => {
    const t = asVehicle(c.vehicle);
    const v = V[t];
    const ids = c.coreAreaIds ?? c.areaIds;
    if (c.kg > kgCap(ctx.config, t, c.stops)) out.kg++;
    if (c.stops > v.maxStops) out.stops++;
    // GC near-only applies to EVERY place, riders included.
    if (t === "gc" && !c.areaIds.every(gcOk)) out.gc++;
    if (ids.length > ctx.config.maxPlacesPerTruck) out.places++;
    let broke = false;
    for (let i = 0; i < ids.length && !broke; i++) for (let j = i + 1; j < ids.length; j++) if (!pairOk(ids[i], ids[j])) { broke = true; break; }
    if (broke) out.pair++;
  });
  return out;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
