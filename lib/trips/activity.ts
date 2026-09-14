// lib/trips/activity.ts
//
// THE TRIP'S STORY. One row per action, one writer, one vocabulary.
//
// 🔴 WHY IT EXISTS. Before this, a trip remembered four moments — created,
// released, dispatched, cancelled — each a pair of columns on `trips`, each
// written once. Everything in between was invisible: who swapped the van, when
// a bill joined the load, how often the slot moved, who edited the note. The
// only trace an edit left was `updatedAt`, which says something changed without
// saying what, and is overwritten by the next edit.
//
// 🔴 AND ONE ERASURE THIS FIXES OUTRIGHT. Cancelling a trip sets `tripDropId`
// to null on every bill, so after a cancel there was NO record of which bills
// were ever on it. 49 cancelled trips are in that state and nothing here
// backfills them — see `logTripCancelled`, which captures the OBD numbers
// BEFORE the detach loop runs.
//
// ⚠ THE STAMPS ON `trips` STAY. releasedAt/releasedById and the rest are
// untouched, nothing was migrated off them, and this table does not replace
// them. It records the story BETWEEN them.
//
// ⚠ ONE ROW PER PRESS, NEVER PER BILL. Attaching 40 bills writes ONE row
// carrying 40 ids. The reasoning is the one bills/route.ts already gives for
// writing no `order_status_logs` rows on that path: a row per bill buries the
// events somebody actually reads back.
//
// ⚠ NEVER THROWS INTO THE CALLER. See `writeActivity` — a logging failure must
// not turn a successful cancel into a 500. The action already happened; losing
// the note about it is bad, losing the caller's answer is worse.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// THE VOCABULARY
//
// 🔴 IMPORT THESE, NEVER RETYPE THE LITERAL (CORE §3's status-string rule). A
// hand-typed action passes every type check and is refused by
// chk_trip_activity_action at the database — the right failure, but the constant
// is why it never gets that far.
// ─────────────────────────────────────────────────────────────────────────────

export const TRIP_CREATED = "created";
export const TRIP_BILLS_ADDED = "bills_added";
export const TRIP_BILLS_REMOVED = "bills_removed";
export const TRIP_VEHICLE_CHANGED = "vehicle_changed";
export const TRIP_DETAILS_CHANGED = "details_changed";
export const TRIP_CANCELLED_ACTION = "cancelled";

/**
 * ⚠ THESE TWO ARE TEMPORARY WRITERS AND THAT IS PLANNED, NOT A DEFECT.
 *
 * Slice 3 deletes the release route entirely; slice 4 deletes Mark dispatched.
 * Both writers vanish with the routes they live in, and the cleanup is free
 * because the whole file goes.
 *
 * 🔴 THE ACTIONS STAY IN THIS LIST AFTERWARDS, and must stay in the CHECK too.
 * Rows written today outlive their writers, and a log that stops explaining its
 * own old rows is worse than one carrying two retired verbs. Do NOT remove
 * these constants when the routes go — delete the call sites only.
 */
export const TRIP_RELEASED = "released";
export const TRIP_DISPATCHED = "dispatched";

/** Every value `chk_trip_activity_action` admits. The CHECK is the backstop. */
export const TRIP_ACTIONS = [
  TRIP_CREATED,
  TRIP_BILLS_ADDED,
  TRIP_BILLS_REMOVED,
  TRIP_VEHICLE_CHANGED,
  TRIP_DETAILS_CHANGED,
  TRIP_CANCELLED_ACTION,
  TRIP_RELEASED,
  TRIP_DISPATCHED,
] as const;

export type TripAction = (typeof TRIP_ACTIONS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// THE WRITER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write one activity row.
 *
 * 🔴 SWALLOWS ITS OWN FAILURE, DELIBERATELY. Every caller has already performed
 * the real write — the trip exists, the bills moved, the vehicle changed. If
 * this insert fails, the honest outcome is a trip with a gap in its history, not
 * a 500 on an action that succeeded. The failure is logged to the server console
 * where it is visible, and the caller is never told, because there is nothing
 * the caller could usefully do about it.
 *
 * ⚠ THE ONE EXCEPTION IS A MISSING TABLE, and it will look exactly like this:
 * every call failing with P2021. Slice 2's SQL creates `trip_activity`; deploy
 * the code AFTER running it, not before.
 */
async function writeActivity(opts: {
  tripId: number;
  action: TripAction;
  actorId: number;
  summary: string;
  detail?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.trip_activity.create({
      data: {
        tripId: opts.tripId,
        action: opts.action,
        actorId: opts.actorId,
        summary: opts.summary,
        ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
      },
    });
  } catch (err) {
    console.error(
      `[trip-activity] could not log ${opts.action} on trip ${opts.tripId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** "3 bills" / "1 bill" — the count phrase every summary below shares. */
function bills(n: number): string {
  return `${n} bill${n === 1 ? "" : "s"}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE FUNCTION PER ACTION
//
// The summary is written HERE and nowhere else, so the panel, the short line and
// any future export all read the same sentence. A caller supplies facts, never
// wording.
// ─────────────────────────────────────────────────────────────────────────────

/** A trip was built. Its number and vehicle are the facts worth keeping. */
export async function logTripCreated(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
  tripDate: string;
  vehicleLabel: string | null;
  windowLabel: string | null;
}): Promise<void> {
  const where = opts.vehicleLabel ? ` · ${opts.vehicleLabel}` : " · no vehicle yet";
  const when = opts.windowLabel ? ` · ${opts.windowLabel}` : " · no slot yet";
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_CREATED,
    actorId: opts.actorId,
    summary: `Trip ${opts.tripNumber} created${where}${when}`,
    detail: {
      tripNumber: opts.tripNumber,
      tripDate: opts.tripDate,
      vehicleLabel: opts.vehicleLabel,
      windowLabel: opts.windowLabel,
    },
  });
}

/**
 * Bills joined or left the trip. ONE row per press.
 *
 * ⚠ `orderIds` IS WHAT ACTUALLY MOVED, not what was asked for. A bill the route
 * skipped (already on this stop) or refused (on another trip) is not in it, and
 * must not be — the log is a record of what happened.
 */
export async function logTripBills(opts: {
  tripId: number;
  actorId: number;
  direction: "add" | "remove";
  orderIds: number[];
  obdNumbers: string[];
}): Promise<void> {
  if (opts.orderIds.length === 0) return; // nothing happened, nothing to say
  const added = opts.direction === "add";
  await writeActivity({
    tripId: opts.tripId,
    action: added ? TRIP_BILLS_ADDED : TRIP_BILLS_REMOVED,
    actorId: opts.actorId,
    summary: `${bills(opts.orderIds.length)} ${added ? "added to" : "removed from"} the trip`,
    detail: { orderIds: opts.orderIds, obdNumbers: opts.obdNumbers },
  });
}

/**
 * The van changed, or was set for the first time.
 *
 * ⚠ BOTH SIDES ARE RECORDED. "Changed the vehicle" answers nothing a month
 * later; "GJ05AB1234 → GJ05XY9999" answers it completely, and section 9 of the
 * discovery report names the missing before-value as the specific gap.
 */
export async function logTripVehicleChanged(opts: {
  tripId: number;
  actorId: number;
  from: string | null;
  to: string | null;
}): Promise<void> {
  const from = opts.from ?? "none";
  const to = opts.to ?? "none";
  const summary =
    opts.from === null
      ? `Vehicle set to ${to}`
      : opts.to === null
        ? `Vehicle ${from} removed`
        : `Vehicle changed ${from} → ${to}`;
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_VEHICLE_CHANGED,
    actorId: opts.actorId,
    summary,
    detail: { from: opts.from, to: opts.to },
  });
}

/** The PATCH fields `details_changed` covers. The vehicle has its own action. */
export type TripDetailField = "dispatchWindowId" | "transporterId" | "note" | "transporterTripNo";

export interface TripDetailChange {
  field: TripDetailField;
  /** Raw column values — ids for the two FKs. These go into `detail` untouched. */
  from: string | number | null;
  to: string | number | null;
  /**
   * The resulting value as the trip header prints it — the slot's `windowTime`,
   * the transporter's `name`. Resolved by the caller through
   * loadSlotAndTransporterNames (lib/trips/queries.ts), the header's own
   * resolver. Summary wording only; NEVER written into `detail`.
   */
  toLabel?: string | null;
}

/**
 * One field's clause, in the words the floor uses — never the column name.
 * Reads the same way vehicle_changed does: "Vehicle set to GJ05AB1234".
 *
 * ⚠ AN UNRESOLVED ID STILL SAYS SOMETHING TRUE. A slot or transporter row that
 * cannot be found (deactivated, deleted) falls back to "#12" rather than
 * dropping the clause or printing the column name back.
 */
function detailClause(c: TripDetailChange): string {
  const shown = c.toLabel ?? (c.to !== null ? `#${c.to}` : null);
  switch (c.field) {
    case "dispatchWindowId":
      return shown === null ? "Slot cleared" : `Slot set to ${shown}`;
    case "transporterId":
      return shown === null ? "Transporter cleared" : `Transporter set to ${shown}`;
    case "note":
      return c.to === null ? "Note cleared" : "Note updated";
    case "transporterTripNo":
      return c.to === null ? "Transporter trip no cleared" : `Transporter trip no set to ${c.to}`;
  }
}

/**
 * Any other edit through PATCH — the slot, the transporter, the note, the
 * transporter's own trip number.
 *
 * 🔴 IT EXISTS SO A SLOT CHANGE IS NOT INVISIBLE. Logging only the vehicle
 * would have left four of PATCH's six fields unrecorded, which is most of the
 * gap this table was built to close.
 *
 * ⚠ SUMMARY IN FLOOR WORDS, DETAIL IN COLUMN NAMES (2026-09-14). The first
 * cut printed "Updated transporterId", which nobody on the floor can read. The
 * summary now names each field and its new value; `detail.changes` still
 * carries `{ field, from, to }` with the raw column names and ids, exactly as
 * before — the labels are wording, and wording is not a fact worth storing twice.
 */
export async function logTripDetailsChanged(opts: {
  tripId: number;
  actorId: number;
  changes: TripDetailChange[];
}): Promise<void> {
  if (opts.changes.length === 0) return;
  const summary = opts.changes.map(detailClause).join(" · ");
  const rawChanges = opts.changes.map(({ field, from, to }) => ({ field, from, to }));
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_DETAILS_CHANGED,
    actorId: opts.actorId,
    summary,
    detail: { changes: rawChanges },
  });
}

/**
 * The trip was called off.
 *
 * 🔴 THE BILL LIST IS THE WHOLE POINT OF THIS ROW. Cancel sets `tripDropId` to
 * null on every bill, and once that runs there is no way to ask which bills were
 * on the trip — the drop rows survive but hold nothing. CALL THIS BEFORE THE
 * DETACH LOOP, with the list the route has already read, and never after.
 *
 * ⚠ IT IS CALLED EVEN WHEN THE TRIP CARRIED NOTHING. An empty load being called
 * off is still a thing that happened, and `obdNumbers: []` says so precisely.
 */
export async function logTripCancelled(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
  orderIds: number[];
  obdNumbers: string[];
  reason?: string | null;
}): Promise<void> {
  const carried =
    opts.orderIds.length === 0
      ? "it carried no bills"
      : `${bills(opts.orderIds.length)} detached`;
  const why = opts.reason ? ` — ${opts.reason}` : "";
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_CANCELLED_ACTION,
    actorId: opts.actorId,
    summary: `Trip ${opts.tripNumber} cancelled, ${carried}${why}`,
    detail: {
      tripNumber: opts.tripNumber,
      orderIds: opts.orderIds,
      obdNumbers: opts.obdNumbers,
      reason: opts.reason ?? null,
    },
  });
}

/**
 * The trip was confirmed.
 *
 * ⚠ TEMPORARY WRITER — slice 3 deletes the release route. See TRIP_RELEASED.
 */
export async function logTripReleased(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
  releasedCount: number;
  alreadyFinishedCount: number;
}): Promise<void> {
  // ⚠ SAYS WHAT THE PRESS DID, WHICH IS USUALLY NOTHING TO THE BILLS. Every
  // trip this desk plans is made of already-checked bills, and release has
  // nothing left to do to them (section 8.4 of the discovery report). A summary
  // claiming otherwise would be the log telling a nicer story than the truth.
  const moved =
    opts.releasedCount > 0
      ? `${bills(opts.releasedCount)} released to the floor`
      : opts.alreadyFinishedCount > 0
        ? `${bills(opts.alreadyFinishedCount)} already finished — no bill changed`
        : "no bill changed";
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_RELEASED,
    actorId: opts.actorId,
    summary: `Trip ${opts.tripNumber} confirmed, ${moved}`,
    detail: {
      releasedCount: opts.releasedCount,
      alreadyFinishedCount: opts.alreadyFinishedCount,
    },
  });
}

/**
 * Bills were marked dispatched from this trip.
 *
 * ⚠ TEMPORARY WRITER — slice 4 deletes Mark dispatched. See TRIP_DISPATCHED.
 *
 * ⚠ ONE ROW PER PRESS, and the press is re-runnable through the day, so a trip
 * legitimately carries several of these. That is the record working: four bills
 * at 11:00 and six more at 15:00 is two rows, which is what happened.
 */
export async function logTripDispatched(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
  orderIds: number[];
  obdNumbers: string[];
  closed: boolean;
}): Promise<void> {
  if (opts.orderIds.length === 0) return; // a press that moved nothing
  const tail = opts.closed ? " — trip closed" : "";
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_DISPATCHED,
    actorId: opts.actorId,
    summary: `${bills(opts.orderIds.length)} marked dispatched${tail}`,
    detail: { orderIds: opts.orderIds, obdNumbers: opts.obdNumbers, closed: opts.closed },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE READER
// ─────────────────────────────────────────────────────────────────────────────

export interface TripActivityRow {
  id: number;
  action: string;
  actorId: number;
  actorName: string | null;
  summary: string;
  detail: unknown;
  createdAt: string;
}

/**
 * One trip's history, OLDEST FIRST — the order it happened in, which is the
 * order a person reads a story.
 *
 * ⚠ TWO QUERIES, NOT AN INCLUDE. `users` is resolved by a batched second read
 * for the same reason lib/picking/queue.ts:537-554 does it: Prisma issues a
 * separate SELECT per relation, and on a 20-row history that is 20 round trips
 * against a pooled connection in Mumbai.
 *
 * ⚠ NOT ON THE BOARD PATH. This is called by getTripDetail, which runs when a
 * planner opens ONE trip — never by the board feed, whose statement count is
 * fought over every week.
 */
export async function getTripActivity(tripId: number): Promise<TripActivityRow[]> {
  const rows = await prisma.trip_activity.findMany({
    where: { tripId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      action: true,
      actorId: true,
      summary: true,
      detail: true,
      createdAt: true,
    },
  });
  if (rows.length === 0) return [];

  const actorIds = Array.from(new Set(rows.map((r) => r.actorId)));
  const users = await prisma.users.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actorId,
    actorName: nameById.get(r.actorId) ?? null,
    summary: r.summary,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  }));
}
