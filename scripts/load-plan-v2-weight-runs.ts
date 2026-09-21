// scripts/load-plan-v2-weight-runs.ts — LOCAL ONLY, READ-ONLY (2026-09-21).
//
//   NODE_PATH=node_modules npx tsx scripts/load-plan-v2-weight-runs.ts
//
// HARD WEIGHT LIMITS — three sets (owner, 2026-09-21). Base = 41d5319f:
// 2 Aces/day, GC 3/day, GC allowed on the 16 extra areas (in memory only),
// direct Big off.
//
//   Hard stops   — history p95: Ace 11 · Big 9 · GC 6. stopChargeRs 300 per
//                  stop above the ideal (Ace 8, Big 6, GC 4).
//   Hard kg      — A: Big 3,050 · Ace 2,050 · GC 1,550
//                  B: Big 3,300 · Ace 2,200 · GC 1,650
//                  C: Big 3,500 · Ace 2,300 · GC 1,650
//   Soft weight  — weightChargeRsPer100Kg {0, 250} per 100 kg above the rated
//                  load (Ace 2,000 · Big 3,000 · GC 1,500). 6 runs.
//   "Overloaded" — over the rated load + 50 (Ace 2,050 · Big 3,050 · GC 1,550).
//   ACTUAL       — history trucks over 6,000 kg (likely two vehicles under one
//                  trip number) are left out of the actual SERVICE numbers
//                  (> 8 stops, max stops, overloaded, amber/day) and counted.
//                  Actual trucks and cost still include them — their bills are
//                  in the day's pool.
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
const TARGET_PCT = 105;
/** History trucks heavier than this are left out of the ACTUAL service numbers. */
const TWO_VEHICLE_KG = 6000;
const HARD_STOPS: Record<VehicleType, number> = { ace: 11, big: 9, gc: 6 };
const STOP_CHARGE = 300;
const SETS: Array<{ name: string; kg: Record<VehicleType, number> }> = [
  { name: "A", kg: { big: 3050, ace: 2050, gc: 1550 } },
  { name: "B", kg: { big: 3300, ace: 2200, gc: 1650 } },
  { name: "C", kg: { big: 3500, ace: 2300, gc: 1650 } },
];
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
  // The actual SERVICE numbers leave out "trucks" over 6,000 kg (likely two
  // vehicles under one trip number); trucks and cost keep them.
  const serviceActual = allActual.filter((t) => t.kg <= TWO_VEHICLE_KG);
  const ignoredHeavy = allActual.length - serviceActual.length;

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
      ace: { ...V.ace, maxKg: RATED.ace, overKg: 50, idealStops: IDEAL.ace, maxStops: HARD_STOPS.ace },
      big: { ...V.big, maxKg: RATED.big, overKg: 50, idealStops: IDEAL.big, maxStops: HARD_STOPS.big },
      gc: { ...V.gc, maxKg: RATED.gc, overKg: 50, idealStops: IDEAL.gc, maxStops: HARD_STOPS.gc },
    },
  };
  const price = makePricer(base);
  const actualCostByDate = new Map(dates.map((d) => [d, actualByDate.get(d)!.reduce((n, t) => n + price(t.areaIds, asVehicle(t.vehicle), t.routeId), 0)] as const));

  // ── One run ───────────────────────────────────────────────────────────────
  const runOnce = (set: (typeof SETS)[number], weightCharge: number) => {
    const stopCharge = STOP_CHARGE;
    const config: LoadPlanV2Config = {
      ...baseConfig,
      stopChargeRs: stopCharge,
      weightChargeRsPer100Kg: weightCharge,
      vehicles: {
        ace: { ...baseConfig.vehicles.ace, hardMaxKg: set.kg.ace },
        big: { ...baseConfig.vehicles.big, hardMaxKg: set.kg.big },
        gc: { ...baseConfig.vehicles.gc, hardMaxKg: set.kg.gc },
      },
    };
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
      set,
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
  for (const set of SETS) for (const wc of [0, 250]) results.push(runOnce(set, wc));

  // ── Actual, on the same terms ─────────────────────────────────────────────
  const aOver8 = (serviceActual.filter((t) => t.stops > 8).length / serviceActual.length) * 100;
  const aOverloaded = (serviceActual.filter((t) => overloaded(t.vehicle, t.kg)).length / serviceActual.length) * 100;
  const aAmberPerDay = serviceActual.filter((t) => t.stops > IDEAL[asVehicle(t.vehicle)] || overloaded(t.vehicle, t.kg)).length / dates.length;
  const aMaxStops = Math.max(...serviceActual.map((t) => t.stops));

  // ── Report ────────────────────────────────────────────────────────────────
  const line = "─".repeat(128);
  console.log(line);
  console.log(`LOAD PLAN v2 — HARD WEIGHT SETS · 6 runs · ${dates.length} days · Ace ${ACE_COUNT}/day · GC ${GC_COUNT}/day (+${gcAdded} GC areas) · direct Big off · stopCharge ${STOP_CHARGE}`);
  console.log(`Hard stops (history p95): Ace ${HARD_STOPS.ace} · Big ${HARD_STOPS.big} · GC ${HARD_STOPS.gc}`);
  SETS.forEach((st) => console.log(`Hard kg set ${st.name}: Big ${f0(st.kg.big)} · Ace ${f0(st.kg.ace)} · GC ${f0(st.kg.gc)}`));
  console.log(`ACTUAL service numbers leave out ${ignoredHeavy} history "trucks" over ${f0(TWO_VEHICLE_KG)} kg (likely two vehicles under one trip); actual trucks and cost keep them.`);
  console.log(`Ideal stops Ace ${IDEAL.ace} / Big ${IDEAL.big} / GC ${IDEAL.gc} · rated load Ace ${f0(RATED.ace)} / Big ${f0(RATED.big)} / GC ${f0(RATED.gc)} kg (+50 before "overloaded")`);
  console.log(`Cost = plan ÷ actual, trip cost only (soft charges never counted); bulk = ⌈kg ÷ Big hard kg⌉ Bigs; holds priced as a Big.`);
  console.log(`✓ = cost ≤ ${TARGET_PCT}%.`);
  console.log(line);
  console.log(
    `${pad("", 2)}${pad("run", 26)}│ ${lpad("cost", 5)} ${lpad("light", 6)} ${lpad("normal", 7)} ${lpad("heavy", 6)} │ ${lpad("trucks", 7)} │ ${lpad(">8 st", 6)} ${lpad("max st", 7)} ${lpad("overload", 9)} ${lpad("amber/day", 10)} │ ${lpad("breaks", 6)}`,
  );
  console.log(
    `${pad("", 2)}${pad("ACTUAL history", 26)}│ ${lpad("100%", 5)} ${lpad("—", 6)} ${lpad("—", 7)} ${lpad("—", 6)} │ ${lpad(f0(allActual.length), 7)} │ ${lpad(pct(aOver8, 1), 6)} ${lpad(String(aMaxStops), 7)} ${lpad(pct(aOverloaded, 1), 9)} ${lpad(f1(aAmberPerDay), 10)} │ ${lpad("—", 6)}`,
  );
  const good = (r: (typeof results)[number]) => r.cost <= TARGET_PCT;
  results
    .slice()
    .sort((a, b) => a.cost - b.cost)
    .forEach((r) => {
      console.log(
        `${pad(good(r) ? "✓" : "", 2)}${pad(`set ${r.set.name} · weight ${r.weightCharge}`, 26)}│ ${lpad(pct(r.cost), 5)} ${lpad(pct(r.light), 6)} ${lpad(pct(r.normal), 7)} ${lpad(pct(r.heavy), 6)} │ ${lpad(f0(r.trucks), 7)} │ ${lpad(pct(r.over8, 1), 6)} ${lpad(String(r.maxStops), 7)} ${lpad(pct(r.overloaded, 1), 9)} ${lpad(f1(r.amberPerDay), 10)} │ ${lpad(String(r.breaks), 6)}`,
      );
    });
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
