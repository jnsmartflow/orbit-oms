// scripts/load-plan-v2-soft-runs.ts — LOCAL ONLY, READ-ONLY (2026-09-21).
//
//   NODE_PATH=node_modules npx tsx scripts/load-plan-v2-soft-runs.ts
//
// HARD LIMITS FROM HISTORY, SERVICE RULES AS SOFT COSTS (owner, 2026-09-21).
// Base = 41d5319f: 2 Aces/day, GC 3/day, GC allowed on the 16 extra areas (in
// memory only), direct Big off.
//
//   Hard limits  — per vehicle class, the 95th percentile of kg and of stops
//                  per truck in the history file (kg rounded to the nearest
//                  50). Printed.
//   Soft costs   — stopChargeRs per stop above the ideal (Ace 8, Big 6, GC 4)
//                  and weightChargeRsPer100Kg per 100 kg above the rated load
//                  (Ace 2,000, Big 3,000, GC 1,500), added to PLANNING cost
//                  only. A card over an ideal or rated value is amber.
//   9 runs       — stopCharge {0, 150, 300} × weightCharge {0, 100, 250}.
//
// INPUT: docs/data/load-plan/load_plan_backtest_history.csv (.gitignore'd) and
// the v2 context from the database, READ-ONLY.
// 🔴 RATES ARE SECRET: terminal only, no file written, cost ONLY as plan ÷
// actual (the same rate table, trip cost only — the soft charges are a
// planning device and are never counted or printed).

import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { loadPlanV2Context } from "@/lib/floor/load-plan-v2-loader";
import {
  kgCap,
  makePricer,
  planLoadsV2,
  stopsAllowed,
  V2_DEFAULTS,
  type AreaRate,
  type LoadPlanV2Config,
  type LoadPlanV2Context,
  type V2Card,
  type VehicleType,
} from "@/lib/trips/load-plan-v2";

const HISTORY = path.join(process.cwd(), "docs/data/load-plan/load_plan_backtest_history.csv");
const LIGHT_KG = 5_600;
const HEAVY_KG = 27_000;
const NOISE_TRUCK_KG = 20;
const TARGET_PCT = 103;
const ACE_COUNT = 2;
const GC_COUNT = 3;
const BARDOLI = 14;
const BHARUCH = 17;
/** Ideal stops and rated loads (owner). The rated tolerance stays overKg = 50. */
const IDEAL: Record<VehicleType, number> = { ace: 8, big: 6, gc: 4 };
const RATED: Record<VehicleType, number> = { ace: 2000, big: 3000, gc: 1500 };

interface Row { date: string; tripNo: string; vehicleClass: string; stopKey: string; areaId: number; routeId: number; kg: number }
interface Truck { vehicle: string; areaIds: number[]; kg: number; stops: number; routeId: number | null }
type DayType = "light" | "normal" | "heavy";
interface Day { date: string; kg: number; type: DayType; actual: Truck[]; cards: V2Card[]; actualCost: number; planCost: number; planTrucks: number }

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
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "—");
const pct = (n: number, d = 0) => (Number.isFinite(n) ? `${n.toFixed(d)}%` : "—");
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const asVehicle = (v: string): VehicleType => (v === "ace" || v === "gc" ? v : "big");
const isTruckCard = (t: string) => t === "ace" || t === "big" || t === "gc" || t === "direct";
/** Over the rated load: Ace > 2,050 · Big > 3,050 · GC > 1,550 (history "other" measured as a Big). */
const overloaded = (vehicle: string, kg: number) => kg > RATED[asVehicle(vehicle)] + 50;

async function main() {
  if (!fs.existsSync(HISTORY)) throw new Error(`History file not found: ${HISTORY}`);
  const rows = readHistory();
  const base = await loadPlanV2Context("Upcountry");
  if (!base) {
    console.log("v2 is not set up in the database — nothing to run.");
    return;
  }

  // ── History, once — and the hard limits from it ───────────────────────────
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
        .map((rs) => ({ vehicle: rs[0].vehicleClass, areaIds: Array.from(new Set(rs.map((r) => r.areaId))), kg: rs.reduce((n, r) => n + r.kg, 0), stops: new Set(rs.map((r) => r.stopKey)).size, routeId: rs[0].routeId }))
        .filter((t) => t.kg >= NOISE_TRUCK_KG),
    );
  });
  const allActual = Array.from(actualByDate.values()).flat();
  const hard = {} as Record<VehicleType, { kg: number; stops: number }>;
  (["ace", "big", "gc"] as VehicleType[]).forEach((t) => {
    const ts = allActual.filter((x) => x.vehicle === t);
    hard[t] = { kg: Math.round(quantile(ts.map((x) => x.kg), 0.95) / 50) * 50, stops: quantile(ts.map((x) => x.stops), 0.95) };
  });

  // ── The GC override (the 16 areas), in memory only ────────────────────────
  const ank = Array.from(base.areas.entries()).filter(([, a]) => a.name === "Ankleshwar" && a.routeId === BHARUCH);
  if (ank.length !== 1) throw new Error(`Expected one Ankleshwar area on the Bharuch route, found ${ank.length}`);
  const ankBig = base.rates.get(ank[0][0])?.bigRate;
  if (typeof ankBig !== "number") throw new Error("Ankleshwar has no Big rate");
  const rates = new Map<number, AreaRate>(base.rates);
  let gcAdded = 0;
  Array.from(base.areas.entries()).forEach(([id, a]) => {
    const r = rates.get(id);
    if (!r || r.gcAllowed) return;
    if (a.routeId === BARDOLI || (a.routeId === BHARUCH && typeof r.bigRate === "number" && r.bigRate <= ankBig)) {
      rates.set(id, { ...r, gcAllowed: true });
      gcAdded++;
    }
  });

  const V = base.config.vehicles;
  const baseConfig: LoadPlanV2Config = {
    ...base.config,
    pairMinTimes: V2_DEFAULTS.pairMinTimes,
    maxPlacesPerTruck: V2_DEFAULTS.maxPlacesPerTruck,
    directBigMaxKg: 3050, // direct Big off: at or below every hard limit
    aceLightRun: null,
    vehicles: {
      ace: { ...V.ace, maxKg: RATED.ace, overKg: 50, idealStops: IDEAL.ace, hardMaxKg: hard.ace.kg, maxStops: hard.ace.stops },
      big: { ...V.big, maxKg: RATED.big, overKg: 50, idealStops: IDEAL.big, hardMaxKg: hard.big.kg, maxStops: hard.big.stops },
      gc: { ...V.gc, maxKg: RATED.gc, overKg: 50, idealStops: IDEAL.gc, hardMaxKg: hard.gc.kg, maxStops: hard.gc.stops },
    },
  };
  const price = makePricer(base);
  const areaName = (id: number) => base.areas.get(id)?.name ?? `Area ${id}`;
  const actualCostByDate = new Map(dates.map((d) => [d, actualByDate.get(d)!.reduce((n, t) => n + price(t.areaIds, asVehicle(t.vehicle), t.routeId), 0)] as const));

  // ── One run ───────────────────────────────────────────────────────────────
  const runOnce = (stopCharge: number, weightCharge: number) => {
    const config: LoadPlanV2Config = { ...baseConfig, stopChargeRs: stopCharge, weightChargeRsPer100Kg: weightCharge };
    const ctx: LoadPlanV2Context = { ...base, rates, config };
    const bulkN = (kg: number) => Math.ceil(kg / kgCap(config, "big", 1));
    const days: Day[] = dates.map((date) => {
      const dayRows = byDate.get(date)!;
      const kg = dayRows.reduce((n, r) => n + r.kg, 0);
      const type: DayType = kg < LIGHT_KG ? "light" : kg > HEAVY_KG ? "heavy" : "normal";
      const bills = dayRows.map((r, i) => ({ orderId: i + 1, weightKg: r.kg, stopKey: r.stopKey, areaId: r.areaId, routeId: r.routeId, overdue: false }));
      const cards = planLoadsV2(bills, ctx, { ace: ACE_COUNT, gc: GC_COUNT }).cards;
      let planCost = 0;
      let planTrucks = 0;
      cards.forEach((c) => {
        const ids = Array.from(new Set(c.stops.map((s) => s.areaId).filter((a): a is number => a !== null)));
        const one = price(ids, asVehicle(c.type)); // trip cost only — never the soft charges
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
    const vehicleCards = truckCards.filter((c) => c.type !== "direct");
    const costPct = (ds: Day[]) => (ds.reduce((n, d) => n + d.planCost, 0) / ds.reduce((n, d) => n + d.actualCost, 0)) * 100;
    return {
      stopCharge,
      weightCharge,
      days,
      cost: costPct(days),
      light: costPct(days.filter((d) => d.type === "light")),
      normal: costPct(days.filter((d) => d.type === "normal")),
      heavy: costPct(days.filter((d) => d.type === "heavy")),
      trucks: days.reduce((n, d) => n + d.planTrucks, 0),
      over8: (truckCards.filter((c) => c.stopCount > 8).length / truckCards.length) * 100,
      maxStops: Math.max(...truckCards.map((c) => c.stopCount)),
      overloaded: (vehicleCards.filter((c) => overloaded(c.type, c.kg)).length / vehicleCards.length) * 100,
      amberPerDay: days.reduce((n, d) => n + d.cards.filter((c) => c.flags.amber).length, 0) / days.length,
      breaks: breaks(days.flatMap((d) => d.cards), ctx),
    };
  };

  const results: Array<ReturnType<typeof runOnce>> = [];
  for (const sc of [0, 150, 300]) for (const wc of [0, 100, 250]) results.push(runOnce(sc, wc));

  // ── Actual, on the same terms ─────────────────────────────────────────────
  const aOver8 = (allActual.filter((t) => t.stops > 8).length / allActual.length) * 100;
  const aOverloaded = (allActual.filter((t) => overloaded(t.vehicle, t.kg)).length / allActual.length) * 100;
  const aAmberPerDay = allActual.filter((t) => t.stops > IDEAL[asVehicle(t.vehicle)] || overloaded(t.vehicle, t.kg)).length / dates.length;

  // ── Report ────────────────────────────────────────────────────────────────
  const line = "─".repeat(128);
  console.log(line);
  console.log(`LOAD PLAN v2 — HARD LIMITS FROM HISTORY, SOFT SERVICE COSTS · 9 runs · ${dates.length} days · Ace ${ACE_COUNT}/day · GC ${GC_COUNT}/day (+${gcAdded} GC areas) · direct Big off`);
  console.log(
    `Hard limits (history p95): Ace ${f0(hard.ace.kg)} kg / ${hard.ace.stops} stops · Big ${f0(hard.big.kg)} kg / ${hard.big.stops} stops · GC ${f0(hard.gc.kg)} kg / ${hard.gc.stops} stops`,
  );
  console.log(`Ideal stops Ace ${IDEAL.ace} / Big ${IDEAL.big} / GC ${IDEAL.gc} · rated load Ace ${f0(RATED.ace)} / Big ${f0(RATED.big)} / GC ${f0(RATED.gc)} kg (+50 before "overloaded")`);
  console.log(`Cost = plan ÷ actual, trip cost only (soft charges never counted); bulk = ⌈kg ÷ Big hard kg⌉ Bigs; holds priced as a Big.`);
  console.log(`✓ = cost ≤ ${TARGET_PCT}% AND % trucks > 8 stops below history AND % overloaded below history.`);
  console.log(line);
  console.log(
    `${pad("", 2)}${pad("run", 26)}│ ${lpad("cost", 5)} ${lpad("light", 6)} ${lpad("normal", 7)} ${lpad("heavy", 6)} │ ${lpad("trucks", 7)} │ ${lpad(">8 st", 6)} ${lpad("max st", 7)} ${lpad("overload", 9)} ${lpad("amber/day", 10)} │ ${lpad("breaks", 6)}`,
  );
  console.log(
    `${pad("", 2)}${pad("ACTUAL history", 26)}│ ${lpad("100%", 5)} ${lpad("—", 6)} ${lpad("—", 7)} ${lpad("—", 6)} │ ${lpad(f0(allActual.length), 7)} │ ${lpad(pct(aOver8, 1), 6)} ${lpad(String(Math.max(...allActual.map((t) => t.stops))), 7)} ${lpad(pct(aOverloaded, 1), 9)} ${lpad(f1(aAmberPerDay), 10)} │ ${lpad("—", 6)}`,
  );
  const good = (r: (typeof results)[number]) => r.cost <= TARGET_PCT && r.over8 < aOver8 && r.overloaded < aOverloaded;
  results
    .slice()
    .sort((a, b) => a.cost - b.cost)
    .forEach((r) => {
      console.log(
        `${pad(good(r) ? "✓" : "", 2)}${pad(`stop ${r.stopCharge} · weight ${r.weightCharge}`, 26)}│ ${lpad(pct(r.cost), 5)} ${lpad(pct(r.light), 6)} ${lpad(pct(r.normal), 7)} ${lpad(pct(r.heavy), 6)} │ ${lpad(f0(r.trucks), 7)} │ ${lpad(pct(r.over8, 1), 6)} ${lpad(String(r.maxStops), 7)} ${lpad(pct(r.overloaded, 1), 9)} ${lpad(f1(r.amberPerDay), 10)} │ ${lpad(String(r.breaks), 6)}`,
      );
    });
  console.log(line);

  // ── The best: a ✓ run, cheapest; else say so and show the cheapest run ────
  const marked = results.filter(good).sort((a, b) => a.cost - b.cost);
  const best = marked[0] ?? results.slice().sort((a, b) => a.cost - b.cost)[0];
  if (marked.length === 0) console.log(`No run meets all three conditions. Showing the cheapest run instead.`);
  console.log(`${marked.length ? "BEST ✓ RUN" : "CHEAPEST RUN"} — stopCharge ${best.stopCharge} · weightCharge ${best.weightCharge} (${pct(best.cost)})`);
  for (const t of ["normal", "heavy"] as const) {
    const ds = best.days.filter((d) => d.type === t).sort((a, b) => a.kg - b.kg);
    const d = ds[(ds.length - 1) >> 1];
    console.log(`${line}\nEXAMPLE — ${t.toUpperCase()} DAY ${d.date} · ${f0(d.kg)} kg · actual ${d.actual.length} trucks · plan ${d.planTrucks} trucks\n${line}`);
    const row = (v: string, names: string[], kg: number, stops: number, amber = false) =>
      `${pad(v + (amber ? " ⚠" : ""), 8)} ${pad(names.join(" + ").slice(0, 50), 50)} ${lpad(f0(kg), 6)} kg ${lpad(String(stops), 3)} st`;
    console.log("ACTUAL   (⚠ = over ideal stops or over rated load)");
    d.actual
      .slice()
      .sort((a, b) => b.kg - a.kg)
      .forEach((x) => console.log("  " + row(x.vehicle, x.areaIds.map(areaName), x.kg, x.stops, x.stops > IDEAL[asVehicle(x.vehicle)] || overloaded(x.vehicle, x.kg))));
    console.log("PLAN     (⚠ = amber card)");
    d.cards.forEach((c) => {
      console.log("  " + row(c.type, c.areaNames, c.kg, c.stopCount, c.flags.amber));
      console.log(`           ↳ ${c.reason}`);
    });
  }
  console.log(line);
}

/** Plan HARD-limit breaks under THIS run's config (incl. the GC override) — independent of the engine. */
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
    let bad = c.kg > kgCap(cfg, c.type, c.stopCount) || !stopsAllowed(cfg, c.type, c.stopCount, c.kg) || core.length > cfg.maxPlacesPerTruck;
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
