// lib/trips/redelivery.ts
//
// TRIP RE-DELIVERIES (2026-10-03, Schema v27.53) — a bill that already went out
// on a truck and came back undelivered, put on a LATER trip as attempt 2, 3 …
// Plan of record: docs/prompts/drafts/web-update-2026-10-03-trip-redelivery.md
// (rev 5, §2 decisions, §4 flow). Table: trip_redeliveries.
//
// 🔴 NEVER WRITES `orders`, AND NO order_status_logs ROW. The bill keeps its own
// tripDropId (its FIRST trip), its stage and its hold — no trip action changes a
// bill's status or hold (CLAUDE_FLOOR_TRIPS.md §13). Every write here is to
// trip_redeliveries, trip_drops or trip_activity.
//
// 🔴 ORBIT TRIPS ONLY. No NTS: trip_report is never read (plan rev 5).
// 🔴 CANCELLED TRIPS ARE IGNORED in every history / attempt / latest-attempt
// calculation (plan §2 #6) — their re-delivery rows are kept as the record.
//
// "Today" is the IST calendar day, read with getTodayIST() exactly as the trip
// routes do (`parseTripDate(getTodayIST())`); trips.tripDate is a @db.Date at
// UTC midnight, so its YYYY-MM-DD slice compares directly.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";
import { DISPATCHED, PICK_CHECKED } from "@/lib/workflow-stages";
import { TRIP_CANCELLED } from "@/lib/trips/live-trips";
import { findBillsByNumber, parseBillLookupTerm } from "@/lib/trips/find-bill";
import { deleteTripDropIfEmpty, findOrCreateTripDrop } from "@/lib/trips/drop";
import { logTripRedeliveryAdded, logTripRedeliveryRemoved, type RedeliveryLogItem } from "@/lib/trips/activity";
import { dealerDisplayName } from "@/lib/orders/dealer-name";

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** The reasons chk_trip_redeliveries_reason admits. A new one = ALTER the CHECK first. */
export const REDELIVERY_REASONS = ["site_closed", "wrong_dispatch"] as const;
export type RedeliveryReason = (typeof REDELIVERY_REASONS)[number];

export const REDELIVERY_REASON_LABELS: Record<RedeliveryReason, string> = {
  site_closed: "Shop / site closed",
  wrong_dispatch: "Wrong dispatch",
};

export function isRedeliveryReason(value: unknown): value is RedeliveryReason {
  return typeof value === "string" && (REDELIVERY_REASONS as readonly string[]).includes(value);
}

/** The label for a stored reason; the raw value when unknown (an old row after a CHECK change). */
export function redeliveryReasonLabel(reason: string): string {
  return isRedeliveryReason(reason) ? REDELIVERY_REASON_LABELS[reason] : reason;
}

/** The stages a bill must be at to have "gone out" (plan §2 #1). */
const GONE_OUT_STAGES: readonly string[] = [PICK_CHECKED, DISPATCHED];

/** The trip statuses that refuse a re-delivery. `dispatched` is a chk_trips_status value. */
const TRIP_DISPATCHED_STATUS = "dispatched";

// ── Messages (one place, so the dialog and the server say the same words) ──

export const MSG_NOT_GONE_OUT = "Not gone out yet — add it to a trip normally.";
export const MSG_ALREADY_ON_TRIP = "Already on this trip";
export const MSG_REMOVED = "This bill was removed — it cannot be re-delivered.";
export const MSG_NEEDS_CONFIRM = "Tick Truck came back";
export const MSG_NOT_ON_TRIP = "Not on this trip";

function tripRefusal(trip: { status: string; isHand: boolean }): string | null {
  if (trip.status === TRIP_CANCELLED) return "This trip is cancelled — re-deliveries cannot be added.";
  if (trip.status === TRIP_DISPATCHED_STATUS) return "This trip has been dispatched — re-deliveries cannot be added.";
  if (trip.isHand) return "This is a Hand trip (dealer collects) — re-deliveries go on a truck trip.";
  return null;
}

// ── History ─────────────────────────────────────────────────────────────────

export interface AttemptHistoryEntry {
  tripId: number;
  tripNumber: string;
  /** YYYY-MM-DD (the trip's own @db.Date). */
  tripDate: string;
  kind: "original" | "redelivery";
  /** Stored reason, redelivery entries only. */
  reason: string | null;
  /** Its label, redelivery entries only. */
  reasonLabel: string | null;
  /** The tie-breaker after tripDate: the trip's createdAt (original) or the row's (redelivery). */
  createdAt: string;
}

function sortHistory(entries: AttemptHistoryEntry[]): AttemptHistoryEntry[] {
  return entries.sort((a, b) => a.tripDate.localeCompare(b.tripDate) || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Every Orbit attempt for each bill — its own trip (through tripDropId) plus
 * every trip_redeliveries row for it — on NON-CANCELLED trips only, ordered by
 * tripDate then createdAt. Batched: four reads for any number of bills.
 */
export async function getAttemptHistories(orderIds: number[]): Promise<Map<number, AttemptHistoryEntry[]>> {
  const ids = Array.from(new Set(orderIds));
  const out = new Map<number, AttemptHistoryEntry[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;

  const orders = await prisma.orders.findMany({
    where: { id: { in: ids } },
    select: { id: true, tripDropId: true },
  });
  const dropIds = Array.from(new Set(orders.map((o) => o.tripDropId).filter((d): d is number => d !== null)));
  const drops = dropIds.length
    ? await prisma.trip_drops.findMany({ where: { id: { in: dropIds } }, select: { id: true, tripId: true } })
    : [];
  const rows = await prisma.trip_redeliveries.findMany({
    where: { orderId: { in: ids } },
    select: { orderId: true, tripId: true, reason: true, createdAt: true },
  });

  const tripIds = Array.from(new Set([...drops.map((d) => d.tripId), ...rows.map((r) => r.tripId)]));
  const trips = tripIds.length
    ? await prisma.trips.findMany({
        where: { id: { in: tripIds }, status: { not: TRIP_CANCELLED } },
        select: { id: true, tripNumber: true, tripDate: true, createdAt: true },
      })
    : [];
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const tripIdByDrop = new Map(drops.map((d) => [d.id, d.tripId]));

  for (const o of orders) {
    if (o.tripDropId === null) continue;
    const t = tripById.get(tripIdByDrop.get(o.tripDropId) ?? -1);
    if (!t) continue; // cancelled, or a pointer read mid-change
    out.get(o.id)!.push({
      tripId: t.id,
      tripNumber: t.tripNumber,
      tripDate: t.tripDate.toISOString().slice(0, 10),
      kind: "original",
      reason: null,
      reasonLabel: null,
      createdAt: t.createdAt.toISOString(),
    });
  }
  for (const r of rows) {
    const t = tripById.get(r.tripId);
    if (!t) continue; // a re-delivery on a cancelled trip is not an attempt
    out.get(r.orderId)!.push({
      tripId: t.id,
      tripNumber: t.tripNumber,
      tripDate: t.tripDate.toISOString().slice(0, 10),
      kind: "redelivery",
      reason: r.reason,
      reasonLabel: redeliveryReasonLabel(r.reason),
      createdAt: r.createdAt.toISOString(),
    });
  }
  for (const [id, list] of Array.from(out.entries())) out.set(id, sortHistory(list));
  return out;
}

/** Attempt = 1 + earlier attempts, minimum 2 (plan §2 #3). */
export function attemptNoFor(history: readonly AttemptHistoryEntry[]): number {
  return Math.max(2, 1 + history.length);
}

/** The previous attempt's trip, or null when the bill has no earlier Orbit trip. */
export function prevTripIdFor(history: readonly AttemptHistoryEntry[]): number | null {
  return history.length > 0 ? history[history.length - 1].tripId : null;
}

// ── Eligibility ─────────────────────────────────────────────────────────────

export type RedeliveryVerdict = "ok" | "warn" | "refused";

export interface RedeliveryJudgement {
  verdict: RedeliveryVerdict;
  /** Null on a plain ok. */
  message: string | null;
  attemptNo: number;
  history: AttemptHistoryEntry[];
  /** The latest earlier attempt's trip number, or null. */
  latestTripNumber: string | null;
}

/**
 * Can this bill go on this trip as a re-delivery? The ORDER is the rule:
 *   refused — 1 trip cancelled / dispatched / Hand · 2 bill removed ·
 *             3 not at pick_checked or dispatched · 4 already on this trip
 *             (its own stop, or a re-delivery row here)
 *   warn    — the latest earlier attempt's trip is dated today (IST) or later
 *   ok      — otherwise
 * `history` must already exclude cancelled trips (getAttemptHistories).
 */
export function judgeBillForTrip(
  trip: { id: number; status: string; isHand: boolean },
  bill: { isRemoved: boolean; workflowStage: string; ownTripId: number | null; hasRowOnThisTrip: boolean },
  history: AttemptHistoryEntry[],
): RedeliveryJudgement {
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const base = { attemptNo: attemptNoFor(history), history, latestTripNumber: latest?.tripNumber ?? null };

  const tripMsg = tripRefusal(trip);
  if (tripMsg) return { ...base, verdict: "refused", message: tripMsg };
  if (bill.isRemoved) return { ...base, verdict: "refused", message: MSG_REMOVED };
  if (!GONE_OUT_STAGES.includes(bill.workflowStage)) return { ...base, verdict: "refused", message: MSG_NOT_GONE_OUT };
  if (bill.ownTripId === trip.id || bill.hasRowOnThisTrip) {
    return { ...base, verdict: "refused", message: MSG_ALREADY_ON_TRIP };
  }
  if (latest && latest.tripDate >= getTodayIST()) {
    return {
      ...base,
      verdict: "warn",
      message: `Already on ${latest.tripNumber} today. Add only if that truck came back.`,
    };
  }
  return { ...base, verdict: "ok", message: null };
}

/** The bill's own trip id (through its stop), batched. */
async function ownTripIds(orders: Array<{ id: number; tripDropId: number | null }>): Promise<Map<number, number>> {
  const dropIds = Array.from(new Set(orders.map((o) => o.tripDropId).filter((d): d is number => d !== null)));
  const drops = dropIds.length
    ? await prisma.trip_drops.findMany({ where: { id: { in: dropIds } }, select: { id: true, tripId: true } })
    : [];
  const tripIdByDrop = new Map(drops.map((d) => [d.id, d.tripId]));
  const out = new Map<number, number>();
  for (const o of orders) {
    const t = o.tripDropId !== null ? tripIdByDrop.get(o.tripDropId) : undefined;
    if (t !== undefined) out.set(o.id, t);
  }
  return out;
}

// ── Search ──────────────────────────────────────────────────────────────────

export interface RedeliveryCandidate {
  orderId: number;
  obdNumber: string;
  invoiceNo: string | null;
  /** The effective ship-to name (override, then customer, then SAP's). */
  customerName: string;
  area: string | null;
  workflowStage: string;
  volumeLitres: number | null;
  verdict: RedeliveryVerdict;
  message: string | null;
  attemptNo: number;
  history: AttemptHistoryEntry[];
  latestTripNumber: string | null;
}

export type SearchOutcome =
  | { ok: true; q: string; trip: { id: number; tripNumber: string }; bills: RedeliveryCandidate[] }
  | { ok: false; status: number; error: string };

/**
 * The dialog's search: every bill matching one full OBD / SO / invoice number
 * (an invoice can return 2+), whether or not it is on a trip, each judged
 * against this trip. Removed bills are not returned (the finder excludes them),
 * so a removed bill reads as not found.
 */
export async function searchForRedelivery(tripId: number, raw: string): Promise<SearchOutcome> {
  const term = parseBillLookupTerm(raw);
  if (term === null) return { ok: false, status: 400, error: "q must be one full OBD, SO or invoice number" };

  const trip = await prisma.trips.findUnique({
    where: { id: tripId },
    select: { id: true, tripNumber: true, status: true, isHand: true },
  });
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };

  const bills = await findBillsByNumber(term, {
    id: true,
    obdNumber: true,
    invoiceNo: true,
    isRemoved: true,
    workflowStage: true,
    tripDropId: true,
    shipToCustomerName: true,
    customer: { select: { customerName: true, area: { select: { name: true } } } },
    shipToOverrideCustomer: { select: { customerName: true, area: { select: { name: true } } } },
    querySnapshot: { select: { totalVolume: true } },
  });
  if (bills.length === 0) return { ok: true, q: term.q, trip: { id: trip.id, tripNumber: trip.tripNumber }, bills: [] };

  const ids = bills.map((b) => b.id);
  const histories = await getAttemptHistories(ids);
  const own = await ownTripIds(bills);
  const here = await prisma.trip_redeliveries.findMany({
    where: { tripId, orderId: { in: ids } },
    select: { orderId: true },
  });
  const hereSet = new Set(here.map((r) => r.orderId));

  const out: RedeliveryCandidate[] = bills.map((b) => {
    const dealer = b.shipToOverrideCustomer ?? b.customer;
    const j = judgeBillForTrip(
      trip,
      {
        isRemoved: b.isRemoved,
        workflowStage: b.workflowStage,
        ownTripId: own.get(b.id) ?? null,
        hasRowOnThisTrip: hereSet.has(b.id),
      },
      histories.get(b.id) ?? [],
    );
    return {
      orderId: b.id,
      obdNumber: b.obdNumber,
      invoiceNo: b.invoiceNo ?? null,
      customerName: dealerDisplayName(dealer?.customerName, b.shipToCustomerName),
      area: dealer?.area?.name ?? null,
      workflowStage: b.workflowStage,
      volumeLitres: b.querySnapshot?.totalVolume ?? null,
      verdict: j.verdict,
      message: j.message,
      attemptNo: j.attemptNo,
      history: j.history,
      latestTripNumber: j.latestTripNumber,
    };
  });
  return { ok: true, q: term.q, trip: { id: trip.id, tripNumber: trip.tripNumber }, bills: out };
}

// ── Add ─────────────────────────────────────────────────────────────────────

export interface RedeliveryFailure {
  orderId: number;
  error: string;
}

export type AddOutcome =
  | { ok: true; added: Array<{ id: number; orderId: number; obdNumber: string; attemptNo: number }>; failed: RedeliveryFailure[] }
  | { ok: false; status: number; error: string };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Put bills on the trip as re-deliveries. Each bill IN ORDER: re-judged here
 * (never trust the dialog); refused → failed; warn without confirmedReturn →
 * failed "Tick Truck came back"; else find-or-create its stop and write ONE
 * trip_redeliveries row. Then ONE redelivery_added activity row for the bills
 * that were added. No `orders` write.
 */
export async function addRedeliveries(
  tripId: number,
  input: { orderIds: number[]; reason: RedeliveryReason; note: string | null; confirmedReturn: boolean },
  actorId: number,
): Promise<AddOutcome> {
  if (!isRedeliveryReason(input.reason)) return { ok: false, status: 400, error: "Unknown reason" };

  const trip = await prisma.trips.findUnique({
    where: { id: tripId },
    select: { id: true, status: true, isHand: true },
  });
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  const tripMsg = tripRefusal(trip);
  if (tripMsg) return { ok: false, status: 409, error: tripMsg };

  const added: Array<{ id: number; orderId: number; obdNumber: string; attemptNo: number }> = [];
  const logItems: RedeliveryLogItem[] = [];
  const failed: RedeliveryFailure[] = [];

  for (const orderId of input.orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          obdNumber: true,
          invoiceNo: true,
          isRemoved: true,
          workflowStage: true,
          tripDropId: true,
          customerId: true,
          shipToOverrideCustomerId: true,
          shipToCustomerId: true,
          shipToCustomerName: true,
        },
      });
      if (!order) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      const history = (await getAttemptHistories([orderId])).get(orderId) ?? [];
      const own = await ownTripIds([order]);
      const existing = await prisma.trip_redeliveries.findUnique({
        where: { tripId_orderId: { tripId, orderId } },
        select: { id: true },
      });
      const j = judgeBillForTrip(
        trip,
        {
          isRemoved: order.isRemoved,
          workflowStage: order.workflowStage,
          ownTripId: own.get(orderId) ?? null,
          hasRowOnThisTrip: existing !== null,
        },
        history,
      );
      if (j.verdict === "refused") {
        failed.push({ orderId, error: j.message ?? "Refused" });
        continue;
      }
      if (j.verdict === "warn" && input.confirmedReturn !== true) {
        failed.push({ orderId, error: MSG_NEEDS_CONFIRM });
        continue;
      }

      // The stop, by the shared drop-key rule. A lost race on its unique
      // throws into this bill's catch.
      const drop = await findOrCreateTripDrop(tripId, order);

      let row: { id: number };
      try {
        row = await prisma.trip_redeliveries.create({
          data: {
            tripId,
            // Written from the SAME drop row as tripId (landmine: nothing ties them).
            tripDropId: drop.id,
            orderId,
            obdNumber: order.obdNumber,
            invoiceNo: order.invoiceNo ?? null,
            attemptNo: j.attemptNo,
            prevTripId: prevTripIdFor(history),
            reason: input.reason,
            note: input.note,
            confirmedReturn: input.confirmedReturn === true,
            createdById: actorId,
          },
          select: { id: true },
        });
      } catch (err) {
        // A stop created for this bill alone must not be left empty behind it.
        await deleteTripDropIfEmpty(drop.id).catch(() => false);
        if (isUniqueViolation(err)) {
          failed.push({ orderId, error: MSG_ALREADY_ON_TRIP });
          continue;
        }
        throw err;
      }

      added.push({ id: row.id, orderId, obdNumber: order.obdNumber, attemptNo: j.attemptNo });
      logItems.push({ orderId, obd: order.obdNumber, attemptNo: j.attemptNo, reason: input.reason });
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  await logTripRedeliveryAdded({
    tripId,
    actorId,
    items: logItems,
    note: input.note,
    confirmedReturn: input.confirmedReturn,
  });

  return { ok: true, added, failed };
}

// ── Remove ──────────────────────────────────────────────────────────────────

export interface RemoveFailure {
  redeliveryId: number;
  error: string;
}

export type RemoveOutcome =
  | { ok: true; removed: number[]; failed: RemoveFailure[] }
  | { ok: false; status: number; error: string };

/**
 * Take re-deliveries off the trip: each row must belong to this trip (else
 * "Not on this trip"); the row is DELETED; its stop goes too if it now holds no
 * order and no re-delivery. Then ONE redelivery_removed activity row — the only
 * record left of what was planned. No `orders` write.
 */
export async function removeRedeliveries(
  tripId: number,
  input: { redeliveryIds: number[] },
  actorId: number,
): Promise<RemoveOutcome> {
  const trip = await prisma.trips.findUnique({ where: { id: tripId }, select: { id: true, status: true } });
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  // Same refusal as the bills route: a finished trip's plan is a record.
  if (trip.status === TRIP_CANCELLED || trip.status === TRIP_DISPATCHED_STATUS) {
    return { ok: false, status: 409, error: `Cannot change the re-deliveries on a ${trip.status} trip.` };
  }

  const removed: number[] = [];
  const logItems: RedeliveryLogItem[] = [];
  const failed: RemoveFailure[] = [];

  for (const redeliveryId of input.redeliveryIds) {
    try {
      const row = await prisma.trip_redeliveries.findUnique({
        where: { id: redeliveryId },
        select: { id: true, tripId: true, tripDropId: true, orderId: true, obdNumber: true, attemptNo: true, reason: true },
      });
      if (!row || row.tripId !== tripId) {
        failed.push({ redeliveryId, error: MSG_NOT_ON_TRIP });
        continue;
      }
      await prisma.trip_redeliveries.delete({ where: { id: row.id } });
      removed.push(row.id);
      logItems.push({ orderId: row.orderId, obd: row.obdNumber, attemptNo: row.attemptNo, reason: row.reason });
      // The removal stands even if tidying the stop fails — an empty stop is
      // visible and harmless; reporting the bill as failed would be untrue.
      await deleteTripDropIfEmpty(row.tripDropId).catch((err) => {
        console.error(`[redelivery] could not tidy stop ${row.tripDropId}:`, err instanceof Error ? err.message : err);
        return false;
      });
    } catch (err) {
      failed.push({ redeliveryId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  await logTripRedeliveryRemoved({ tripId, actorId, items: logItems });
  return { ok: true, removed, failed };
}
