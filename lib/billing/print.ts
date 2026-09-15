// lib/billing/print.ts
//
// THE PRINT TAB (slice 9, 2026-09-15). Trips the planner has SENT TO BILLING,
// each with the invoice numbers billing pastes into SAP to print. Orbit prints
// nothing; this module decides what is copyable and records that it was copied.
//
// ── THE RULES, EACH AN OWNER DECISION ───────────────────────────────────────
//
//   1. HELD BILLS ARE OUT OF BOTH THE COUNT AND THE COPY SET. 9 bills, 8
//      invoiced, 1 held reads "8 of 8 invoiced · ready". The held bill still
//      shows in the table, marked.
//   2. DISTINCT NUMBERS. Bills can share an invoice number (live: 1,752 bills,
//      1,748 numbers over 14 days); the copy carries each number once and N
//      counts numbers, not bills.
//   3. NEVER A PARTIAL SET. A trip is copyable only when every non-held bill
//      carries an invoice number.
//   4. NEW SINCE COPY. Each copy's numbers are stored in its `invoices_copied`
//      activity row. A copied trip whose current numbers are not all in the
//      union of those rows REOPENS, and its next copy carries ONLY the new
//      numbers. A number is never offered twice.
//   5. DATES MIRROR PICKING. Trips with copy work outstanding are listed from
//      every date; finished trips are listed for the day they were copied.
//
// 🔴 EVERY WRITE HERE IS TO `trips`, and one activity row. Never an order row:
// no trip action may change a bill's status or its hold (the rule the floor
// rebuild follows). The one writer is `copyTripInvoices`.
//
// Batched reads keyed on `IN` lists, never an include chain (lib/trips/queries.ts
// header). Sequential awaits, never prisma.$transaction (CORE §3).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logTripInvoicesCopied, TRIP_INVOICES_COPIED, TRIP_BILLS_ADDED } from "@/lib/trips/activity";

/** `orders.dispatchStatus` for a held bill — the same test lib/trips/queries.ts bucketFor makes. */
const HOLD = "hold";

export interface PrintBillRow {
  orderId: number;
  obdNumber: string;
  invoiceNo: string | null;
  shipToName: string | null;
  routeName: string | null;
  dropSeq: number;
  litres: number;
  /** On hold — shown, never counted, never copied. */
  held: boolean;
  /** Its invoice number arrived after the trip was last copied. */
  isNew: boolean;
}

/**
 *   uncopied — sent, never copied.
 *   reopened — copied, and since then a number arrived that was not taken, or a
 *              bill joined (or came off hold) that still has no number.
 *   copied   — every current number has been taken. Nothing to do.
 */
export type PrintTripState = "uncopied" | "reopened" | "copied";

export interface PrintTrip {
  id: number;
  tripNumber: string;
  tripDate: string;
  status: string;
  sentToBillingAt: string | null;
  sentToBillingByName: string | null;
  billingCopiedAt: string | null;
  billingCopiedByName: string | null;
  state: PrintTripState;
  /** Non-removed bills on the trip, held included. */
  bills: number;
  /** Stops holding at least one bill. */
  stops: number;
  litres: number;
  held: number;
  /** bills − held: the ones billing copies. */
  eligible: number;
  /** Of `eligible`, how many carry an invoice number. */
  invoiced: number;
  /** eligible > 0 and every eligible bill invoiced. */
  ready: boolean;
  /** Distinct numbers across the eligible bills, in table order. */
  invoiceNos: string[];
  /** Numbers already taken by earlier copies that are still on the trip. */
  copiedCount: number;
  /**
   * What the header button copies AND records: every number on an uncopied
   * trip, only the new ones on a reopened trip, nothing on a copied trip (its
   * plain Copy re-copies `invoiceNos` and records nothing).
   */
  copySet: string[];
  /** Eligible bills behind `copySet` — more than its length when bills share a number. */
  copyBillCount: number;
  rows: PrintBillRow[];
}

function distinctInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** `detail.invoiceNos` from an `invoices_copied` row, defensively — the column is jsonb. */
function copiedNosFrom(detail: Prisma.JsonValue): string[] {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return [];
  const nos = (detail as Record<string, unknown>).invoiceNos;
  return Array.isArray(nos) ? nos.filter((n): n is string => typeof n === "string") : [];
}

/**
 * Build the Print view of the given trips. Missing ids are simply absent.
 *
 * Six batched statements for any number of trips (trips, drops, bills with the
 * ship-to override, litres, copy rows, names); none when the list is empty.
 */
export async function loadPrintTrips(tripIds: number[]): Promise<PrintTrip[]> {
  const ids = Array.from(new Set(tripIds));
  if (ids.length === 0) return [];

  const trips = await prisma.trips.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      tripNumber: true,
      tripDate: true,
      status: true,
      sentToBillingAt: true,
      sentToBillingById: true,
      billingCopiedAt: true,
      billingCopiedById: true,
    },
  });
  if (trips.length === 0) return [];

  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    select: { id: true, tripId: true, dropSeq: true, routeName: true },
  });
  const dropById = new Map(drops.map((d) => [d.id, d]));

  const orders = drops.length
    ? await prisma.orders.findMany({
        where: { tripDropId: { in: drops.map((d) => d.id) }, isRemoved: false },
        select: {
          id: true,
          tripDropId: true,
          obdNumber: true,
          invoiceNo: true,
          dispatchStatus: true,
          shipToCustomerName: true,
          shipToOverrideCustomer: { select: { customerName: true } },
        },
        orderBy: { id: "asc" },
      })
    : [];

  const snapshots = orders.length
    ? await prisma.import_obd_query_summary.findMany({
        where: { orderId: { in: orders.map((o) => o.id) } },
        select: { orderId: true, totalVolume: true },
      })
    : [];
  const litresByOrderId = new Map<number, number>();
  for (const s of snapshots) if (s.orderId !== null) litresByOrderId.set(s.orderId, s.totalVolume);

  const copyRows = await prisma.trip_activity.findMany({
    where: { tripId: { in: trips.map((t) => t.id) }, action: TRIP_INVOICES_COPIED },
    select: { tripId: true, detail: true },
  });
  const copiedByTripId = new Map<number, Set<string>>();
  for (const r of copyRows) {
    const set = copiedByTripId.get(r.tripId) ?? new Set<string>();
    for (const n of copiedNosFrom(r.detail)) set.add(n);
    copiedByTripId.set(r.tripId, set);
  }

  const userIds = Array.from(
    new Set(
      trips
        .flatMap((t) => [t.sentToBillingById, t.billingCopiedById])
        .filter((id): id is number => id !== null),
    ),
  );
  const users = userIds.length
    ? await prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const ordersByTripId = new Map<number, typeof orders>();
  for (const o of orders) {
    const drop = o.tripDropId !== null ? dropById.get(o.tripDropId) : undefined;
    if (!drop) continue;
    const arr = ordersByTripId.get(drop.tripId) ?? [];
    arr.push(o);
    ordersByTripId.set(drop.tripId, arr);
  }

  return trips.map((t) => {
    const own = (ordersByTripId.get(t.id) ?? []).slice().sort((a, b) => {
      const da = dropById.get(a.tripDropId!)!.dropSeq;
      const db = dropById.get(b.tripDropId!)!.dropSeq;
      return da - db || a.id - b.id;
    });
    const copied = copiedByTripId.get(t.id) ?? new Set<string>();

    const eligibleRows = own.filter((o) => o.dispatchStatus !== HOLD);
    const invoiceNos = distinctInOrder(
      eligibleRows.map((o) => o.invoiceNo).filter((n): n is string => n !== null),
    );
    const invoiced = eligibleRows.filter((o) => o.invoiceNo !== null).length;
    const eligible = eligibleRows.length;
    const ready = eligible > 0 && invoiced === eligible;
    const newSince = invoiceNos.filter((n) => !copied.has(n));

    const state: PrintTripState =
      t.billingCopiedAt === null
        ? "uncopied"
        : newSince.length > 0 || invoiced < eligible
          ? "reopened"
          : "copied";
    const copySet = state === "uncopied" ? invoiceNos : state === "reopened" ? newSince : [];
    const copySetLookup = new Set(copySet);
    const newLookup = new Set(state === "reopened" ? newSince : []);

    const rows: PrintBillRow[] = own.map((o) => {
      const drop = dropById.get(o.tripDropId!)!;
      return {
        orderId: o.id,
        obdNumber: o.obdNumber,
        invoiceNo: o.invoiceNo,
        shipToName: o.shipToOverrideCustomer?.customerName ?? o.shipToCustomerName,
        routeName: drop.routeName,
        dropSeq: drop.dropSeq,
        litres: litresByOrderId.get(o.id) ?? 0,
        held: o.dispatchStatus === HOLD,
        isNew: o.dispatchStatus !== HOLD && o.invoiceNo !== null && newLookup.has(o.invoiceNo),
      };
    });

    return {
      id: t.id,
      tripNumber: t.tripNumber,
      tripDate: t.tripDate.toISOString().slice(0, 10),
      status: t.status,
      sentToBillingAt: t.sentToBillingAt?.toISOString() ?? null,
      sentToBillingByName: t.sentToBillingById !== null ? (nameById.get(t.sentToBillingById) ?? null) : null,
      billingCopiedAt: t.billingCopiedAt?.toISOString() ?? null,
      billingCopiedByName: t.billingCopiedById !== null ? (nameById.get(t.billingCopiedById) ?? null) : null,
      state,
      bills: own.length,
      stops: new Set(own.map((o) => o.tripDropId)).size,
      litres: own.reduce((sum, o) => sum + (litresByOrderId.get(o.id) ?? 0), 0),
      held: own.length - eligible,
      eligible,
      invoiced,
      ready,
      invoiceNos,
      copiedCount: invoiceNos.length - newSince.length,
      copySet,
      copyBillCount: eligibleRows.filter((o) => o.invoiceNo !== null && copySetLookup.has(o.invoiceNo)).length,
      rows,
    };
  });
}

/** The trips the Print tab is about at all: sent, and not cancelled (cancel detaches every bill). */
const ON_PRINT = { sentToBillingAt: { not: null }, status: { not: "cancelled" } } satisfies Prisma.tripsWhereInput;

/**
 * Ids of every trip that MIGHT have copy work outstanding: never copied, or
 * copied and touched since.
 *
 * ⚠ THE SECOND ARM IS A SUPERSET, CONFIRMED BY THE CALLER. "Touched since" is a
 * non-removed, non-held bill written after the last copy — a number arriving
 * (auto-import's Prisma update moves `updatedAt`), a bill joining the trip, a
 * hold lifted — or a bills_added row after it. A checked or dispatched write
 * also lands here; loadPrintTrips decides, and such a trip comes back `copied`.
 * Measured against the real stamps, never a guess: without this arm a copied
 * trip could never reopen, and loading EVERY copied trip would grow with history.
 */
export async function getPrintWorkTripIds(): Promise<number[]> {
  const uncopied = await prisma.trips.findMany({
    where: { ...ON_PRINT, billingCopiedAt: null },
    select: { id: true },
  });
  const touched = await prisma.$queryRaw<{ id: number }[]>`
    SELECT t.id
      FROM trips t
     WHERE t."sentToBillingAt" IS NOT NULL
       AND t.status <> 'cancelled'
       AND t."billingCopiedAt" IS NOT NULL
       AND (
         EXISTS (
           SELECT 1
             FROM trip_drops d
             JOIN orders o ON o."tripDropId" = d.id
            WHERE d."tripId" = t.id
              AND o."isRemoved" = false
              AND o."dispatchStatus" IS DISTINCT FROM ${HOLD}
              AND o."updatedAt" > t."billingCopiedAt"
         )
         OR EXISTS (
           SELECT 1
             FROM trip_activity a
            WHERE a."tripId" = t.id
              AND a.action = ${TRIP_BILLS_ADDED}
              AND a."createdAt" > t."billingCopiedAt"
         )
       )`;
  return Array.from(new Set([...uncopied.map((t) => t.id), ...touched.map((t) => t.id)]));
}

/** Trips whose latest copy fell inside [start, end). */
export async function getCopiedTripIds(start: Date, end: Date): Promise<number[]> {
  const rows = await prisma.trips.findMany({
    where: { ...ON_PRINT, billingCopiedAt: { gte: start, lt: end } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Oldest sent first — the order billing works them, like Picking's oldest-checked-first. */
export function byOldestSent(a: PrintTrip, b: PrintTrip): number {
  return (a.sentToBillingAt ?? "").localeCompare(b.sentToBillingAt ?? "") || a.id - b.id;
}

/** Newest copy first. */
export function byNewestCopy(a: PrintTrip, b: PrintTrip): number {
  return (b.billingCopiedAt ?? "").localeCompare(a.billingCopiedAt ?? "") || b.id - a.id;
}

/**
 * The Print marker's change key: the newest write that could alter anything the
 * tab shows. ONE statement, three MAXes:
 *
 *   - trips.updatedAt over EVERY trip — a send, a take-back, a copy. Deliberately
 *     unfiltered: a take-back removes the trip from any "sent" filter, so a
 *     filtered MAX would not see it move. ~120 rows.
 *   - trip_activity.createdAt on sent trips — a bill removed (its own
 *     `updatedAt` moves, but it is no longer on the trip to be counted).
 *   - orders.updatedAt on sent trips' bills — a number arriving, a hold.
 */
export async function getPrintMarkerLatest(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ latest: Date | null }[]>`
    SELECT GREATEST(
      (SELECT MAX(t."updatedAt") FROM trips t),
      (SELECT MAX(a."createdAt")
         FROM trip_activity a JOIN trips t ON t.id = a."tripId"
        WHERE t."sentToBillingAt" IS NOT NULL),
      (SELECT MAX(o."updatedAt")
         FROM orders o
         JOIN trip_drops d ON d.id = o."tripDropId"
         JOIN trips t ON t.id = d."tripId"
        WHERE t."sentToBillingAt" IS NOT NULL)
    ) AS latest`;
  return rows[0]?.latest ? rows[0].latest.toISOString() : null;
}

export type CopyOutcome =
  | { ok: true; changed: boolean; tripNumber: string; invoiceNos: string[]; billingCopiedAt: string | null }
  | { ok: false; status: number; error: string };

/**
 * Billing pressed Copy on a trip: record that `invoiceNos` were copied.
 *
 * 🔴 THE CLIENT HAS ALREADY PUT THE NUMBERS ON THE CLIPBOARD, and sends exactly
 * what it put there. The server recomputes the copy set from the database and
 * records ONLY if the two match — so the history can never claim a set the
 * screen did not show, and a trip that changed under the screen (a bill added, a
 * hold lifted, a number arrived) is refused with 409 rather than half-recorded.
 *
 * ⚠ IDEMPOTENT. A trip with nothing new returns `changed: false` and writes
 * nothing. Two people pressing at once: the stamp is a conditional update on
 * the `billingCopiedAt` this call read, so only one of them records.
 */
export async function copyTripInvoices(opts: {
  tripId: number;
  invoiceNos: string[];
  actorId: number;
}): Promise<CopyOutcome> {
  const [trip] = await loadPrintTrips([opts.tripId]);
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  if (trip.sentToBillingAt === null) {
    return { ok: false, status: 409, error: `${trip.tripNumber} is not sent to billing.` };
  }
  if (trip.status === "cancelled") {
    return { ok: false, status: 409, error: `${trip.tripNumber} is cancelled.` };
  }
  if (trip.state === "copied") {
    return { ok: true, changed: false, tripNumber: trip.tripNumber, invoiceNos: [], billingCopiedAt: trip.billingCopiedAt };
  }
  if (!trip.ready) {
    return {
      ok: false,
      status: 409,
      error:
        trip.eligible === 0
          ? `${trip.tripNumber} has no bills to copy.`
          : `${trip.tripNumber}: ${trip.invoiced} of ${trip.eligible} invoiced — never a partial set.`,
    };
  }

  const sent = distinctInOrder(opts.invoiceNos);
  const expected = new Set(trip.copySet);
  if (sent.length !== expected.size || sent.some((n) => !expected.has(n))) {
    return {
      ok: false,
      status: 409,
      error: `${trip.tripNumber} changed since your screen loaded — nothing was recorded. Copy again.`,
    };
  }

  const stamp = new Date();
  const updated = await prisma.trips.updateMany({
    where: {
      id: trip.id,
      billingCopiedAt: trip.billingCopiedAt === null ? null : new Date(trip.billingCopiedAt),
    },
    data: { billingCopiedAt: stamp, billingCopiedById: opts.actorId },
  });
  if (updated.count === 0) {
    return {
      ok: false,
      status: 409,
      error: `${trip.tripNumber} was just copied by someone else — nothing was recorded.`,
    };
  }

  await logTripInvoicesCopied({
    tripId: trip.id,
    actorId: opts.actorId,
    tripNumber: trip.tripNumber,
    invoiceNos: trip.copySet,
    billCount: trip.copyBillCount,
    kind: trip.state === "uncopied" ? "first" : "new_since",
  });

  return {
    ok: true,
    changed: true,
    tripNumber: trip.tripNumber,
    invoiceNos: trip.copySet,
    billingCopiedAt: stamp.toISOString(),
  };
}
