// scripts/load-plan-v2-backtest.ts — LOCAL ONLY, READ-ONLY (2026-09-21).
//
//   NODE_PATH=node_modules npx tsx scripts/load-plan-v2-backtest.ts
//
// Replays real Upcountry days through the v2 engine in SUGGEST mode and
// compares the plan with the trucks that actually went. Six runs (owner,
// 2026-09-21): three HARD weight sets × weightChargeRsPer100Kg {0, 250}.
//
//   Hard kg      — A: Big 3,050 · Ace 2,050 · GC 1,550
//                  B: Big 3,300 · Ace 2,200 · GC 1,650
//                  C: Big 3,500 · Ace 2,300 · GC 1,650
//   Hard stops   — history p95: Ace 11 · Big 9 · GC 6. stopChargeRs 300 per
//                  stop above the ideal (Ace 8 · Big 6 · GC 4).
//   Base         — 2 Aces/day, GC 3/day, Big unlimited; GC allowed on the 16
//                  extra areas of sql/2026-09-21-load-plan-gc-allowed.sql (IN
//                  MEMORY only — that SQL is not run); direct Big off;
//                  pairMinTimes 1, places ≤ 6 (the live row still says 2 / 5).
//   Skipped      — history "trucks" over 6,000 kg (likely two vehicles under
//                  one trip number): their bills leave the day's pool AND their
//                  trucks leave the actual numbers, cost included. Trucks under
//                  20 kg are record noise and not counted.
//   "Overloaded" — over the rated load + 50 (Ace 2,050 · Big 3,050 · GC 1,550).
//
// INPUT: docs/data/load-plan/load_plan_backtest_history.csv — 233 days of real
// trucks from NTS records (date, tripNo, vehicleClass, stopKey, areaId,
// routeId, kg). 🔴 That file is .gitignore'd and must never be committed; this
// script only reads it. The rates, pairs and config come from the database,
// READ-ONLY, through lib/floor/load-plan-v2-loader.ts.
//
// 🔴 RATES ARE SECRET. This prints to the terminal only, writes no file, and
// never prints a rupee amount: cost is shown ONLY as plan ÷ actual, both priced
// with the same rate table, trip cost only (the soft charges are a planning
// device and are never counted). Bulk = ⌈kg ÷ Big hard kg⌉ Bigs; a Hold card
// is priced as a Big (it still has to go some day).

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
/** History "trucks" lighter than this are record noise — not counted as trucks. */
const NOISE_TRUCK_KG = 20;
/** History "trucks" heavier than this are skipped — bills and truck both. */
const TWO_VEHICLE_KG = 6000;
const HARD_STOPS: Record<VehicleType, number> = { ace: 11, big: 9, gc: 6 };
const STOP_CHARGE = 300;
const WEIGHT_CHARGES = [0, 250];
const SETS: Array<{ name: string; kg: Record<VehicleType, number> }> = [
  { name: "A", kg: { big: 3050, ace: 2050, gc: 1550 } },
  { name: "B", kg: { big: 3300, ace: 2200, gc: 1650 } },
  { name: "C", kg: { big: 3500, ace: 2300, gc: 1650 } },
];
const COUNTS = { ace: 2, gc: 3 } as const;
const BARDOLI = 14;
const BHARUCH = 17;
/** Ideal stops and rated loads (owner). */
const IDEAL: Record<VehicleType, number> = { ace: 8, big: 6, gc: 4 };
const RATED: Record<VehicleType, number> = { ace: 2000, big: 3000, gc: 1500 };

interface Row { date: string; tripNo: string; vehicleClass: string; stopKey: string; areaId: number; routeId: number; kg: number }
interface Truck { vehicle: VehicleType; areaIds: number[]; kg: number; stops: number; routeId: number | null }

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

const f0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "—");
const pct = (n: number, d = 0) => (Number.isFinite(n) ? `${n.toFixed(d)}%` : "—");
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((n, x) => n + x, 0) / xs.length);
/** History "other" is measured as a Big. */
const asVehicle = (v: string): VehicleType => (v === "ace" || v === "gc" ? v : "big");
const overloaded = (t: VehicleType, kg: number) => kg > RATED[t] + 50;
const avgStops = (xs: Array<{ vehicle: VehicleType; stops: number }>) =>
  (["ace", "big", "gc"] as VehicleType[]).map((t) => f1(mean(xs.filter((x) => x.vehicle === t).map((x) => x.stops)))).join(" / ");

async function main() {
  const rows = readHistory();
  const base = await loadPlanV2Context("Upcountry");
  if (!base) {
    console.log("v2 is not set up in the database — nothing to run.");
    return;
  }

  // ── History: trucks per day; skip the > 6,000 kg ones, bills and all ──────
  const byTrip = new Map<string, Row[]>();
  rows.forEach((r) => {
    const k = `${r.date}|${r.tripNo}`;
    byTrip.set(k, [...(byTrip.get(k) ?? []), r]);
  });
  let skipped = 0;
  const kept: Row[] = [];
  Array.from(byTrip.values()).forEach((rs) => {
    if (rs.reduce((n, r) => n + r.kg, 0) > TWO_VEHICLE_KG) skipped++;
    else kept.push(...rs);
  });
  const byDate = new Map<string, Row[]>();
  kept.forEach((r) => byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]));
  const dates = Array.from(byDate.keys()).sort();
  const actualByDate = new Map<string, Truck[]>();
  dates.forEach((d) => {
    const trips = new Map<string, Row[]>();
    byDate.get(d)!.forEach((r) => trips.set(r.tripNo, [...(trips.get(r.tripNo) ?? []), r]));
    actualByDate.set(
      d,
      Array.from(trips.values())
        .map((rs) => ({
          vehicle: asVehicle(rs[0].vehicleClass),
          areaIds: Array.from(new Set(rs.map((r) => r.areaId))),
          kg: rs.reduce((n, r) => n + r.kg, 0),
          stops: new Set(rs.map((r) => r.stopKey)).size,
          routeId: rs[0].routeId,
        }))
        .filter((t) => t.kg >= NOISE_TRUCK_KG),
    );
  });
  const allActual = Array.from(actualByDate.values()).flat();

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
    stopChargeRs: STOP_CHARGE,
    vehicles: {
      ace: { ...V.ace, maxKg: RATED.ace, overKg: 50, idealStops: IDEAL.ace, maxStops: HARD_STOPS.ace },
      big: { ...V.big, maxKg: RATED.big, overKg: 50, idealStops: IDEAL.big, maxStops: HARD_STOPS.big },
      gc: { ...V.gc, maxKg: RATED.gc, overKg: 50, idealStops: IDEAL.gc, maxStops: HARD_STOPS.gc },
    },
  };
  const price = makePricer(base);
  const actualCost = allActual.reduce((n, t) => n + price(t.areaIds, t.vehicle, t.routeId), 0);

  // ── One run ───────────────────────────────────────────────────────────────
  const runOnce = (set: (typeof SETS)[number], weightCharge: number) => {
    const config: LoadPlanV2Config = {
      ...baseConfig,
      weightChargeRsPer100Kg: weightCharge,
      vehicles: {
        ace: { ...baseConfig.vehicles.ace, hardMaxKg: set.kg.ace },
        big: { ...baseConfig.vehicles.big, hardMaxKg: set.kg.big },
        gc: { ...baseConfig.vehicles.gc, hardMaxKg: set.kg.gc },
      },
    };
    const ctx: LoadPlanV2Context = { ...base, rates, config };
    const bulkN = (kg: number) => Math.ceil(kg / kgCap(config, "big", 1));
    let planCost = 0;
    let trucks = 0;
    const cards: V2Card[] = [];
    dates.forEach((date) => {
      const bills = byDate.get(date)!.map((r, i) => ({ orderId: i + 1, weightKg: r.kg, stopKey: r.stopKey, areaId: r.areaId, routeId: r.routeId, overdue: false }));
      const plan = planLoadsV2(bills, ctx, COUNTS); // suggest mode: no `available`
      plan.cards.forEach((c) => {
        const ids = Array.from(new Set(c.stops.map((s) => s.areaId).filter((a): a is number => a !== null)));
        const one = price(ids, asVehicle(c.type)); // trip cost only — never the soft charges
        if (c.type === "bulk") {
          planCost += one * bulkN(c.kg);
          trucks += bulkN(c.kg);
        } else {
          planCost += one;
          if (c.type !== "hold") trucks += 1;
        }
      });
      cards.push(...plan.cards);
    });
    const truckCards = cards.filter((c) => c.type === "ace" || c.type === "big" || c.type === "gc" || c.type === "direct");
    const vehicleCards = truckCards
      .filter((c) => c.type !== "direct")
      .map((c) => ({ vehicle: c.type as VehicleType, stops: c.stopCount, kg: c.kg }));
    return {
      name: `set ${set.name} · weight ${weightCharge}`,
      cost: (planCost / actualCost) * 100,
      trucks,
      overloaded: (vehicleCards.filter((c) => overloaded(c.vehicle, c.kg)).length / vehicleCards.length) * 100,
      over8: (truckCards.filter((c) => c.stopCount > 8).length / truckCards.length) * 100,
      avg: avgStops(vehicleCards),
      breaks: breaks(cards, ctx),
    };
  };

  const results: Array<ReturnType<typeof runOnce>> = [];
  SETS.forEach((set) => WEIGHT_CHARGES.forEach((wc) => results.push(runOnce(set, wc))));

  // ── Report ────────────────────────────────────────────────────────────────
  const line = "─".repeat(86);
  console.log(line);
  console.log(`LOAD PLAN v2 BACKTEST — suggest mode · 6 runs · ${dates.length} days · Ace ${COUNTS.ace}/day · GC ${COUNTS.gc}/day (+${gcAdded} GC areas, in memory) · direct Big off`);
  console.log(`stopCharge ${STOP_CHARGE} · hard stops Ace ${HARD_STOPS.ace} / Big ${HARD_STOPS.big} / GC ${HARD_STOPS.gc} · ideal stops ${IDEAL.ace} / ${IDEAL.big} / ${IDEAL.gc}`);
  SETS.forEach((st) => console.log(`Hard kg set ${st.name}: Big ${f0(st.kg.big)} · Ace ${f0(st.kg.ace)} · GC ${f0(st.kg.gc)}`));
  console.log(`Skipped ${skipped} history trucks over ${f0(TWO_VEHICLE_KG)} kg — their bills and their cost both.`);
  console.log(`Cost = plan ÷ actual (trip cost only). Overloaded = over rated + 50 (Ace ${f0(RATED.ace + 50)} · Big ${f0(RATED.big + 50)} · GC ${f0(RATED.gc + 50)}).`);
  console.log(line);
  const row = (a: string, b: string, c: string, d: string, e: string, f: string) =>
    console.log(`${pad(a, 22)}│ ${lpad(b, 5)} │ ${lpad(c, 6)} │ ${lpad(d, 10)} │ ${lpad(e, 9)} │ ${lpad(f, 18)}`);
  row("run", "cost", "trucks", "overloaded", "> 8 stops", "avg stops A/B/GC");
  row(
    "ACTUAL history",
    "100%",
    f0(allActual.length),
    pct((allActual.filter((t) => overloaded(t.vehicle, t.kg)).length / allActual.length) * 100, 1),
    pct((allActual.filter((t) => t.stops > 8).length / allActual.length) * 100, 1),
    avgStops(allActual),
  );
  results.forEach((r) => row(r.name, pct(r.cost), f0(r.trucks), pct(r.overloaded, 1), pct(r.over8, 1), r.avg));
  console.log(line);
  const broke = results.filter((r) => r.breaks > 0);
  console.log(broke.length === 0 ? "Hard-limit check: 0 breaks in every run." : `Hard-limit breaks: ${broke.map((r) => `${r.name} ${r.breaks}`).join(" · ")}`);
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
