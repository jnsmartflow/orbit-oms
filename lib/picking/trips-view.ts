// lib/picking/trips-view.ts
//
// THE TRIPS FEED for the supervisor's Assign tab › Trips view (slice 1,
// 2026-10-13). Served by GET /api/picking/trips. Plan:
// docs/prompts/drafts/code-discovery-2026-10-13-assign-trips-view.md (C–I).
//
// 🔴 READ-ONLY. SELECT only, sequential awaits, never prisma.$transaction
// (CORE §3). Nothing here writes trips, trip_drops, trip_activity or orders —
// the live-sync markers key on MAX(orders.updatedAt), so a stray write would
// fire a false "changed" on every board (PICKING §10).
//
// 🔴 IT TOUCHES NOTHING THE PICKING BOARD READS. No term is added to
// buildPickingWhere and getPickingQueue is not called, so the queue, its
// marker and the held-back band cannot move because of this file.
//
// WHICH TRIPS (owner, 2026-10-13):
//   - on TODAY's desk — getTripsForDate(today, today), the Floor rail's own
//     feed, so the desk rule (lib/trips/live-trips.ts: today's trips + earlier
//     trips still holding unfinished work) has one definition;
//   - not cancelled (the rail drops those at render; we drop them here);
//   - gate ON → SHOWN to the floor only (`shownAt` set). The planner made 5
//     trips and showed 3 → the supervisor gets 3;
//   - holding at least one non-removed bill.
//
// WHY A SECOND MEMBER READ when getTripsForDate already reads the bills: the
// summary's buckets cannot tell a DUE waiting bill from a LOCKED upcoming one,
// nor a tint-room bill from a pending_support one, and it does not hand back
// who is on which stop. One more batched orders read gives all three. Its
// counts are built to reconcile with the summary's (PickingTripCounts), and
// scripts/_smoke-picking-trips.ts checks that they do.

import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";
import {
  SUPPORT_DONE_OUTPUT,
  PICK_ASSIGNED,
  PICK_DONE,
  PICK_CHECKED,
  DISPATCHED,
} from "@/lib/workflow-stages";
import { getTripsForDate, getPlaceholderRouteNames, parseTripDate } from "@/lib/trips/queries";
import { TRIP_CANCELLED } from "@/lib/trips/live-trips";
import { formatRouteLabel, type RouteRankItem } from "@/lib/trips/route-label";
import { onStopsWhere, placeOnTrips, stopRowsSelect } from "@/lib/order-invoices/trip-read";
import { isPickGateOn, countHeldBackWaiting, WAITING_FOR_PICKER } from "./visibility-gate";
import { buildPickingWhere } from "./queue";
import type { PickingTrip, PickingTripCounts, PickingTripsResult } from "./types";

/**
 * The tint room's three stages — the same three lib/picking/tint-workload.ts
 * names (module-private there). Written out, never derived from rank, for the
 * reason that file gives: a rank filter would absorb any future stage.
 */
const TINT_ROOM_STAGES: readonly string[] = ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"];

const EMPTY_COUNTS: PickingTripCounts = {
  waiting: 0,
  lockedUpcoming: 0,
  tinting: 0,
  picking: 0,
  needsCheck: 0,
  checked: 0,
  held: 0,
  other: 0,
  total: 0,
};

/** The member columns the buckets need. */
interface MemberBill {
  workflowStage: string;
  dispatchStatus: string | null;
  dispatchTargetDate: Date | null;
  pickEarlyReleasedAt: Date | null;
}

/**
 * One bill's bucket. MIRRORS `bucketFor` (lib/trips/queries.ts) — the hold test
 * first and outranking every stage, dispatched folded into checked — and splits
 * two of its buckets (see PickingTripCounts).
 *
 * The due / upcoming split is the board's own zone rule (lib/picking/queue.ts):
 * a FUTURE dispatch date is upcoming unless early-released; a null date is due.
 * `todayMs` is today's IST date as UTC midnight — the queue's `anchorMs`.
 */
function bucketOf(b: MemberBill, todayMs: number): keyof Omit<PickingTripCounts, "total"> {
  if (b.dispatchStatus === "hold") return "held";
  const stage = b.workflowStage;
  if (stage === SUPPORT_DONE_OUTPUT) {
    const upcoming =
      b.dispatchTargetDate !== null && b.dispatchTargetDate.getTime() > todayMs && b.pickEarlyReleasedAt === null;
    return upcoming ? "lockedUpcoming" : "waiting";
  }
  if (stage === PICK_ASSIGNED) return "picking";
  if (stage === PICK_DONE) return "needsCheck";
  if (stage === PICK_CHECKED || stage === DISPATCHED) return "checked";
  if (TINT_ROOM_STAGES.includes(stage)) return "tinting";
  return "other";
}

/**
 * Every distinct route on the trip, in the order lib/trips/route-label.ts
 * ranks them: most stops first, the first stop reached breaks a tie. Same skips
 * as the label — stops with no bill, blank names, placeholder routes — so the
 * first entry is always the label's main route.
 */
function rankedRoutes(items: readonly RouteRankItem[], placeholders: ReadonlySet<string>): string[] {
  const byName = new Map<string, { count: number; firstOrder: number }>();
  for (const item of items) {
    if (!item.hasBills) continue;
    const name = item.name?.trim();
    if (!name || placeholders.has(name)) continue;
    const cur = byName.get(name);
    if (cur) {
      cur.count += 1;
      cur.firstOrder = Math.min(cur.firstOrder, item.order);
    } else {
      byName.set(name, { count: 1, firstOrder: item.order });
    }
  }
  return Array.from(byName.entries())
    .sort((a, b) => b[1].count - a[1].count || a[1].firstOrder - b[1].firstOrder)
    .map(([name]) => name);
}

/**
 * Today's trips for the supervisor, plus the no-trip waiting count. The gate is
 * read LIVE (isPickGateOn — fails OFF), never taken from a caller, for the
 * reason getPickingQueue gives: a forced answer would show a set no other
 * surface agrees with.
 */
export async function getPickingTrips(): Promise<PickingTripsResult> {
  return buildPickingTrips(await isPickGateOn());
}

/**
 * The builder, with the gate passed in. ⚠ FOR THE SMOKE SCRIPT ONLY
 * (scripts/_smoke-picking-trips.ts runs the gate-OFF path read-only, without
 * flipping the switch). App code calls getPickingTrips above.
 */
export async function buildPickingTrips(gateOn: boolean): Promise<PickingTripsResult> {
  const date = getTodayIST();
  const today = parseTripDate(date);
  const todayMs = today.getTime();

  // ── 1. The desk — the Floor rail's feed, then the owner's three filters ───
  // `counts.total` is over the trip's non-removed bills (loadTripBills), the
  // same set the member read below returns.
  const summaries = (await getTripsForDate(today, today)).filter(
    (t) => t.status !== TRIP_CANCELLED && (!gateOn || t.shownAt !== null) && t.counts.total > 0,
  );

  // ── 2. The no-trip count (owner: a count, never a list) ────────────────────
  // Gate ON: the queue's own helper and its own ungated where — so this is the
  // band's "N not planned yet", by construction. Gate OFF: every waiting bill
  // on no trip (orders."tripDropId" null — exact for "on ANY trip", see
  // waitingBranchWhere), all of which the Bills view shows.
  const notOnTripBills = gateOn
    ? (await countHeldBackWaiting(buildPickingWhere({ scope: "openPending" }).where, true)).unplanned
    : await prisma.orders.count({ where: { AND: [WAITING_FOR_PICKER, { tripDropId: null }] } });

  if (summaries.length === 0) {
    return { date, gateOn, trips: [], notOnTrip: { bills: notOnTripBills, notPlannedYet: gateOn } };
  }
  const tripIds = summaries.map((t) => t.id);

  // ── 3. Stops — dropSeq for the members, routeName for the route list ───────
  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: tripIds } },
    select: { id: true, tripId: true, dropSeq: true, routeName: true },
  });
  const dropIds = drops.map((d) => d.id);
  const tripIdOfDrop = new Map(drops.map((d) => [d.id, d.tripId] as const));
  const dropSeqOf = new Map(drops.map((d) => [d.id, d.dropSeq] as const));

  // ── 4. Members — THROUGH THE INVOICE ROWS (v27.66), every stage ────────────
  // One entry per (OBD, trip), on the stop of its lowest-seq row there — the
  // reader lib/trips/queries.ts loadTripBills uses, so the set matches the
  // summary's. `isRemoved: false` per CORE §3; no stage filter on purpose
  // (tint and dispatched bills are members too — discovery H).
  const found = await prisma.orders.findMany({
    where: { ...onStopsWhere(dropIds), isRemoved: false },
    select: {
      id: true,
      workflowStage: true,
      dispatchStatus: true,
      dispatchTargetDate: true,
      pickEarlyReleasedAt: true,
      invoices: stopRowsSelect(dropIds),
    },
    orderBy: { id: "asc" },
  });
  const placed = placeOnTrips(found, tripIdOfDrop);

  // ── 5. Re-delivery stops — so the route list skips the same stops the label
  // does (a re-delivery-only stop counts as carrying a bill, queries.ts).
  const redeliveries = await prisma.trip_redeliveries.findMany({
    where: { tripId: { in: tripIds } },
    select: { tripDropId: true },
  });

  // ── 6. Window sortOrder (not on the summary) and the placeholder routes ───
  const windowIds = Array.from(
    new Set(summaries.map((t) => t.dispatchWindowId).filter((id): id is number => id !== null)),
  );
  const windows = windowIds.length
    ? await prisma.dispatch_slot_master.findMany({
        where: { id: { in: windowIds } },
        select: { id: true, sortOrder: true },
      })
    : [];
  const sortOrderOf = new Map(windows.map((w) => [w.id, w.sortOrder] as const));
  const placeholders = new Set(await getPlaceholderRouteNames());

  // ── Assemble, in memory ────────────────────────────────────────────────────
  const countsByTrip = new Map<number, PickingTripCounts>();
  const membersByTrip = new Map<number, Array<{ orderId: number; dropSeq: number }>>();
  for (const b of placed) {
    const counts = countsByTrip.get(b.tripId) ?? { ...EMPTY_COUNTS };
    counts[bucketOf(b, todayMs)] += 1;
    counts.total += 1;
    countsByTrip.set(b.tripId, counts);
    const members = membersByTrip.get(b.tripId) ?? [];
    members.push({ orderId: b.id, dropSeq: dropSeqOf.get(b.tripDropId) ?? 0 });
    membersByTrip.set(b.tripId, members);
  }

  const stopsWithBills = new Set<number>(placed.map((b) => b.tripDropId));
  for (const r of redeliveries) stopsWithBills.add(r.tripDropId);
  const rankItemsByTrip = new Map<number, RouteRankItem[]>();
  for (const d of drops) {
    const items = rankItemsByTrip.get(d.tripId) ?? [];
    items.push({ name: d.routeName, order: d.dropSeq, hasBills: stopsWithBills.has(d.id) });
    rankItemsByTrip.set(d.tripId, items);
  }

  const trips: PickingTrip[] = summaries.map((t) => ({
    id: t.id,
    tripNumber: t.tripNumber,
    tripDate: t.tripDate,
    typeCode: t.typeCode,
    deliveryTypeName: t.deliveryTypeName,
    cutoff: t.windowTime,
    cutoffSortOrder: t.dispatchWindowId !== null ? (sortOrderOf.get(t.dispatchWindowId) ?? null) : null,
    // The summary's own ranked route, printed by the shared formatter — never
    // re-ranked here, so it is the Floor rail's label character for character.
    routeLabel: formatRouteLabel(t.routeName !== null ? { name: t.routeName, others: t.routeExtraCount } : null),
    routes: rankedRoutes(rankItemsByTrip.get(t.id) ?? [], placeholders),
    stops: t.dropCount,
    vehiclePlate: t.vehicleNo ?? t.adhocVehicleNo ?? null,
    driverName: t.driverName,
    driverPhone: t.driverPhone,
    isHand: t.isHand,
    shownAt: t.shownAt,
    counts: countsByTrip.get(t.id) ?? { ...EMPTY_COUNTS },
    members: (membersByTrip.get(t.id) ?? []).sort((a, b) => a.dropSeq - b.dropSeq || a.orderId - b.orderId),
  }));

  // Cutoff slot order (no window last), then trip number.
  trips.sort((a, b) => {
    const sa = a.cutoffSortOrder ?? Number.MAX_SAFE_INTEGER;
    const sb = b.cutoffSortOrder ?? Number.MAX_SAFE_INTEGER;
    return sa - sb || a.tripNumber.localeCompare(b.tripNumber, "en");
  });

  return { date, gateOn, trips, notOnTrip: { bills: notOnTripBills, notPlannedYet: gateOn } };
}
