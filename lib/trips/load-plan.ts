// lib/trips/load-plan.ts
//
// THE LOAD PLAN ENGINE (2026-09-19, owner) — suggested truckloads for one
// delivery type's pool (Upcountry today). Floor's "Load plan" view draws one
// card per truck this returns.
//
// PURE. No Prisma, no clock, no I/O, no React — the view calls it on the rows it
// already has, a test calls it on made-up rows, and both get the same answer.
//
// 🔴 A SUGGESTION, NEVER AN ACTION. Nothing here creates a trip or touches a
// bill. "Make trip" on a card runs the floor's existing New trip flow with the
// card's bills — the same two API calls a planner makes by ticking them.
//
// 🔴 THE RULES LIVE IN CONFIG, not here: `load_plan_config.config` (one row per
// delivery type), read by lib/floor/load-plan-config.ts and validated by
// `parseLoadPlanConfig` below. Route IDS, never names.
//
// THE ALGORITHM, in the owner's order:
//   0. Pack by STOP, never by bill — a stop's bills are never split. A stop is
//      the trip module's own identity (`stopKey` = computeDropKey). Stops are
//      taken largest first.
//   1. A single stop over `bigMaxKg` is its own BULK truck — no size, never
//      split, not counted as a small or big truck.
//   2. Every route (partners included): while what it has left is over
//      `bigMaxKg`, fill one Big truck up to `bigMaxKg`, first-fit by stop. What
//      remains is the route's LEFTOVER.
//   3. A main route's leftover is its OPEN truck — the only truck anything may
//      join; a full truck from step 2 never takes a partner.
//   4. Each partner (in config order): if its whole leftover fits on an allowed
//      main route's open truck (total ≤ `bigMaxKg`), it joins — `most_space`
//      picks the one with the most free space (a tie goes to list order),
//      `in_order` the first that fits. Otherwise it gets its own truck.
//   5. Every other route (and the route-less bills) gets its own truck(s),
//      never mixed with another route.
//   6. Size from the final load: ≤ `smallMaxKg` Small, else Big.
//   7. One plain-English reason per truck.
//   8. Sorted by kg, highest first; the key breaks ties. The same pool always
//      gives the same trucks in the same order.
//
// ⚠ AN UNKNOWN WEIGHT PACKS AS 0 kg and is COUNTED (`unknownWeightCount`), so
// the view can print "2,400+ kg" — the same honest "+" the rest of the floor
// uses. The importer stores a missing SAP weight as 0, so 0 and "unknown" are
// one stored value (floor-page.tsx, `selectionWeight`).

// ── Config ──────────────────────────────────────────────────────────────────

export type PartnerPick = "most_space" | "in_order";

export interface LoadPlanPartner {
  /** The small route. */
  routeId: number;
  /** Main routes whose open truck it may join, in priority order. */
  joins: number[];
  /** `most_space`: the fitting truck with the most free space (tie → list order). `in_order`: the first that fits. */
  pick: PartnerPick;
}

export interface LoadPlanConfig {
  smallMaxKg: number;
  bigMaxKg: number;
  mainRouteIds: number[];
  partners: LoadPlanPartner[];
}

const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * The stored jsonb → a config, or null when it is missing or malformed. The
 * view shows "Load plan not set up" on null — a bad row must never crash the
 * floor, and a half-read config must never plan with guessed rules.
 */
export function parseLoadPlanConfig(raw: unknown): LoadPlanConfig | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isPosInt(o.smallMaxKg) || !isPosInt(o.bigMaxKg) || o.smallMaxKg > o.bigMaxKg) return null;
  if (!Array.isArray(o.mainRouteIds) || !o.mainRouteIds.every(isPosInt)) return null;
  if (!Array.isArray(o.partners)) return null;
  const partners: LoadPlanPartner[] = [];
  for (const p of o.partners) {
    if (p === null || typeof p !== "object") return null;
    const q = p as Record<string, unknown>;
    if (!isPosInt(q.routeId) || !Array.isArray(q.joins) || !q.joins.every(isPosInt)) return null;
    if (q.pick !== "most_space" && q.pick !== "in_order") return null;
    partners.push({ routeId: q.routeId, joins: q.joins as number[], pick: q.pick });
  }
  return {
    smallMaxKg: o.smallMaxKg,
    bigMaxKg: o.bigMaxKg,
    mainRouteIds: o.mainRouteIds as number[],
    partners,
  };
}

// ── Input and output ────────────────────────────────────────────────────────

/** One bill, as much of it as the plan needs. A structural subset of FloorBoardRow. */
export interface LoadPlanBill {
  orderId: number;
  /** null = the bill's area has no route ("No route"). */
  routeId: number | null;
  routeName: string | null;
  /** The bill's stop — computeDropKey. Bills sharing one are never split. */
  stopKey: string;
  /** Kilos; null, 0 or negative = unknown (packs as 0, counted). */
  weightKg: number | null;
}

export type TruckKind = "small" | "big" | "bulk";

export interface PlannedTruck {
  /**
   * Stable identity for the view: which routes, and which truck of theirs.
   * The same pool gives the same keys, so an open panel survives a regroup
   * that did not touch its truck.
   */
  key: string;
  kind: TruckKind;
  /** The truck's size in kg (small or big max); null for a bulk truck. */
  capacityKg: number | null;
  /** Main route first, then the partners that joined it, in the order they joined. */
  routeIds: Array<number | null>;
  routeNames: string[];
  /** Kilos packed — unknown weights count 0. */
  kg: number;
  unknownWeightCount: number;
  stopCount: number;
  orderIds: number[];
  reason: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const NO_ROUTE = "No route";

interface Stop {
  key: string;
  kg: number;
  unknown: number;
  orderIds: number[];
}

interface Load {
  stops: Stop[];
  kg: number;
}

const knownKg = (w: number | null) => (w !== null && Number.isFinite(w) && w > 0 ? w : 0);
const fmtKg = (kg: number) => Math.round(kg).toLocaleString("en-US");
const routeKey = (id: number | null) => (id === null ? "none" : String(id));
const sumKg = (stops: Stop[]) => stops.reduce((s, x) => s + x.kg, 0);

/** "A", "A or B", "A, B or C". */
function orList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** "A", "A and B", "A, B and C". */
function andList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Step 2: take full Big trucks off a route while it has more than `max` left.
 * First-fit over the stops, largest first. Returns the full loads and what is
 * left (≤ max). Every stop here is ≤ max (bulk stops were taken out first), so
 * each pass places at least one stop and the loop always ends.
 */
function takeFullTrucks(stops: Stop[], max: number): { full: Load[]; leftover: Stop[] } {
  let rest = stops;
  const full: Load[] = [];
  while (sumKg(rest) > max) {
    const load: Stop[] = [];
    let kg = 0;
    const next: Stop[] = [];
    for (const s of rest) {
      if (kg + s.kg <= max) {
        load.push(s);
        kg += s.kg;
      } else {
        next.push(s);
      }
    }
    if (load.length === 0) break; // cannot happen (every stop ≤ max); never loop forever
    full.push({ stops: load, kg });
    rest = next;
  }
  return { full, leftover: rest };
}

// ── The plan ────────────────────────────────────────────────────────────────

interface Draft {
  key: string;
  bulk: boolean;
  routeIds: Array<number | null>;
  stops: Stop[];
  reason: string;
  // For an open main-route truck: who joined, and the pick sentences.
  joined?: string[];
  picks?: string[];
  baseReason?: string;
}

/**
 * The suggested trucks for these bills under this config. An empty list when
 * there is no config (the view says "Load plan not set up") or no bills.
 *
 * @param routeNames id → name for every route the config names. A reason can
 *   name a route with NO bills today ("No open Navsari truck to join"), which
 *   the bills cannot supply; the server reads these from route_master with the
 *   config. A route missing from both reads "Route 11", never a bare number.
 */
export function planLoads(
  bills: LoadPlanBill[],
  config: LoadPlanConfig | null,
  routeNames: Readonly<Record<number, string>> = {},
): PlannedTruck[] {
  if (config === null || bills.length === 0) return [];
  const max = config.bigMaxKg;

  // ── Stops, per route. A stop's key is route + stopKey, so two routes can
  //    never share a stop even if a key collided.
  const nameOf = new Map<string, string>();
  const stopsOf = new Map<string, Map<string, Stop>>();
  for (const b of bills) {
    const rk = routeKey(b.routeId);
    if (!nameOf.has(rk)) nameOf.set(rk, b.routeId === null ? NO_ROUTE : (b.routeName ?? `Route ${b.routeId}`).trim());
    const m = stopsOf.get(rk) ?? new Map<string, Stop>();
    const s = m.get(b.stopKey) ?? { key: b.stopKey, kg: 0, unknown: 0, orderIds: [] };
    const w = knownKg(b.weightKg);
    s.kg += w;
    if (w === 0) s.unknown += 1;
    s.orderIds.push(b.orderId);
    m.set(b.stopKey, s);
    stopsOf.set(rk, m);
  }
  // Largest stop first; the stop key breaks ties so the order is stable.
  const sortedStops = (rk: string) =>
    Array.from(stopsOf.get(rk)?.values() ?? []).sort((a, b) => b.kg - a.kg || a.key.localeCompare(b.key));
  const routeName = (rk: string) =>
    nameOf.get(rk) ?? (rk === "none" ? NO_ROUTE : routeNames[Number(rk)]?.trim() || `Route ${rk}`);
  const idOf = (rk: string): number | null => (rk === "none" ? null : Number(rk));

  const drafts: Draft[] = [];
  const leftovers = new Map<string, Stop[]>();

  // ── Steps 1 + 2, every route in a fixed order (by id; "No route" last).
  const routeKeys = Array.from(stopsOf.keys()).sort((a, b) => {
    if (a === "none") return 1;
    if (b === "none") return -1;
    return Number(a) - Number(b);
  });
  for (const rk of routeKeys) {
    const name = routeName(rk);
    const all = sortedStops(rk);
    all
      .filter((s) => s.kg > max)
      .forEach((s, i) =>
        drafts.push({
          key: `bulk:${rk}:${i}`,
          bulk: true,
          routeIds: [idOf(rk)],
          stops: [s],
          reason: `One ${name} stop of ${fmtKg(s.kg)} kg — over ${fmtKg(max)} kg. A stop is never split.`,
        }),
      );
    const { full, leftover } = takeFullTrucks(all.filter((s) => s.kg <= max), max);
    full.forEach((load, i) =>
      drafts.push({
        key: `full:${rk}:${i}`,
        bulk: false,
        routeIds: [idOf(rk)],
        stops: load.stops,
        reason: `Full load of ${name}.`,
      }),
    );
    leftovers.set(rk, leftover);
  }
  const hadFull = (rk: string) => drafts.some((d) => d.key.startsWith(`full:${rk}:`));

  // ── Step 3: each main route's leftover is its open truck.
  const mainKeys = config.mainRouteIds.map(routeKey);
  const open = new Map<string, Draft>();
  for (const rk of mainKeys) {
    const left = leftovers.get(rk) ?? [];
    if (left.length === 0) continue;
    const name = routeName(rk);
    const d: Draft = {
      key: `open:${rk}`,
      bulk: false,
      routeIds: [idOf(rk)],
      stops: [...left],
      reason: "",
      joined: [],
      picks: [],
      baseReason: hadFull(rk) ? `The rest of ${name} after its full truck${drafts.filter((x) => x.key.startsWith(`full:${rk}:`)).length === 1 ? "" : "s"}.` : `${name} on its own.`,
    };
    open.set(rk, d);
    drafts.push(d);
  }

  // ── Step 4: partners, in config order.
  const partnerKeys = new Set<string>();
  for (const p of config.partners) {
    const rk = routeKey(p.routeId);
    if (mainKeys.includes(rk) || partnerKeys.has(rk)) continue; // a main route is never a partner; first rule wins
    partnerKeys.add(rk);
    const left = leftovers.get(rk) ?? [];
    if (left.length === 0) continue;
    const name = routeName(rk);
    const kg = sumKg(left);
    const joinKeys = p.joins.map(routeKey);
    const withOpen = joinKeys.filter((k) => open.has(k));
    const fitting = withOpen.filter((k) => sumKg(open.get(k)!.stops) + kg <= max);
    let chosen: string | null = null;
    if (fitting.length > 0) {
      if (p.pick === "most_space") {
        // Most free space; a tie keeps list order (reduce keeps the earlier on equal).
        chosen = fitting.reduce((best, k) => (sumKg(open.get(k)!.stops) < sumKg(open.get(best)!.stops) ? k : best));
      } else {
        chosen = fitting[0];
      }
    }
    if (chosen !== null) {
      const t = open.get(chosen)!;
      t.stops.push(...left);
      t.routeIds.push(idOf(rk));
      t.joined!.push(name);
      if (p.pick === "most_space" && withOpen.length > 1) {
        const others = withOpen.filter((k) => k !== chosen).map(routeName);
        const why = fitting.length === 1 ? `there was no room on the ${orList(others)} truck` : `it had more space than ${orList(others)}`;
        t.picks!.push(`${name} picked ${routeName(chosen)} because ${why}.`);
      }
    } else {
      const reason =
        withOpen.length > 0
          ? `No room on the ${orList(withOpen.map(routeName))} truck, so ${name} goes on its own.`
          : `No open ${orList(joinKeys.map(routeName))} truck to join, so ${name} goes on its own.`;
      drafts.push({
        key: `own:${rk}`,
        bulk: false,
        routeIds: [idOf(rk)],
        stops: left,
        reason: hadFull(rk) ? `${reason.slice(0, -1)} with the rest after its full truck.` : reason,
      });
    }
  }

  // ── Step 5: every other route, on its own.
  for (const rk of routeKeys) {
    if (mainKeys.includes(rk) || partnerKeys.has(rk)) continue;
    const left = leftovers.get(rk) ?? [];
    if (left.length === 0) continue;
    const name = routeName(rk);
    drafts.push({
      key: `own:${rk}`,
      bulk: false,
      routeIds: [idOf(rk)],
      stops: left,
      reason: hadFull(rk) ? `The rest of ${name} after its full truck — it has no partner route.` : `${name} has no partner route, so it goes on its own.`,
    });
  }

  // ── Steps 6–8: size, reason, sort.
  const trucks: PlannedTruck[] = drafts.map((d) => {
    const kg = sumKg(d.stops);
    let reason = d.reason;
    if (d.joined !== undefined) {
      reason =
        d.joined.length === 0
          ? d.baseReason!
          : [`${andList(d.joined)} fit${d.joined.length === 1 ? "s" : ""} on the ${routeName(routeKey(d.routeIds[0]))} truck.`, ...d.picks!].join(" ");
    }
    const kind: TruckKind = d.bulk ? "bulk" : kg <= config.smallMaxKg ? "small" : "big";
    return {
      key: d.key,
      kind,
      capacityKg: kind === "bulk" ? null : kind === "small" ? config.smallMaxKg : config.bigMaxKg,
      routeIds: d.routeIds,
      routeNames: d.routeIds.map((id) => routeName(routeKey(id))),
      kg,
      unknownWeightCount: d.stops.reduce((s, x) => s + x.unknown, 0),
      stopCount: d.stops.length,
      orderIds: d.stops.flatMap((s) => s.orderIds).sort((a, b) => a - b),
      reason,
    };
  });
  return trucks.sort((a, b) => b.kg - a.kg || a.key.localeCompare(b.key));
}

/** The summary line's numbers. Bulk trucks are counted apart from small/big. */
export function summarisePlan(trucks: PlannedTruck[]): { kg: number; trucks: number; big: number; small: number; bulk: number } {
  return {
    kg: trucks.reduce((s, t) => s + t.kg, 0),
    trucks: trucks.filter((t) => t.kind !== "bulk").length,
    big: trucks.filter((t) => t.kind === "big").length,
    small: trucks.filter((t) => t.kind === "small").length,
    bulk: trucks.filter((t) => t.kind === "bulk").length,
  };
}
