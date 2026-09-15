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
 * The trip's NUMBER changed without anybody cancelling it at that moment
 * (slice 5, 2026-09-15).
 *
 * ⚠ WRITTEN BY SQL, NOT BY THIS FILE. Its only writer is the one-off migration
 * that renamed every already-cancelled trip to <number>-C, run in the Supabase
 * SQL Editor as user 1 and saying so in its summary. A cancel from the app today
 * renames the trip inside its own `cancelled` row — which is why there is no
 * logTripRenamed below, and why reusing `cancelled` for the migration would have
 * read as a second cancel. The constant exists so the vocabulary stays complete
 * and chk_trip_activity_action has a TypeScript twin.
 */
export const TRIP_RENAMED = "renamed";

/**
 * Show to floor, and its take-back (slice 8, 2026-09-15). With desk control on,
 * a trip's WAITING bills reach the supervisor's Assign tab only once the trip is
 * shown. Written by POST /api/floor/trips/[id]/show and — for `shown` only — by
 * turning desk control on, which shows every trip already holding a waiting
 * bill so nothing leaves the supervisor's screen (lib/trips/show.ts).
 */
export const TRIP_SHOWN = "shown";
export const TRIP_TAKEN_BACK = "taken_back";

/**
 * Send to billing, its take-back, and the Print tab's copy (slice 9,
 * 2026-09-15). The planner's Send to billing puts the trip on the Billing
 * screen's Print tab; billing's Copy puts the trip's invoice numbers on the
 * clipboard for SAP and records that it happened.
 *
 * 🔴 `invoices_copied` CARRIES THE NUMBERS, AND THAT IS LOAD-BEARING. Its
 * `detail.invoiceNos` is the ONLY record of which numbers billing has taken.
 * "New since copy" is the trip's current numbers minus the union of every
 * such row's list (lib/billing/print.ts) — so a number is never offered twice.
 * Never rewrite or delete these rows.
 */
export const TRIP_SENT_TO_BILLING = "sent_to_billing";
export const TRIP_TAKEN_BACK_FROM_BILLING = "taken_back_from_billing";
export const TRIP_INVOICES_COPIED = "invoices_copied";

/**
 * ⚠ BOTH ARE STILL WRITTEN, AND THIS NOTE WAS WRONG TWICE BEFORE.
 *
 * `dispatched` — Mark dispatched STAYS (the owner dropped slice 4 on
 * 2026-09-15: recording the truck leaving is out of this rebuild's scope).
 * `released` — POST /api/floor/trips/[id]/confirm still writes it, but has no
 * caller on the floor screen since slice 6: a vehicle now moves a trip out of
 * draft inside the create and PATCH routes, which record it as
 * `confirmed: true` in their own rows' detail rather than as a `released` row.
 * The slice 6 migration's rows also use `released`.
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
  TRIP_RENAMED,
  TRIP_SHOWN,
  TRIP_TAKEN_BACK,
  TRIP_SENT_TO_BILLING,
  TRIP_TAKEN_BACK_FROM_BILLING,
  TRIP_INVOICES_COPIED,
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
  /**
   * Cancelled trips that once held this number, newest cancel first
   * (slice 5, 2026-09-15 — findPreviousHolders, lib/trips/number.ts).
   *
   * 🔴 THE PAPER SAFEGUARD. A cancelled trip gives its number back, and a sheet
   * printed for it carries the same number as this trip. One clause here makes
   * that traceable: whoever finds two sheets reading L-260915-03 can open this
   * trip and read which cancelled trip held the number first. Empty or absent
   * on a number used for the first time, and then the summary says nothing.
   */
  reusedFrom?: string[];
  /**
   * True when the trip was created with a vehicle and therefore born out of
   * draft (slice 6). A FACT IN `detail`, never a word in the summary — the
   * Draft / Confirmed vocabulary is off the screen.
   */
  confirmed?: boolean;
}): Promise<void> {
  const where = opts.vehicleLabel ? ` · ${opts.vehicleLabel}` : " · no vehicle yet";
  const when = opts.windowLabel ? ` · ${opts.windowLabel}` : " · no slot yet";
  const reusedFrom = opts.reusedFrom ?? [];
  const reused =
    reusedFrom.length > 0 ? ` · number reused, previously held by ${reusedFrom.join(", ")}` : "";
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_CREATED,
    actorId: opts.actorId,
    summary: `Trip ${opts.tripNumber} created${where}${when}${reused}`,
    detail: {
      tripNumber: opts.tripNumber,
      tripDate: opts.tripDate,
      vehicleLabel: opts.vehicleLabel,
      windowLabel: opts.windowLabel,
      ...(reusedFrom.length > 0 ? { reusedFrom } : {}),
      ...(opts.confirmed ? { confirmed: true } : {}),
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
  /**
   * The transporter the new vehicle brought with it, when that CHANGED the
   * trip's transporter (2026-09-14).
   *
   * 🔴 PICKING A MASTER VEHICLE DEFAULTS THE TRANSPORTER FROM IT (PATCH, owner
   * decision 7). Before this, that change was saved and never logged, so the
   * header's transporter could move with no row saying so — a silent change to
   * a field the header displays, which is the exact thing this table exists to
   * stop. Same `field: "transporterId"` shape as details_changed, so a reader
   * looking for transporter moves finds both.
   */
  transporter?: TripDetailChange;
  /**
   * True when THIS vehicle change moved the trip out of draft (slice 6,
   * 2026-09-15). Owner's wording rule: `confirmed: true` in this row's detail,
   * and NO separate "confirmed" line in the history.
   */
  confirmed?: boolean;
}): Promise<void> {
  const from = opts.from ?? "none";
  const to = opts.to ?? "none";
  const vehicleClause =
    opts.from === null
      ? `Vehicle set to ${to}`
      : opts.to === null
        ? `Vehicle ${from} removed`
        : `Vehicle changed ${from} → ${to}`;
  const summary = opts.transporter
    ? `${vehicleClause} · ${detailClause(opts.transporter)}`
    : vehicleClause;
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_VEHICLE_CHANGED,
    actorId: opts.actorId,
    summary,
    detail: {
      from: opts.from,
      to: opts.to,
      ...(opts.transporter
        ? {
            transporter: {
              field: opts.transporter.field,
              from: opts.transporter.from,
              to: opts.transporter.to,
            },
          }
        : {}),
      ...(opts.confirmed ? { confirmed: true } : {}),
    },
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
 *
 * 🔴 BOTH NAMES, BECAUSE CANCELLING RENAMES THE TRIP (slice 5, 2026-09-15).
 * "Trip L-260914-03 cancelled, now L-260914-03-C, 2 bills detached". The panel
 * already prints who and when from `actorId` and `createdAt`, so the summary
 * does not repeat them. `detail.was` / `detail.now` carry the two names as
 * facts; `detail.tripNumber` keeps its pre-slice-5 meaning — the number the
 * trip had when it was cancelled — so old and new rows read the same key.
 */
export async function logTripCancelled(opts: {
  tripId: number;
  actorId: number;
  /** The number the trip carried until this cancel. */
  tripNumber: string;
  /** The number it carries from now on — `<tripNumber>-C`, `-C2` … */
  renamedTo: string;
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
    summary: `Trip ${opts.tripNumber} cancelled, now ${opts.renamedTo}, ${carried}${why}`,
    detail: {
      was: opts.tripNumber,
      now: opts.renamedTo,
      tripNumber: opts.tripNumber,
      orderIds: opts.orderIds,
      obdNumbers: opts.obdNumbers,
      reason: opts.reason ?? null,
    },
  });
}

/**
 * The trip was shown to the floor (slice 8).
 *
 * `via` records WHICH press did it: the planner's own Show to floor, or turning
 * desk control on — which shows every trip already holding a waiting bill, so
 * the supervisor loses nothing he could see (the no-cliff rule). The second is
 * not a person choosing this trip, and the summary says so.
 */
export async function logTripShown(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
  /** Waiting bills on the trip at that moment — what the supervisor now sees. */
  waitingCount: number;
  via: "button" | "desk_control_on";
}): Promise<void> {
  const tail =
    opts.via === "desk_control_on"
      ? " — shown automatically when desk control was turned on, so nothing left the floor's screen"
      : "";
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_SHOWN,
    actorId: opts.actorId,
    summary: `Trip ${opts.tripNumber} shown to the floor, ${bills(opts.waitingCount)} waiting${tail}`,
    detail: { waitingCount: opts.waitingCount, via: opts.via },
  });
}

/**
 * The trip was taken back from the floor (slice 8).
 *
 * ⚠ ONLY ITS STILL-WAITING BILLS LEAVE THE SUPERVISOR'S SCREEN. A bill already
 * with a picker, picked or checked is never gated (lib/picking/queue.ts, the
 * locked rule), so it stays exactly where it is — and the row names both counts
 * so a reader can see that nothing was pulled out of anybody's hands.
 */
export async function logTripTakenBack(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
  /** Waiting bills that are now hidden from the Assign tab again. */
  hiddenCount: number;
  /** Bills already with a picker or further on — unaffected. */
  stayedCount: number;
}): Promise<void> {
  const stayed = opts.stayedCount > 0 ? `, ${bills(opts.stayedCount)} already with pickers stay` : "";
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_TAKEN_BACK,
    actorId: opts.actorId,
    summary: `Trip ${opts.tripNumber} taken back from the floor, ${bills(opts.hiddenCount)} waiting hidden again${stayed}`,
    detail: { hiddenCount: opts.hiddenCount, stayedCount: opts.stayedCount },
  });
}

/**
 * The planner sent the trip to billing (slice 9). The counts are the trip as
 * billing will first see it — how many of its bills already carry an invoice
 * number — so a later "why was nothing copyable" has its answer here.
 */
export async function logTripSentToBilling(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
  /** Bills on the trip that are not on hold — the ones billing will copy. */
  billCount: number;
  /** Of those, how many already carry an invoice number. */
  invoicedCount: number;
}): Promise<void> {
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_SENT_TO_BILLING,
    actorId: opts.actorId,
    summary: `Trip ${opts.tripNumber} sent to billing, ${opts.invoicedCount} of ${bills(opts.billCount)} invoiced`,
    detail: { billCount: opts.billCount, invoicedCount: opts.invoicedCount },
  });
}

/**
 * The planner took the trip back from billing (slice 9). Only possible before
 * billing has copied anything — the route refuses it after — so this row never
 * sits after an `invoices_copied` row on the same trip.
 */
export async function logTripTakenBackFromBilling(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
}): Promise<void> {
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_TAKEN_BACK_FROM_BILLING,
    actorId: opts.actorId,
    summary: `Trip ${opts.tripNumber} taken back from billing`,
    detail: {},
  });
}

/**
 * Billing copied the trip's invoice numbers on the Print tab (slice 9).
 *
 * 🔴 `invoiceNos` IS EXACTLY WHAT THIS PRESS PUT ON THE CLIPBOARD — distinct,
 * in table order. On a first copy that is every number on the trip; on a copy
 * after new bills arrived it is ONLY the new ones. The union across rows is
 * what lib/billing/print.ts subtracts to find "new since copy". A re-copy of a
 * finished trip writes no row at all.
 */
export async function logTripInvoicesCopied(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
  invoiceNos: string[];
  /** Bills behind those numbers — more than the numbers when bills share one. */
  billCount: number;
  kind: "first" | "new_since";
}): Promise<void> {
  const n = opts.invoiceNos.length;
  const nos = `${n} ${opts.kind === "new_since" ? "new " : ""}invoice no${n === 1 ? "" : "s"}`;
  const shared = opts.billCount !== n ? ` (${bills(opts.billCount)})` : "";
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_INVOICES_COPIED,
    actorId: opts.actorId,
    summary: `Billing copied ${nos}${shared} for trip ${opts.tripNumber}`,
    detail: { invoiceNos: opts.invoiceNos, billCount: opts.billCount, kind: opts.kind },
  });
}

/**
 * The trip was confirmed — Confirm plan, draft → released.
 *
 * 🔴 NO LONGER A TEMPORARY WRITER (slice 3, 2026-09-14). Slice 2 wrote this
 * from POST /api/floor/trips/[id]/release and marked it to vanish with that
 * route. The route went; the press did not. Its caller is now
 * POST /api/floor/trips/[id]/confirm, a trips-only write, which lives until
 * slice 6 retires the Draft / Confirmed words. See TRIP_RELEASED.
 *
 * ⚠ `detail` HAS TWO SHAPES IN THE TABLE. Rows written by the old release
 * route carry `{ releasedCount, alreadyFinishedCount }` and read "confirmed,
 * N bills already finished — no bill changed". Rows written from here carry
 * `{ billCount }`. Both are true of their moment; neither is rewritten.
 */
export async function logTripReleased(opts: {
  tripId: number;
  actorId: number;
  tripNumber: string;
  /** Bills on the trip at the moment it was confirmed. Nothing was written to them. */
  billCount: number;
}): Promise<void> {
  await writeActivity({
    tripId: opts.tripId,
    action: TRIP_RELEASED,
    actorId: opts.actorId,
    summary: `Trip ${opts.tripNumber} confirmed with ${bills(opts.billCount)}`,
    detail: { billCount: opts.billCount },
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
