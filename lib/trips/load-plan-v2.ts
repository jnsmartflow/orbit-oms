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
//   2b. Direct Big — a Big with 1 or 2 stops may carry up to directBigMaxKg;
//                  with 3+ stops it keeps its hard limit. OFF in the locked
//                  defaults (directBigMaxKg = the Big hard limit).
//   2c. Light milk run — optional (aceLightRun): an Ace may carry more than
//                  its maxStops, up to aceLightRun.maxStops, ONLY when the load
//                  weighs ≤ aceLightRun.maxKg. Such a card carries flags.lightRun
//                  (the screen shows it amber). Off unless configured.
//   2d. Soft service costs — optional: stopChargeRs per stop above a
//                  vehicle's idealStops and weightChargeRsPer100Kg per 100 kg
//                  above its rated maxKg, added to the PLANNING cost only (never
//                  output). The hard limits are hardMaxKg (else maxKg + overKg)
//                  and maxStops. A card over its ideal stops or its rated load
//                  (maxKg) is flagged amber — a bend of up to overKg is allowed
//                  but always shown.
//   3. Bulk      — a stop (dealer) heavier than bulkKg is a BULK dealer: its
//                  bills are split BY BILL into Bulk cards of at most bulkKg
//                  (a single bill over bulkKg is a Bulk card on its own) while
//                  more than bulkKg is left; the leftover bills plan like any
//                  other stop. Each Bulk card is one Big (replan: the smallest
//                  vehicle on hand that carries it). A bill no vehicle can carry
//                  is a Bulk card with no vehicle — hire.
//   4. Every other stop starts as its own load.
//   5. Combine   — the savings method: join the pair of loads on the SAME side
//                  that saves most (cost A + cost B − cost A∪B + truckPenaltyRs)
//                  while the join is allowed; stop when nothing saves. Allowed:
//                  a vehicle carries it, ≤ maxPlacesPerTruck places, and every
//                  pair of places allowed (same route always; else seen together
//                  ≥ pairMinTimes).
//   5b. Ride-along — a load under rideAlongBelowKg may join a load on its
//                  side with a looser pair rule (seen together ≥
//                  rideAlongPairMinTimes, or same route) and no places limit
//                  (kg and stop limits still apply). If it can join nothing and has no
//                  overdue bill → Hold ("Hold for tomorrow").
//   5c. Amber    — a load goes over a vehicle's ideal kg or stops only when
//                  stops JOINED (so it saved a truck), never over the hard max:
//                  a single stop never rides over a vehicle's ideal kg.
//   6. Vehicles  — Aces first (loads only an Ace carries, then where an Ace
//                  saves most vs a Big), then Bigs for the heavy loads, then
//                  GCs. With Bigs unlimited (suggest mode) a load a GC carries
//                  for less is left for the GCs first and goes on a Big only
//                  when the GCs run out — the same plan as Big-before-GC with
//                  those loads held back. A load too long for any vehicle but
//                  an Ace, with no Ace left, is re-planned without Aces; then
//                  one more combine on the assigned vehicles' costs.
//   7. Limits    — loads left without a vehicle become ONE Waiting card per
//                  side; overdue loads get vehicles first, then the oldest.
//   8. Order     — stops far first (highest Big rate), back toward Surat.
//   9. Output    — cards + a summary, no rupees; reasons name the PLACES.
//                  `shortage` ("Short 800 kg — add 1 Ace") when anything waits:
//                  kg and vehicle TYPES only, never a cost.
//  10. Replan    — optional (owner, 2026-09-21). With `available` the engine
//                  plans with THOSE vehicles only, never more: a vehicle with
//                  maxKg is hard-capped there (no bend, no direct-Big stretch);
//                  one without may bend overKg above its rated load (amber).
//                  Fill order Ace → Big → GC (GC only where every place is
//                  gcAllowed, within its maxStops); two trucks going the same
//                  way share one vehicle when that saves. Stops that still have
//                  no vehicle are placed one by one (overdue, heaviest, oldest
//                  first); an overdue stop may push the smallest, newest
//                  non-overdue stops of a truck out. What is left waits.
//                  `unused` lists the vehicles not needed ("1 GC not needed").
//                  Without `available` it is SUGGEST mode, exactly as before.
//      Pinned    — `pinned` card keys keep their stops and vehicle out of any
//                  planning (either mode); the vehicle counts against
//                  `available` (or the day's counts).
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
  /** A ride-along stop (under rideAlongBelowKg) needs only this many times together (or the same route). */
  rideAlongPairMinTimes: number;
  /** Two places on the same route may always share a truck. */
  sameRoutePairsAlways: boolean;
  /** A load lighter than this may ride along with any load on its side. */
  rideAlongBelowKg: number;
  /** A Big with 1 or 2 stops may carry up to this; 3+ stops keep maxKg + overKg. */
  directBigMaxKg: number;
  /** One bill above a Big's hard max but ≤ this goes on a Big alone ("Big (heavy)"); above it → hire. */
  heavyBigMaxKg: number;
  /** Light milk run: an Ace may exceed its maxStops up to `maxStops` when the load is ≤ `maxKg`. null = off. */
  aceLightRun: { maxStops: number; maxKg: number } | null;
  /** INTERNAL soft cost per stop above a vehicle's idealStops (planning only, never output). Default 0. */
  stopChargeRs: number;
  /** INTERNAL soft cost per 100 kg above a vehicle's rated maxKg (planning only, never output). Default 0. */
  weightChargeRsPer100Kg: number;
  /** A stop heavier than this is a bulk dealer (rule 3), split by bill into Bulk cards of at most this. */
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
  rideAlongPairMinTimes: 1,
  sameRoutePairsAlways: true,
  maxPlacesPerTruck: 6,
  rideAlongBelowKg: 300,
  directBigMaxKg: 3500,
  heavyBigMaxKg: 4500,
} as const;

/**
 * THE LOCKED UPCOUNTRY DEFAULTS (owner, 2026-09-21). `lockV2Config` lays them
 * over the stored row, so the row cannot drift them. The row still supplies
 * routeSides, newArea, truckPenaltyRs, holdSmallUnlessOverdue and each
 * vehicle's nearOnly and priority.
 *
 *   Weight  ideal (maxKg) → hard max (hardMaxKg); above the ideal is amber:
 *           Ace 2,000 → 2,300 · Big 3,000 → 3,500 · GC 1,500 → 1,650.
 *           overKg = hard − ideal, so "overloaded" means over the hard max.
 *   Stops   Ace ideal 6, max 8 · Big ideal 6, max 7 · GC 4 (hard). Light
 *           milk run: an Ace may do up to 10 stops when the load is
 *           ≤ 1,500 kg (a load is always one side).
 *   Per day Ace 2 · GC 3 · Big as needed.
 *   Soft    a charge per stop above the ideal and per 100 kg above the ideal
 *           (planning only, never output); direct Big off.
 *   Pairs   seen together ≥ 3 times or same route · ≤ 6 places · ride-along
 *           under 300 kg needs ≥ 1 time or same route · bulk dealer over 3,000 kg · one bill 3,500–4,500
 *           kg → "Big (heavy)", over 4,500 kg → hire.
 */
export const V2_LOCKED = {
  vehicles: {
    ace: { maxKg: 2000, hardMaxKg: 2300, overKg: 300, idealStops: 6, maxStops: 8, dailyCount: 2 },
    big: { maxKg: 3000, hardMaxKg: 3500, overKg: 500, idealStops: 6, maxStops: 7, dailyCount: null },
    gc: { maxKg: 1500, hardMaxKg: 1650, overKg: 150, idealStops: 4, maxStops: 4, dailyCount: 3 },
  },
  stopChargeRs: 300,
  weightChargeRsPer100Kg: 250,
  /** = the Big hard max → direct Big off. */
  directBigMaxKg: 3500,
  pairMinTimes: 3,
  rideAlongPairMinTimes: 1,
  sameRoutePairsAlways: true,
  maxPlacesPerTruck: 6,
  rideAlongBelowKg: 300,
  bulkKg: 3000,
  heavyBigMaxKg: 4500,
  aceLightRun: { maxStops: 10, maxKg: 1500 },
} as const;

/** The stored config with the locked defaults laid over it (see V2_LOCKED). */
export function lockV2Config(cfg: LoadPlanV2Config): LoadPlanV2Config {
  const L = V2_LOCKED;
  const vehicles = {} as Record<VehicleType, VehicleSpec>;
  VEHICLE_TYPES.forEach((t) => {
    vehicles[t] = { ...cfg.vehicles[t], ...L.vehicles[t] };
  });
  return {
    ...cfg,
    vehicles,
    stopChargeRs: L.stopChargeRs,
    weightChargeRsPer100Kg: L.weightChargeRsPer100Kg,
    directBigMaxKg: L.directBigMaxKg,
    pairMinTimes: L.pairMinTimes,
    rideAlongPairMinTimes: L.rideAlongPairMinTimes,
    sameRoutePairsAlways: L.sameRoutePairsAlways,
    maxPlacesPerTruck: L.maxPlacesPerTruck,
    rideAlongBelowKg: L.rideAlongBelowKg,
    bulkKg: L.bulkKg,
    heavyBigMaxKg: L.heavyBigMaxKg,
    aceLightRun: { ...L.aceLightRun },
  };
}

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
  const rideAlongPairMinTimes = posOr("rideAlongPairMinTimes", V2_DEFAULTS.rideAlongPairMinTimes);
  if (rideAlongPairMinTimes === null) return null;
  const maxPlacesPerTruck = posOr("maxPlacesPerTruck", V2_DEFAULTS.maxPlacesPerTruck);
  const rideAlongBelowKg = posOr("rideAlongBelowKg", V2_DEFAULTS.rideAlongBelowKg);
  const sameRoutePairsAlways = boolOr("sameRoutePairsAlways", V2_DEFAULTS.sameRoutePairsAlways);
  const directBigMaxKg = posOr("directBigMaxKg", V2_DEFAULTS.directBigMaxKg);
  const heavyBigMaxKg = posOr("heavyBigMaxKg", V2_DEFAULTS.heavyBigMaxKg);
  if (heavyBigMaxKg === null) return null;
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
    routeSides, vehicles, maxPlacesPerTruck, pairMinTimes, rideAlongPairMinTimes, sameRoutePairsAlways, rideAlongBelowKg, directBigMaxKg, heavyBigMaxKg, aceLightRun,
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

/** One line of the vehicles on hand for a REPLAN. */
export interface AvailableVehicle {
  type: VehicleType;
  count: number;
  /** Hard cap for these vehicles (no bend). Absent → maxKg + overKg (a bend, amber). */
  maxKg?: number;
}

export interface PlanOptions {
  /** Present → REPLAN with exactly these vehicles. Absent → suggest mode. */
  available?: AvailableVehicle[];
  /** Card keys (V2Card.key) to keep exactly as they are. Truck cards only. */
  pinned?: string[];
  /** Stop ids (V2Stop.id) the planner moved to Waiting — they stay there. */
  waiting?: string[];
}

export type V2CardType = VehicleType | "bulk" | "direct" | "hold" | "waiting";
export type BulkKind = "split" | "single" | "heavy" | "hire";

export interface V2Stop {
  /** The engine's own stop id (a card key is "<type>:" + its stop ids, sorted, joined by "|"). */
  id: string;
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
  /** The vehicle: a truck card's own type; a Bulk card's vehicle (absent = hire). */
  vehicle?: VehicleType;
  /** Bulk cards: split (a bulk dealer's part) · single (one bill) · heavy ("Big (heavy)") · hire. */
  bulkKind?: BulkKind;
  /** Replan: the driver's max kg for this vehicle, when one was entered. */
  driverMaxKg?: number;
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
    /** Heavier than the vehicle's limit: maxKg + overKg, or a replan vehicle's own maxKg. */
    overloaded: boolean;
    /** Kept as it was (PlanOptions.pinned). */
    pinned: boolean;
    /** Over the vehicle's HARD limit (kg or stops) — only a planner's pin or move does that. Show red. */
    overHard: boolean;
    /** Show amber: over the ideal stops, over the rated load (a bend), or a light milk run. */
    amber: boolean;
  };
  /** Words only — never a rupee figure. */
  reason: string;
  /** Waiting cards: the vehicles that would carry these loads. */
  needs?: Partial<Record<VehicleType, number>>;
}

/** Kilos left waiting and the cheapest vehicle types that would carry them — no cost. */
export interface V2Shortage {
  kg: number;
  add: Partial<Record<VehicleType, number>>;
  /** "Short 800 kg — add 1 Ace". */
  text: string;
}

/** Replan vehicles no load needed. */
export interface V2Unused {
  type: VehicleType;
  count: number;
  maxKg?: number;
  /** "1 GC not needed". */
  text: string;
}

export interface V2Plan {
  mode: "suggest" | "replan";
  cards: V2Card[];
  /** null when nothing waits. */
  shortage: V2Shortage | null;
  /** Replan only; [] in suggest mode. */
  unused: V2Unused[];
  summary: {
    /** Suggested trucks by type (Bulk cards are counted in `bulk`, not here). */
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
      // Every Surat-side place is near: GC allowed by side (owner, 2026-09-21).
      gcAllowed:
        (routeId !== null && this.ctx.config.routeSides[routeId] === "Surat") ||
        (row ? row.gcAllowed : this.ctx.config.newArea.gcAllowed),
      typical,
      hasPairs: this.withPairs.has(id),
    };
    this.cache.set(id, facts);
    return facts;
  }

  /** May these two places share a truck? `minTimes`: pairMinTimes, or rideAlongPairMinTimes for a rider. */
  pairOk(a: AreaFacts, b: AreaFacts, minTimes: number = this.ctx.config.pairMinTimes): boolean {
    if (a.id === b.id) return true;
    const sameRoute = a.routeId !== null && a.routeId === b.routeId;
    // Same route: always together (owner, 2026-09-21) — which also covers
    // newArea.pairs = "same_route" for a place with no pair history.
    if (sameRoute && (this.ctx.config.sameRoutePairsAlways || !a.hasPairs || !b.hasPairs)) return true;
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    return (this.ctx.pairs.get(key) ?? 0) >= minTimes;
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
  /** A Bulk load split off a bulk dealer (rule 3): the stop's area, its total kg, one bill or several. */
  split?: { area: string; stopKg: number; kind: BulkKind };
  /** Moved to Waiting by the planner (PlanOptions.waiting). */
  forced?: boolean;
  /** Replan: the one vehicle carrying it. */
  unit?: Unit;
  pinned?: boolean;
}

/** Replan: one vehicle on hand. `cap` = its maxKg, else maxKg + overKg. */
interface Unit {
  idx: number;
  type: VehicleType;
  maxKg?: number;
  cap: number;
  load?: Load;
}

const FILL_ORDER: readonly VehicleType[] = ["ace", "big", "gc"];

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

export function planLoadsV2(bills: V2Bill[], ctx: LoadPlanV2Context, counts: VehicleCounts = {}, opts: PlanOptions = {}): V2Plan {
  const cfg = ctx.config;
  const V = cfg.vehicles;
  const replan = opts.available !== undefined;
  // Replan: every vehicle on hand is one unit.
  const units: Unit[] = [];
  (opts.available ?? []).forEach((a) => {
    if (!VEHICLE_TYPES.includes(a.type)) return;
    const hasMax = typeof a.maxKg === "number" && a.maxKg > 0;
    for (let i = 0; i < Math.max(0, Math.floor(a.count)); i++) {
      units.push({
        idx: units.length,
        type: a.type,
        ...(hasMax ? { maxKg: a.maxKg } : {}),
        cap: hasMax ? (a.maxKg as number) : V[a.type].hardMaxKg ?? V[a.type].maxKg + V[a.type].overKg,
      });
    }
  });
  /** A single bill heavier than this has no vehicle: a Big's limit, or (replan) the largest vehicle on hand. */
  const hireCap = replan && units.length > 0 ? Math.max(...units.map((u) => u.cap)) : kgCap(cfg, "big", 1);
  /** A stop heavier than this is a bulk dealer (rule 3). */
  const bulkCap = Math.min(cfg.bulkKg, hireCap);
  /** A Big's hard max: one bill above it is "Big (heavy)" (up to heavyBigMaxKg). */
  const bigHard = kgCap(cfg, "big", 1);
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
  let planned: Array<{ stop: StopRec; side: string }> = [];
  const bulkLoads: Load[] = [];
  rawStops.forEach((s) => {
    const side = sideOf(s.routeId);
    if (side === "Direct") {
      const k = String(s.routeId);
      directByRoute.set(k, [...(directByRoute.get(k) ?? []), toStop(s, s.bills)]);
      return;
    }
    const total = s.bills.reduce((n, b) => n + b.kg, 0);
    if (total <= bulkCap) {
      planned.push({ stop: toStop(s, s.bills), side });
      return;
    }
    // ── 3. A BULK dealer: a bill no vehicle can carry → Bulk, hire; the rest is
    //    split BY BILL into Bulk loads of at most bulkKg (a bill over bulkKg
    //    alone) while more than bulkKg is left; the leftover bills plan like
    //    any other stop.
    let rest = s.bills.slice().sort((a, b) => b.kg - a.kg || a.id - b.id);
    // One bill over heavyBigMaxKg → hire; over a Big's hard max (and ≤ heavyBigMaxKg) → a Big alone.
    rest.filter((b) => b.kg > cfg.heavyBigMaxKg).forEach((b) => {
      const load = makeLoad([toStop(s, [b], `#bill${b.id}`)], side);
      load.split = { area: load.areas[0].name, stopKg: total, kind: "hire" };
      cards.push(toCard(load, "bulk", bulkReason(load)));
    });
    rest.filter((b) => b.kg > bigHard && b.kg <= cfg.heavyBigMaxKg).forEach((b) => {
      const load = makeLoad([toStop(s, [b], `#bill${b.id}`)], side);
      load.split = { area: load.areas[0].name, stopKg: total, kind: "heavy" };
      bulkLoads.push(load);
    });
    rest = rest.filter((b) => b.kg <= bigHard);
    let part = 0;
    while (rest.reduce((n, b) => n + b.kg, 0) > bulkCap) {
      let take: typeof rest = [];
      let keep: typeof rest = [];
      if (rest[0].kg > bulkCap) {
        take = [rest[0]];
        keep = rest.slice(1);
      } else {
        let kg = 0;
        rest.forEach((b) => {
          if (kg + b.kg <= bulkCap) {
            take.push(b);
            kg += b.kg;
          } else keep.push(b);
        });
      }
      const load = makeLoad([toStop(s, take, `#part${++part}`)], side);
      load.split = { area: load.areas[0].name, stopKg: total, kind: take.length === 1 && take[0].kg > bulkCap ? "single" : "split" };
      bulkLoads.push(load);
      rest = keep;
    }
    if (rest.length > 0) planned.push({ stop: toStop(s, rest), side });
  });
  Array.from(directByRoute.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([rk, stops]) => {
      cards.push(toCard(makeLoad(stops, "Direct"), "direct", `${routeName(Number(rk))} is a direct route — never mixed.`));
    });

  // ── Pinned: a card key is "<type>:<stop key>|<stop key>…". Its stops come
  //    out of the pool as they are and keep their vehicle.
  const pinnedLoads: Load[] = [];
  (opts.pinned ?? []).slice().sort().forEach((id) => {
    const i = id.indexOf(":");
    const t = id.slice(0, i) as VehicleType;
    if (i < 0 || !VEHICLE_TYPES.includes(t)) return;
    const keys = new Set(id.slice(i + 1).split("|"));
    const got: Array<{ stop: StopRec; side: string }> = [];
    planned = planned.filter((x) => {
      if (!keys.has(x.stop.key)) return true;
      got.push(x);
      return false;
    });
    if (got.length === 0) return;
    const l = makeLoad(got.map((x) => x.stop), got[0].side);
    l.vehicle = t;
    l.pinned = true;
    if (replan) {
      // The vehicle it keeps: the smallest of its type that carries it, else the largest.
      let u: Unit | null = null;
      for (const x of units) {
        if (x.load || x.type !== t) continue;
        const fitsX = l.kg <= x.cap;
        const fitsU = u !== null && l.kg <= u.cap;
        if (!u || (fitsX && !fitsU) || (fitsX === fitsU && (fitsX ? x.cap < u.cap : x.cap > u.cap))) u = x;
      }
      if (u) {
        u.load = l;
        l.unit = u;
      }
    } else avail[t] = Math.max(0, avail[t] - 1);
    pinnedLoads.push(l);
  });
  // ── Moved to Waiting by the planner: out of planning, straight to Waiting.
  const waitIds = new Set(opts.waiting ?? []);
  const forcedWait: Load[] = [];
  planned = planned.filter((x) => {
    if (!waitIds.has(x.stop.key)) return true;
    const l = makeLoad([x.stop], x.side);
    l.forced = true;
    forcedWait.push(l);
    return false;
  });
  /** Replan: the largest free vehicle of each type (−∞ = none on hand). */
  const typeCap = {} as Record<VehicleType, number>;
  VEHICLE_TYPES.forEach((t) => {
    typeCap[t] = units.filter((u) => u.type === t && !u.load).reduce((m, u) => Math.max(m, u.cap), -Infinity);
  });

  // ── 4. Every other stop is its own load.
  let loads: Load[] = planned.map((p) => makeLoad([p.stop], p.side));

  // ── Helpers over loads.
  /** "plan" = this run's vehicles (replan: the ones on hand); "suggest" = the normal limits, what an ADDED vehicle carries. */
  const allowedTypes = (l: { kg: number; stops: StopRec[]; areas: AreaFacts[] }, exclude: ReadonlySet<VehicleType>, caps: "plan" | "suggest" = "plan"): VehicleType[] =>
    VEHICLE_TYPES.filter((t) => {
      if (exclude.has(t)) return false;
      const v = V[t];
      const cap = replan && caps === "plan" ? typeCap[t] : kgCap(cfg, t, l.stops.length);
      if (l.kg > cap || !stopsAllowed(cfg, t, l.stops.length, l.kg)) return false;
      // Near-only applies to EVERY place, riders included.
      if (v.nearOnly && !l.areas.every((a) => a.gcAllowed)) return false;
      // Rule h: a bend over the ideal kg only when stops JOINED (it saves a
      // truck) — one stop alone never rides over a vehicle's ideal.
      if (l.stops.length === 1 && l.kg > v.maxKg) return false;
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
  const planCost = (exclude: ReadonlySet<VehicleType>, caps: "plan" | "suggest" = "plan") => (l: Load) =>
    cheapest(l, allowedTypes(l, exclude, caps))?.cost ?? Infinity;
  const planUnion = (exclude: ReadonlySet<VehicleType>, caps: "plan" | "suggest" = "plan") => (_a: Load, _b: Load, u: Load) =>
    cheapest(u, allowedTypes(u, exclude, caps))?.cost ?? null;

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
  /** A rider's places vs the host's core places: seen together ≥ rideAlongPairMinTimes, or same route. */
  const ridePairOk = (riders: StopRec[], host: Load) =>
    riders.every((r) => host.coreAreas.every((c) => areas.pairOk(r.area, c, cfg.rideAlongPairMinTimes)));
  /** The load on `part`'s side where `part` rides along for the least added cost (kg and stop limits apply). */
  const rideHost = (part: Load): { host: Load; u: Load } | null => {
    let best: { host: Load; u: Load; add: number } | null = null;
    for (const host of loads) {
      if (host === part || host.side !== part.side || !ridePairOk(part.stops, host)) continue;
      const riders = part.stops.map((s) => ({ ...s, rider: true }));
      const u = makeLoad(host.stops.concat(riders), host.side);
      const uc = cheapest(u, allowedTypes(u, NONE));
      if (!uc) continue;
      const add = uc.cost - (cheapest(host, allowedTypes(host, NONE))?.cost ?? Infinity);
      if (!best || add < best.add || (add === best.add && host.key < best.host.key)) best = { host, u, add };
    }
    return best;
  };
  const holdReason = `Under ${fmtKg(cfg.rideAlongBelowKg)} kg and no truck on its side has room for it — hold for tomorrow.`;
  light.forEach((small) => {
    if (!loads.includes(small)) return; // already absorbed as a host's partner
    const whole = rideHost(small);
    if (whole) {
      loads = loads.filter((x) => x !== small && x !== whole.host).concat([whole.u]);
      return;
    }
    // Place by place: each place rides along on its own where it fits; what is
    // left is one Hold card PER PLACE (overdue stays in the plan).
    loads = loads.filter((x) => x !== small);
    const byPlace = new Map<number, StopRec[]>();
    small.stops.forEach((st) => byPlace.set(st.area.id, [...(byPlace.get(st.area.id) ?? []), { ...st, rider: false }]));
    const places = Array.from(byPlace.entries()).sort((a, b) => a[0] - b[0]).map(([, ss]) => ss);
    const keep: StopRec[] = [];
    places.forEach((ss) => {
      const part = makeLoad(ss, small.side);
      const host = places.length > 1 ? rideHost(part) : null;
      if (host) loads = loads.filter((x) => x !== host.host).concat([host.u]);
      else if (cfg.holdSmallUnlessOverdue && !part.overdue) cards.push(toCard(part, "hold", holdReason));
      else keep.push(...ss);
    });
    if (keep.length > 0) loads.push(makeLoad(keep, small.side));
  });

  // ── 6 + 7. Vehicles.
  let assigned: Load[] = [];
  let unassigned: Load[] = [];
  const costAs = (l: Load, t: VehicleType) => tripCostOf(l.areas, t) + softCost(cfg, t, l.stops.length, l.kg);
  const fits = (l: Load, t: VehicleType) => allowedTypes(l, NONE).includes(t);
  // Overdue first, then the oldest — the rule-7 priority.
  const urgency = (a: Load, b: Load) => Number(b.overdue) - Number(a.overdue) || b.maxAge - a.maxAge;
  const onlyAce = (l: Load) => l.stops.length > V.big.maxStops;
  const aceGain = (l: Load) => (fits(l, "big") ? costAs(l, "big") : Infinity) - costAs(l, "ace");

  let bulkDone: Load[] = [];
  if (replan) {
    const r = replanVehicles(loads, bulkLoads);
    assigned = r.assigned;
    unassigned = r.waiting;
    bulkDone = r.bulk;
  } else {
  // Bulk loads: OVERDUE ones take their Bigs first; the rest go last (below),
  // so when Bigs are short the trucks get them before a bulk dealer does.
  const bulkBig = (l: Load) => {
    if (avail.big > 0) {
      l.vehicle = "big";
      avail.big -= 1;
      bulkDone.push(l);
    } else unassigned.push(l);
  };
  const bulkSorted = bulkLoads.slice().sort((a, b) => urgency(a, b) || (a.key < b.key ? -1 : 1));
  bulkSorted.filter((l) => l.overdue).forEach(bulkBig);

  const assignAll = (pool: Load[], aceAllowed: boolean): { done: Load[]; left: Load[] } => {
    let left = pool.slice();
    const done: Load[] = [];
    if (aceAllowed) {
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
  bulkSorted.filter((l) => !l.overdue).forEach(bulkBig);
  }
  unassigned = unassigned.concat(forcedWait);

  pinnedLoads.forEach((l) => cards.push(toCard(l, l.vehicle!, `Pinned — kept as it is. ${truckReason(l)}`.trim())));
  assigned.forEach((l) => cards.push(toCard(l, l.vehicle!, truckReason(l))));
  bulkDone.forEach((l) => cards.push(toCard(l, "bulk", bulkReason(l))));

  // 7. Waiting — one card per side for the loads no vehicle is left for.
  //    `needs` names the cheapest vehicle for each load, but never more Aces
  //    than the day allows (dailyCount minus the Aces already in play) — past
  //    that, a Big. Stops the PLANNER moved here count toward no shortage.
  const acesInPlay = replan ? units.filter((u) => u.type === "ace").length : counts.ace ?? V.ace.dailyCount ?? Infinity;
  const aceDaily = V.ace.dailyCount ?? Infinity;
  let aceRoom = aceDaily === Infinity ? Infinity : Math.max(0, aceDaily - acesInPlay);
  const shortAdd: Partial<Record<VehicleType, number>> = {};
  let shortKg = 0;
  const waitBySide = new Map<string, Load[]>();
  unassigned.forEach((l) => waitBySide.set(l.side, [...(waitBySide.get(l.side) ?? []), l]));
  Array.from(waitBySide.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .forEach(([side, ls]) => {
      const needs: Partial<Record<VehicleType, number>> = {};
      ls.filter((l) => !l.forced).forEach((l) => {
        let t: VehicleType = l.split ? "big" : cheapest(l, allowedTypes(l, NONE, "suggest"))?.t ?? "big";
        if (t === "ace") {
          if (aceRoom > 0) aceRoom -= 1;
          else t = "big";
        }
        needs[t] = (needs[t] ?? 0) + 1;
        shortAdd[t] = (shortAdd[t] ?? 0) + 1;
        shortKg += l.kg;
      });
      const words = VEHICLE_TYPES.filter((t) => needs[t])
        .map((t) => `${needs[t]} more ${VEHICLE_LABEL[t]}`)
        .join(" and ");
      const moved = ls.some((l) => l.forced);
      const reason = words
        ? `No vehicle left — needs ${words}.${moved ? " Also holds stops the planner moved here." : ""}`
        : "Moved to Waiting by the planner.";
      const card = toCard(makeLoad(ls.flatMap((l) => l.stops), side), "waiting", reason);
      card.needs = needs;
      cards.push(card);
    });

  // ── Output order: trucks by kg (heaviest first), then bulk, direct,
  //    waiting, hold; the key breaks ties.
  const RANK: Record<V2CardType, number> = { ace: 0, big: 0, gc: 0, bulk: 1, direct: 2, waiting: 3, hold: 4 };
  cards.sort((a, b) => RANK[a.type] - RANK[b.type] || b.kg - a.kg || (a.key < b.key ? -1 : 1));

  const count = (t: V2CardType) => cards.filter((c) => c.type === t).length;

  // Shortage: the kilos waiting (not the planner's own moves) and the vehicle types that carry them.
  const shortage: V2Shortage | null =
    shortKg > 0 ? { kg: shortKg, add: shortAdd, text: `Short ${fmtKg(shortKg)} kg — add ${vehicleWords(shortAdd)}` } : null;
  // Unused: replan vehicles no load needed, grouped by type and cap.
  const unusedMap = new Map<string, V2Unused>();
  units.filter((u) => !u.load).forEach((u) => {
    const k = `${VEHICLE_TYPES.indexOf(u.type)}|${u.maxKg ?? 0}`;
    const e = unusedMap.get(k) ?? { type: u.type, count: 0, ...(u.maxKg !== undefined ? { maxKg: u.maxKg } : {}), text: "" };
    e.count += 1;
    unusedMap.set(k, e);
  });
  const unused = Array.from(unusedMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, e]) => ({
      ...e,
      text: `${vehicleWords({ [e.type]: e.count })}${e.maxKg !== undefined ? ` (${fmtKg(e.maxKg)} kg)` : ""} not needed`,
    }));

  return {
    mode: replan ? "replan" : "suggest",
    cards,
    shortage,
    unused,
    summary: {
      ace: count("ace"), big: count("big"), gc: count("gc"),
      trucks: count("ace") + count("big") + count("gc"),
      bulk: count("bulk"), direct: count("direct"), hold: count("hold"), waiting: count("waiting"),
      totalKg: cards.reduce((n, c) => n + c.kg, 0),
    },
  };

  // ── Replan vehicles (hoisted) ─────────────────────────────────────────────

  /**
   * 10. REPLAN: put the loads on the vehicles on hand, never more. Ace → Big →
   * GC; a merge pass; then the stops still without a vehicle one by one;
   * what is left waits (re-combined on the normal limits, so `needs` and the
   * shortage name whole vehicles).
   */
  function replanVehicles(loadsIn: Load[], bulk: Load[]): { assigned: Load[]; waiting: Load[]; bulk: Load[] } {
    const pool = loadsIn.slice();
    /** Bulk loads are a dealer's own truck: exempt from rule h (one stop over the ideal). */
    const unitFits = (u: Unit, l: Load, bulkLoad = false) =>
      l.kg <= u.cap &&
      stopsAllowed(cfg, u.type, l.stops.length, l.kg) &&
      (!V[u.type].nearOnly || l.areas.every((a) => a.gcAllowed)) &&
      (bulkLoad || u.maxKg !== undefined || l.stops.length > 1 || l.kg <= V[u.type].maxKg);
    /** The smallest free vehicle of type `t` that carries `l`. */
    const bestUnit = (l: Load, t: VehicleType, bulkLoad = false): Unit | null => {
      let best: Unit | null = null;
      for (const u of units) {
        if (u.load || u.type !== t || !unitFits(u, l, bulkLoad)) continue;
        if (!best || u.cap < best.cap) best = u;
      }
      return best;
    };
    const put = (l: Load, u: Unit) => {
      l.vehicle = u.type;
      l.unit = u;
      u.load = l;
    };

    // Bulk loads: OVERDUE ones get a vehicle first; the rest LAST, after every
    // truck (step e below). The smallest Big that carries each, else the
    // smallest other vehicle; a heavy bill needs a Big whose driver max (if
    // any) carries it.
    const bulkUnit = (l: Load): Unit | null => {
      if (l.split?.kind === "heavy") {
        let best: Unit | null = null;
        for (const u of units) {
          if (u.load || u.type !== "big" || l.kg > (u.maxKg ?? cfg.heavyBigMaxKg)) continue;
          if (!best || u.cap < best.cap) best = u;
        }
        return best;
      }
      return bestUnit(l, "big", true) ?? bestUnit(l, "ace", true) ?? bestUnit(l, "gc", true);
    };
    const bulkDone: Load[] = [];
    const bulkLeft: Load[] = [];
    const bulkSorted = bulk.slice().sort((a, b) => urgency(a, b) || b.kg - a.kg || (a.key < b.key ? -1 : 1));
    bulkSorted.filter((l) => l.overdue).forEach((l) => {
      const u = bulkUnit(l);
      if (u) {
        put(l, u);
        bulkDone.push(l);
      } else bulkLeft.push(l);
    });
    bulkLeft.push(...bulkSorted.filter((l) => !l.overdue));

    // a) Fill order Ace → Big → GC. Overdue first, then the oldest, then the heaviest.
    for (const t of FILL_ORDER) {
      const cands = pool
        .filter((l) => !l.vehicle && bestUnit(l, t) !== null)
        .sort(
          (a, b) =>
            urgency(a, b) ||
            (t === "ace" ? Number(onlyAce(b)) - Number(onlyAce(a)) || aceGain(b) - aceGain(a) : 0) ||
            b.kg - a.kg ||
            (a.key < b.key ? -1 : 1),
        );
      for (const l of cands) {
        const u = bestUnit(l, t);
        if (u) put(l, u);
      }
    }

    // b) Two trucks going the same way share one vehicle when that saves —
    //    the union takes the cheapest vehicle free once the two give theirs back.
    let trucks = combine(
      pool.filter((l) => l.vehicle),
      (l) => costAs(l, l.vehicle!),
      (a, b, u) => {
        let best: { x: Unit; c: number } | null = null;
        for (const x of units) {
          if ((x.load && x !== a.unit && x !== b.unit) || !unitFits(x, u)) continue;
          const c = costAs(u, x.type);
          if (!best || c < best.c || (c === best.c && (V[x.type].priority < V[best.x.type].priority || (x.type === best.x.type && x.cap < best.x.cap)))) {
            best = { x, c };
          }
        }
        if (!best) return null;
        u.vehicle = best.x.type;
        u.unit = best.x;
        return best.c;
      },
      (a, b, u) => {
        a.unit!.load = undefined;
        b.unit!.load = undefined;
        u.unit!.load = u;
        u.merged = true;
        if (a.split || b.split) u.split = a.split ?? b.split;
      },
    );

    // c) The stops still without a vehicle, most important first.
    const withStop = (host: Load, st: StopRec): Load | null => {
      if (joinable(host, makeLoad([st], host.side))) return makeLoad(host.stops.concat([st]), host.side);
      if (st.kg < cfg.rideAlongBelowKg && ridePairOk([st], host)) return makeLoad(host.stops.concat([{ ...st, rider: true }]), host.side);
      return null;
    };
    const swap = (old: Load, nu: Load) => {
      nu.vehicle = old.vehicle;
      nu.unit = old.unit;
      nu.merged = old.merged;
      nu.split = old.split;
      old.unit!.load = nu;
      trucks = trucks.map((x) => (x === old ? nu : x));
    };
    /** Into the truck (or free vehicle) where it adds least. */
    const place = (st: StopRec, side: string): boolean => {
      let best: { add: number; tk: string; nu: Load; host?: Load; unit?: Unit } | null = null;
      const consider = (add: number, tk: string, nu: Load, host?: Load, unit?: Unit) => {
        if (!best || add < best.add || (add === best.add && tk < best.tk)) best = { add, tk, nu, host, unit };
      };
      for (const host of trucks) {
        if (host.side !== side) continue;
        const nu = withStop(host, st);
        if (!nu || !unitFits(host.unit!, nu)) continue;
        consider(costAs(nu, host.vehicle!) - costAs(host, host.vehicle!), `0${host.key}`, nu, host);
      }
      for (const u of units) {
        const nu = makeLoad([st], side);
        if (u.load || !unitFits(u, nu)) continue;
        consider(costAs(nu, u.type) + cfg.truckPenaltyRs, `1${String(u.idx).padStart(4, "0")}`, nu, undefined, u);
      }
      if (!best) return false;
      const b: { nu: Load; host?: Load; unit?: Unit } = best;
      if (b.host) swap(b.host, b.nu);
      else {
        put(b.nu, b.unit!);
        trucks.push(b.nu);
      }
      return true;
    };
    /** An overdue stop pushes the smallest, newest non-overdue stops of one truck out. */
    const evictFor = (st: StopRec, side: string): StopRec[] | null => {
      let best: { host: Load; nu: Load; out: StopRec[]; outKg: number } | null = null;
      for (const host of trucks) {
        if (host.side !== side) continue;
        const movable = host.stops
          .filter((x) => !x.overdue)
          .sort((a, b) => a.kg - b.kg || a.maxAge - b.maxAge || (a.key < b.key ? -1 : 1));
        for (let k = 1; k <= movable.length; k++) {
          const out = movable.slice(0, k);
          const keep = host.stops.filter((x) => !out.includes(x));
          const nu = keep.length === 0 ? makeLoad([st], side) : withStop(makeLoad(keep, side), st);
          if (!nu || !unitFits(host.unit!, nu)) continue;
          const outKg = out.reduce((n, x) => n + x.kg, 0);
          if (!best || outKg < best.outKg || (outKg === best.outKg && host.key < best.host.key)) best = { host, nu, out, outKg };
          break;
        }
      }
      if (!best) return null;
      const b: { host: Load; nu: Load; out: StopRec[] } = best;
      swap(b.host, b.nu);
      return b.out;
    };

    const left = pool
      .filter((l) => !l.vehicle)
      .flatMap((l) => l.stops.map((st) => ({ st: { ...st, rider: false }, side: l.side })))
      .sort((a, b) => Number(b.st.overdue) - Number(a.st.overdue) || b.st.kg - a.st.kg || b.st.maxAge - a.st.maxAge || (a.st.key < b.st.key ? -1 : 1));
    const waitingStops: Array<{ st: StopRec; side: string }> = [];
    left.forEach(({ st, side }) => {
      if (place(st, side)) return;
      const out = st.overdue ? evictFor(st, side) : null;
      if (!out) {
        waitingStops.push({ st, side });
        return;
      }
      out.forEach((o) => {
        const free = { ...o, rider: false };
        if (!place(free, side)) waitingStops.push({ st: free, side });
      });
    });

    // e) The bulk loads left get what vehicles are left; none → they wait.
    bulkLeft.forEach((l) => {
      const u = bulkUnit(l);
      if (u) {
        put(l, u);
        bulkDone.push(l);
      } else l.stops.forEach((st) => waitingStops.push({ st, side: l.side }));
    });

    // d) What waits, re-combined on the NORMAL limits (what an added vehicle carries).
    const bySide = new Map<string, StopRec[]>();
    waitingStops.forEach(({ st, side }) => bySide.set(side, [...(bySide.get(side) ?? []), st]));
    const waiting = Array.from(bySide.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .flatMap(([side, ss]) => combine(ss.map((st) => makeLoad([st], side)), planCost(NONE, "suggest"), planUnion(NONE, "suggest")));
    return { assigned: trucks, waiting, bulk: bulkDone };
  }

  // ── Card building (hoisted) ───────────────────────────────────────────────

  /**
   * Words for a truck, naming PLACES (owner): "Jolva, Kadodara joined Bardoli
   * — saves a truck". The main place is the one carrying the most kg; the
   * saving is claimed only when places from ANOTHER route joined.
   */
  /** Words for a Bulk card. */
  function bulkReason(l: Load): string {
    const sp = l.split!;
    const on = l.unit ? ` On a ${VEHICLE_LABEL[l.unit.type]}.${l.unit.maxKg !== undefined ? ` Driver max ${fmtKg(l.unit.maxKg)} kg.` : ""}` : "";
    if (sp.kind === "hire") {
      return `Hire truck — about ${Math.max(2, Math.ceil(l.kg / V.big.maxKg))} Bigs of load (one bill of ${fmtKg(l.kg)} kg at ${sp.area}).`;
    }
    if (sp.kind === "heavy") return `Big (heavy) — one bill of ${fmtKg(l.kg)} kg at ${sp.area}.${on}`;
    return sp.kind === "single"
      ? `One bill of ${fmtKg(l.kg)} kg at ${sp.area} — a truck of its own.${on}`
      : `Bulk dealer: ${sp.area} has ${fmtKg(sp.stopKg)} kg — split by bill; this load is ${fmtKg(l.kg)} kg.${on}`;
  }

  function truckReason(l: Load): string {
    const parts: string[] = [];
    if (l.split) {
      parts.push(`Part of a ${fmtKg(l.split.stopKg)} kg bulk dealer at ${l.split.area}, split by bill.`);
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
    if (l.unit && l.unit.maxKg === undefined && l.kg > V[l.unit.type].maxKg) {
      parts.push(`${fmtKg(l.kg - V[l.unit.type].maxKg)} kg over the ${VEHICLE_LABEL[l.unit.type]}'s ${fmtKg(V[l.unit.type].maxKg)} kg.`);
    }
    if (!l.unit && l.vehicle === "big" && l.stops.length <= 2 && l.kg > (V.big.hardMaxKg ?? V.big.maxKg + V.big.overKg)) parts.push(`Direct Big (${l.stops.length} ${l.stops.length === 1 ? "stop" : "stops"}, up to ${fmtKg(cfg.directBigMaxKg)} kg).`);
    if (l.vehicle === "ace" && l.stops.length > V.ace.maxStops && cfg.aceLightRun) {
      parts.push(`Light milk run — ${l.stops.length} stops, ${fmtKg(cfg.aceLightRun.maxKg)} kg or less.`);
    } else if (l.vehicle === "ace" && l.stops.length > V.big.maxStops) {
      parts.push(`${l.stops.length} stops — only an Ace carries that many.`);
    }
    if (l.replanned) parts.push(`Re-planned without an Ace (max ${V.big.maxStops} stops).`);
    if (l.merged) parts.push(`Two loads going the same way merged.`);
    if (l.unit?.maxKg !== undefined) parts.push(`Driver max ${fmtKg(l.unit.maxKg)} kg.`);
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
    // A replan vehicle with its own maxKg is judged against that; else the rated load.
    const ownMax = type === l.vehicle ? l.unit?.maxKg : undefined;
    const overloaded = vt !== null && (ownMax !== undefined ? l.kg > ownMax : overRated(cfg, vt, l.kg));
    const bent = vt !== null && l.kg > (ownMax ?? V[vt].maxKg);
    const vehicle: VehicleType | undefined = vt ?? (type === "bulk" ? l.vehicle : undefined);
    const hardKg = vt === null ? Infinity : ownMax ?? V[vt].hardMaxKg ?? V[vt].maxKg + V[vt].overKg;
    const overHard = vt !== null && (l.kg > hardKg || !stopsAllowed(cfg, vt, l.stops.length, l.kg));
    const driverMaxKg = vehicle !== undefined && type !== "waiting" ? l.unit?.maxKg : undefined;
    return {
      key: `${type}:${l.key}`,
      type,
      ...(vehicle ? { vehicle } : {}),
      ...(type === "bulk" && l.split ? { bulkKind: l.split.kind } : {}),
      ...(driverMaxKg !== undefined ? { driverMaxKg } : {}),
      side: l.side,
      orderIds: ordered.flatMap((s) => s.orderIds).sort((a, b) => a - b),
      stops: ordered.map((s) => ({
        id: s.key,
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
        overloaded,
        pinned: l.pinned === true,
        overHard,
        amber: vt !== null && (l.stops.length > V[vt].idealStops || bent || overloaded || (type === "ace" && l.stops.length > V.ace.maxStops)),
      },
      reason,
    };
  }
}

const VEHICLE_LABEL: Record<VehicleType, string> = { ace: "Ace", big: "Big", gc: "GC" };
const fmtKg = (kg: number) => Math.round(kg).toLocaleString("en-US");
/** "1 Ace and 2 Bigs". */
const vehicleWords = (n: Partial<Record<VehicleType, number>>) =>
  VEHICLE_TYPES.filter((t) => (n[t] ?? 0) > 0)
    .map((t) => `${n[t]} ${VEHICLE_LABEL[t]}${(n[t] ?? 0) > 1 ? "s" : ""}`)
    .join(" and ");
