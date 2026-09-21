// scripts/load-plan-v2-gc-runs.ts — LOCAL ONLY, READ-ONLY (2026-09-21).
//
//   NODE_PATH=node_modules npx tsx scripts/load-plan-v2-gc-runs.ts
//
// Four backtests of the v2 engine over the history file, on the owner's base
// (cf105cef, 3 Aces/day, Ace 8 stops, Big 6 stops, directBigMaxKg 3,050, GC 3,
// pair ≥ 1 / same route, places 6, ride-along 300) with GC ALLOWED ON MORE
// AREAS — applied here IN MEMORY ONLY, never written to the database:
//   every area on the Bardoli route, plus every area on the Bharuch route
//   whose Big rate is ≤ Ankleshwar's Big rate.
// (sql/2026-09-21-load-plan-gc-allowed.sql makes the same change for real —
// the owner runs it; it is not committed.)
//
//   1. truckPenaltyRs 600
//   2. truckPenaltyRs 300
//   3. like 2 + light milk run: an Ace may carry 9–10 stops if ≤ 1,500 kg
//   4. like 3 with the light-run limit 1,200 kg
//
// INPUT: docs/data/load-plan/load_plan_backtest_history.csv (.gitignore'd) and
// the v2 context from the database, READ-ONLY.
// 🔴 RATES ARE SECRET: terminal only, no file written, cost ONLY as plan ÷
// actual (same rate table). The GC area list shows names and ids, never a rate.

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
const TARGET_PCT = 105;
const ACE_COUNT = 3;
const GC_COUNT = 3;
const BARDOLI = 14;
const BHARUCH = 17;

interface Row { date: string; tripNo: string; vehicleClass: string; stopKey: string; areaId: number; routeId: number; kg: number }
interface Truck { vehicle: string; areaIds: number[]; kg: number; stops: number; routeId: number | null }
type DayType = "light" | "normal" | "heavy";
interface RunSpec { n: number; label: string; penalty: number; lightRun: { maxStops: number; maxKg: number } | null }
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
const pct = (n: number, d = 0) => (Number.isFinite(n) ? `${n.toFixed(d)}%` : "—");
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const asVehicle = (v: string): VehicleType => (v === "ace" || v === "gc" ? v : "big");
const isTruckCard = (t: string) => t === "ace" || t === "big" || t === "gc" || t === "direct";

async function main() {
  if (!fs.existsSync(HISTORY)) throw new Error(`History file not found: ${HISTORY}`);
  const rows = readHistory();
  const base = await loadPlanV2Context("Upcountry");
  if (!base) {
    console.log("v2 is not set up in the database — nothing to run.");
    return;
  }

  // ── The GC override, in memory only ───────────────────────────────────────
  const ank = Array.from(base.areas.entries()).filter(([, a]) => a.name === "Ankleshwar" && a.routeId === BHARUCH);
  if (ank.length !== 1) throw new Error(`Expected one Ankleshwar area on the Bharuch route, found ${ank.length}`);
  const ankBig = base.rates.get(ank[0][0])?.bigRate;
  if (typeof ankBig !== "number") throw new Error("Ankleshwar has no Big rate");
  const added: Array<{ id: number; name: string; route: string }> = [];
  const rates = new Map<number, AreaRate>(base.rates);
  Array.from(base.areas.entries()).forEach(([id, a]) => {
    const r = rates.get(id);
    if (!r || r.gcAllowed) return; // no row → cannot be switched here; already allowed → nothing to add
    const qualifies = a.routeId === BARDOLI || (a.routeId === BHARUCH && typeof r.bigRate === "number" && r.bigRate <= ankBig);
    if (!qualifies) return;
    rates.set(id, { ...r, gcAllowed: true });
    added.push({ id, name: a.name, route: base.routeNames[a.routeId!] ?? String(a.routeId) });
  });
  added.sort((a, b) => (a.route + a.name + a.id < b.route + b.name + b.id ? -1 : 1));

  const baseConfig: LoadPlanV2Config = {
    ...base.config,
    pairMinTimes: V2_DEFAULTS.pairMinTimes,
    maxPlacesPerTruck: V2_DEFAULTS.maxPlacesPerTruck,
    directBigMaxKg: 3050,
    vehicles: {
      ...base.config.vehicles,
      ace: { ...base.config.vehicles.ace, maxStops: 8 },
      big: { ...base.config.vehicles.big, maxStops: 6 },
    },
  };
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
        .map((rs) => ({ vehicle: rs[0].vehicleClass, areaIds: Array.from(new Set(rs.map((r) => r.areaId))), kg: rs.reduce((n, r) => n + r.kg, 0), stops: new Set(rs.map((r) => r.stopKey)).size, routeId: rs[0].routeId }))
        .filter((t) => t.kg >= NOISE_TRUCK_KG),
    );
  });
  const allActual = Array.from(actualByDate.values()).flat();
  const actualCostByDate = new Map(dates.map((d) => [d, actualByDate.get(d)!.reduce((n, t) => n + price(t.areaIds, asVehicle(t.vehicle), t.routeId), 0)] as const));

  // ── One run ───────────────────────────────────────────────────────────────
  const runOnce = (spec: RunSpec) => {
    const config: LoadPlanV2Config = { ...baseConfig, truckPenaltyRs: spec.penalty, aceLightRun: spec.lightRun };
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
        const one = price(ids, asVehicle(c.type));
        if (c.type === "bulk") {
          planCost += one * bulkN(c.kg);
          planTrucks += bulkN(c.kg);
        } else {
          planCost += one; // a hold is priced as a Big (it still has to go) …
          if (c.type !== "hold") planTrucks += 1; // … but is not a truck today
        }
      });
      return { date, kg, type, actual: actualByDate.get(date)!, cards, actualCost: actualCostByDate.get(date)!, planCost, planTrucks };
    });
    const truckCards = days.flatMap((d) => d.cards.filter((c) => isTruckCard(c.type)));
    const costPct = (ds: Day[]) => (ds.reduce((n, d) => n + d.planCost, 0) / ds.reduce((n, d) => n + d.actualCost, 0)) * 100;
    return {
      spec,
      days,
      cost: costPct(days),
      light: costPct(days.filter((d) => d.type === "light")),
      normal: costPct(days.filter((d) => d.type === "normal")),
      heavy: costPct(days.filter((d) => d.type === "heavy")),
      trucks: days.reduce((n, d) => n + d.planTrucks, 0),
      gcs: truckCards.filter((c) => c.type === "gc").length,
      lightRuns: truckCards.filter((c) => c.flags.lightRun).length,
      over8: (truckCards.filter((c) => c.stopCount > 8).length / truckCards.length) * 100,
      maxStops: Math.max(...truckCards.map((c) => c.stopCount)),
      fill: med(truckCards.filter((c) => c.type !== "direct").map((c) => (c.kg / config.vehicles[asVehicle(c.type)].maxKg) * 100)),
      breaks: breaks(days.flatMap((d) => d.cards), ctx),
    };
  };

  const specs: RunSpec[] = [
    { n: 1, label: "penalty 600", penalty: 600, lightRun: null },
    { n: 2, label: "penalty 300", penalty: 300, lightRun: null },
    { n: 3, label: "penalty 300 + light run ≤ 1,500", penalty: 300, lightRun: { maxStops: 10, maxKg: 1500 } },
    { n: 4, label: "penalty 300 + light run ≤ 1,200", penalty: 300, lightRun: { maxStops: 10, maxKg: 1200 } },
  ];
  const results = specs.map(runOnce);

  // ── Report ────────────────────────────────────────────────────────────────
  const line = "─".repeat(124);
  console.log(line);
  console.log(`LOAD PLAN v2 — GC on more areas · 4 runs · ${dates.length} days · Ace ${ACE_COUNT}/day (8 stops) · Big 6 stops · direct Big 3,050 · GC ${GC_COUNT}/day`);
  console.log(`GC now allowed on ${added.length} more areas (in memory only — the database is unchanged):`);
  const byRoute = new Map<string, string[]>();
  added.forEach((a) => byRoute.set(a.route, [...(byRoute.get(a.route) ?? []), `${a.name} (${a.id})`]));
  Array.from(byRoute.entries()).forEach(([r, names]) => console.log(`  ${r}: ${names.join(", ")}`));
  console.log(`Cost = plan ÷ actual, same rate table; bulk = ⌈kg ÷ direct-Big kg⌉ Bigs; holds priced as a Big. ✓ = at or under ${TARGET_PCT}%.`);
  console.log(line);
  const aFill = med(allActual.map((t) => (t.kg / baseConfig.vehicles[asVehicle(t.vehicle)].maxKg) * 100));
  const hdr = `${pad("", 2)}${pad("run", 36)}│ ${lpad("cost", 5)} ${lpad("light", 6)} ${lpad("normal", 7)} ${lpad("heavy", 6)} │ ${lpad("trucks", 7)} ${lpad("GCs", 5)} ${lpad("light-run", 10)} │ ${lpad(">8 st", 6)} ${lpad("max st", 7)} ${lpad("fill", 5)} │ ${lpad("breaks", 6)}`;
  console.log(hdr);
  console.log(
    `${pad("", 2)}${pad("ACTUAL history", 36)}│ ${lpad("100%", 5)} ${lpad("—", 6)} ${lpad("—", 7)} ${lpad("—", 6)} │ ${lpad(f0(allActual.length), 7)} ${lpad(String(allActual.filter((t) => t.vehicle === "gc").length), 5)} ${lpad("—", 10)} │ ${lpad(pct((allActual.filter((t) => t.stops > 8).length / allActual.length) * 100, 1), 6)} ${lpad(String(Math.max(...allActual.map((t) => t.stops))), 7)} ${lpad(pct(aFill), 5)} │ ${lpad("—", 6)}`,
  );
  results.forEach((r) => {
    console.log(
      `${pad(r.cost <= TARGET_PCT ? "✓" : "", 2)}${pad(`${r.spec.n}. ${r.spec.label}`, 36)}│ ${lpad(pct(r.cost), 5)} ${lpad(pct(r.light), 6)} ${lpad(pct(r.normal), 7)} ${lpad(pct(r.heavy), 6)} │ ${lpad(f0(r.trucks), 7)} ${lpad(String(r.gcs), 5)} ${lpad(String(r.lightRuns), 10)} │ ${lpad(pct(r.over8, 1), 6)} ${lpad(String(r.maxStops), 7)} ${lpad(pct(r.fill), 5)} │ ${lpad(String(r.breaks), 6)}`,
    );
  });
  console.log(line);

  // ── The best run: the cheapest; one example light day ────────────────────
  const best = results.slice().sort((a, b) => a.cost - b.cost)[0];
  const ds = best.days.filter((d) => d.type === "light").sort((a, b) => a.kg - b.kg);
  const d = ds[(ds.length - 1) >> 1];
  console.log(`BEST RUN — ${best.spec.n}. ${best.spec.label} (${pct(best.cost)})`);
  console.log(`EXAMPLE — LIGHT DAY ${d.date} · ${f0(d.kg)} kg · actual ${d.actual.length} trucks · plan ${d.planTrucks} trucks`);
  console.log(line);
  const row = (v: string, names: string[], kg: number, stops: number, amber = false) =>
    `${pad(v + (amber ? " ⚠" : ""), 8)} ${pad(names.join(" + ").slice(0, 50), 50)} ${lpad(f0(kg), 6)} kg ${lpad(String(stops), 3)} st`;
  console.log("ACTUAL");
  d.actual.slice().sort((a, b) => b.kg - a.kg).forEach((x) => console.log("  " + row(x.vehicle, x.areaIds.map(areaName), x.kg, x.stops)));
  console.log("PLAN   (⚠ = amber: light milk run)");
  d.cards.forEach((c) => {
    console.log("  " + row(c.type, c.areaNames, c.kg, c.stopCount, c.flags.lightRun));
    console.log(`           ↳ ${c.reason}`);
  });
  console.log(line);
}

/** Plan limit breaks under THIS run's config (incl. the GC override) — independent of the engine. */
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
