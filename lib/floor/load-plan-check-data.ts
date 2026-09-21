// lib/floor/load-plan-check-data.ts — SERVER ONLY, READ-ONLY (2026-09-21).
//
// Builds the admin "Load plan check" for a day or a week: picks the day's
// snapshot (the 15:00 'auto' one unless another is asked for), finds the trip
// each snapshot bill went on THAT DAY, and hands both to the pure comparison
// (lib/trips/load-plan-check.ts).
//
// 🔴 THE COST % IS ADMIN-ONLY. It prices plan and actual with the secret rate
// table here, on the server, and returns ONLY plan ÷ actual as a percentage.
// The route that calls this (app/api/admin/load-plan-check) is superuser-only.
// No rupee amount is returned, logged or stored.
//
// Sequential awaits; never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { loadPlanV2Context } from "@/lib/floor/load-plan-v2-loader";
import { makePricer, VEHICLE_TYPES, type LoadPlanV2Context, type VehicleType } from "@/lib/trips/load-plan-v2";
import {
  actualTypeOf,
  compareDay,
  parseSnapshotCards,
  type BillFact,
  type CheckLimits,
  type DayCheck,
  type SnapshotCard,
  type TripFact,
} from "@/lib/trips/load-plan-check";

export interface SnapshotInfo {
  id: number;
  source: string;
  /** ISO timestamp. */
  takenAt: string;
}

export interface DayCheckResult {
  date: string;
  /** null = no snapshot that day. */
  snapshot: SnapshotInfo | null;
  /** Every snapshot of the day, for the picker. */
  snapshots: SnapshotInfo[];
  check: DayCheck | null;
  /** Plan cost ÷ actual cost × 100 over the trips that carried snapshot bills. ADMIN ONLY. */
  costPct: number | null;
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** kg limits from the live, locked config — or null when v2 is not set up. */
function limitsOf(ctx: LoadPlanV2Context): CheckLimits {
  const out = {} as CheckLimits;
  VEHICLE_TYPES.forEach((t) => {
    const v = ctx.config.vehicles[t];
    out[t] = { idealKg: v.maxKg, hardKg: v.hardMaxKg ?? v.maxKg + v.overKg };
  });
  return out;
}

export async function loadDayCheck(dateIso: string, snapshotId?: number, ctxIn?: LoadPlanV2Context | null): Promise<DayCheckResult> {
  const date = toDate(dateIso);
  const rows = await prisma.load_plan_snapshot.findMany({
    where: { date },
    select: { id: true, source: true, takenAt: true, cards: true },
    orderBy: [{ takenAt: "asc" }],
  });
  const snapshots = rows.map((r) => ({ id: r.id, source: r.source, takenAt: r.takenAt.toISOString() }));
  // The 15:00 'auto' one by default; else the latest Replan of the day.
  const row =
    (snapshotId !== undefined ? rows.find((r) => r.id === snapshotId) : undefined) ??
    rows.find((r) => r.source === "auto") ??
    rows[rows.length - 1];
  if (!row) return { date: dateIso, snapshot: null, snapshots, check: null, costPct: null };
  const cards = parseSnapshotCards(row.cards);
  const snapshot = { id: row.id, source: row.source, takenAt: row.takenAt.toISOString() };

  const ctx = ctxIn === undefined ? await loadPlanV2Context("Upcountry") : ctxIn;
  if (!ctx) return { date: dateIso, snapshot, snapshots, check: null, costPct: null };
  const r = await checkCards(dateIso, cards, ctx);
  return { date: dateIso, snapshot, snapshots, check: r.check, costPct: r.costPct };
}

/** Compares snapshot cards with the trips of `dateIso` (the core of loadDayCheck). */
export async function checkCards(dateIso: string, cards: SnapshotCard[], ctx: LoadPlanV2Context): Promise<{ check: DayCheck; costPct: number | null }> {
  const date = toDate(dateIso);

  // ── The snapshot's bills as they stand now ────────────────────────────────
  const areaSel = { select: { area: { select: { id: true, name: true } } } } as const;
  const ids = Array.from(new Set(cards.flatMap((c) => c.billIds)));
  const orders = ids.length
    ? await prisma.orders.findMany({
        where: { id: { in: ids } },
        select: { id: true, tripDropId: true, querySnapshot: { select: { totalWeight: true } }, customer: areaSel, shipToOverrideCustomer: areaSel },
      })
    : [];
  const dropIds = Array.from(new Set(orders.map((o) => o.tripDropId).filter((d): d is number => d !== null)));
  const drops = dropIds.length
    ? await prisma.trip_drops.findMany({ where: { id: { in: dropIds } }, select: { id: true, tripId: true } })
    : [];
  const tripIdOfDrop = new Map(drops.map((d) => [d.id, d.tripId] as const));
  const tripRows = drops.length
    ? await prisma.trips.findMany({
        where: { id: { in: Array.from(new Set(drops.map((d) => d.tripId))) } },
        select: { id: true, tripDate: true, status: true, vehicle: { select: { category: true } } },
      })
    : [];
  // A trip counts only if it is that day's and not cancelled.
  const dayTrips = tripRows.filter((t) => t.status !== "cancelled" && t.tripDate.getTime() === date.getTime());
  const dayTripIds = new Set(dayTrips.map((t) => t.id));

  const bills = new Map<number, BillFact>();
  orders.forEach((o) => {
    const area = (o.shipToOverrideCustomer ?? o.customer)?.area ?? null;
    const tripId = o.tripDropId !== null ? tripIdOfDrop.get(o.tripDropId) ?? null : null;
    bills.set(o.id, {
      billId: o.id,
      areaId: area?.id ?? null,
      areaName: area?.name.trim() ?? "Area not set",
      kg: o.querySnapshot?.totalWeight ?? 0,
      tripId: tripId !== null && dayTripIds.has(tripId) ? tripId : null,
    });
  });

  // ── Those trips in full: every bill on them, their stops ──────────────────
  const tripIds = Array.from(dayTripIds);
  const tripDrops = tripIds.length
    ? await prisma.trip_drops.findMany({ where: { tripId: { in: tripIds } }, select: { id: true, tripId: true } })
    : [];
  const tripOrders = tripDrops.length
    ? await prisma.orders.findMany({
        where: { tripDropId: { in: tripDrops.map((d) => d.id) }, isRemoved: false },
        select: { tripDropId: true, querySnapshot: { select: { totalWeight: true } }, customer: areaSel, shipToOverrideCustomer: areaSel },
      })
    : [];
  const tripOfDrop = new Map(tripDrops.map((d) => [d.id, d.tripId] as const));
  const trips = new Map<number, TripFact>();
  dayTrips.forEach((t) => {
    trips.set(t.id, { tripId: t.id, type: actualTypeOf(t.vehicle?.category ?? null), kg: 0, stops: tripDrops.filter((d) => d.tripId === t.id).length, places: [] });
  });
  tripOrders.forEach((o) => {
    const t = trips.get(tripOfDrop.get(o.tripDropId as number) ?? -1);
    if (!t) return;
    const area = (o.shipToOverrideCustomer ?? o.customer)?.area ?? null;
    const kg = o.querySnapshot?.totalWeight ?? 0;
    t.kg += kg;
    t.places.push({ areaId: area?.id ?? null, areaName: area?.name.trim() ?? "Area not set", kg });
  });

  const check = compareDay({ cards, bills, trips, limits: limitsOf(ctx) });
  return { check, costPct: costPct(cards, bills, trips, ctx) };
}

/**
 * Plan ÷ actual trip cost × 100, both priced with the same rate table.
 * 🔴 ADMIN ONLY — the rupee sums never leave this function.
 * Plan: every truck, Bulk and Direct card (a hire Bulk as ⌈kg ÷ Big ideal⌉
 * Bigs, a Direct card as a Big). Actual: the trips that carried snapshot
 * bills, by their vehicle (unknown → Big).
 */
function costPct(cards: SnapshotCard[], bills: Map<number, BillFact>, trips: Map<number, TripFact>, ctx: LoadPlanV2Context): number | null {
  const price = makePricer(ctx);
  const areaIds = (ids: number[]) =>
    Array.from(new Set(ids.map((id) => bills.get(id)?.areaId).filter((a): a is number => typeof a === "number")));
  let plan = 0;
  cards.forEach((c) => {
    if (c.type === "hold" || c.type === "waiting") return;
    const ids = areaIds(c.billIds);
    if (ids.length === 0) return;
    const t: VehicleType = c.vehicle ?? "big";
    const n = c.type === "bulk" && c.vehicle === null ? Math.max(1, Math.ceil(c.kg / ctx.config.vehicles.big.maxKg)) : 1;
    plan += price(ids, t) * n;
  });
  const used = new Set(Array.from(bills.values()).map((b) => b.tripId).filter((t): t is number => t !== null));
  let actual = 0;
  used.forEach((id) => {
    const t = trips.get(id);
    if (!t) return;
    const ids = Array.from(new Set(t.places.map((p) => p.areaId).filter((a): a is number => a !== null)));
    if (ids.length > 0) actual += price(ids, t.type === "unknown" ? "big" : t.type);
  });
  return actual > 0 ? (plan / actual) * 100 : null;
}

/** The 7 days ending on `endIso`, oldest first. */
export async function loadWeekCheck(endIso: string): Promise<DayCheckResult[]> {
  const ctx = await loadPlanV2Context("Upcountry");
  const end = toDate(endIso).getTime();
  const out: DayCheckResult[] = [];
  for (let i = 6; i >= 0; i--) {
    const iso = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    out.push(await loadDayCheck(iso, undefined, ctx));
  }
  return out;
}
