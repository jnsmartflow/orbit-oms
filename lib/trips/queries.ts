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
// 🔴 THE ROUTE/AREA RANKING LIVES IN ONE PLACE (2026-09-16) — a pure module the
// CLIENT can import too, so the rail card-s label and the pool-s add hint cannot
// drift apart. PLACEHOLDER_ROUTE_IDS moved there with it.
import {
  rankRouteName,
  formatRouteLabel,
  PLACEHOLDER_ROUTE_IDS,
  type RouteRank,
  type RouteRankItem,
} from "@/lib/trips/route-label";

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
  /**
   * Where the load is going, DERIVED from its stops — "Katargam", or
   * "Katargam +2" when they span three areas (slice 6, 2026-09-15). Nobody types
   * it. See `deriveAreaLabel` for the rule.
   *
   * ⚠ NULL ON AN EMPTY TRIP, and on a trip whose every stop lacks an area. The
   * card shows nothing in that slot: an empty trip already says "No bills yet",
   * and saying it twice is noise.
   */
  areaLabel: string | null;
  /**
   * The ROUTE the load mostly runs, and how many other routes it touches
   * (floor redesign, 2026-09-15). `deriveRouteLabel` — the area label's rule.
   * Null / 0 when no stop with a bill has a route; the screen says "No route".
   */
  routeName: string | null;
  routeExtraCount: number;
  /** `vehicle_master.category` ("Tata 407") for a master vehicle; null for a typed plate or none. */
  vehicleCategory: string | null;
  /**
   * Total weight of the trip's non-removed bills, kg, from the same
   * import_obd_query_summary read as the litres. A bill with no snapshot row adds
   * nothing and is counted in `weightUnknownCount`, so the screen can tell a
   * true total from a partial one.
   */
  totalWeightKg: number;
  weightUnknownCount: number;
  releasedAt: string | null;
  dispatchedAt: string | null;
  cancelledAt: string | null;
  /**
   * When the desk showed this trip to the floor (slice 8), or null. With desk
   * control on, the trip's WAITING bills are on the supervisor's Assign tab only
   * once this is set. Meaningless while desk control is off — every waiting bill
   * is visible then — so screens read it together with the switch.
   */
  shownAt: string | null;
  /**
   * When the planner sent this trip to billing's Print tab (slice 9), or null.
   * `billingCopiedAt` is billing's latest Copy there. Take-back is refused once
   * it is set (lib/trips/billing.ts).
   */
  sentToBillingAt: string | null;
  billingCopiedAt: string | null;
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
  /** kg from the snapshot; null when the bill has no snapshot row. */
  weightKg: number | null;
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
    // totalWeight rides the same read as the litres — one more column, no
    // extra statement (floor redesign, 2026-09-15).
    select: { orderId: true, totalVolume: true, totalWeight: true },
  });
  const weightByOrderId = new Map<number, number>();
  for (const s of snapshots) {
    if (s.orderId !== null) weightByOrderId.set(s.orderId, s.totalWeight);
  }
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
    // NULL, not 0, when there is no snapshot — the summary counts it as unknown.
    weightKg: weightByOrderId.get(o.id) ?? null,
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
  shownAt: true,
  sentToBillingAt: true,
  billingCopiedAt: true,
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
  shownAt: Date | null;
  sentToBillingAt: Date | null;
  billingCopiedAt: Date | null;
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
        // `category` rides the same read (floor redesign, 2026-09-15).
        select: { id: true, vehicleNo: true, category: true },
      })
    : [];
  // The current names of the placeholder routes (PLACEHOLDER_ROUTE_IDS). One
  // primary-key read on a ~25-row table, per feed.
  const placeholderRoutes = await prisma.route_master.findMany({
    where: { id: { in: [...PLACEHOLDER_ROUTE_IDS] } },
    select: { name: true },
  });

  return {
    deliveryTypeById: new Map(deliveryTypes.map((r) => [r.id, r.name])),
    windowTimeById,
    transporterById,
    vehicleNoById: new Map(vehicles.map((r) => [r.id, r.vehicleNo])),
    vehicleCategoryById: new Map(vehicles.map((r) => [r.id, r.category])),
    placeholderRouteNames: new Set(placeholderRoutes.map((r) => r.name.trim())),
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

/** One stop, as much of it as the area label needs. */
interface AreaStop {
  areaName: string | null;
  /** `trip_drops.routeName`, a snapshot like `areaName`. */
  routeName: string | null;
  dropSeq: number;
  /** Does at least one live bill sit on this stop? */
  hasBills: boolean;
}

/**
 * The trip's area, from its stops (slice 6, 2026-09-15 — owner's rule).
 *
 *   - only stops that CARRY A BILL count: the area is derived from the orders
 *     inside, and an empty trip has none
 *   - blank areas are ignored
 *   - the area with the MOST STOPS is named; a tie goes to the one reached
 *     first (lowest dropSeq)
 *   - every other distinct area is counted into "+N"
 *   - null when nothing is left to name
 *
 * ⚠ `trip_drops.areaName` IS A SNAPSHOT taken when the stop was created
 * (bills/route.ts). Measured 2026-09-15: 0 of 228 stops differ from their
 * customer's current area, so it is safe to read without a join.
 *
 * PURE — exported so a test can check the rule without a database.
 */
export function deriveAreaLabel(stops: readonly AreaStop[]): string | null {
  return formatRouteLabel(rankRouteName(toRankItems(stops, (s) => s.areaName)));
}

/**
 * The trip's ROUTE, from its stops (floor redesign, 2026-09-15 — owner's rule).
 *
 * 🔴 THE SAME RULE AS THE AREA, ON PURPOSE (owner): most stops wins, the first
 * stop reached breaks a tie, stops with no bill or no route are skipped, every
 * other distinct route is counted. Two different rules for area and route on one
 * trip would eventually disagree and read as a bug. Returned as two parts because
 * the screen greys the "+N".
 *
 * PURE — exported so a test can check the rule without a database.
 */
export function deriveRouteLabel(
  stops: readonly AreaStop[],
  placeholderNames: ReadonlySet<string> = new Set(),
): RouteRank | null {
  return rankRouteName(toRankItems(stops, (s) => s.routeName), placeholderNames);
}

/**
 * The CURRENT names of the placeholder routes, for callers that rank bills
 * rather than stops (2026-09-16).
 *
 * 🔴 THE CLIENT NEEDS THEM TOO. The pool's add hint ranks the SELECTED BILLS,
 * client-side, and must skip exactly the routes the rail card's label skips —
 * so the trips feed hands this set down with the trips and floor-page passes it
 * into the same shared ranker. Resolving ids to names stays server-side, where
 * the ids mean something.
 */
export async function getPlaceholderRouteNames(): Promise<string[]> {
  const rows = await prisma.route_master.findMany({
    where: { id: { in: [...PLACEHOLDER_ROUTE_IDS] } },
    select: { name: true },
  });
  return rows.map((r) => r.name.trim());
}

/** A trip-s stops as the shared ranker takes them: one item per stop, in visit order. */
function toRankItems(stops: readonly AreaStop[], pick: (s: AreaStop) => string | null): RouteRankItem[] {
  return stops.map((s) => ({ name: pick(s), order: s.dropSeq, hasBills: s.hasBills }));
}

/** Assemble one summary from a row plus the resolved maps and its own bills. */
function toSummary(
  t: TripRow,
  labels: Awaited<ReturnType<typeof loadTripLabels>>,
  bills: TripBillRow[],
  dropCount: number,
  areaStops: readonly AreaStop[],
): TripSummary {
  const counts: TripBillCounts = { ...EMPTY_COUNTS };
  let totalLitres = 0;
  // Counted in the SAME pass, off the stage the bucket already reads — no extra
  // query, no extra column fetched. See `dispatchedCount` on TripSummary for why
  // it rides beside `counts` instead of inside it.
  let dispatchedCount = 0;
  let totalWeightKg = 0;
  let weightUnknownCount = 0;
  for (const b of bills) {
    counts[bucketFor(b.workflowStage, b.dispatchStatus)] += 1;
    counts.total += 1;
    if (b.workflowStage === DISPATCHED) dispatchedCount += 1;
    totalLitres += b.litres;
    if (b.weightKg === null) weightUnknownCount += 1;
    else totalWeightKg += b.weightKg;
  }
  const route = deriveRouteLabel(areaStops, labels.placeholderRouteNames);

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
    areaLabel: deriveAreaLabel(areaStops),
    routeName: route?.name ?? null,
    routeExtraCount: route?.others ?? 0,
    vehicleCategory: t.vehicleId !== null ? (labels.vehicleCategoryById.get(t.vehicleId) ?? null) : null,
    totalWeightKg,
    weightUnknownCount,
    releasedAt: t.releasedAt?.toISOString() ?? null,
    dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
    shownAt: t.shownAt?.toISOString() ?? null,
    sentToBillingAt: t.sentToBillingAt?.toISOString() ?? null,
    billingCopiedAt: t.billingCopiedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * The trips a desk dated `tripDate` shows, when today is `todayDate` (both
 * UTC-midnight). THE RULE IS NOT HERE — it is `tripsOnDeskWhere`
 * (lib/trips/live-trips.ts), shared with the board's fourth arm and, through it,
 * the 15-second marker.
 *
 *   - a LIVE desk (today): the day's own trips, plus any trip from an earlier
 *     day that still holds a bill that is not done (done = checked, or on hold).
 *   - a HISTORY desk (a past day): trips dated that day ONLY.
 *
 * 🔴 SLICE 10 (2026-09-15) REPLACED THE DRAFT-CARRY RULE. This used to carry
 * every still-open DRAFT onto every later day and drop everything else at
 * midnight. The trapped-draft bug of 2026-09-11 (a past-dated draft was
 * unreachable, its bills stranded off the pool and off every sweep) stays
 * closed: a trip with work left on it follows the planner forward. What changed
 * is what counts as work — the bills inside, never the trip's status.
 *
 * ⚠ A CARRIED TRIP KEEPS ITS REAL `tripDate`. Nothing here rewrites it, and the
 * rail renders it, so it reads as old rather than as today's — which is the
 * point. A trip silently relabelled today would hide exactly the staleness the
 * planner needs to see.
 *
 * ⚠ CANCELLED trips ARE in the payload for the day they are dated (the rail
 * drops them at render; see liveTripsOnDeskWhere for why), and a cancelled trip
 * from an earlier day is never carried — cancel detaches its bills.
 *
 * Sequential awaits, never $transaction. SELECT-only.
 */
export async function getTripsForDate(tripDate: Date, todayDate: Date): Promise<TripSummary[]> {
  const trips = (await prisma.trips.findMany({
    // 🔴 THE RULE LIVES IN lib/trips/live-trips.ts (2026-09-13), shared with the
    // board's trip arm so the rail and the board can never disagree about which
    // trips are on the desk. Slice 10 changed the rule there, not here.
    where: tripsOnDeskWhere(tripDate, todayDate),
    select: TRIP_SELECT,
    // 🔴 NEWEST CREATED FIRST (slice 6, 2026-09-15). The rail and the Add-to-trip
    // list both read this order. NOT the trip number: since slice 5 a cancelled
    // trip gives its number back, so a trip made at 3pm can hold seq 5 and
    // number order no longer matches creation order. `id` breaks a same-instant
    // tie so the order is stable across reloads. A carried draft was created
    // earliest, so it now sits at the BOTTOM — its date chip still says so.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  })) as TripRow[];
  if (trips.length === 0) return [];

  // `areaName` and `dropSeq` ride this same read for the derived area label —
  // two more columns, no extra statement on the board's feed.
  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    select: { id: true, tripId: true, areaName: true, routeName: true, dropSeq: true },
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
  const dropIdsWithBills = new Set(bills.map((b) => b.tripDropId));
  const areaStopsByTripId = new Map<number, AreaStop[]>();
  for (const d of drops) {
    dropCountByTripId.set(d.tripId, (dropCountByTripId.get(d.tripId) ?? 0) + 1);
    const arr = areaStopsByTripId.get(d.tripId) ?? [];
    arr.push({
      areaName: d.areaName,
      routeName: d.routeName,
      dropSeq: d.dropSeq,
      hasBills: dropIdsWithBills.has(d.id),
    });
    areaStopsByTripId.set(d.tripId, arr);
  }

  return trips.map((t) =>
    toSummary(
      t,
      labels,
      billsByTripId.get(t.id) ?? [],
      dropCountByTripId.get(t.id) ?? 0,
      areaStopsByTripId.get(t.id) ?? [],
    ),
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
    ...toSummary(
      trip,
      labels,
      bills,
      drops.length,
      drops.map((d) => ({
        areaName: d.areaName,
        routeName: d.routeName,
        dropSeq: d.dropSeq,
        hasBills: (billsByDropId.get(d.id)?.length ?? 0) > 0,
      })),
    ),
    drops: dropSummaries,
    activity,
  };
}
