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
  DISPATCHED,
} from "@/lib/workflow-stages";
// The ONE definition of which trips a day's desk is about. Shared with the
// board's trip arm (lib/floor/queries.ts) so the rail and the board cannot
// disagree about it again — read that module's header before changing the rule.
import { tripsOnDeskWhere } from "@/lib/trips/live-trips";
import { getTripActivity, type TripActivityRow } from "@/lib/trips/activity";

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
  /**
   * A human said "not this one" — `orders.dispatchStatus = 'hold'`, whatever the
   * stage (2026-09-14).
   *
   * 🔴 IT EXISTS BECAUSE A HELD BILL USED TO PIN A TRIP OPEN FOREVER. `bucketFor`
   * read only the STAGE and `loadTripBills` did not even fetch the status, so a
   * bill held at `pending_picking` counted as `waiting`. `isReady` is "every bill
   * checked", a held bill never reaches `pick_checked`, and the trip could
   * therefore never report ready — waiting on a decision somebody had already
   * made in the other direction.
   *
   * ⚠ IT OUTRANKS THE STAGE, not the other way round. A hold is a human
   * instruction and it is true at every rung of the ladder.
   */
  held: number;
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
  /**
   * How many of this trip's bills have actually LEFT — `workflowStage`
   * 'dispatched' (2026-09-13).
   *
   * 🔴 A SEPARATE FIGURE, NOT A SIXTH BUCKET, AND THAT IS DELIBERATE.
   * `counts.checked` folds `dispatched` into `checked` on purpose — read
   * `bucketFor` for why `isReady` and the progress bar depend on it — so
   * `counts` alone cannot tell "checked, still here" from "checked and gone".
   * Splitting the bucket would change what the bar means on every trip surface;
   * adding one number beside it changes nothing and answers the question.
   *
   * ⚠ WHAT IT IS FOR. Confirming a trip marks its checked bills dispatched and
   * leaves anything still being picked exactly where it is (lib/floor/dispatch
   * .ts). That skip is rare — one trip in 55, measured 2026-09-13 — so it must
   * be visible on the TRIP afterwards, not only in a toast the operator has
   * already dismissed. `counts.total - dispatchedCount` on a confirmed trip is
   * exactly "how many did not go", and unlike a buckets-based guess it also
   * catches a HELD bill at `pick_checked`, which sits in `checked` and is never
   * dispatched.
   */
  dispatchedCount: number;
  totalLitres: number;
  dropCount: number;
  releasedAt: string | null;
  dispatchedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface TripDetail extends TripSummary {
  drops: TripDropSummary[];
  /**
   * The trip's own history, oldest first (2026-09-14, slice 2).
   *
   * ⚠ ON THE DETAIL PATH ONLY, NEVER ON THE BOARD. getTripsForDate does not
   * fetch this and must not — the board's statement count is fought over every
   * week, and nobody reads a history they have not opened a trip to see.
   */
  activity: TripActivityRow[];
}

const EMPTY_COUNTS: TripBillCounts = {
  waiting: 0,
  withPicker: 0,
  picked: 0,
  checked: 0,
  held: 0,
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
function bucketFor(stage: string, dispatchStatus: string | null): keyof Omit<TripBillCounts, "total"> {
  // 🔴 THE HOLD TEST IS FIRST AND IT OUTRANKS EVERY STAGE (2026-09-14). Hold is a
  // STATUS, not a rung — a held bill can sit at any stage, including
  // `pick_checked` — so a stage-only test both mislabels it and, through
  // `isReady`, pinned the whole trip open. See TripBillCounts.held.
  if (dispatchStatus === "hold") return "held";
  if (stage === SUPPORT_DONE_OUTPUT) return "waiting";
  if (stage === PICK_ASSIGNED) return "withPicker";
  if (stage === PICK_DONE) return "picked";
  // 🔴 DISPATCHED COUNTS AS CHECKED, AND `isReady` IS WHY (2026-09-11). A
  // shipped bill passed through checking; it did not stop being finished by
  // leaving. `isReady` is `counts.total > 0 && counts.checked === counts.total`,
  // so a dispatched bill landing in `other` would drop `checked` below `total`
  // and a fully-finished trip would report NOT ready. Worse on screen: the rail
  // folds `other` into `waiting` (toStatusCounts, trip-rail.tsx), so that trip
  // would show a fully GREY bar while every bill on it had shipped. Four live
  // draft trips were in exactly that position when this was written.
  //
  // ⚠ THE TWO STAGES ARE NOT MERGED ANYWHERE ELSE. Floor History keeps them
  // distinct and shows a separate "Dispatched" pill; only this bucket treats
  // them as one, because the question a trip asks is "is every bill on this load
  // finished", and both answers to that are yes.
  if (stage === PICK_CHECKED || stage === DISPATCHED) return "checked";
  return "other";
}

/** The bill rows both readers need, already narrowed. */
interface TripBillRow {
  id: number;
  tripDropId: number | null;
  workflowStage: string;
  /**
   * `orders.dispatchStatus` — 'dispatch' | 'hold' | null.
   *
   * ⚠ FETCHED SINCE 2026-09-14 AND NOT BEFORE. Without it `bucketFor` could not
   * see a hold at all, which is how a held bill came to count as waiting. Same
   * query, one more column, no extra read.
   */
  dispatchStatus: string | null;
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
    select: { id: true, tripDropId: true, workflowStage: true, dispatchStatus: true },
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
    dispatchStatus: o.dispatchStatus,
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
  const { windowTimeById, transporterById } = await loadSlotAndTransporterNames(
    windowIds,
    transporterIds,
  );
  const vehicles = vehicleIds.length
    ? await prisma.vehicle_master.findMany({
        where: { id: { in: vehicleIds } },
        select: { id: true, vehicleNo: true },
      })
    : [];

  return {
    deliveryTypeById: new Map(deliveryTypes.map((r) => [r.id, r.name])),
    windowTimeById,
    transporterById,
    vehicleNoById: new Map(vehicles.map((r) => [r.id, r.vehicleNo])),
  };
}

/**
 * The slot's time and the transporter's name, by id — the two words the trip
 * header prints (`windowTime`, `transporterName`).
 *
 * 🔴 ONE RESOLVER FOR THE HEADER AND THE ACTIVITY LOG (2026-09-14). The PATCH
 * route calls this to word its `details_changed` summary, so "Slot set to 18:00"
 * in the history and "· 18:00" in the header are read from the same column by
 * the same query and cannot disagree. Word either one from a different column
 * (`dispatch_slot_master.label`, say) and they will.
 *
 * Batched `id IN (…)`; an empty id list issues no query.
 */
export async function loadSlotAndTransporterNames(
  windowIds: number[],
  transporterIds: number[],
): Promise<{ windowTimeById: Map<number, string>; transporterById: Map<number, string> }> {
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
  return {
    windowTimeById: new Map(windows.map((r) => [r.id, r.windowTime])),
    transporterById: new Map(transporters.map((r) => [r.id, r.name])),
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
  // Counted in the SAME pass, off the stage the bucket already reads — no extra
  // query, no extra column fetched. See `dispatchedCount` on TripSummary for why
  // it rides beside `counts` instead of inside it.
  let dispatchedCount = 0;
  for (const b of bills) {
    counts[bucketFor(b.workflowStage, b.dispatchStatus)] += 1;
    counts.total += 1;
    if (b.workflowStage === DISPATCHED) dispatchedCount += 1;
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
    // 🔴 HELD BILLS ARE OUT OF THE MATHS (2026-09-14). Ready means every bill
    // that is GOING is finished; a held bill is not going, and leaving it in the
    // denominator meant one hold could keep a finished load from ever reporting
    // ready. `counts.total > 0` is still load-bearing for the empty trip, and a
    // trip of nothing BUT holds is deliberately not ready either — there is
    // nothing on it to send.
    isReady:
      counts.total > 0 &&
      counts.total - counts.held > 0 &&
      counts.checked === counts.total - counts.held,
    counts,
    dispatchedCount,
    totalLitres,
    dropCount,
    releasedAt: t.releasedAt?.toISOString() ?? null,
    dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * Every trip on one day, PLUS every still-open draft from an earlier one.
 *
 * Ordered by (typeCode, seq) — the order the numbers were handed out, which is
 * the order a planner thinks in. Not by status: a board that re-sorts itself as
 * trips progress moves the ground under the operator's hand, which is the same
 * defect FLOOR_SPINE drops `byAssigned` to avoid (FLOOR §3).
 *
 * ── 🔴 THE TRAPPED-DRAFT BUG, FIXED 2026-09-11 ─────────────────────────────
 *
 * This read `where: { tripDate }` alone, and a draft dated in the past was
 * UNREACHABLE. Past days are read-only on the floor board, so such a trip could
 * never be cancelled, edited or confirmed — and its bills were stranded twice
 * over: off the pool (they carry a `tripDropId`) and off every sweep (they are
 * on a trip). Four of them had to be cleared by raw SQL on 2026-09-11.
 *
 * An OPEN DRAFT therefore follows the planner forward. It is unfinished work and
 * unfinished work carries — the same rule `floorCarriedPoolWhere` applies to
 * bills (lib/floor/queries.ts). A RELEASED trip does NOT: it is a decision that
 * was made, it belongs to the day it was made on, and it drops off after it.
 *
 * ⚠ THE OLD DRAFT KEEPS ITS REAL `tripDate`. Nothing here rewrites it, and the
 * rail renders it, so it reads as old rather than as today's — which is the
 * point. A trip silently relabelled today would hide exactly the staleness the
 * planner needs to see.
 *
 * ⚠ CANCELLED AND DISPATCHED ARE NOT CARRIED. Both are finished states. A
 * cancelled trip keeps its number so the allocator can never reissue it, but it
 * is not work and does not follow anyone forward.
 *
 * ⚠ HISTORY IS UNAFFECTED. A past day asked for its own date still gets its own
 * trips; this arm only ADDS open drafts, and by definition a day in the past
 * has none that are older than itself and still open unless they are genuinely
 * stale — in which case the planner should see them there too.
 *
 * Sequential awaits, never $transaction. SELECT-only.
 */
export async function getTripsForDate(tripDate: Date): Promise<TripSummary[]> {
  const trips = (await prisma.trips.findMany({
    // 🔴 THE RULE MOVED OUT, IT DID NOT CHANGE (2026-09-13). This used to spell
    // out "tripDate = D, OR an open draft older than D" inline. It now comes
    // from lib/trips/live-trips.ts, because the board's trip arm needs the SAME
    // answer and the two spellings had already drifted: the board said
    // `tripDate >= today`, so it refused the bills of every carried draft this
    // feed was busy putting on the rail. 22 trips and 105 bills on the morning
    // of 2026-09-13. Same set as before, one owner now.
    where: tripsOnDeskWhere(tripDate),
    select: TRIP_SELECT,
    // tripDate leads so a carried draft sorts ABOVE the day's own trips rather
    // than interleaving with them by type — it is older, and it reads as older.
    orderBy: [{ tripDate: "asc" }, { typeCode: "asc" }, { seq: "asc" }],
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
  // Two more statements, on a fetch that runs when a planner opens ONE trip.
  // See TripDetail.activity — deliberately absent from the board feed.
  const activity = await getTripActivity(tripId);

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
    activity,
  };
}
