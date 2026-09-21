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
// what order, and why in words. `tripCostOf` is exported for the local backtest
// (which prints percentages only); never send its result to a browser.
//
// THE RULES, in the owner's order (step 3 prompt, 2026-09-21):
//   1. Direct   — a route whose side is "Direct" (IGT / CROSS, Transport): one
//                 Direct card per route, never mixed.
//   2. Stops    — bills grouped by stopKey; a stop is never split.
//   3. Bulk     — a stop over bulkKg: its own Bulk card.
//   4. Every other stop starts as its own load.
//   5. Combine  — the savings method: join the pair of loads on the SAME side
//                 that saves most (cost A + cost B − cost A∪B + truckPenaltyRs)
//                 while the join is allowed; stop when nothing saves.
//   6. Vehicles — Aces first (7–8-stop loads, then where Ace saves most vs Big),
//                 then GCs (small, near, cheaper than Big), then Bigs; a 7–8-stop
//                 load with no Ace left is re-planned without Aces (≤ 6 stops);
//                 then one more combine pass on the assigned vehicles' costs.
//   7. Limits   — loads left without a vehicle become ONE Waiting card per side;
//                 overdue loads get vehicles first, then the oldest.
//   8. Hold     — a load under holdBelowKg alone on its side with no overdue
//                 bill: "Hold for tomorrow", not a truck.
//   9. Order    — stops far first (highest Big rate), back toward Surat.
//  10. Output   — cards + a summary, no rupees.
//
// ⚠ TARGET < ES2015: every Set/Map is iterated through Array.from (CLAUDE.md §1).

// ── Config ──────────────────────────────────────────────────────────────────

export type VehicleType = "ace" | "big" | "gc";
export const VEHICLE_TYPES: readonly VehicleType[] = ["ace", "big", "gc"];

export interface VehicleSpec {
  maxKg: number;
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
  bulkKg: number;
  /** INTERNAL — the cost of one more truck, added to every saving. Never output. */
  truckPenaltyRs: number;
  holdSmallUnlessOverdue: boolean;
  /** Code default (owner, 2026-09-21): 300 kg. */
  holdBelowKg: number;
  newArea: { rate: "route_typical"; gcAllowed: boolean; pairs: "same_route" };
}

/** The Hold threshold — a code default, not a config key (owner). */
export const HOLD_BELOW_KG = 300;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPos = (v: unknown): v is number => isNum(v) && v > 0;

/**
 * The stored Upcountry config → the v2 config, or null when any v2 key is
 * missing or malformed (the v1 keys are ignored here; v1 reads its own).
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
    vehicles[t] = {
      maxKg: s.maxKg, overKg: s.overKg, idealStops: s.idealStops, maxStops: s.maxStops,
      dailyCount: s.dailyCount as number | null, nearOnly: s.nearOnly, priority: s.priority,
    };
  }
  if (!isPos(o.maxPlacesPerTruck) || !isPos(o.pairMinTimes) || !isPos(o.bulkKg) || !isNum(o.truckPenaltyRs)) return null;
  if (typeof o.holdSmallUnlessOverdue !== "boolean") return null;
  const na = o.newArea as Record<string, unknown> | undefined;
  if (!na || na.rate !== "route_typical" || typeof na.gcAllowed !== "boolean" || na.pairs !== "same_route") return null;
  return {
    routeSides, vehicles,
    maxPlacesPerTruck: o.maxPlacesPerTruck, pairMinTimes: o.pairMinTimes, bulkKg: o.bulkKg,
    truckPenaltyRs: o.truckPenaltyRs, holdSmallUnlessOverdue: o.holdSmallUnlessOverdue,
    holdBelowKg: HOLD_BELOW_KG,
    newArea: { rate: "route_typical", gcAllowed: na.gcAllowed, pairs: "same_route" },
  };
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
}

export interface V2Card {
  key: string;
  type: V2CardType;
  /** The side the load travels ("South", "North", "Surat", "Direct", or "route:<id>"). */
  side: string;
  orderIds: number[];
  /** Far first (rule 9). */
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
  };
  /** Words only — never a rupee figure. */
  reason: string;
  /** Waiting cards: the vehicles that would carry these loads. */
  needs?: Partial<Record<VehicleType, number>>;
}

export interface V2Plan {
  cards: V2Card[];
  summary: {
    /** Suggested trucks by type. */
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

  /** May these two areas share a truck? */
  pairOk(a: AreaFacts, b: AreaFacts): boolean {
    if (a.id === b.id) return true;
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    if ((this.ctx.pairs.get(key) ?? 0) >= this.ctx.config.pairMinTimes) return true;
    // newArea.pairs = "same_route": an area with no pair history may pair with
    // any area on its own route.
    return (!a.hasPairs || !b.hasPairs) && a.routeId !== null && a.routeId === b.routeId;
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
}

interface Load {
  key: string;
  side: string;
  stops: StopRec[];
  kg: number;
  areas: AreaFacts[];
  overdue: boolean;
  maxAge: number;
  /** Assigned vehicle, once step 6 runs. */
  vehicle?: VehicleType;
  replanned?: boolean;
  merged?: boolean;
}

function makeLoad(stops: StopRec[], side: string): Load {
  const byId = new Map<number, AreaFacts>();
  stops.forEach((s) => byId.set(s.area.id, s.area));
  const sorted = stops.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    key: sorted.map((s) => s.key).join("|"),
    side,
    stops: sorted,
    kg: stops.reduce((n, s) => n + s.kg, 0),
    areas: Array.from(byId.values()).sort((a, b) => a.id - b.id),
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
  const areas = new Areas(ctx);
  const routeName = (id: number | null) => (id === null ? "No route" : ctx.routeNames[id]?.trim() || `Route ${id}`);
  const sideOf = (routeId: number | null) =>
    routeId !== null && cfg.routeSides[routeId] ? cfg.routeSides[routeId] : `route:${routeId ?? "none"}`;
  const cards: V2Card[] = [];

  // ── 2. Stops (per side and route; the stop key identifies the customer).
  const stopMap = new Map<string, { stop: StopRec; routeId: number | null }>();
  bills.forEach((b) => {
    const areaId = b.areaId ?? syntheticArea(b.routeId);
    const k = b.stopKey;
    let e = stopMap.get(k);
    if (!e) {
      e = { stop: { key: k, area: areas.get(areaId, b.routeId), kg: 0, orderIds: [], overdue: false, maxAge: 0 }, routeId: b.routeId };
      stopMap.set(k, e);
    }
    const w = typeof b.weightKg === "number" && b.weightKg > 0 ? b.weightKg : 0;
    e.stop.kg += w;
    e.stop.orderIds.push(b.orderId);
    if (b.overdue) e.stop.overdue = true;
    e.stop.maxAge = Math.max(e.stop.maxAge, b.ageDays ?? 0);
  });
  const allStops = Array.from(stopMap.values()).sort((a, b) => (a.stop.key < b.stop.key ? -1 : 1));

  // ── 1. Direct routes: one card per route, never mixed.
  const directByRoute = new Map<string, StopRec[]>();
  const rest: Array<{ stop: StopRec; routeId: number | null }> = [];
  allStops.forEach((e) => {
    if (sideOf(e.routeId) === "Direct") {
      const k = String(e.routeId);
      directByRoute.set(k, [...(directByRoute.get(k) ?? []), e.stop]);
    } else rest.push(e);
  });
  Array.from(directByRoute.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([rk, stops]) => {
      const load = makeLoad(stops, "Direct");
      cards.push(toCard(load, "direct", `${routeName(Number(rk))} is a direct route — never mixed.`));
    });

  // ── 3. Bulk stops; 4. every other stop is its own load.
  let loads: Load[] = [];
  rest.forEach((e) => {
    const side = sideOf(e.routeId);
    if (e.stop.kg > cfg.bulkKg) {
      cards.push(toCard(makeLoad([e.stop], side), "bulk", `One stop over ${fmtKg(cfg.bulkKg)} kg — hire as needed.`));
    } else loads.push(makeLoad([e.stop], side));
  });

  // ── Helpers over loads.
  const allowedTypes = (l: { kg: number; stops: StopRec[]; areas: AreaFacts[] }, exclude: ReadonlySet<VehicleType>): VehicleType[] =>
    VEHICLE_TYPES.filter((t) => {
      if (exclude.has(t)) return false;
      const v = V[t];
      if (l.kg > v.maxKg + v.overKg || l.stops.length > v.maxStops) return false;
      if (v.nearOnly && !l.areas.every((a) => a.gcAllowed)) return false;
      return true;
    });
  const cheapest = (l: Load, types: VehicleType[]): { t: VehicleType; cost: number } | null => {
    let best: { t: VehicleType; cost: number } | null = null;
    types.forEach((t) => {
      const c = tripCostOf(l.areas, t);
      if (!best || c < best.cost || (c === best.cost && V[t].priority < V[best.t].priority)) best = { t, cost: c };
    });
    return best;
  };
  const joinable = (a: Load, b: Load): boolean => {
    if (a.side !== b.side) return false;
    const ids = new Set<number>();
    a.areas.forEach((x) => ids.add(x.id));
    b.areas.forEach((x) => ids.add(x.id));
    if (ids.size > cfg.maxPlacesPerTruck) return false;
    return a.areas.every((x) => b.areas.every((y) => areas.pairOk(x, y)));
  };
  const minAreaId = (l: Load) => l.areas.reduce((m, a) => Math.min(m, a.id), Infinity);
  /** Deterministic tie-break between two candidate joins. */
  const tieKey = (a: Load, b: Load) => {
    const m = Math.min(minAreaId(a), minAreaId(b));
    const [x, y] = a.key < b.key ? [a.key, b.key] : [b.key, a.key];
    return { m, s: `${x}#${y}` };
  };

  /**
   * 5. THE SAVINGS METHOD. Repeatedly join the pair (same side, allowed) with
   * the largest saving until none saves anything. `costOf` prices a load as it
   * stands; `unionCost` prices a candidate union (null = not carriable).
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
          if (
            !best ||
            saving > best.saving ||
            (saving === best.saving && (tk.m < best.tk.m || (tk.m === best.tk.m && tk.s < best.tk.s)))
          ) {
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

  // ── 8. Hold — alone on its side, light, not overdue: not a truck today.
  if (cfg.holdSmallUnlessOverdue) {
    const perSide = new Map<string, Load[]>();
    loads.forEach((l) => perSide.set(l.side, [...(perSide.get(l.side) ?? []), l]));
    Array.from(perSide.values()).forEach((ls) => {
      if (ls.length !== 1) return;
      const l = ls[0];
      if (l.kg < cfg.holdBelowKg && !l.overdue) {
        cards.push(toCard(l, "hold", `Under ${fmtKg(cfg.holdBelowKg)} kg and alone on its side — hold for tomorrow.`));
        loads = loads.filter((x) => x !== l);
      }
    });
  }

  // ── 6 + 7. Vehicles.
  const avail: Avail = {
    ace: counts.ace ?? V.ace.dailyCount ?? Infinity,
    big: counts.big ?? V.big.dailyCount ?? Infinity,
    gc: counts.gc ?? V.gc.dailyCount ?? Infinity,
  };
  const costAs = (l: Load, t: VehicleType) => tripCostOf(l.areas, t);
  const fits = (l: Load, t: VehicleType) => allowedTypes(l, NONE).includes(t);
  // Overdue first, then the oldest — the rule-7 priority — then a stable key.
  const urgency = (a: Load, b: Load) => Number(b.overdue) - Number(a.overdue) || b.maxAge - a.maxAge;

  const assignAll = (pool: Load[], aceAllowed: boolean): { done: Load[]; left: Load[] } => {
    let left = pool.slice();
    const done: Load[] = [];
    // a) Aces: 7–8-stop loads (only an Ace carries them) first, then where an
    //    Ace saves most against a Big.
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
    // b) GCs: small, near loads where a GC is cheaper than a Big.
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
    // c) Bigs: everything else a Big can carry.
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

  let { done: assigned, left: unassigned } = assignAll(loads, true);

  // d) 7–8-stop loads with no Ace left: re-plan just their stops without Aces.
  const aceOnlyLeft = unassigned.filter((l) => l.stops.length > V.big.maxStops);
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
        const t = cheapest(l, allowedTypes(l, NONE))?.t ?? "big";
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

  /** Words for a truck: which routes joined, and anything unusual about it. */
  function truckReason(l: Load): string {
    const byRoute = new Map<string, number>();
    l.stops.forEach((s) => {
      const k = String(s.area.routeId);
      byRoute.set(k, (byRoute.get(k) ?? 0) + s.kg);
    });
    const routes = Array.from(byRoute.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const main = routeName(routes[0][0] === "null" ? null : Number(routes[0][0]));
    const others = routes.slice(1).map(([k]) => routeName(k === "null" ? null : Number(k)));
    const parts: string[] = [];
    if (others.length > 0) parts.push(`${others.join(", ")} joined ${main} — saves ${others.length === 1 ? "a truck" : `${others.length} trucks`}.`);
    else if (l.areas.length > 1) parts.push(`${l.areas.length} places on ${main}.`);
    else parts.push(`${l.areas[0].name} on its own.`);
    if (l.vehicle === "ace" && l.stops.length > V.big.maxStops) parts.push(`${l.stops.length} stops — only an Ace carries that many.`);
    if (l.replanned) parts.push(`Re-planned without an Ace (max ${V.big.maxStops} stops).`);
    if (l.merged) parts.push(`Two loads going the same way merged.`);
    return parts.join(" ");
  }

  function toCard(l: Load, type: V2CardType, reason: string): V2Card {
    // 9. Far first: the highest Big rate first, back toward Surat.
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
        stopKey: s.key,
        areaId: s.area.id >= 0 ? s.area.id : null,
        areaName: s.area.name,
        kg: s.kg,
        orderIds: s.orderIds.slice().sort((a, b) => a - b),
      })),
      kg: l.kg,
      stopCount: l.stops.length,
      areaNames: names,
      flags: {
        overIdealStops: vt !== null && l.stops.length > V[vt].idealStops,
        newArea: l.areas.some((a) => a.typical || !a.hasPairs),
      },
      reason,
    };
  }
}

const VEHICLE_LABEL: Record<VehicleType, string> = { ace: "Ace", big: "Big", gc: "GC" };
const fmtKg = (kg: number) => Math.round(kg).toLocaleString("en-US");
