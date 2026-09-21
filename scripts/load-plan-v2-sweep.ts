// scripts/load-plan-v2-sweep.ts — LOCAL ONLY, READ-ONLY (2026-09-21).
//
//   NODE_PATH=node_modules npx tsx scripts/load-plan-v2-sweep.ts
//
// A focused parameter sweep of the v2 engine over the backtest history — the
// owner's 36 runs (directBigMaxKg × Ace count × Ace maxStops × Big maxStops)
// plus one extra (Ace maxKg 2,500). Everything else as in the backtest: pair
// rule 1 / same route always, places 6, ride-along 300, heavy stops split by
// bill, GC 4 stops, overKg 50, GC count 3, Big unlimited.
//
// INPUT: docs/data/load-plan/load_plan_backtest_history.csv (.gitignore'd —
// never committed) and the v2 context from the database, READ-ONLY.
//
// 🔴 RATES ARE SECRET. Terminal only, no file written, no rupee amount printed:
// cost appears ONLY as plan ÷ actual, both priced with the same rate table.

import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { loadPlanV2Context } from "@/lib/floor/load-plan-v2-loader";
import {
  kgCap,
  makePricer,
  planLoadsV2,
  V2_DEFAULTS,
  type LoadPlanV2Config,
  type LoadPlanV2Context,
  type V2Card,
  type VehicleType,
} from "@/lib/trips/load-plan-v2";

const HISTORY = path.join(process.cwd(), "docs/data/load-plan/load_plan_backtest_history.csv");
const LIGHT_KG = 5_600;
const HEAVY_KG = 27_000;
const NOISE_TRUCK_KG = 20;
const GC_COUNT = 3;
const TARGET_PCT = 105;

interface Row { date: string; tripNo: string; vehicleClass: string; stopKey: string; areaId: number; routeId: number; kg: number }
interface Truck { vehicle: string; areaIds: number[]; coreAreaIds?: number[]; kg: number; stops: number; routeId: number | null }
type DayType = "light" | "normal" | "heavy";

function readHistory(): Row[] {
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

const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
};
const med = (xs: number[]) => quantile(xs, 0.5);
const f0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");
const pct = (n: number, d = 0) => (Number.isFinite(n) ? `${n.toFixed(d)}%` : "—");
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const asVehicle = (v: string): VehicleType => (v === "ace" || v === "gc" ? v : "big");
const isTruckCard = (t: string) => t === "ace" || t === "big" || t === "gc" || t === "direct";

interface RunSpec { directBigMaxKg: number; ace: number; aceStops: number; bigStops: number; aceMaxKg: number; extra?: boolean }
interface Day { date: string; kg: number; type: DayType; actual: Truck[]; cards: V2Card[]; actualCost: number; planCost: number; planTrucks: number }
interface RunResult { spec: RunSpec; days: Day[]; cost: number; costByType: Record<DayType, number>; trucksPlan: number; trucksActual: number; over8: number; maxStops: number; fill: number; breaks: number }

async function main() {
  if (!fs.existsSync(HISTORY)) throw new Error(`History file not found: ${HISTORY}`);
  const rows = readHistory();
  const base = await loadPlanV2Context("Upcountry");
  if (!base) {
    console.log("v2 is not set up in the database — nothing to sweep.");
    return;
  }
  // The owner's revised values for keys the live row still overrides.
  const baseConfig: LoadPlanV2Config = { ...base.config, pairMinTimes: V2_DEFAULTS.pairMinTimes, maxPlacesPerTruck: V2_DEFAULTS.maxPlacesPerTruck };
  const price = makePricer(base);
  const areaName = (id: number) => base.areas.get(id)?.name ?? `Area ${id}`;

  // ── History, once ─────────────────────────────────────────────────────────
  const byDate = new Map<string, Row[]>();
  rows.forEach((r) => byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]));
  const dates = Array.from(byDate.keys()).sort();
  const actualByDate = new Map<string, Truck[]>();
  dates.forEach((d) => {
    const trips = new Map<string, Row[]>();
    byDate.get(d)!.forEach((r) => trips.set(r.tripNo, [...(trips.get(r.tripNo) ?? []), r]));
    actualByDate.set(
      d,
      Array.from(trips.values())
        .map((rs) => ({
          vehicle: rs[0].vehicleClass,
          areaIds: Array.from(new Set(rs.map((r) => r.areaId))),
          kg: rs.reduce((n, r) => n + r.kg, 0),
          stops: new Set(rs.map((r) => r.stopKey)).size,
          routeId: rs[0].routeId,
        }))
        .filter((t) => t.kg >= NOISE_TRUCK_KG),
    );
  });
  const allActual = Array.from(actualByDate.values()).flat();
  const actualCostOf = (t: Truck) => price(t.areaIds, asVehicle(t.vehicle), t.routeId);
  const actualCostByDate = new Map(dates.map((d) => [d, actualByDate.get(d)!.reduce((n, t) => n + actualCostOf(t), 0)] as const));

  // ── One run ───────────────────────────────────────────────────────────────
  const runOnce = (spec: RunSpec): RunResult => {
    const config: LoadPlanV2Config = {
      ...baseConfig,
      directBigMaxKg: spec.directBigMaxKg,
      vehicles: {
        ...baseConfig.vehicles,
        ace: { ...baseConfig.vehicles.ace, maxStops: spec.aceStops, maxKg: spec.aceMaxKg },
        big: { ...baseConfig.vehicles.big, maxStops: spec.bigStops },
      },
    };
    const ctx: LoadPlanV2Context = { ...base, config };
    const bulkN = (kg: number) => Math.ceil(kg / kgCap(config, "big", 1));
    const days: Day[] = dates.map((date) => {
      const dayRows = byDate.get(date)!;
      const kg = dayRows.reduce((n, r) => n + r.kg, 0);
      const type: DayType = kg < LIGHT_KG ? "light" : kg > HEAVY_KG ? "heavy" : "normal";
      const bills = dayRows.map((r, i) => ({ orderId: i + 1, weightKg: r.kg, stopKey: r.stopKey, areaId: r.areaId, routeId: r.routeId, overdue: false }));
      const cards = planLoadsV2(bills, ctx, { ace: spec.ace, gc: GC_COUNT }).cards;
      let planCost = 0;
      let planTrucks = 0;
      cards.forEach((c) => {
        const ids = Array.from(new Set(c.stops.map((s) => s.areaId).filter((a): a is number => a !== null)));
        const one = price(ids, asVehicle(c.type));
        // Hold: priced as a Big (it still has to go), not counted as a truck.
        if (c.type === "bulk") {
          planCost += one * bulkN(c.kg);
          planTrucks += bulkN(c.kg);
        } else {
          planCost += one;
          if (c.type !== "hold") planTrucks += 1;
        }
      });
      return { date, kg, type, actual: actualByDate.get(date)!, cards, actualCost: actualCostByDate.get(date)!, planCost, planTrucks };
    });
    const truckCards = days.flatMap((d) => d.cards.filter((c) => isTruckCard(c.type)));
    const nominal = (t: string) => config.vehicles[asVehicle(t)].maxKg;
    const costPct = (ds: Day[]) => (ds.reduce((n, d) => n + d.planCost, 0) / ds.reduce((n, d) => n + d.actualCost, 0)) * 100;
    return {
      spec,
      days,
      cost: costPct(days),
      costByType: {
        light: costPct(days.filter((d) => d.type === "light")),
        normal: costPct(days.filter((d) => d.type === "normal")),
        heavy: costPct(days.filter((d) => d.type === "heavy")),
      },
      trucksPlan: days.reduce((n, d) => n + d.planTrucks, 0),
      trucksActual: days.reduce((n, d) => n + d.actual.length, 0),
      over8: (truckCards.filter((c) => c.stopCount > 8).length / truckCards.length) * 100,
      maxStops: Math.max(...truckCards.map((c) => c.stopCount)),
      fill: med(truckCards.filter((c) => c.type !== "direct").map((c) => (c.kg / nominal(c.type)) * 100)),
      breaks: breaks(days.flatMap((d) => d.cards), ctx),
    };
  };

  // ── The runs ──────────────────────────────────────────────────────────────
  const specs: RunSpec[] = [];
  for (const directBigMaxKg of [3050, 3500, 4000])
    for (const ace of [2, 3])
      for (const aceStops of [8, 10])
        for (const bigStops of [6, 8]) specs.push({ directBigMaxKg, ace, aceStops, bigStops, aceMaxKg: 2000 });
  specs.push({ directBigMaxKg: 3500, ace: 3, aceStops: 8, bigStops: 6, aceMaxKg: 2500, extra: true });

  const t0 = Date.now();
  const results = specs.map(runOnce);
  const line = "─".repeat(118);

  // ── Actual history, on the same terms ─────────────────────────────────────
  const aBig = allActual.filter((t) => t.vehicle === "big" || t.vehicle === "other");
  const aAce = allActual.filter((t) => t.vehicle === "ace");
  const aFill = med(allActual.map((t) => (t.kg / baseConfig.vehicles[asVehicle(t.vehicle)].maxKg) * 100));
  console.log(line);
  console.log(`LOAD PLAN v2 SWEEP — ${results.length} runs over ${dates.length} days (${(((Date.now() - t0) / 1000) | 0)} s). GC ${GC_COUNT}/day, Big unlimited, pair ≥ 1 / same route, places ≤ 6, ride-along < 300 kg.`);
  console.log(`Cost = plan ÷ actual, both priced with the same rate table; bulk = ⌈kg ÷ direct-Big kg⌉ Bigs; holds priced as a Big. ✓ = at or under ${TARGET_PCT}%.`);
  console.log(line);
  console.log(
    `ACTUAL  ${f0(allActual.length)} trucks · > 8 stops ${pct((allActual.filter((t) => t.stops > 8).length / allActual.length) * 100, 1)} · max stops ${Math.max(...allActual.map((t) => t.stops))} · median fill ${pct(aFill)}` +
      ` · Bigs over 3,050 ${pct((aBig.filter((t) => t.kg > 3050).length / aBig.length) * 100, 1)}` +
      ` / 3,500 ${pct((aBig.filter((t) => t.kg > 3500).length / aBig.length) * 100, 1)}` +
      ` / 4,000 ${pct((aBig.filter((t) => t.kg > 4000).length / aBig.length) * 100, 1)}` +
      ` · Aces over 2,050 ${pct((aAce.filter((t) => t.kg > 2050).length / aAce.length) * 100, 1)}`,
  );
  console.log(line);
  console.log(
    `${pad("", 2)}${lpad("#", 3)} ${pad("directBig", 10)}${lpad("Ace", 4)} ${lpad("AceSt", 6)} ${lpad("BigSt", 6)} ${lpad("AceKg", 6)} │ ${lpad("cost", 6)} ${lpad("light", 6)} ${lpad("normal", 7)} ${lpad("heavy", 6)} │ ${lpad("trucks plan/actual", 19)} │ ${lpad(">8 st", 6)} ${lpad("max st", 7)} ${lpad("fill", 5)} │ ${lpad("breaks", 6)}`,
  );
  const sorted = results.slice().sort((a, b) => a.cost - b.cost);
  sorted.forEach((r) => {
    const i = results.indexOf(r) + 1;
    const s = r.spec;
    console.log(
      `${pad(r.cost <= TARGET_PCT ? "✓" : "", 2)}${lpad(String(i), 3)} ${pad(f0(s.directBigMaxKg), 10)}${lpad(String(s.ace), 4)} ${lpad(String(s.aceStops), 6)} ${lpad(String(s.bigStops), 6)} ${lpad(f0(s.aceMaxKg), 6)} │ ${lpad(pct(r.cost), 6)} ${lpad(pct(r.costByType.light), 6)} ${lpad(pct(r.costByType.normal), 7)} ${lpad(pct(r.costByType.heavy), 6)} │ ${lpad(`${f0(r.trucksPlan)} / ${f0(r.trucksActual)}`, 19)} │ ${lpad(pct(r.over8, 1), 6)} ${lpad(String(r.maxStops), 7)} ${lpad(pct(r.fill), 5)} │ ${lpad(String(r.breaks), 6)}${s.extra ? "   ← extra run (Ace maxKg 2,500)" : ""}`,
    );
  });

  // ── The pick: at or under 105%, fewest trucks over 8 stops (then cheapest) ─
  const ok = sorted.filter((r) => r.cost <= TARGET_PCT);
  const best = ok.slice().sort((a, b) => a.over8 - b.over8 || a.cost - b.cost)[0];
  console.log(line);
  if (!best) {
    console.log(`No run is at or under ${TARGET_PCT}%. The cheapest run is #${results.indexOf(sorted[0]) + 1} at ${pct(sorted[0].cost)} — shown in detail below instead.`);
  }
  const pick = best ?? sorted[0];
  const ps = pick.spec;
  console.log(
    `${best ? "BEST RUN at or under " + TARGET_PCT + "%, fewest trucks over 8 stops" : "CHEAPEST RUN"} — #${results.indexOf(pick) + 1}: directBig ${f0(ps.directBigMaxKg)} · Ace ${ps.ace}/day · Ace ${ps.aceStops} stops · Big ${ps.bigStops} stops · Ace maxKg ${f0(ps.aceMaxKg)}`,
  );
  console.log(line);
  const detail = (title: string, ds: Day[]) => {
    const pT = ds.flatMap((d) => d.cards.filter((c) => isTruckCard(c.type)));
    const aT = ds.flatMap((d) => d.actual);
    const mix = (keys: string[], count: (k: string) => number) => keys.map((k) => `${k} ${count(k)}`).join(" · ");
    const cards = ds.flatMap((d) => d.cards);
    console.log(`${title} — ${ds.length} days`);
    console.log(`  Trucks        actual ${f0(ds.reduce((n, d) => n + d.actual.length, 0))} · plan ${f0(ds.reduce((n, d) => n + d.planTrucks, 0))}  (median day ${f0(med(ds.map((d) => d.actual.length)))} / ${f0(med(ds.map((d) => d.planTrucks)))})`);
    console.log(`  Mix           actual: ${mix(["ace", "big", "gc", "other"], (k) => aT.filter((t) => t.vehicle === k).length)}`);
    console.log(`                plan:   ${mix(["ace", "big", "gc", "bulk", "direct", "waiting", "hold"], (k) => cards.filter((c) => c.type === k).length)}`);
    console.log(`  Stops/truck   actual ${f0(med(aT.map((t) => t.stops)))} / ${f0(quantile(aT.map((t) => t.stops), 0.9))} / ${f0(Math.max(...aT.map((t) => t.stops)))}  ·  plan ${f0(med(pT.map((c) => c.stopCount)))} / ${f0(quantile(pT.map((c) => c.stopCount), 0.9))} / ${f0(Math.max(...pT.map((c) => c.stopCount)))}   (median / 90% / max)`);
    console.log(`  Cost          plan = ${pct((ds.reduce((n, d) => n + d.planCost, 0) / ds.reduce((n, d) => n + d.actualCost, 0)) * 100)} of actual`);
  };
  detail("ALL DAYS", pick.days);
  detail("LIGHT", pick.days.filter((d) => d.type === "light"));
  detail("NORMAL", pick.days.filter((d) => d.type === "normal"));
  detail("HEAVY", pick.days.filter((d) => d.type === "heavy"));

  for (const t of ["normal", "heavy"] as const) {
    const ds = pick.days.filter((d) => d.type === t).sort((a, b) => a.kg - b.kg);
    const d = ds[(ds.length - 1) >> 1];
    console.log(`${line}\nEXAMPLE — ${t.toUpperCase()} DAY ${d.date} · ${f0(d.kg)} kg · actual ${d.actual.length} trucks · plan ${d.planTrucks} trucks\n${line}`);
    const row = (v: string, names: string[], kg: number, stops: number) => `${pad(v, 7)} ${pad(names.join(" + ").slice(0, 46), 46)} ${lpad(f0(kg), 6)} kg ${lpad(String(stops), 3)} st`;
    console.log("ACTUAL");
    d.actual.slice().sort((a, b) => b.kg - a.kg).forEach((x) => console.log("  " + row(x.vehicle, x.areaIds.map(areaName), x.kg, x.stops)));
    console.log("PLAN");
    d.cards.forEach((c) => {
      console.log("  " + row(c.type, c.areaNames, c.kg, c.stopCount));
      console.log(`          ↳ ${c.reason}`);
    });
  }
  console.log(line);
}

/** Plan limit breaks under THIS run's config — checked independently of the engine. */
function breaks(cards: V2Card[], ctx: LoadPlanV2Context): number {
  const cfg = ctx.config;
  const withPairs = new Set<number>();
  Array.from(ctx.pairs.keys()).forEach((k) => k.split("-").forEach((x) => withPairs.add(Number(x))));
  const routeOf = (id: number) => ctx.areas.get(id)?.routeId ?? null;
  const gcOk = (id: number) => ctx.rates.get(id)?.gcAllowed ?? cfg.newArea.gcAllowed;
  const pairOk = (a: number, b: number) => {
    if (a === b) return true;
    if (routeOf(a) !== null && routeOf(a) === routeOf(b) && (cfg.sameRoutePairsAlways || !withPairs.has(a) || !withPairs.has(b))) return true;
    return (ctx.pairs.get(a < b ? `${a}-${b}` : `${b}-${a}`) ?? 0) >= cfg.pairMinTimes;
  };
  let n = 0;
  cards.forEach((c) => {
    if (c.type !== "ace" && c.type !== "big" && c.type !== "gc") return;
    const all = Array.from(new Set(c.stops.map((s) => s.areaId).filter((a): a is number => a !== null)));
    const core = Array.from(new Set(c.stops.filter((s) => !s.ridesAlong).map((s) => s.areaId).filter((a): a is number => a !== null)));
    let bad = c.kg > kgCap(cfg, c.type, c.stopCount) || c.stopCount > cfg.vehicles[c.type].maxStops || core.length > cfg.maxPlacesPerTruck;
    if (c.type === "gc" && !all.every(gcOk)) bad = true;
    for (let i = 0; i < core.length && !bad; i++) for (let j = i + 1; j < core.length; j++) if (!pairOk(core[i], core[j])) { bad = true; break; }
    if (bad) n++;
  });
  return n;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
