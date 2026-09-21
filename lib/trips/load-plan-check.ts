// lib/trips/load-plan-check.ts — LOAD PLAN CHECK, the comparison (2026-09-21).
//
// How well did the Upcountry load plan match the trips the planners actually
// made? Planners may never press Make trip, so a card cannot be matched to a
// trip; the comparison is BY BILL: for each bill in the day's snapshot, which
// trip did it go on that day, and did its card-mates go with it?
//
// PURE. No Prisma, no clock, no I/O, NO RATES. The server builds the inputs
// (lib/floor/load-plan-check-data.ts); the cost % is added there, admin only.
//
// ⚠ TARGET < ES2015: every Set/Map is iterated through Array.from.

import type { V2CardType, V2Plan, VehicleType } from "./load-plan-v2";

// ── Snapshot ────────────────────────────────────────────────────────────────

/** One card as stored in load_plan_snapshot.cards — no rates. */
export interface SnapshotCard {
  cardNo: number;
  type: V2CardType;
  /** ace | big | gc; a Bulk card's vehicle; null for hire, hold, waiting, direct. */
  vehicle: VehicleType | null;
  billIds: number[];
  kg: number;
  stops: number;
  /** Area names, far first. */
  places: string[];
}

/** The plan's cards as snapshot rows, numbered in the plan's own order. */
export function snapshotCards(plan: V2Plan): SnapshotCard[] {
  return plan.cards.map((c, i) => ({
    cardNo: i + 1,
    type: c.type,
    vehicle: c.vehicle ?? null,
    billIds: c.orderIds.slice(),
    kg: Math.round(c.kg * 10) / 10,
    stops: c.stopCount,
    places: c.areaNames.slice(),
  }));
}

/** A stored `cards` value → SnapshotCard[], dropping anything malformed. */
export function parseSnapshotCards(raw: unknown): SnapshotCard[] {
  if (!Array.isArray(raw)) return [];
  const out: SnapshotCard[] = [];
  raw.forEach((x) => {
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (typeof o.cardNo !== "number" || typeof o.type !== "string" || !Array.isArray(o.billIds)) return;
    out.push({
      cardNo: o.cardNo,
      type: o.type as V2CardType,
      vehicle: o.vehicle === "ace" || o.vehicle === "big" || o.vehicle === "gc" ? o.vehicle : null,
      billIds: o.billIds.filter((b): b is number => typeof b === "number"),
      kg: typeof o.kg === "number" ? o.kg : 0,
      stops: typeof o.stops === "number" ? o.stops : 0,
      places: Array.isArray(o.places) ? o.places.filter((p): p is string => typeof p === "string") : [],
    });
  });
  return out;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export type ActualType = VehicleType | "unknown";

/** A snapshot bill as it stands now. `tripId` = its trip ON THE SNAPSHOT DAY (not cancelled), else null. */
export interface BillFact {
  billId: number;
  areaId: number | null;
  areaName: string;
  kg: number;
  tripId: number | null;
}

/** An actual trip that carried at least one snapshot bill. */
export interface TripFact {
  tripId: number;
  type: ActualType;
  kg: number;
  stops: number;
  /** Every place on the trip (all its bills, not only the snapshot's), with kg. */
  places: Array<{ areaId: number | null; areaName: string; kg: number }>;
}

/** kg limits per vehicle; an unknown actual vehicle is judged as a Big. */
export type CheckLimits = Record<VehicleType, { idealKg: number; hardKg: number }>;

export interface PlaceDifference {
  place: string;
  wentWith: string;
  plannedWith: string;
}

export interface DayCheck {
  bills: {
    /** Every bill in the snapshot (all cards). */
    planned: number;
    /** On a trip that day. */
    sent: number;
    /** In the plan, not on any trip that day. */
    notSent: number;
    /** Sent bills from truck, Bulk and Direct cards — the match denominator. */
    judged: number;
    matched: number;
    /** matched ÷ judged × 100; null when nothing was judged. */
    matchPct: number | null;
  };
  trucks: {
    plan: { ace: number; big: number; gc: number; bulk: number; direct: number; total: number };
    actual: { ace: number; big: number; gc: number; unknown: number; total: number };
  };
  /** Sums, so a week can average them properly. */
  stops: { planSum: number; planTrucks: number; actualSum: number; actualTrucks: number };
  overIdeal: { plan: number; actual: number };
  overHard: { plan: number; actual: number };
  /** One entry per distinct difference this day. */
  differences: PlaceDifference[];
}

const TRUCK_TYPES: readonly V2CardType[] = ["ace", "big", "gc"];
const JUDGED_TYPES: readonly V2CardType[] = ["ace", "big", "gc", "bulk", "direct"];
/** A place with no other place beside it. */
export const ALONE = "on its own";

/** The heaviest place other than `areaId` in a list of (place, kg); ALONE when none. */
function mainOther(items: Array<{ areaId: number | null; areaName: string; kg: number }>, areaId: number | null, areaName: string): string {
  const kg = new Map<string, number>();
  items.forEach((x) => {
    if (x.areaId === areaId && x.areaName === areaName) return;
    kg.set(x.areaName, (kg.get(x.areaName) ?? 0) + x.kg);
  });
  const best = Array.from(kg.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return best ? best[0] : ALONE;
}

export function compareDay(input: {
  cards: SnapshotCard[];
  bills: ReadonlyMap<number, BillFact>;
  trips: ReadonlyMap<number, TripFact>;
  limits: CheckLimits;
}): DayCheck {
  const { cards, bills, trips, limits } = input;
  const fact = (id: number) => bills.get(id);
  const allIds = cards.flatMap((c) => c.billIds);
  const sentIds = allIds.filter((id) => fact(id)?.tripId != null);

  // Which judged card each bill was planned on.
  const cardOf = new Map<number, SnapshotCard>();
  cards.filter((c) => JUDGED_TYPES.includes(c.type)).forEach((c) => c.billIds.forEach((id) => cardOf.set(id, c)));

  let judged = 0;
  let matched = 0;
  const diffKeys = new Set<string>();
  const differences: PlaceDifference[] = [];
  cardOf.forEach((card, id) => {
    const b = fact(id);
    if (!b || b.tripId === null) return;
    judged += 1;
    const sentMates = card.billIds.filter((m) => m !== id && fact(m)?.tripId != null);
    let ok: boolean;
    if (sentMates.length > 0) {
      // Most of its card-mates went on the same trip.
      ok = sentMates.filter((m) => fact(m)!.tripId === b.tripId).length * 2 > sentMates.length;
    } else {
      // Planned alone (or its mates never went): its trip holds no bill planned on ANOTHER card.
      ok = !Array.from(cardOf.entries()).some(([o, c]) => c !== card && fact(o)?.tripId === b.tripId);
    }
    if (ok) {
      matched += 1;
      return;
    }
    const trip = trips.get(b.tripId);
    const planned = card.billIds
      .map((m) => fact(m))
      .filter((f): f is BillFact => f !== undefined)
      .map((f) => ({ areaId: f.areaId, areaName: f.areaName, kg: f.kg }));
    const plannedWith = mainOther(planned, b.areaId, b.areaName);
    const wentWith = trip ? mainOther(trip.places, b.areaId, b.areaName) : ALONE;
    if (plannedWith === wentWith) return;
    const key = `${b.areaName}|${wentWith}|${plannedWith}`;
    if (diffKeys.has(key)) return;
    diffKeys.add(key);
    differences.push({ place: b.areaName, wentWith, plannedWith });
  });

  const planTrucks = cards.filter((c) => TRUCK_TYPES.includes(c.type));
  const plan = {
    ace: cards.filter((c) => c.type === "ace").length,
    big: cards.filter((c) => c.type === "big").length,
    gc: cards.filter((c) => c.type === "gc").length,
    bulk: cards.filter((c) => c.type === "bulk").length,
    direct: cards.filter((c) => c.type === "direct").length,
    total: 0,
  };
  plan.total = plan.ace + plan.big + plan.gc + plan.bulk + plan.direct;

  const usedTrips = Array.from(new Set(sentIds.map((id) => fact(id)!.tripId as number)))
    .map((t) => trips.get(t))
    .filter((t): t is TripFact => t !== undefined);
  const actual = { ace: 0, big: 0, gc: 0, unknown: 0, total: usedTrips.length };
  usedTrips.forEach((t) => (actual[t.type] += 1));

  const lim = (t: ActualType) => limits[t === "unknown" ? "big" : t];
  differences.sort((a, b) => (a.place < b.place ? -1 : a.place > b.place ? 1 : 0));
  return {
    bills: {
      planned: allIds.length,
      sent: sentIds.length,
      notSent: allIds.length - sentIds.length,
      judged,
      matched,
      matchPct: judged > 0 ? (matched / judged) * 100 : null,
    },
    trucks: { plan, actual },
    stops: {
      planSum: planTrucks.reduce((n, c) => n + c.stops, 0),
      planTrucks: planTrucks.length,
      actualSum: usedTrips.reduce((n, t) => n + t.stops, 0),
      actualTrucks: usedTrips.length,
    },
    overIdeal: {
      plan: planTrucks.filter((c) => c.kg > limits[c.type as VehicleType].idealKg).length,
      actual: usedTrips.filter((t) => t.kg > lim(t.type).idealKg).length,
    },
    overHard: {
      plan: planTrucks.filter((c) => c.kg > limits[c.type as VehicleType].hardKg).length,
      actual: usedTrips.filter((t) => t.kg > lim(t.type).hardKg).length,
    },
    differences,
  };
}

// ── The week ────────────────────────────────────────────────────────────────

export interface WeekCheck {
  days: number;
  bills: DayCheck["bills"];
  trucks: DayCheck["trucks"];
  stops: DayCheck["stops"];
  overIdeal: DayCheck["overIdeal"];
  overHard: DayCheck["overHard"];
  /** "Vijalpor went with Vapi, not Navsari" — counted in DAYS, most first. */
  topDifferences: Array<PlaceDifference & { days: number }>;
}

export function summariseWeek(days: DayCheck[], top = 10): WeekCheck {
  const sum = (f: (d: DayCheck) => number) => days.reduce((n, d) => n + f(d), 0);
  const judged = sum((d) => d.bills.judged);
  const matched = sum((d) => d.bills.matched);
  const count = new Map<string, PlaceDifference & { days: number }>();
  days.forEach((d) =>
    d.differences.forEach((x) => {
      const k = `${x.place}|${x.wentWith}|${x.plannedWith}`;
      const e = count.get(k) ?? { ...x, days: 0 };
      e.days += 1;
      count.set(k, e);
    }),
  );
  return {
    days: days.length,
    bills: {
      planned: sum((d) => d.bills.planned),
      sent: sum((d) => d.bills.sent),
      notSent: sum((d) => d.bills.notSent),
      judged,
      matched,
      matchPct: judged > 0 ? (matched / judged) * 100 : null,
    },
    trucks: {
      plan: {
        ace: sum((d) => d.trucks.plan.ace),
        big: sum((d) => d.trucks.plan.big),
        gc: sum((d) => d.trucks.plan.gc),
        bulk: sum((d) => d.trucks.plan.bulk),
        direct: sum((d) => d.trucks.plan.direct),
        total: sum((d) => d.trucks.plan.total),
      },
      actual: {
        ace: sum((d) => d.trucks.actual.ace),
        big: sum((d) => d.trucks.actual.big),
        gc: sum((d) => d.trucks.actual.gc),
        unknown: sum((d) => d.trucks.actual.unknown),
        total: sum((d) => d.trucks.actual.total),
      },
    },
    stops: {
      planSum: sum((d) => d.stops.planSum),
      planTrucks: sum((d) => d.stops.planTrucks),
      actualSum: sum((d) => d.stops.actualSum),
      actualTrucks: sum((d) => d.stops.actualTrucks),
    },
    overIdeal: { plan: sum((d) => d.overIdeal.plan), actual: sum((d) => d.overIdeal.actual) },
    overHard: { plan: sum((d) => d.overHard.plan), actual: sum((d) => d.overHard.actual) },
    topDifferences: Array.from(count.values())
      .sort((a, b) => b.days - a.days || (a.place < b.place ? -1 : a.place > b.place ? 1 : 0))
      .slice(0, top),
  };
}

/** "Vijalpor went with Vapi, not Navsari" · "… went on its own, not with Navsari" · "… went with Vapi, not on its own". */
export function differenceText(d: PlaceDifference): string {
  if (d.wentWith === ALONE) return `${d.place} went on its own, not with ${d.plannedWith}`;
  if (d.plannedWith === ALONE) return `${d.place} went with ${d.wentWith}, not on its own`;
  return `${d.place} went with ${d.wentWith}, not ${d.plannedWith}`;
}

/** An actual vehicle's class from vehicle_master.category; unknown when it cannot be told. */
export function actualTypeOf(category: string | null): ActualType {
  if (!category) return "unknown";
  if (/\bace\b/i.test(category)) return "ace";
  if (/\bgc\b|goods carrier/i.test(category)) return "gc";
  if (/407|eicher|big|truck|14 ?ft|17 ?ft|19 ?ft/i.test(category)) return "big";
  return "unknown";
}
