// lib/trips/queries.ts
//
// The trip module's READ side. SELECT-only. Sequential awaits, never
// prisma.$transaction (CORE §3). No writes anywhere in this file — the live-sync
// markers key on MAX(orders.updatedAt), so a stray write here would fire a false
// "changed" on every board (FLOOR §5/§10, PICKING §10).
//
// 🔴 BATCHED READS, NEVER AN INCLUDE CHAIN. Every lookup is one `findMany` keyed
// on `id IN (…)` or `tripId IN (…)`. lib/picking/queue.ts:537-554 records the
// measurement that settled this: an include tree issued EIGHTEEN SQL statements
// for a 72-row board, because Prisma neither dedupes two relation chains to the
// same table nor skips a chain for rows whose FK is null. Four findMany calls
// are four statements whatever the board size.
//
// 🔴 `ready` IS DERIVED HERE AND STORED NOWHERE. A trip is ready when every bill
// under it is at pick_checked. The stored `status` vocabulary deliberately has
// no 'ready' value (chk_trips_status admits draft/released/loading/dispatched/
// cancelled) because a stored flag would drift the moment a bill is added to the
// trip or unassigned, and nothing would correct it. Owner decision 2026-09-09.
// If you find yourself wanting to persist it, the answer is no — read §C2 of
// docs/prompts/drafts/web-update-2026-09-09-trip-schema.md first.

import { prisma } from "@/lib/prisma";
import {
  SUPPORT_DONE_OUTPUT,
  PICK_ASSIGNED,
  PICK_DONE,
  PICK_CHECKED,
} from "@/lib/workflow-stages";

/**
 * Per-trip bill counts by state.
 *
 * ⚠ `other` EXISTS SO THE NUMBERS ADD UP. Trip membership is NOT gated by stage
 * — a bill can join a trip at any `workflowStage` (owner decision) — so a trip
 * can legitimately hold a bill at `pending_support`, `cancelled` or
 * `dispatched`. Without this bucket the four named counts would silently fail to
 * sum to `total`, and a progress bar built on them would render short with no
 * indication why. Four named states plus a remainder is honest; four alone is a
 * quiet lie.
 */
export interface TripBillCounts {
  waiting: number;
  withPicker: number;
  picked: number;
  checked: number;
  other: number;
  total: number;
}

export interface TripDropSummary {
  id: number;
  dropSeq: number;
  customerId: number | null;
  shipToCode: string;
  dropKey: string;
  customerName: string;
  areaName: string | null;
  routeName: string | null;
  note: string | null;
  /** OBD numbers on this stop, in id order. */
  orderIds: number[];
  bills: number;
  litres: number;
}

export interface TripSummary {
  id: number;
  tripNumber: string;
  tripDate: string; // YYYY-MM-DD
  typeCode: string;
  deliveryTypeId: number;
  deliveryTypeName: string | null;
  seq: number;
  dispatchWindowId: number | null;
  windowTime: string | null;
  transporterId: number | null;
  transporterName: string | null;
  vehicleId: number | null;
  vehicleNo: string | null;
  adhocVehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  transporterTripNo: string | null;
  note: string | null;
  status: string;
  /** DERIVED, never stored — every bill checked and at least one bill. */
  isReady: boolean;
  counts: TripBillCounts;
  totalLitres: number;
  dropCount: number;
  releasedAt: string | null;
  dispatchedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface TripDetail extends TripSummary {
  drops: TripDropSummary[];
}

const EMPTY_COUNTS: TripBillCounts = {
  waiting: 0,
  withPicker: 0,
  picked: 0,
  checked: 0,
  other: 0,
  total: 0,
};

/** ISO date-only from a @db.Date value. UTC-anchored — never a timezone shift. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse "YYYY-MM-DD" to a UTC-midnight Date — the shape a `@db.Date` column
 * compares against. Throws on a malformed or impossible calendar date so the
 * route can surface a 400 rather than silently answering for the wrong day.
 *
 * Same rule and same round-trip check as `parseFloorDate` (lib/floor/queries.ts)
 * and `resolveTargetDate` (lib/picking/queue.ts). Never `new Date(str)`.
 */
export function parseTripDate(dateStr: string): Date {
  if (!DATE_RE.test(dateStr)) throw new Error(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.toISOString().slice(0, 10) !== dateStr) throw new Error(`Invalid calendar date "${dateStr}"`);
  return dt;
}

/**
 * Bucket one bill by stage.
 *
 * Composed from the exported ladder constants, never string literals, so a
 * renamed stage moves this with everything else (lib/workflow-stages.ts's own
 * discipline). Anything outside the four picking stages lands in `other` — see
 * the note on TripBillCounts for why that bucket is not optional.
 */
function bucketFor(stage: string): keyof Omit<TripBillCounts, "total"> {
  if (stage === SUPPORT_DONE_OUTPUT) return "waiting";
  if (stage === PICK_ASSIGNED) return "withPicker";
  if (stage === PICK_DONE) return "picked";
  if (stage === PICK_CHECKED) return "checked";
  return "other";
}

/** The bill rows both readers need, already narrowed. */
interface TripBillRow {
  id: number;
  tripDropId: number | null;
  workflowStage: string;
  litres: number;
}

/**
 * Every non-removed bill attached to the given drops, with its litres.
 *
 * TWO batched reads, both keyed on an `IN` list:
 *   1. orders by `tripDropId IN (…)`
 *   2. import_obd_query_summary by `orderId IN (…)` — the litres
 *
 * ⚠ THE SECOND READ IS A SEPARATE findMany, NOT `include: { querySnapshot }`.
 * A to-one include would work and would probably cost one statement today, but
 * the rule in this module is that every lookup is visible as its own query. See
 * the file header.
 *
 * ⚠ `isRemoved: false` — the standing soft-delete rule for every `orders` read
 * (CORE §3). A removed bill must not inflate a trip's counts or its litres. Its
 * `tripDropId` is deliberately left alone: un-removing it should put it back on
 * the stop it was on, and clearing the pointer here would be a WRITE in a
 * read-only module.
 */
async function loadTripBills(dropIds: number[]): Promise<TripBillRow[]> {
  if (dropIds.length === 0) return [];

  const orders = await prisma.orders.findMany({
    where: { tripDropId: { in: dropIds }, isRemoved: false },
    select: { id: true, tripDropId: true, workflowStage: true },
    orderBy: { id: "asc" },
  });
  if (orders.length === 0) return [];

  const snapshots = await prisma.import_obd_query_summary.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    select: { orderId: true, totalVolume: true },
  });
  const litresByOrderId = new Map<number, number>();
  for (const s of snapshots) {
    if (s.orderId !== null) litresByOrderId.set(s.orderId, s.totalVolume);
  }

  return orders.map((o) => ({
    id: o.id,
    tripDropId: o.tripDropId,
    workflowStage: o.workflowStage,
    // A bill with no snapshot row contributes 0, never null — the same choice
    // lib/floor/queries.ts makes for `volumeLitres` on its own rows.
    litres: litresByOrderId.get(o.id) ?? 0,
  }));
}

/** The trip row shape both readers select. Kept in one place so they cannot drift. */
const TRIP_SELECT = {
  id: true,
  tripNumber: true,
  tripDate: true,
  typeCode: true,
  deliveryTypeId: true,
  seq: true,
  dispatchWindowId: true,
  transporterId: true,
  vehicleId: true,
  adhocVehicleNo: true,
  driverName: true,
  driverPhone: true,
  transporterTripNo: true,
  note: true,
  status: true,
  releasedAt: true,
  dispatchedAt: true,
  cancelledAt: true,
  createdAt: true,
} as const;

type TripRow = {
  id: number;
  tripNumber: string;
  tripDate: Date;
  typeCode: string;
  deliveryTypeId: number;
  seq: number;
  dispatchWindowId: number | null;
  transporterId: number | null;
  vehicleId: number | null;
  adhocVehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  transporterTripNo: string | null;
  note: string | null;
  status: string;
  releasedAt: Date | null;
  dispatchedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
};

/**
 * Resolve the four master-data labels for a page of trips — delivery type,
 * dispatch window, transporter, vehicle.
 *
 * FOUR batched reads, each one `id IN (…)` over the distinct ids actually
 * present. A trip with no vehicle costs nothing: the id never enters the list,
 * so the query is not issued for it. That is precisely what an include chain
 * fails to do (it pays for the null-FK rows too — queue.ts:537-554).
 */
async function loadTripLabels(trips: TripRow[]) {
  const distinct = (ids: Array<number | null>) =>
    Array.from(new Set(ids.filter((id): id is number => id !== null)));

  const deliveryTypeIds = distinct(trips.map((t) => t.deliveryTypeId));
  const windowIds = distinct(trips.map((t) => t.dispatchWindowId));
  const transporterIds = distinct(trips.map((t) => t.transporterId));
  const vehicleIds = distinct(trips.map((t) => t.vehicleId));

  const deliveryTypes = deliveryTypeIds.length
    ? await prisma.delivery_type_master.findMany({
        where: { id: { in: deliveryTypeIds } },
        select: { id: true, name: true },
      })
    : [];
  const windows = windowIds.length
    ? await prisma.dispatch_slot_master.findMany({
        where: { id: { in: windowIds } },
        select: { id: true, windowTime: true },
      })
    : [];
  const transporters = transporterIds.length
    ? await prisma.transporter_master.findMany({
        where: { id: { in: transporterIds } },
        select: { id: true, name: true },
      })
    : [];
  const vehicles = vehicleIds.length
    ? await prisma.vehicle_master.findMany({
        where: { id: { in: vehicleIds } },
        select: { id: true, vehicleNo: true },
      })
    : [];

  return {
    deliveryTypeById: new Map(deliveryTypes.map((r) => [r.id, r.name])),
    windowTimeById: new Map(windows.map((r) => [r.id, r.windowTime])),
    transporterById: new Map(transporters.map((r) => [r.id, r.name])),
    vehicleNoById: new Map(vehicles.map((r) => [r.id, r.vehicleNo])),
  };
}

/** Assemble one summary from a row plus the resolved maps and its own bills. */
function toSummary(
  t: TripRow,
  labels: Awaited<ReturnType<typeof loadTripLabels>>,
  bills: TripBillRow[],
  dropCount: number,
): TripSummary {
  const counts: TripBillCounts = { ...EMPTY_COUNTS };
  let totalLitres = 0;
  for (const b of bills) {
    counts[bucketFor(b.workflowStage)] += 1;
    counts.total += 1;
    totalLitres += b.litres;
  }

  return {
    id: t.id,
    tripNumber: t.tripNumber,
    tripDate: isoDate(t.tripDate),
    typeCode: t.typeCode,
    deliveryTypeId: t.deliveryTypeId,
    deliveryTypeName: labels.deliveryTypeById.get(t.deliveryTypeId) ?? null,
    seq: t.seq,
    dispatchWindowId: t.dispatchWindowId,
    windowTime: t.dispatchWindowId !== null ? (labels.windowTimeById.get(t.dispatchWindowId) ?? null) : null,
    transporterId: t.transporterId,
    transporterName: t.transporterId !== null ? (labels.transporterById.get(t.transporterId) ?? null) : null,
    vehicleId: t.vehicleId,
    vehicleNo: t.vehicleId !== null ? (labels.vehicleNoById.get(t.vehicleId) ?? null) : null,
    adhocVehicleNo: t.adhocVehicleNo,
    driverName: t.driverName,
    driverPhone: t.driverPhone,
    transporterTripNo: t.transporterTripNo,
    note: t.note,
    status: t.status,
    // 🔴 DERIVED. `counts.total > 0` is load-bearing: an EMPTY trip is not
    // ready, it is empty. Without that clause `every bill checked` is
    // vacuously true on a trip with no bills and a brand-new draft would
    // announce itself as ready to leave.
    isReady: counts.total > 0 && counts.checked === counts.total,
    counts,
    totalLitres,
    dropCount,
    releasedAt: t.releasedAt?.toISOString() ?? null,
    dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * Every trip on one day, with its counts and litres.
 *
 * Ordered by (typeCode, seq) — the order the numbers were handed out, which is
 * the order a planner thinks in. Not by status: a board that re-sorts itself as
 * trips progress moves the ground under the operator's hand, which is the same
 * defect FLOOR_SPINE drops `byAssigned` to avoid (FLOOR §3).
 *
 * Sequential awaits, never $transaction. SELECT-only.
 */
export async function getTripsForDate(tripDate: Date): Promise<TripSummary[]> {
  const trips = (await prisma.trips.findMany({
    where: { tripDate },
    select: TRIP_SELECT,
    orderBy: [{ typeCode: "asc" }, { seq: "asc" }],
  })) as TripRow[];
  if (trips.length === 0) return [];

  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    select: { id: true, tripId: true },
  });

  const bills = await loadTripBills(drops.map((d) => d.id));
  const labels = await loadTripLabels(trips);

  const tripIdByDropId = new Map(drops.map((d) => [d.id, d.tripId]));
  const billsByTripId = new Map<number, TripBillRow[]>();
  for (const b of bills) {
    if (b.tripDropId === null) continue;
    const tripId = tripIdByDropId.get(b.tripDropId);
    if (tripId === undefined) continue;
    const arr = billsByTripId.get(tripId) ?? [];
    arr.push(b);
    billsByTripId.set(tripId, arr);
  }
  const dropCountByTripId = new Map<number, number>();
  for (const d of drops) {
    dropCountByTripId.set(d.tripId, (dropCountByTripId.get(d.tripId) ?? 0) + 1);
  }

  return trips.map((t) =>
    toSummary(t, labels, billsByTripId.get(t.id) ?? [], dropCountByTripId.get(t.id) ?? 0),
  );
}

/**
 * One trip, with its drops in `dropSeq` order.
 *
 * ⚠ ORDERED BY `dropSeq`, WHICH MAY HAVE GAPS. Removing the last bill from a
 * stop deletes the drop row and leaves its number unused — uniqueness is on
 * (tripId, dropSeq), never contiguity, and renumbering the survivors would
 * change the stop order a driver may already have been given. Read the sequence
 * as an ORDERING, never as an index.
 *
 * Returns null when the trip does not exist, so the route can 404 rather than
 * inventing an empty trip.
 */
export async function getTripDetail(tripId: number): Promise<TripDetail | null> {
  const trip = (await prisma.trips.findUnique({
    where: { id: tripId },
    select: TRIP_SELECT,
  })) as TripRow | null;
  if (!trip) return null;

  const drops = await prisma.trip_drops.findMany({
    where: { tripId },
    orderBy: { dropSeq: "asc" },
    select: {
      id: true,
      dropSeq: true,
      customerId: true,
      shipToCode: true,
      dropKey: true,
      customerName: true,
      areaName: true,
      routeName: true,
      note: true,
    },
  });

  const bills = await loadTripBills(drops.map((d) => d.id));
  const labels = await loadTripLabels([trip]);

  const billsByDropId = new Map<number, TripBillRow[]>();
  for (const b of bills) {
    if (b.tripDropId === null) continue;
    const arr = billsByDropId.get(b.tripDropId) ?? [];
    arr.push(b);
    billsByDropId.set(b.tripDropId, arr);
  }

  const dropSummaries: TripDropSummary[] = drops.map((d) => {
    const own = billsByDropId.get(d.id) ?? [];
    return {
      id: d.id,
      dropSeq: d.dropSeq,
      customerId: d.customerId,
      shipToCode: d.shipToCode,
      dropKey: d.dropKey,
      customerName: d.customerName,
      areaName: d.areaName,
      routeName: d.routeName,
      note: d.note,
      orderIds: own.map((b) => b.id),
      bills: own.length,
      litres: own.reduce((sum, b) => sum + b.litres, 0),
    };
  });

  return {
    ...toSummary(trip, labels, bills, drops.length),
    drops: dropSummaries,
  };
}
