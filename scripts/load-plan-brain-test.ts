// scripts/load-plan-brain-test.ts — LOCAL ONLY, READ-ONLY (2026-09-21).
//
//   NODE_PATH=node_modules npx tsx scripts/load-plan-brain-test.ts
//
// A READABLE check of the Upcountry load plan on 5 real days from history:
// one light, one normal, one heavy, the one with the most small dealers, and
// one with a bulk dealer. For each day it prints what the engine suggests —
// truck by truck, stop by stop, far first, with the reason — then the Waiting
// / Hold / Direct / Bulk cards, then the trucks that actually went. The heavy
// day is also replanned twice with a fixed set of vehicles.
//
// The config is the LIVE one through lib/floor/load-plan-v2-loader.ts, which
// lays the locked defaults (V2_LOCKED) over the stored row. Live gcAllowed as
// it is — the 16-area GC SQL is not run and not applied here.
//
// INPUT: docs/data/load-plan/load_plan_backtest_history.csv (.gitignore'd).
// Its stopKey is anonymised, so a dealer shows as its short key.
// OUTPUT: docs/data/load-plan/brain-test.md (.gitignore'd — never commit it).
// 🔴 No rupee value is read out or written: the engine output carries none.

import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { loadPlanV2Context } from "@/lib/floor/load-plan-v2-loader";
import { planLoadsV2, type AvailableVehicle, type LoadPlanV2Context, type V2Card, type V2Plan, type VehicleType } from "@/lib/trips/load-plan-v2";

const HISTORY = path.join(process.cwd(), "docs/data/load-plan/load_plan_backtest_history.csv");
const OUT = path.join(process.cwd(), "docs/data/load-plan/brain-test.md");
const LIGHT_KG = 5_600;
const HEAVY_KG = 27_000;
const NOISE_TRUCK_KG = 20;
const TWO_VEHICLE_KG = 6000;
const SMALL_KG = 300;
const LABEL: Record<VehicleType, string> = { ace: "Ace", big: "Big", gc: "GC" };

interface Row { date: string; tripNo: string; vehicleClass: string; stopKey: string; areaId: number; routeId: number; kg: number }
interface DayFacts { date: string; rows: Row[]; kg: number; stops: number; small: number; maxStop: number }

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

const f0 = (n: number) => Math.round(n).toLocaleString("en-US");
const dayType = (kg: number) => (kg < LIGHT_KG ? "light" : kg > HEAVY_KG ? "heavy" : "normal");
const median = <T>(xs: T[], by: (x: T) => number): T | undefined => xs.slice().sort((a, b) => by(a) - by(b))[Math.floor((xs.length - 1) / 2)];

async function main() {
  const rows = readHistory();
  const ctx = await loadPlanV2Context("Upcountry");
  if (!ctx) {
    console.log("v2 is not set up in the database — nothing to run.");
    return;
  }

  // ── Day facts ─────────────────────────────────────────────────────────────
  const byDate = new Map<string, Row[]>();
  rows.forEach((r) => byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]));
  const days: DayFacts[] = Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, rs]) => {
      const stopKg = new Map<string, number>();
      rs.forEach((r) => stopKg.set(r.stopKey, (stopKg.get(r.stopKey) ?? 0) + r.kg));
      const kgs = Array.from(stopKg.values());
      return { date, rows: rs, kg: rs.reduce((n, r) => n + r.kg, 0), stops: kgs.length, small: kgs.filter((k) => k < SMALL_KG).length, maxStop: Math.max(...kgs) };
    });

  // ── The 5 days ────────────────────────────────────────────────────────────
  const picked: Array<{ label: string; day: DayFacts }> = [];
  const free = () => days.filter((d) => !picked.some((p) => p.day === d));
  const pick = (label: string, d: DayFacts | undefined) => {
    if (d) picked.push({ label, day: d });
  };
  pick("light (median light day)", median(free().filter((d) => dayType(d.kg) === "light"), (d) => d.kg));
  pick("normal (median normal day)", median(free().filter((d) => dayType(d.kg) === "normal"), (d) => d.kg));
  pick("heavy (median heavy day)", median(free().filter((d) => dayType(d.kg) === "heavy"), (d) => d.kg));
  pick(`most small dealers (under ${f0(SMALL_KG)} kg)`, free().sort((a, b) => b.small - a.small || (a.date < b.date ? -1 : 1))[0]);
  pick(`bulk dealer (a stop over ${f0(ctx.config.bulkKg)} kg; the largest such stop)`, free().filter((d) => d.maxStop > ctx.config.bulkKg).sort((a, b) => b.maxStop - a.maxStop)[0]);

  const V = ctx.config.vehicles;
  const out: string[] = [];
  out.push("# Load plan — brain test (5 real days)");
  out.push("");
  out.push(`Generated ${new Date().toISOString().slice(0, 10)} from the history file, live config with the locked defaults.`);
  out.push(`Ideal → hard max: Ace ${f0(V.ace.maxKg)} → ${f0(V.ace.hardMaxKg ?? V.ace.maxKg + V.ace.overKg)} kg · Big ${f0(V.big.maxKg)} → ${f0(V.big.hardMaxKg ?? V.big.maxKg + V.big.overKg)} kg · GC ${f0(V.gc.maxKg)} → ${f0(V.gc.hardMaxKg ?? V.gc.maxKg + V.gc.overKg)} kg.`);
  out.push(`Stops ideal / max: Ace ${V.ace.idealStops} / ${V.ace.maxStops} · Big ${V.big.idealStops} / ${V.big.maxStops} · GC ${V.gc.idealStops} / ${V.gc.maxStops}. Per day: Ace ${V.ace.dailyCount ?? "any"} · GC ${V.gc.dailyCount ?? "any"} · Big ${V.big.dailyCount ?? "as needed"}.`);
  out.push("Dealers are the history file's anonymised stop keys (first 6 characters). Nobody is overdue in history.");
  out.push("");

  const sideName = (side: string) => (side.startsWith("route:") ? ctx.routeNames[Number(side.slice(6))] ?? side : side);
  const bills = (d: DayFacts) =>
    d.rows.map((r, i) => ({ orderId: i + 1, weightKg: r.kg, stopKey: r.stopKey, areaId: r.areaId, routeId: r.routeId, overdue: false }));

  for (let i = 0; i < picked.length; i++) {
    const { label, day } = picked[i];
    out.push("```");
    out.push(`DAY ${i + 1} — ${label}`);
    out.push(`Day: ${day.date} · ${f0(day.kg)} kg · ${day.stops} stops · ${dayType(day.kg)} day · ${day.small} dealers under ${f0(SMALL_KG)} kg · biggest stop ${f0(day.maxStop)} kg`);
    printPlan(out, planLoadsV2(bills(day), ctx), ctx, sideName);
    printHistory(out, day);
    out.push("```");
    out.push("");
    if (label.startsWith("heavy")) {
      const runs: Array<{ name: string; available: AvailableVehicle[] }> = [
        { name: "a) 1 Ace, 3 Big (one Big maxKg 3,000), 1 GC", available: [{ type: "ace", count: 1 }, { type: "big", count: 2 }, { type: "big", count: 1, maxKg: 3000 }, { type: "gc", count: 1 }] },
        { name: "b) 2 Ace, 2 Big", available: [{ type: "ace", count: 2 }, { type: "big", count: 2 }] },
      ];
      runs.forEach((r) => {
        out.push("```");
        out.push(`DAY ${i + 1} — REPLAN ${r.name}`);
        out.push(`Day: ${day.date} · ${f0(day.kg)} kg · ${day.stops} stops`);
        printPlan(out, planLoadsV2(bills(day), ctx, {}, { available: r.available }), ctx, sideName);
        out.push("```");
        out.push("");
      });
    }
  }

  fs.writeFileSync(OUT, out.join("\n"));
  console.log(`Written ${path.relative(process.cwd(), OUT)} (${picked.length} days).`);
}

function amberWhy(c: V2Card, ctx: LoadPlanV2Context): string {
  const t = c.vehicle;
  if (!c.flags.amber || !t) return "";
  const v = ctx.config.vehicles[t];
  const why: string[] = [];
  if (c.kg > v.maxKg) why.push(`over the ${f0(v.maxKg)} kg ideal`);
  if (c.stopCount > v.idealStops) why.push(`over ${v.idealStops} stops`);
  return ` (amber — ${why.join(", ") || "light run"})`;
}

function printPlan(out: string[], plan: V2Plan, ctx: LoadPlanV2Context, sideName: (s: string) => string) {
  const s = plan.summary;
  const extras = [s.bulk && `${s.bulk} Bulk`, s.direct && `${s.direct} Direct`, s.waiting && `${s.waiting} Waiting`, s.hold && `${s.hold} Hold`].filter(Boolean);
  out.push(`Suggested: ${s.ace} Ace · ${s.big} Big · ${s.gc} GC${extras.length ? `   (+ ${extras.join(" · ")})` : ""}`);
  if (plan.mode === "replan") {
    out.push(`Shortage: ${plan.shortage ? plan.shortage.text : "none"}`);
    out.push(`Unused: ${plan.unused.length ? plan.unused.map((u) => u.text).join(" · ") : "none"}`);
  }
  out.push("");
  const trucks = plan.cards.filter((c) => c.type === "ace" || c.type === "big" || c.type === "gc");
  const others = plan.cards.filter((c) => !trucks.includes(c));
  const block = (title: string, c: V2Card) => {
    out.push(`${title} — ${f0(c.kg)} kg${amberWhy(c, ctx)} — ${c.stopCount} ${c.stopCount === 1 ? "stop" : "stops"} — ${sideName(c.side)}`);
    c.stops.forEach((st, k) => {
      out.push(`   ${k + 1}. ${st.areaName} — dealer ${st.stopKey.slice(0, 6)} — ${f0(st.kg)} kg${st.ridesAlong ? " (rides along)" : ""}`);
    });
    out.push(`   Reason: ${c.reason}`);
    out.push("");
  };
  trucks.forEach((c, k) => block(`Truck ${k + 1} — ${LABEL[c.type as VehicleType]}`, c));
  const typeName: Record<string, string> = { bulk: "Bulk", direct: "Direct", waiting: "Waiting", hold: "Hold" };
  others.forEach((c) => block(`${typeName[c.type]}${c.vehicle ? ` — ${LABEL[c.vehicle]}` : c.type === "bulk" ? " — hire" : ""}`, c));
}

function printHistory(out: string[], day: DayFacts) {
  const trips = new Map<string, Row[]>();
  day.rows.forEach((r) => trips.set(r.tripNo, [...(trips.get(r.tripNo) ?? []), r]));
  const trucks = Array.from(trips.values())
    .map((rs) => ({ v: rs[0].vehicleClass, kg: rs.reduce((n, r) => n + r.kg, 0), stops: new Set(rs.map((r) => r.stopKey)).size }))
    .filter((t) => t.kg >= NOISE_TRUCK_KG);
  const byType = new Map<string, typeof trucks>();
  trucks.forEach((t) => byType.set(t.v, [...(byType.get(t.v) ?? []), t]));
  const name = (v: string) => (v === "ace" ? "Ace" : v === "gc" ? "GC" : v === "big" ? "Big" : "Other");
  out.push(`History that day: ${trucks.length} trucks — ${Array.from(byType.entries()).map(([v, ts]) => `${ts.length} ${name(v)}`).join(" · ")}`);
  Array.from(byType.entries()).forEach(([v, ts]) => {
    const list = ts
      .sort((a, b) => b.kg - a.kg)
      .map((t) => `${t.stops} st / ${f0(t.kg)} kg${t.kg > TWO_VEHICLE_KG ? " (likely 2 vehicles)" : ""}`)
      .join(" · ");
    out.push(`   ${name(v)}: ${list}`);
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
