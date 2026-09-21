// lib/trips/load-plan-v2.ts
//
// THE LOAD PLAN ENGINE, v2 (2026-09-21, owner) — suggested truckloads for the
// Upcountry pool, priced by each area's real rates and grouped by which areas
// actually travel together. Built BESIDE v1 (lib/trips/load-plan.ts, untouched,
// still what the live view uses); nothing on screen reads this yet.
//
// PURE. No Prisma, no clock, no I/O. The rates, pairs and config arrive in a
// `LoadPlanV2Context` built on the SERVER by lib/floor/load-plan-v2-loader.ts.
//
// 🔴 RATES ARE SECRET (CLAUDE_CORE.md §7.19). They are read inside this file to
// choose loads and vehicles, and the OUTPUT CARRIES NO RUPEE VALUE — no rate,
// no cost, no saving, no penalty. A card says which bills, which vehicle, in
// what order, and why in words. `tripCostOf` / `makePricer` are exported for
// the local backtest (which prints percentages only); never send their result
// to a browser.
//
// THE RULES, in the owner's order (step 3, revised 2026-09-21):
//   1. Direct    — a route whose side is "Direct" (IGT / CROSS, Transport): one
//                  Direct card per route, never mixed.
//   2. Stops     — bills grouped by stopKey. A stop of ≤ bulkKg is never split.
//   2b. Direct Big — a Big with 1 or 2 stops may carry up to directBigMaxKg
//                  (default 3,500); with 3+ stops it keeps maxKg + overKg.
//   2c. Light milk run — optional (aceLightRun): an Ace may carry more than
//                  its maxStops, up to aceLightRun.maxStops, ONLY when the load
//                  weighs ≤ aceLightRun.maxKg. Such a card carries flags.lightRun
//                  (the screen shows it amber). Off unless configured.
//   2d. Soft service costs — optional: stopChargeRs per stop above a
//                  vehicle's idealStops and weightChargeRsPer100Kg per 100 kg
//                  above its rated maxKg, added to the PLANNING cost only (never
//                  output). The hard limits are hardMaxKg (else maxKg + overKg)
//                  and maxStops. A card over its ideal stops or its rated load
//                  (maxKg + overKg) is flagged amber.
//   3. Heavy     — a stop heavier than one direct Big is split BY BILL into
//                  full direct-Big loads while more than one direct Big of it is
//                  left; the leftover bills plan like any other stop. Only a
//                  single bill heavier than a direct Big gets a Bulk card.
//   4. Every other stop starts as its own load.
//   5. Combine   — the savings method: join the pair of loads on the SAME side
//                  that saves most (cost A + cost B − cost A∪B + truckPenaltyRs)
//                  while the join is allowed; stop when nothing saves. Allowed:
//                  a vehicle carries it, ≤ maxPlacesPerTruck places, and every
//                  pair of places allowed (same route always; else seen together
//                  ≥ pairMinTimes).
//   5b. Ride-along — a load under rideAlongBelowKg may join ANY load on its
//                  side, ignoring the pair rule and the places limit (kg and
//                  stop limits still apply). If it can join nothing and has no
//                  overdue bill → Hold ("Hold for tomorrow").
//   6. Vehicles  — Aces first (7–8-stop loads, then where Ace saves most vs
//                  Big), then GCs (small, near, cheaper than Big), then Bigs; a
//                  7–8-stop load with no Ace left is re-planned without Aces;
//                  then one more combine on the assigned vehicles' costs.
//   7. Limits    — loads left without a vehicle become ONE Waiting card per
//                  side; overdue loads get vehicles first, then the oldest.
//   8. Order     — stops far first (highest Big rate), back toward Surat.
//   9. Output    — cards + a summary, no rupees; reasons name the PLACES.
//
// ⚠ TARGET < ES2015: every Set/Map is iterated through Array.from (CLAUDE.md §1).

// ── Config ──────────────────────────────────────────────────────────────────

export type VehicleType = "ace" | "big" | "gc";
export const VEHICLE_TYPES: readonly VehicleType[] = ["ace", "big", "gc"];

export interface VehicleSpec {
  /** The RATED load. Above it (+ overKg) a card is flagged amber. */
  maxKg: number;
  /** Optional HARD weight limit; absent → maxKg + overKg is the hard limit. */
  hardMaxKg?: number;
  /** Allowed over maxKg (a 2,000 kg Ace may carry 2,050). */
  overKg: number;
  idealStops: number;
  maxStops: number;
  /** Default count per day; null = unlimited. */
  dailyCount: number | null;
  /** May only go where every area has gcAllowed. */
  nearOnly: boolean;
  /** 1 = assigned first. */
  priority: number;
}

export interface LoadPlanV2Config {
  /** routeId → "South" | "North" | "Surat" | "Direct". Loads combine only within one side. */
  routeSides: Record<number, string>;
  vehicles: Record<VehicleType, VehicleSpec>;
  maxPlacesPerTruck: number;
  pairMinTimes: number;
  /** Two places on the same route may always share a truck. */
  sameRoutePairsAlways: boolean;
  /** A load lighter than this may ride along with any load on its side. */
  rideAlongBelowKg: number;
  /** A Big with 1 or 2 stops may carry up to this; 3+ stops keep maxKg + overKg. */
  directBigMaxKg: number;
  /** Light milk run: an Ace may exceed its maxStops up to `maxStops` when the load is ≤ `maxKg`. null = off. */
  aceLightRun: { maxStops: number; maxKg: number } | null;
  /** INTERNAL soft cost per stop above a vehicle's idealStops (planning only, never output). Default 0. */
  stopChargeRs: number;
  /** INTERNAL soft cost per 100 kg above a vehicle's rated maxKg (planning only, never output). Default 0. */
  weightChargeRsPer100Kg: number;
  /** Kept for the stored row; the heavy-stop split now keys on directBigMaxKg. */
  bulkKg: number;
  /** INTERNAL — the cost of one more truck, added to every saving. Never output. */
  truckPenaltyRs: number;
  holdSmallUnlessOverdue: boolean;
  newArea: { rate: "route_typical"; gcAllowed: boolean; pairs: "same_route" };
}

/**
 * CODE DEFAULTS (owner, 2026-09-21). A value set in the config row OVERRIDES
 * its default; a key absent from the row takes the default.
 */
export const V2_DEFAULTS = {
  pairMinTimes: 1,
  sameRoutePairsAlways: true,
  maxPlacesPerTruck: 6,
  rideAlongBelowKg: 300,
  directBigMaxKg: 3500,
} as const;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPos = (v: unknown): v is number => isNum(v) && v > 0;

/**
 * The stored Upcountry config → the v2 config, or null when a REQUIRED v2 key
 * is missing or malformed. Keys with a code default (V2_DEFAULTS) are optional;
 * when present they must be valid and they win. The v1 keys are ignored here.
 */
export function parseLoadPlanV2Config(raw: unknown): LoadPlanV2Config | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const sidesRaw = o.routeSides;
  if (sidesRaw === null || typeof sidesRaw !== "object" || Array.isArray(sidesRaw)) return null;
  const routeSides: Record<number, string> = {};
  for (const k of Object.keys(sidesRaw as object)) {
    const v = (sidesRaw as Record<string, unknown>)[k];
    const id = Number(k);
    if (!Number.isInteger(id) || typeof v !== "string" || v === "") return null;
    routeSides[id] = v;
  }
  const vr = o.vehicles as Record<string, unknown> | undefined;
  if (!vr || typeof vr !== "object") return null;
  const vehicles = {} as Record<VehicleType, VehicleSpec>;
  for (const t of VEHICLE_TYPES) {
    const s = vr[t] as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object") return null;
    if (!isPos(s.maxKg) || !isNum(s.overKg) || s.overKg < 0 || !isPos(s.idealStops) || !isPos(s.maxStops)) return null;
    if (!(s.dailyCount === null || (isNum(s.dailyCount) && s.dailyCount >= 0))) return null;
    if (typeof s.nearOnly !== "boolean" || !isNum(s.priority)) return null;
    if (s.hardMaxKg !== undefined && !isPos(s.hardMaxKg)) return null;
    vehicles[t] = {
      maxKg: s.maxKg, overKg: s.overKg, idealStops: s.idealStops, maxStops: s.maxStops,
      dailyCount: s.dailyCount as number | null, nearOnly: s.nearOnly, priority: s.priority,
      ...(s.hardMaxKg !== undefined ? { hardMaxKg: s.hardMaxKg as number } : {}),
    };
  }
  if (!isPos(o.bulkKg) || !isNum(o.truckPenaltyRs) || typeof o.holdSmallUnlessOverdue !== "boolean") return null;
  const na = o.newArea as Record<string, unknown> | undefined;
  if (!na || na.rate !== "route_typical" || typeof na.gcAllowed !== "boolean" || na.pairs !== "same_route") return null;

  // Keys with a code default: absent → default; present → must be valid.
  const posOr = (k: string, d: number): number | null => (o[k] === undefined ? d : isPos(o[k]) ? (o[k] as number) : null);
  const boolOr = (k: string, d: boolean): boolean | null => (o[k] === undefined ? d : typeof o[k] === "boolean" ? (o[k] as boolean) : null);
  const pairMinTimes = posOr("pairMinTimes", V2_DEFAULTS.pairMinTimes);
  const maxPlacesPerTruck = posOr("maxPlacesPerTruck", V2_DEFAULTS.maxPlacesPerTruck);
  const rideAlongBelowKg = posOr("rideAlongBelowKg", V2_DEFAULTS.rideAlongBelowKg);
  const sameRoutePairsAlways = boolOr("sameRoutePairsAlways", V2_DEFAULTS.sameRoutePairsAlways);
  const directBigMaxKg = posOr("directBigMaxKg", V2_DEFAULTS.directBigMaxKg);
  const nonNegOr = (k: string): number | null => (o[k] === undefined ? 0 : isNum(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : null);
  const stopChargeRs = nonNegOr("stopChargeRs");
  const weightChargeRsPer100Kg = nonNegOr("weightChargeRsPer100Kg");
  if (stopChargeRs === null || weightChargeRsPer100Kg === null) return null;
  // aceLightRun: absent or null → off; present → { maxStops, maxKg }, both positive.
  let aceLightRun: { maxStops: number; maxKg: number } | null = null;
  if (o.aceLightRun !== undefined && o.aceLightRun !== null) {
    const lr = o.aceLightRun as Record<string, unknown>;
    if (typeof lr !== "object" || !isPos(lr.maxStops) || !isPos(lr.maxKg)) return null;
    aceLightRun = { maxStops: lr.maxStops, maxKg: lr.maxKg };
  }
  if (pairMinTimes === null || maxPlacesPerTruck === null || rideAlongBelowKg === null || sameRoutePairsAlways === null || directBigMaxKg === null) return null;

  return {
    routeSides, vehicles, maxPlacesPerTruck, pairMinTimes, sameRoutePairsAlways, rideAlongBelowKg, directBigMaxKg, aceLightRun,
    stopChargeRs, weightChargeRsPer100Kg,
    bulkKg: o.bulkKg, truckPenaltyRs: o.truckPenaltyRs, holdSmallUnlessOverdue: o.holdSmallUnlessOverdue,
    newArea: { rate: "route_typical", gcAllowed: na.gcAllowed, pairs: "same_route" },
  };
}

/**
 * How many kg a vehicle of type `t` may carry with `stops` stops: maxKg +
 * overKg, except a Big with 1 or 2 stops — a "direct Big" — which may carry
 * up to directBigMaxKg (never less than the normal Big limit).
 */
export function kgCap(cfg: LoadPlanV2Config, t: VehicleType, stops: number): number {
  const v = cfg.vehicles[t];
  const normal = v.hardMaxKg ?? v.maxKg + v.overKg;
  return t === "big" && stops <= 2 ? Math.max(normal, cfg.directBigMaxKg) : normal;
}

/**
 * May a vehicle of type `t` carry `stops` stops weighing `kg`? Up to its
 * maxStops always; an Ace beyond that only on a light milk run (aceLightRun).
 */
export function stopsAllowed(cfg: LoadPlanV2Config, t: VehicleType, stops: number, kg: number): boolean {
  if (stops <= cfg.vehicles[t].maxStops) return true;
  const lr = cfg.aceLightRun;
  return t === "ace" && lr !== null && stops <= lr.maxStops && kg <= lr.maxKg;
}

/** Above the vehicle's RATED load (maxKg + overKg) — an amber card. */
export function overRated(cfg: LoadPlanV2Config, t: VehicleType, kg: number): boolean {
  const v = cfg.vehicles[t];
  return kg > v.maxKg + v.overKg;
}

/**
 * The SOFT service cost of carrying `stops` stops weighing `kg` in a `t`:
 * stopChargeRs per stop above idealStops + weightChargeRsPer100Kg per 100 kg
 * above the rated maxKg. INTERNAL — planning only, never output.
 */
function softCost(cfg: LoadPlanV2Config, t: VehicleType, stops: number, kg: number): number {
  const v = cfg.vehicles[t];
  return cfg.stopChargeRs * Math.max(0, stops - v.idealStops) + (cfg.weightChargeRsPer100Kg * Math.max(0, kg - v.maxKg)) / 100;
}

// ── Context (built on the server) ───────────────────────────────────────────

/** One load_plan_area_rate row. INTERNAL — never sent to a browser. */
export interface AreaRate {
  gcRate: number | null; aceRate: number | null; bigRate: number | null;
  gcExtra: number | null; aceExtra: number | null; bigExtra: number | null;
  gcAllowed: boolean;
}

export interface AreaInfo {
  name: string;
  routeId: number | null;
}

export interface LoadPlanV2Context {
  config: LoadPlanV2Config;
  /** areaId → its rate row. Areas without a row are priced by their route's typical rate. */
  rates: ReadonlyMap<number, AreaRate>;
  /** "a-b" (a < b) → timesTogether. */
  pairs: ReadonlyMap<string, number>;
  /** Every area: name and route (area_master). */
  areas: ReadonlyMap<number, AreaInfo>;
  routeNames: Readonly<Record<number, string>>;
}

// ── Input and output ────────────────────────────────────────────────────────

export interface V2Bill {
  orderId: number;
  /** null, 0 or negative = unknown → packs as 0. */
  weightKg: number | null;
  /** computeDropKey — bills sharing one are one stop. */
  stopKey: string;
  /** The delivery site's area, else the dealer's. */
  areaId: number | null;
  routeId: number | null;
  overdue: boolean;
  /** Days since the bill was due — the older, the sooner it gets a vehicle. */
  ageDays?: number;
}

/** Vehicles available today. Omitted → config dailyCount (null = unlimited). */
export interface VehicleCounts {
  ace?: number;
  big?: number;
  gc?: number;
}

export type V2CardType = VehicleType | "bulk" | "direct" | "hold" | "waiting";

export interface V2Stop {
  stopKey: string;
  areaId: number | null;
  areaName: string;
  kg: number;
  orderIds: number[];
  /** Joined by the ride-along rule — exempt from the pair rule and the places limit. */
  ridesAlong: boolean;
}

export interface V2Card {
  key: string;
  type: V2CardType;
  /** The side the load travels ("South", "North", "Surat", "Direct", or "route:<id>"). */
  side: string;
  orderIds: number[];
  /** Far first. */
  stops: V2Stop[];
  kg: number;
  stopCount: number;
  /** Distinct area names, in stop order. */
  areaNames: string[];
  flags: {
    /** More stops than the vehicle's idealStops. */
    overIdealStops: boolean;
    /** An area priced by its route's typical rate, or with no pair history. */
    newArea: boolean;
    /** An Ace beyond its normal stop limit on a light milk run — shown amber. */
    lightRun: boolean;
    /** Heavier than the vehicle's rated load (maxKg + overKg). */
    overloaded: boolean;
    /** Show amber: over the ideal stops, over the rated load, or a light milk run. */
    amber: boolean;
  };
  /** Words only — never a rupee figure. */
  reason: string;
  /** Waiting cards: the vehicles that would carry these loads. */
  needs?: Partial<Record<VehicleType, number>>;
}

export interface V2Plan {
  cards: V2Card[];
  summary: {
    /** Suggested trucks by type (split heavy-stop loads count as Bigs). */
    ace: number; big: number; gc: number;
    trucks: number;
    bulk: number; direct: number; hold: number; waiting: number;
    totalKg: number;
  };
}

// ── Areas: rates, typical rates, pairs ──────────────────────────────────────

const NO_AREA_NAME = "Area not set";
/** A bill with no area gets one synthetic area per route. */
const syntheticArea = (routeId: number | null) => -1_000_000 - (routeId ?? 0);

const RATE_FIELD: Record<VehicleType, keyof AreaRate> = { ace: "aceRate", big: "bigRate", gc: "gcRate" };
const EXTRA_FIELD: Record<VehicleType, keyof AreaRate> = { ace: "aceExtra", big: "bigExtra", gc: "gcExtra" };

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** What the engine knows about one area — resolved once per plan. */
interface AreaFacts {
  id: number;
  name: string;
  routeId: number | null;
  rate: Record<VehicleType, number>;
  extra: Record<VehicleType, number>;
  gcAllowed: boolean;
  /** Priced by its route's typical rate (no row, or no rate for a vehicle). */
  typical: boolean;
  /** Has at least one pair row. */
  hasPairs: boolean;
}

class Areas {
  private cache = new Map<number, AreaFacts>();
  private typicalCache = new Map<string, number>();
  private withPairs = new Set<number>();

  constructor(private ctx: LoadPlanV2Context) {
    Array.from(ctx.pairs.keys()).forEach((k) => {
      const [a, b] = k.split("-").map(Number);
      this.withPairs.add(a);
      this.withPairs.add(b);
    });
  }

  /** Median of a rate/extra field over the route's areas that have one; else over all. */
  private typical(routeId: number | null, field: keyof AreaRate): number {
    const key = `${routeId}|${field}`;
    const hit = this.typicalCache.get(key);
    if (hit !== undefined) return hit;
    const onRoute: number[] = [];
    const all: number[] = [];
    Array.from(this.ctx.rates.entries()).forEach(([areaId, r]) => {
      const v = r[field];
      if (typeof v !== "number") return;
      all.push(v);
      if (routeId !== null && this.ctx.areas.get(areaId)?.routeId === routeId) onRoute.push(v);
    });
    const v = median(onRoute) ?? median(all) ?? 0;
    this.typicalCache.set(key, v);
    return v;
  }

  get(id: number, routeHint: number | null): AreaFacts {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const info = this.ctx.areas.get(id);
    const routeId = info?.routeId ?? routeHint;
    const row = id >= 0 ? this.ctx.rates.get(id) : undefined;
    const rate = {} as Record<VehicleType, number>;
    const extra = {} as Record<VehicleType, number>;
    let typical = !row;
    for (const t of VEHICLE_TYPES) {
      const rv = row ? row[RATE_FIELD[t]] : null;
      const ev = row ? row[EXTRA_FIELD[t]] : null;
      if (typeof rv === "number") rate[t] = rv;
      else {
        rate[t] = this.typical(routeId, RATE_FIELD[t]);
        typical = true;
      }
      extra[t] = typeof ev === "number" ? ev : this.typical(routeId, EXTRA_FIELD[t]);
    }
    const facts: AreaFacts = {
      id,
      name: info?.name.trim() || NO_AREA_NAME,
      routeId,
      rate,
      extra,
      // No row → config.newArea.gcAllowed (false). A row → its own flag.
      gcAllowed: row ? row.gcAllowed : this.ctx.config.newArea.gcAllowed,
      typical,
      hasPairs: this.withPairs.has(id),
    };
    this.cache.set(id, facts);
    return facts;
  }

  /** May these two places share a truck? */
  pairOk(a: AreaFacts, b: AreaFacts): boolean {
    if (a.id === b.id) return true;
    const sameRoute = a.routeId !== null && a.routeId === b.routeId;
    // Same route: always together (owner, 2026-09-21) — which also covers
    // newArea.pairs = "same_route" for a place with no pair history.
    if (sameRoute && (this.ctx.config.sameRoutePairsAlways || !a.hasPairs || !b.hasPairs)) return true;
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    return (this.ctx.pairs.get(key) ?? 0) >= this.ctx.config.pairMinTimes;
  }
}

// ── Loads ───────────────────────────────────────────────────────────────────

interface StopRec {
  key: string;
  area: AreaFacts;
  kg: number;
  orderIds: number[];
  overdue: boolean;
  maxAge: number;
  /** Joined by the ride-along rule: exempt from the pair rule and the places limit. */
  rider?: boolean;
}

interface Load {
  key: string;
  side: string;
  stops: StopRec[];
  kg: number;
  /** Every place on the load (prices it). */
  areas: AreaFacts[];
  /** The places the pair rule and the places limit apply to — riders excluded. */
  coreAreas: AreaFacts[];
  overdue: boolean;
  maxAge: number;
  /** Assigned vehicle, once step 6 runs. */
  vehicle?: VehicleType;
  replanned?: boolean;
  merged?: boolean;
  /** A full Big load split off a heavy stop (rule 3): the stop's area and total kg. */
  split?: { area: string; stopKg: number };
}

function makeLoad(stops: StopRec[], side: string): Load {
  const all = new Map<number, AreaFacts>();
  const core = new Map<number, AreaFacts>();
  stops.forEach((s) => {
    all.set(s.area.id, s.area);
    if (!s.rider) core.set(s.area.id, s.area);
  });
  const sorted = stops.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    key: sorted.map((s) => s.key).join("|"),
    side,
    stops: sorted,
    kg: stops.reduce((n, s) => n + s.kg, 0),
    areas: Array.from(all.values()).sort((a, b) => a.id - b.id),
    coreAreas: Array.from(core.values()).sort((a, b) => a.id - b.id),
    overdue: stops.some((s) => s.overdue),
    maxAge: stops.reduce((n, s) => Math.max(n, s.maxAge), 0),
  };
}

/**
 * The trip cost of carrying these areas in one vehicle of type `t`: the
 * highest rate among them, plus that area's extra for each other area, up to
 * three. INTERNAL — exported for the local backtest only.
 */
export function tripCostOf(areas: ReadonlyArray<{ rate: Record<VehicleType, number>; extra: Record<VehicleType, number>; id: number }>, t: VehicleType): number {
  if (areas.length === 0) return 0;
  let base = areas[0];
  areas.forEach((a) => {
    if (a.rate[t] > base.rate[t] || (a.rate[t] === base.rate[t] && a.id < base.id)) base = a;
  });
  return base.rate[t] + base.extra[t] * Math.min(3, areas.length - 1);
}

/**
 * A pricer over this context: the trip cost of one vehicle of type `t` to
 * these areas, with the same route-typical fallback the engine uses.
 * 🔴 INTERNAL — for the LOCAL BACKTEST, which prints percentages only. Its
 * result is a rupee amount: never log it, never send it to a browser.
 */
export function makePricer(ctx: LoadPlanV2Context): (areaIds: ReadonlyArray<number>, t: VehicleType, routeHint?: number | null) => number {
  const areas = new Areas(ctx);
  return (areaIds, t, routeHint = null) => {
    const facts = Array.from(new Set(areaIds)).map((id) => areas.get(id, routeHint));
    return tripCostOf(facts, t);
  };
}

// ── The engine ──────────────────────────────────────────────────────────────

type Avail = Record<VehicleType, number>;

export function planLoadsV2(bills: V2Bill[], ctx: LoadPlanV2Context, counts: VehicleCounts = {}): V2Plan {
  const cfg = ctx.config;
  const V = cfg.vehicles;
  /** One direct Big — what a single stop may weigh before it is split. */
  const splitCap = kgCap(cfg, "big", 1);
  const areas = new Areas(ctx);
  const routeName = (id: number | null) => (id === null ? "No route" : ctx.routeNames[id]?.trim() || `Route ${id}`);
  const sideOf = (routeId: number | null) =>
    routeId !== null && cfg.routeSides[routeId] ? cfg.routeSides[routeId] : `route:${routeId ?? "none"}`;
  const cards: V2Card[] = [];
  const avail: Avail = {
    ace: counts.ace ?? V.ace.dailyCount ?? Infinity,
    big: counts.big ?? V.big.dailyCount ?? Infinity,
    gc: counts.gc ?? V.gc.dailyCount ?? Infinity,
  };

  // ── 2. Stops. Each keeps its bills (weight per bill) for the heavy split.
  interface RawStop { key: string; areaId: number; routeId: number | null; bills: Array<{ id: number; kg: number; overdue: boolean; age: number }> }
  const raw = new Map<string, RawStop>();
  bills.forEach((b) => {
    let s = raw.get(b.stopKey);
    if (!s) {
      s = { key: b.stopKey, areaId: b.areaId ?? syntheticArea(b.routeId), routeId: b.routeId, bills: [] };
      raw.set(b.stopKey, s);
    }
    const kg = typeof b.weightKg === "number" && b.weightKg > 0 ? b.weightKg : 0;
    s.bills.push({ id: b.orderId, kg, overdue: b.overdue, age: b.ageDays ?? 0 });
  });
  const rawStops = Array.from(raw.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
  const toStop = (s: RawStop, part: RawStop["bills"], keySuffix = ""): StopRec => ({
    key: s.key + keySuffix,
    area: areas.get(s.areaId, s.routeId),
    kg: part.reduce((n, b) => n + b.kg, 0),
    orderIds: part.map((b) => b.id).sort((a, b) => a - b),
    overdue: part.some((b) => b.overdue),
    maxAge: part.reduce((n, b) => Math.max(n, b.age), 0),
  });

  // ── 1. Direct routes: one card per route, never mixed.
  const directByRoute = new Map<string, StopRec[]>();
  const planned: Array<{ stop: StopRec; side: string }> = [];
  const preassigned: Load[] = [];
  rawStops.forEach((s) => {
    const side = sideOf(s.routeId);
    if (side === "Direct") {
      const k = String(s.routeId);
      directByRoute.set(k, [...(directByRoute.get(k) ?? []), toStop(s, s.bills)]);
      return;
    }
    const total = s.bills.reduce((n, b) => n + b.kg, 0);
    if (total <= splitCap) {
      planned.push({ stop: toStop(s, s.bills), side });
      return;
    }
    // ── 3. A heavy stop: a single bill no direct Big can carry → Bulk; the rest
    //    is split BY BILL into full direct-Big loads while more than one direct
    //    Big of it is left; the leftover bills plan like any other stop.
    let rest = s.bills.slice().sort((a, b) => b.kg - a.kg || a.id - b.id);
    rest.filter((b) => b.kg > splitCap).forEach((b) => {
      const load = makeLoad([toStop(s, [b], `#bill${b.id}`)], side);
      cards.push(toCard(load, "bulk", `One bill over ${fmtKg(splitCap)} kg — hire as needed.`));
    });
    rest = rest.filter((b) => b.kg <= splitCap);
    let part = 0;
    while (rest.reduce((n, b) => n + b.kg, 0) > splitCap) {
      const take: typeof rest = [];
      let kg = 0;
      const keep: typeof rest = [];
      rest.forEach((b) => {
        if (kg + b.kg <= splitCap) {
          take.push(b);
          kg += b.kg;
        } else keep.push(b);
      });
      if (take.length === 0) break; // cannot happen: every bill here ≤ splitCap
      const load = makeLoad([toStop(s, take, `#part${++part}`)], side);
      load.split = { area: load.areas[0].name, stopKg: total };
      preassigned.push(load);
      rest = keep;
    }
    if (rest.length > 0) planned.push({ stop: toStop(s, rest), side });
  });
  Array.from(directByRoute.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([rk, stops]) => {
      cards.push(toCard(makeLoad(stops, "Direct"), "direct", `${routeName(Number(rk))} is a direct route — never mixed.`));
    });

  // ── 4. Every other stop is its own load.
  let loads: Load[] = planned.map((p) => makeLoad([p.stop], p.side));

  // ── Helpers over loads.
  const allowedTypes = (l: { kg: number; stops: StopRec[]; areas: AreaFacts[] }, exclude: ReadonlySet<VehicleType>): VehicleType[] =>
    VEHICLE_TYPES.filter((t) => {
      if (exclude.has(t)) return false;
      const v = V[t];
      if (l.kg > kgCap(cfg, t, l.stops.length) || !stopsAllowed(cfg, t, l.stops.length, l.kg)) return false;
      // Near-only applies to EVERY place, riders included.
      if (v.nearOnly && !l.areas.every((a) => a.gcAllowed)) return false;
      return true;
    });
  const cheapest = (l: Load, types: VehicleType[]): { t: VehicleType; cost: number } | null => {
    let best: { t: VehicleType; cost: number } | null = null;
    types.forEach((t) => {
      const c = tripCostOf(l.areas, t) + softCost(cfg, t, l.stops.length, l.kg);
      if (!best || c < best.cost || (c === best.cost && V[t].priority < V[best.t].priority)) best = { t, cost: c };
    });
    return best;
  };
  /** The pair rule and the places limit — over CORE places only (riders are exempt). */
  const joinable = (a: Load, b: Load): boolean => {
    if (a.side !== b.side) return false;
    const ids = new Set<number>();
    a.coreAreas.forEach((x) => ids.add(x.id));
    b.coreAreas.forEach((x) => ids.add(x.id));
    if (ids.size > cfg.maxPlacesPerTruck) return false;
    return a.coreAreas.every((x) => b.coreAreas.every((y) => areas.pairOk(x, y)));
  };
  const minAreaId = (l: Load) => l.areas.reduce((m, a) => Math.min(m, a.id), Infinity);
  const tieKey = (a: Load, b: Load) => {
    const m = Math.min(minAreaId(a), minAreaId(b));
    const [x, y] = a.key < b.key ? [a.key, b.key] : [b.key, a.key];
    return { m, s: `${x}#${y}` };
  };

  /**
   * 5. THE SAVINGS METHOD. Repeatedly join the pair (same side, allowed) with
   * the largest saving until none saves anything.
   */
  const combine = (
    list: Load[],
    costOf: (l: Load) => number,
    unionCost: (a: Load, b: Load, u: Load) => number | null,
    onJoin?: (a: Load, b: Load, u: Load) => void,
  ): Load[] => {
    let cur = list.slice();
    for (;;) {
      let best: { i: number; j: number; u: Load; saving: number; tk: { m: number; s: string } } | null = null;
      for (let i = 0; i < cur.length; i++) {
        for (let j = i + 1; j < cur.length; j++) {
          const a = cur[i], b = cur[j];
          if (!joinable(a, b)) continue;
          const u = makeLoad(a.stops.concat(b.stops), a.side);
          const uc = unionCost(a, b, u);
          if (uc === null) continue;
          const saving = costOf(a) + costOf(b) - uc + cfg.truckPenaltyRs;
          if (saving <= 0) continue;
          const tk = tieKey(a, b);
          if (!best || saving > best.saving || (saving === best.saving && (tk.m < best.tk.m || (tk.m === best.tk.m && tk.s < best.tk.s)))) {
            best = { i, j, u, saving, tk };
          }
        }
      }
      if (!best) return cur;
      const { i, j, u } = best;
      onJoin?.(cur[i], cur[j], u);
      cur = cur.filter((_, k) => k !== i && k !== j).concat([u]);
    }
  };
  const planCost = (exclude: ReadonlySet<VehicleType>) => (l: Load) => cheapest(l, allowedTypes(l, exclude))?.cost ?? Infinity;
  const planUnion = (exclude: ReadonlySet<VehicleType>) => (_a: Load, _b: Load, u: Load) => cheapest(u, allowedTypes(u, exclude))?.cost ?? null;

  const NONE = new Set<VehicleType>();
  loads = combine(loads, planCost(NONE), planUnion(NONE));

  // ── 5b. RIDE-ALONG. A load under rideAlongBelowKg joins the load on its side
  //    where it adds the least cost, ignoring the pair rule and the places
  //    limit — only kg and stops must still fit a vehicle. Heaviest light load
  //    first; the key breaks ties. What joins nothing and is not overdue waits
  //    for tomorrow (Hold).
  const light = loads
    .filter((l) => l.kg < cfg.rideAlongBelowKg)
    .sort((a, b) => b.kg - a.kg || (a.key < b.key ? -1 : 1));
  light.forEach((small) => {
    if (!loads.includes(small)) return; // already absorbed as a host's partner
    let best: { host: Load; u: Load; add: number } | null = null;
    loads.forEach((host) => {
      if (host === small || host.side !== small.side) return;
      const riders = small.stops.map((s) => ({ ...s, rider: true }));
      const u = makeLoad(host.stops.concat(riders), host.side);
      const uc = cheapest(u, allowedTypes(u, NONE));
      if (!uc) return;
      const add = uc.cost - (cheapest(host, allowedTypes(host, NONE))?.cost ?? Infinity);
      if (!best || add < best.add || (add === best.add && host.key < best.host.key)) best = { host, u, add };
    });
    if (best) {
      const b: { host: Load; u: Load } = best;
      loads = loads.filter((x) => x !== small && x !== b.host).concat([b.u]);
    } else if (cfg.holdSmallUnlessOverdue && !small.overdue) {
      cards.push(toCard(small, "hold", `Under ${fmtKg(cfg.rideAlongBelowKg)} kg with nothing on its side to ride along with — hold for tomorrow.`));
      loads = loads.filter((x) => x !== small);
    }
  });

  // ── 6 + 7. Vehicles. The split heavy-stop loads take their Bigs first.
  let assigned: Load[] = [];
  let unassigned: Load[] = [];
  preassigned
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .forEach((l) => {
      if (avail.big > 0) {
        l.vehicle = "big";
        avail.big -= 1;
        assigned.push(l);
      } else unassigned.push(l);
    });

  const costAs = (l: Load, t: VehicleType) => tripCostOf(l.areas, t) + softCost(cfg, t, l.stops.length, l.kg);
  const fits = (l: Load, t: VehicleType) => allowedTypes(l, NONE).includes(t);
  // Overdue first, then the oldest — the rule-7 priority.
  const urgency = (a: Load, b: Load) => Number(b.overdue) - Number(a.overdue) || b.maxAge - a.maxAge;

  const assignAll = (pool: Load[], aceAllowed: boolean): { done: Load[]; left: Load[] } => {
    let left = pool.slice();
    const done: Load[] = [];
    if (aceAllowed) {
      const onlyAce = (l: Load) => l.stops.length > V.big.maxStops;
      const aceGain = (l: Load) => (fits(l, "big") ? costAs(l, "big") : Infinity) - costAs(l, "ace");
      const cands = left
        .filter((l) => fits(l, "ace"))
        .sort((a, b) => urgency(a, b) || Number(onlyAce(b)) - Number(onlyAce(a)) || aceGain(b) - aceGain(a) || (a.key < b.key ? -1 : 1));
      for (const l of cands) {
        if (avail.ace <= 0) break;
        l.vehicle = "ace";
        avail.ace -= 1;
        done.push(l);
      }
      left = left.filter((l) => !l.vehicle);
    }
    const gcGain = (l: Load) => (fits(l, "big") ? costAs(l, "big") : Infinity) - costAs(l, "gc");
    const gcs = left
      .filter((l) => fits(l, "gc") && gcGain(l) > 0)
      .sort((a, b) => urgency(a, b) || gcGain(b) - gcGain(a) || (a.key < b.key ? -1 : 1));
    for (const l of gcs) {
      if (avail.gc <= 0) break;
      l.vehicle = "gc";
      avail.gc -= 1;
      done.push(l);
    }
    left = left.filter((l) => !l.vehicle);
    const bigs = left.filter((l) => fits(l, "big")).sort((a, b) => urgency(a, b) || (a.key < b.key ? -1 : 1));
    for (const l of bigs) {
      if (avail.big <= 0) break;
      l.vehicle = "big";
      avail.big -= 1;
      done.push(l);
    }
    left = left.filter((l) => !l.vehicle);
    return { done, left };
  };

  {
    const r = assignAll(loads, true);
    assigned = assigned.concat(r.done);
    unassigned = unassigned.concat(r.left);
  }

  // d) 7–8-stop loads with no Ace left: re-plan just their stops without Aces.
  const aceOnlyLeft = unassigned.filter((l) => !l.split && l.stops.length > V.big.maxStops);
  if (aceOnlyLeft.length > 0) {
    unassigned = unassigned.filter((l) => !aceOnlyLeft.includes(l));
    const NO_ACE = new Set<VehicleType>(["ace"]);
    const singles = aceOnlyLeft.flatMap((l) => l.stops.map((s) => makeLoad([s], l.side)));
    const replanned = combine(singles, planCost(NO_ACE), planUnion(NO_ACE));
    replanned.forEach((l) => (l.replanned = true));
    const r = assignAll(replanned, false);
    assigned = assigned.concat(r.done);
    unassigned = unassigned.concat(r.left);
  }

  // e) One more combine on the ASSIGNED vehicles' costs — two half-empty Bigs
  //    going the same way merge. The union takes the cheapest type it fits
  //    that is free once the two loads give theirs back.
  assigned = combine(
    assigned,
    (l) => costAs(l, l.vehicle!),
    (a, b, u) => {
      const back: Avail = { ...avail };
      back[a.vehicle!] += 1;
      back[b.vehicle!] += 1;
      const types = allowedTypes(u, NONE).filter((t) => back[t] > 0);
      const c = cheapest(u, types);
      if (!c) return null;
      u.vehicle = c.t;
      return c.cost;
    },
    (a, b, u) => {
      avail[a.vehicle!] += 1;
      avail[b.vehicle!] += 1;
      avail[u.vehicle!] -= 1;
      u.merged = true;
      u.replanned = a.replanned || b.replanned;
      if (a.split || b.split) u.split = a.split ?? b.split;
    },
  );

  assigned.forEach((l) => cards.push(toCard(l, l.vehicle!, truckReason(l))));

  // 7. Waiting — one card per side for the loads no vehicle is left for.
  const waitBySide = new Map<string, Load[]>();
  unassigned.forEach((l) => waitBySide.set(l.side, [...(waitBySide.get(l.side) ?? []), l]));
  Array.from(waitBySide.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .forEach(([side, ls]) => {
      const needs: Partial<Record<VehicleType, number>> = {};
      ls.forEach((l) => {
        const t = l.split ? "big" : cheapest(l, allowedTypes(l, NONE))?.t ?? "big";
        needs[t] = (needs[t] ?? 0) + 1;
      });
      const words = VEHICLE_TYPES.filter((t) => needs[t])
        .map((t) => `${needs[t]} more ${VEHICLE_LABEL[t]}`)
        .join(" and ");
      const card = toCard(makeLoad(ls.flatMap((l) => l.stops), side), "waiting", `No vehicle left — needs ${words}.`);
      card.needs = needs;
      cards.push(card);
    });

  // ── Output order: trucks by kg (heaviest first), then bulk, direct,
  //    waiting, hold; the key breaks ties.
  const RANK: Record<V2CardType, number> = { ace: 0, big: 0, gc: 0, bulk: 1, direct: 2, waiting: 3, hold: 4 };
  cards.sort((a, b) => RANK[a.type] - RANK[b.type] || b.kg - a.kg || (a.key < b.key ? -1 : 1));

  const count = (t: V2CardType) => cards.filter((c) => c.type === t).length;
  return {
    cards,
    summary: {
      ace: count("ace"), big: count("big"), gc: count("gc"),
      trucks: count("ace") + count("big") + count("gc"),
      bulk: count("bulk"), direct: count("direct"), hold: count("hold"), waiting: count("waiting"),
      totalKg: cards.reduce((n, c) => n + c.kg, 0),
    },
  };

  // ── Card building (hoisted) ───────────────────────────────────────────────

  /**
   * Words for a truck, naming PLACES (owner): "Jolva, Kadodara joined Bardoli
   * — saves a truck". The main place is the one carrying the most kg; the
   * saving is claimed only when places from ANOTHER route joined.
   */
  function truckReason(l: Load): string {
    const parts: string[] = [];
    if (l.split) {
      parts.push(`Part of a ${fmtKg(l.split.stopKg)} kg stop at ${l.split.area} — split by bill into full Big loads.`);
    }
    const core = l.stops.filter((s) => !s.rider);
    const riders = l.stops.filter((s) => s.rider);
    const kgByArea = new Map<number, { a: AreaFacts; kg: number }>();
    core.forEach((s) => {
      const e = kgByArea.get(s.area.id) ?? { a: s.area, kg: 0 };
      e.kg += s.kg;
      kgByArea.set(s.area.id, e);
    });
    const places = Array.from(kgByArea.values()).sort((a, b) => b.kg - a.kg || a.a.id - b.a.id);
    if (!l.split && places.length > 0) {
      const main = places[0].a;
      const others = places.slice(1).map((p) => p.a);
      if (others.length === 0) {
        parts.push(core.length > 1 ? `${core.length} stops in ${main.name}.` : `${main.name} on its own.`);
      } else {
        const otherRoutes = new Set(others.filter((o) => o.routeId !== main.routeId).map((o) => String(o.routeId)));
        const joined = `${others.map((o) => o.name).join(", ")} joined ${main.name}`;
        parts.push(
          otherRoutes.size === 0
            ? `${joined}.`
            : `${joined} — saves ${otherRoutes.size === 1 ? "a truck" : `${otherRoutes.size} trucks`}.`,
        );
      }
    }
    if (riders.length > 0) {
      const names: string[] = [];
      riders.forEach((s) => { if (!names.includes(s.area.name)) names.push(s.area.name); });
      parts.push(`${names.join(", ")} ${names.length === 1 ? "rides" : "ride"} along (under ${fmtKg(cfg.rideAlongBelowKg)} kg).`);
    }
    if (l.vehicle === "big" && l.stops.length <= 2 && l.kg > (V.big.hardMaxKg ?? V.big.maxKg + V.big.overKg)) parts.push(`Direct Big (${l.stops.length} ${l.stops.length === 1 ? "stop" : "stops"}, up to ${fmtKg(cfg.directBigMaxKg)} kg).`);
    if (l.vehicle === "ace" && l.stops.length > V.ace.maxStops && cfg.aceLightRun) {
      parts.push(`Light milk run — ${l.stops.length} stops, ${fmtKg(cfg.aceLightRun.maxKg)} kg or less.`);
    } else if (l.vehicle === "ace" && l.stops.length > V.big.maxStops) {
      parts.push(`${l.stops.length} stops — only an Ace carries that many.`);
    }
    if (l.replanned) parts.push(`Re-planned without an Ace (max ${V.big.maxStops} stops).`);
    if (l.merged) parts.push(`Two loads going the same way merged.`);
    return parts.join(" ");
  }

  function toCard(l: Load, type: V2CardType, reason: string): V2Card {
    // Far first: the highest Big rate first, back toward Surat.
    const ordered = l.stops
      .slice()
      .sort((a, b) => b.area.rate.big - a.area.rate.big || a.area.id - b.area.id || (a.key < b.key ? -1 : 1));
    const names: string[] = [];
    ordered.forEach((s) => {
      if (!names.includes(s.area.name)) names.push(s.area.name);
    });
    const vt = type === "ace" || type === "big" || type === "gc" ? type : null;
    return {
      key: `${type}:${l.key}`,
      type,
      side: l.side,
      orderIds: ordered.flatMap((s) => s.orderIds).sort((a, b) => a - b),
      stops: ordered.map((s) => ({
        // A split part keeps its stop's own key: "#part1" is internal only.
        stopKey: s.key.replace(/#(part|bill)\d+$/, ""),
        areaId: s.area.id >= 0 ? s.area.id : null,
        areaName: s.area.name,
        kg: s.kg,
        orderIds: s.orderIds.slice().sort((a, b) => a - b),
        ridesAlong: s.rider === true,
      })),
      kg: l.kg,
      stopCount: l.stops.length,
      areaNames: names,
      flags: {
        overIdealStops: vt !== null && l.stops.length > V[vt].idealStops,
        newArea: l.areas.some((a) => a.typical || !a.hasPairs),
        lightRun: type === "ace" && l.stops.length > V.ace.maxStops,
        overloaded: vt !== null && overRated(cfg, vt, l.kg),
        amber:
          vt !== null &&
          (l.stops.length > V[vt].idealStops || overRated(cfg, vt, l.kg) || (type === "ace" && l.stops.length > V.ace.maxStops)),
      },
      reason,
    };
  }
}

const VEHICLE_LABEL: Record<VehicleType, string> = { ace: "Ace", big: "Big", gc: "GC" };
const fmtKg = (kg: number) => Math.round(kg).toLocaleString("en-US");
