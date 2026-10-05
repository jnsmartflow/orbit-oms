// lib/billing/print.ts
//
// THE PRINT TAB — Billing Print v2 (2026-10-05, Schema v27.56; slice 9 was
// 2026-09-15). Trips the planner has SENT TO BILLING. Billing copies each
// trip's OBD numbers and pastes them into SAP, which prints. Orbit prints
// nothing; this module decides what each bill's state is, records which bills
// were copied, and records when billing called a trip done.
//
// ── THE RULES, EACH AN OWNER DECISION (2026-10-05) ──────────────────────────
//
//   1. HELD BILLS ARE OUT. A held bill (orders.dispatchStatus = 'hold') is
//      shown, marked, never copied and never counted.
//   2. THE CLIPBOARD CARRIES OBD NUMBERS, one per bill — not invoice numbers.
//      An invoice number is NOT needed for a bill to be copyable; it is shown
//      when SAP has stamped it.
//   3. A BILL IS READY WHEN ITS PICKING IS DONE, exactly as Floor's status pill
//      says Done: workflowStage ∈ {pick_checked, dispatched} (rowStatus done /
//      direct / dispatched — components/floor/status-pill.tsx). A ready bill
//      with a CONFIRMED pick finding (pick_findings.recordedById not null) is in
//      REVIEW instead: it never goes in the bulk Copy; billing opens it, reads
//      the finding, and marks it done from the panel.
//   4. COPIES ARE PER BILL AND MAY BE PARTIAL. Every copy press writes one
//      trip_bill_copies row per bill (UNIQUE tripId + orderId — a second press
//      on the same bill is skipped); the next press copies only bills that
//      became ready since. Slice 9's "never a partial set" (a trip copyable only
//      once every bill had an invoice number) was REMOVED on purpose — do not
//      restore it.
//   5. DONE IS A PRESS. When every non-held bill is copied, billing presses
//      "Done — all copied" (trips.billingDoneAt). A done trip whose bills change
//      (a bill joins, a hold lifts) REOPENS until those are copied — except a
//      DISPATCHED done trip, which never reopens. Trips with work outstanding
//      are listed from every date; done trips on the IST day of billingDoneAt.
//
// Per-bill copied state is keyed on THIS trip. A bill copied on an earlier trip
// reads uncopied here and carries a quiet `copiedOnOtherTrip` note.
//
// 🔴 EVERY WRITE HERE IS TO `trips`, trip_bill_copies and one activity row.
// Never an order row: no trip action may change a bill's status or its hold,
// and an orders write would fire every orders-keyed marker (CORE §3).
//
// Batched reads keyed on `IN` lists, never an include chain (lib/trips/queries.ts
// header). Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { isGiftBill, loadLitres } from "@/lib/orders/gift";
import { getColourWorkByOrder } from "@/lib/picking/colour-work-query";
import { tintPhaseOf } from "@/lib/floor/tint-phase";
import { DISPATCHED, PICK_ASSIGNED, PICK_CHECKED, PICK_DONE } from "@/lib/workflow-stages";
import { logTripBillingDone, logTripBillsCopied } from "@/lib/trips/activity";

/** `orders.dispatchStatus` for a held bill — the same test lib/trips/queries.ts bucketFor makes. */
const HOLD = "hold";

/** trips.status of a trip that has left the depot — a done one never reopens. */
const TRIP_DISPATCHED = "dispatched";

/**
 * One bill's Print state.
 *   copied  — has a trip_bill_copies row on THIS trip.
 *   ready   — picking Done, no confirmed finding, not copied → goes in bulk Copy.
 *   review  — picking Done WITH a confirmed finding → opened and marked one by one.
 *   waiting — picking not Done yet. Nothing to copy.
 *   held    — on hold. Shown, never copied, never counted. Outranks every other state.
 */
export type PrintBillState = "copied" | "ready" | "review" | "waiting" | "held";

/** What a copy press records — trip_bill_copies.kind minus the one-off 'backfill'. */
export type PrintCopyKind = "bulk" | "single" | "review";

export const PRINT_COPY_KINDS: readonly PrintCopyKind[] = ["bulk", "single", "review"];

export interface PrintBillRow {
  orderId: number;
  obdNumber: string;
  invoiceNo: string | null;
  shipToName: string | null;
  routeName: string | null;
  dropSeq: number;
  litres: number;
  /** SAP GIFTS (lib/orders/gift.ts): `litres` above is shown as stored but left
   *  out of the trip total. Still a bill and a stop — counted, copied. */
  isGift: boolean;
  /** On hold — shown, never copied, never counted. */
  held: boolean;
  state: PrintBillState;

  // ── Floor's StatusPill inputs (components/floor/status-pill.tsx rowStatus) ──
  // The SAME facts getFloorBoard derives (lib/floor/queries.ts), so the Print
  // tab renders <StatusPill status={rowStatus(row)} /> and can never disagree
  // with Floor about a bill.
  isAssigned: boolean;
  isDone: boolean;
  /** TRUE for a dispatched bill too — it was checked on its way out (Floor's rule). */
  isChecked: boolean;
  isDispatched: boolean;
  directLoadedAt: string | null;
  /** lib/floor/tint-phase.ts, with Floor's "base → no phase" override. */
  tintPhase: "pending" | "assigned" | "tinting" | "done" | null;
  /** The pill's time inputs (Floor's liveTime): Done → checkedAt, Direct →
   *  directLoadedAt, Needs check → pickedAt, With picker → assignedAt. Tint done
   *  carries no time here (no tint completion read — no time beats a borrowed one). */
  assignedAt: string | null;
  pickedAt: string | null;
  checkedAt: string | null;

  /** A supervisor-CONFIRMED pick finding on any line (recordedById not null). */
  hasFinding: boolean;
  /** The copy on THIS trip, if any. */
  copiedAt: string | null;
  copiedByName: string | null;
  copyKind: string | null;
  /** The bill's latest copy on ANOTHER trip — a quiet note; it does not change `state`. */
  copiedOnOtherTrip: { tripNumber: string; at: string } | null;
}

/**
 *   open     — billing has not pressed Done.
 *   reopened — Done was pressed, and since then a non-held bill arrived that is
 *              not copied (a bill joined, a hold lifted). Never on a dispatched trip.
 *   done     — Done pressed, nothing outstanding (or the trip is dispatched).
 */
export type PrintTripState = "open" | "reopened" | "done";

export interface PrintTrip {
  id: number;
  tripNumber: string;
  tripDate: string;
  status: string;
  sentToBillingAt: string | null;
  sentToBillingByName: string | null;
  /** The latest copy press on this trip (any bill). */
  billingCopiedAt: string | null;
  billingCopiedByName: string | null;
  billingDoneAt: string | null;
  billingDoneByName: string | null;
  state: PrintTripState;
  /** Non-removed bills on the trip, held included. */
  bills: number;
  /** Stops holding at least one bill. */
  stops: number;
  litres: number;
  held: number;
  /** bills − held: the ones billing copies. */
  eligible: number;
  /** Of `eligible`, how many carry an SAP invoice number (Floor's Send toast reads it). */
  invoiced: number;
  copiedCount: number;
  readyCount: number;
  reviewCount: number;
  waitingCount: number;
  /** The bulk Copy's set, in table order. */
  readyOrderIds: number[];
  readyObds: string[];
  /** Done not pressed, ≥ 1 non-held bill, and every non-held bill copied. */
  canDone: boolean;
  rows: PrintBillRow[];
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/**
 * Build the Print view of the given trips. Missing ids are simply absent.
 *
 * Batched: trips, drops, bills (+ their pick assignment), litres, confirmed
 * findings, copy rows (this trip and others), colour work, names. None when the
 * list is empty.
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
      billingDoneAt: true,
      billingDoneById: true,
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
          workflowStage: true,
          orderType: true,
          smu: true,
          directLoadedAt: true,
          shipToCustomerName: true,
          materialType: true,
          shipToOverrideCustomer: { select: { customerName: true } },
          pickAssignment: { select: { assignedAt: true, pickedAt: true, checkedAt: true } },
        },
        orderBy: { id: "asc" },
      })
    : [];
  const orderIds = orders.map((o) => o.id);

  const snapshots = orderIds.length
    ? await prisma.import_obd_query_summary.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, totalVolume: true },
      })
    : [];
  const litresByOrderId = new Map<number, number>();
  for (const s of snapshots) if (s.orderId !== null) litresByOrderId.set(s.orderId, s.totalVolume);

  // 🔴 CONFIRMED ONLY — recordedById not null, the Picking tab's own test
  // (app/api/billing/picking/list/route.ts). A picker's unconfirmed report is a
  // claim, not a fact, and never reaches a billing screen (CLAUDE_PICKING §11.5).
  const findingRows = orderIds.length
    ? await prisma.pick_findings.findMany({
        where: { orderId: { in: orderIds }, recordedById: { not: null } },
        select: { orderId: true },
      })
    : [];
  const findingOrderIds = new Set(findingRows.map((f) => f.orderId));

  // Every copy of these bills, on any trip: this trip's row decides `copied`,
  // another trip's row is the quiet note.
  const copyRows = orderIds.length
    ? await prisma.trip_bill_copies.findMany({
        where: { orderId: { in: orderIds } },
        select: { tripId: true, orderId: true, copiedAt: true, copiedById: true, kind: true },
        orderBy: { copiedAt: "desc" },
      })
    : [];
  const otherTripIds = Array.from(
    new Set(copyRows.map((c) => c.tripId).filter((tid) => !trips.some((t) => t.id === tid))),
  );
  const otherTrips = otherTripIds.length
    ? await prisma.trips.findMany({ where: { id: { in: otherTripIds } }, select: { id: true, tripNumber: true } })
    : [];
  const tripNumberById = new Map<number, string>([
    ...trips.map((t) => [t.id, t.tripNumber] as [number, string]),
    ...otherTrips.map((t) => [t.id, t.tripNumber] as [number, string]),
  ]);

  // Floor's tint phase needs the colour rule: a "Base — No Tint" bill carries
  // no phase (lib/floor/queries.ts getFloorBoard). Zero queries unless a
  // project-division tint bill is loaded (lib/picking/colour-work-query.ts).
  const colourWorkByOrder = await getColourWorkByOrder(
    orders.map((o) => ({ orderId: o.id, smu: o.smu, orderType: o.orderType })),
  );

  const userIds = Array.from(
    new Set(
      [
        ...trips.flatMap((t) => [t.sentToBillingById, t.billingCopiedById, t.billingDoneById]),
        ...copyRows.map((c) => c.copiedById),
      ].filter((id): id is number => id !== null),
    ),
  );
  const users = userIds.length
    ? await prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const nameOf = (id: number | null) => (id !== null ? (nameById.get(id) ?? null) : null);

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

    const rows: PrintBillRow[] = own.map((o) => {
      const drop = dropById.get(o.tripDropId!)!;
      const held = o.dispatchStatus === HOLD;
      const isChecked = o.workflowStage === PICK_CHECKED || o.workflowStage === DISPATCHED;
      const hasFinding = findingOrderIds.has(o.id);
      // copyRows is newest first, so the first match per (trip, bill) is the latest.
      const mine = copyRows.find((c) => c.orderId === o.id && c.tripId === t.id) ?? null;
      const other = copyRows.find((c) => c.orderId === o.id && c.tripId !== t.id) ?? null;
      const state: PrintBillState = held
        ? "held"
        : mine
          ? "copied"
          : isChecked
            ? hasFinding
              ? "review"
              : "ready"
            : "waiting";
      return {
        orderId: o.id,
        obdNumber: o.obdNumber,
        invoiceNo: o.invoiceNo,
        shipToName: o.shipToOverrideCustomer?.customerName ?? o.shipToCustomerName,
        routeName: drop.routeName,
        dropSeq: drop.dropSeq,
        litres: litresByOrderId.get(o.id) ?? 0,
        isGift: isGiftBill(o.materialType),
        held,
        state,
        isAssigned: o.workflowStage === PICK_ASSIGNED,
        isDone: o.workflowStage === PICK_DONE,
        isChecked,
        isDispatched: o.workflowStage === DISPATCHED,
        directLoadedAt: iso(o.directLoadedAt),
        tintPhase: colourWorkByOrder.get(o.id) === "base" ? null : tintPhaseOf(o.orderType, o.workflowStage),
        assignedAt: iso(o.pickAssignment?.assignedAt),
        pickedAt: iso(o.pickAssignment?.pickedAt),
        checkedAt: iso(o.pickAssignment?.checkedAt),
        hasFinding,
        copiedAt: iso(mine?.copiedAt),
        copiedByName: nameOf(mine?.copiedById ?? null),
        copyKind: mine?.kind ?? null,
        copiedOnOtherTrip: other
          ? { tripNumber: tripNumberById.get(other.tripId) ?? `#${other.tripId}`, at: other.copiedAt.toISOString() }
          : null,
      };
    });

    const eligibleRows = rows.filter((r) => !r.held);
    const eligible = eligibleRows.length;
    const copiedCount = eligibleRows.filter((r) => r.state === "copied").length;
    const readyRows = eligibleRows.filter((r) => r.state === "ready");
    const outstanding = eligible - copiedCount;

    const state: PrintTripState =
      t.billingDoneAt === null
        ? "open"
        : t.status === TRIP_DISPATCHED || outstanding === 0
          ? "done"
          : "reopened";

    return {
      id: t.id,
      tripNumber: t.tripNumber,
      tripDate: t.tripDate.toISOString().slice(0, 10),
      status: t.status,
      sentToBillingAt: iso(t.sentToBillingAt),
      sentToBillingByName: nameOf(t.sentToBillingById),
      billingCopiedAt: iso(t.billingCopiedAt),
      billingCopiedByName: nameOf(t.billingCopiedById),
      billingDoneAt: iso(t.billingDoneAt),
      billingDoneByName: nameOf(t.billingDoneById),
      state,
      bills: own.length,
      stops: new Set(own.map((o) => o.tripDropId)).size,
      // A GIFT bill adds no litres (lib/orders/gift.ts); `bills` and `stops` above count it.
      litres: own.reduce((sum, o) => sum + loadLitres(litresByOrderId.get(o.id), isGiftBill(o.materialType)), 0),
      held: own.length - eligible,
      eligible,
      invoiced: eligibleRows.filter((r) => r.invoiceNo !== null).length,
      copiedCount,
      readyCount: readyRows.length,
      reviewCount: eligibleRows.filter((r) => r.state === "review").length,
      waitingCount: eligibleRows.filter((r) => r.state === "waiting").length,
      readyOrderIds: readyRows.map((r) => r.orderId),
      readyObds: readyRows.map((r) => r.obdNumber),
      canDone: t.billingDoneAt === null && eligible > 0 && outstanding === 0,
      rows,
    };
  });
}

/**
 * Ids of every trip with copy work outstanding — EXACT, one statement:
 * sent, not cancelled, and either Done not pressed, or (not dispatched and) a
 * non-held, non-removed bill on it has no copy row on THIS trip. The same set
 * the list's `pending` holds and the Print pill counts.
 */
export async function getPrintWorkTripIds(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT t.id
      FROM trips t
     WHERE t."sentToBillingAt" IS NOT NULL
       AND t.status <> 'cancelled'
       AND (
         t."billingDoneAt" IS NULL
         OR (
           t.status <> ${TRIP_DISPATCHED}
           AND EXISTS (
             SELECT 1
               FROM trip_drops d
               JOIN orders o ON o."tripDropId" = d.id
              WHERE d."tripId" = t.id
                AND o."isRemoved" = false
                AND o."dispatchStatus" IS DISTINCT FROM ${HOLD}
                AND NOT EXISTS (
                      SELECT 1 FROM trip_bill_copies c
                       WHERE c."tripId" = t.id AND c."orderId" = o.id)
           )
         )
       )`;
  return rows.map((r) => r.id);
}

/** Trips whose Done fell inside [start, end) (the list re-checks they are still done). */
export async function getDoneTripIds(start: Date, end: Date): Promise<number[]> {
  const rows = await prisma.trips.findMany({
    where: {
      sentToBillingAt: { not: null },
      status: { not: "cancelled" },
      billingDoneAt: { gte: start, lt: end },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Oldest sent first — the order billing works them, like Picking's oldest-checked-first. */
export function byOldestSent(a: PrintTrip, b: PrintTrip): number {
  return (a.sentToBillingAt ?? "").localeCompare(b.sentToBillingAt ?? "") || a.id - b.id;
}

/** Newest Done first. */
export function byNewestDone(a: PrintTrip, b: PrintTrip): number {
  return (b.billingDoneAt ?? "").localeCompare(a.billingDoneAt ?? "") || b.id - a.id;
}

/**
 * The Print marker's change key: the newest write that could alter anything the
 * tab shows. ONE statement, five MAXes:
 *
 *   - trips.updatedAt over EVERY trip — a send, a take-back, a copy press or a
 *     Done stamp. Deliberately unfiltered: a take-back removes the trip from any
 *     "sent" filter, so a filtered MAX would not see it move. ~120 rows.
 *   - trip_activity.createdAt on sent trips — a bill removed (its own
 *     `updatedAt` moves, but it is no longer on the trip to be counted).
 *   - orders.updatedAt on sent trips' bills — a stage change (picking Done), a
 *     number arriving, a hold.
 *   - pick_findings recordedAt / createdAt on sent trips' bills — a supervisor
 *     CONFIRMING a finding writes pick_findings only, never orders, so without
 *     this a bill turning to Review would not refresh the tab (2026-10-05).
 *   - trip_bill_copies.createdAt — another desk's copy (the trips stamp moves
 *     with it too; this arm is belt and braces). A tiny table.
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
        WHERE t."sentToBillingAt" IS NOT NULL),
      (SELECT MAX(GREATEST(f."recordedAt", f."createdAt"))
         FROM pick_findings f
         JOIN orders o ON o.id = f."orderId"
         JOIN trip_drops d ON d.id = o."tripDropId"
         JOIN trips t ON t.id = d."tripId"
        WHERE t."sentToBillingAt" IS NOT NULL),
      (SELECT MAX(c."createdAt") FROM trip_bill_copies c)
    ) AS latest`;
  return rows[0]?.latest ? rows[0].latest.toISOString() : null;
}

/** The common refusal shape of the two writers. */
export type PrintRefusal = { ok: false; status: number; error: string };

export type CopyBillsOutcome =
  | {
      ok: true;
      tripNumber: string;
      /** Bills this press recorded. */
      recorded: number;
      /** Bills someone else had already copied — sent but not recorded by this press. */
      alreadyCopied: number;
      obdNumbers: string[];
      billingCopiedAt: string | null;
    }
  | PrintRefusal;

/** The state each kind requires, per bill. */
function requiredState(kind: PrintCopyKind): PrintBillState {
  return kind === "review" ? "review" : "ready";
}

/**
 * Billing copied `orderIds` on a trip: record them.
 *
 * 🔴 THE CLIENT HAS ALREADY PUT THE OBD NUMBERS ON THE CLIPBOARD and sends
 * exactly those bills. The server re-derives every bill's state and records
 * ONLY if each one is still what the press needs — bulk / single → READY,
 * review → REVIEW — else 409 and nothing is written, so the history never
 * claims a bill the screen did not show as copyable.
 *
 * ⚠ A SECOND PRESS ON THE SAME BILL IS SKIPPED, NOT DOUBLE-RECORDED: the rows go
 * in with createMany skipDuplicates over trip_bill_copies_trip_order_key. Fewer
 * rows landing than were sent means someone else copied them first; the answer
 * says how many. `single` and `review` take exactly one bill.
 *
 * Then: trips.billingCopiedAt / ById (the latest copy press) and one
 * `bills_copied` activity row — both only when something landed.
 */
export async function copyTripBills(opts: {
  tripId: number;
  orderIds: number[];
  kind: PrintCopyKind;
  actorId: number;
}): Promise<CopyBillsOutcome> {
  const wanted = Array.from(new Set(opts.orderIds));
  if (wanted.length === 0) return { ok: false, status: 400, error: "No bills to copy." };
  if (opts.kind !== "bulk" && wanted.length !== 1) {
    return { ok: false, status: 400, error: `A ${opts.kind} copy takes exactly one bill.` };
  }

  const [trip] = await loadPrintTrips([opts.tripId]);
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  if (trip.sentToBillingAt === null) {
    return { ok: false, status: 409, error: `${trip.tripNumber} is not sent to billing.` };
  }
  if (trip.status === "cancelled") {
    return { ok: false, status: 409, error: `${trip.tripNumber} is cancelled.` };
  }

  const need = requiredState(opts.kind);
  const rowById = new Map(trip.rows.map((r) => [r.orderId, r]));
  const bills: PrintBillRow[] = [];
  for (const id of wanted) {
    const r = rowById.get(id);
    if (!r) {
      return { ok: false, status: 409, error: `A bill is no longer on ${trip.tripNumber} — nothing was recorded. Refresh.` };
    }
    if (r.state !== need) {
      return {
        ok: false,
        status: 409,
        error:
          r.state === "copied"
            ? `OBD ${r.obdNumber} was already copied — nothing was recorded. Refresh.`
            : `OBD ${r.obdNumber} changed since your screen loaded (now ${r.state}) — nothing was recorded. Refresh.`,
      };
    }
    bills.push(r);
  }

  const pressedAt = new Date();
  const created = await prisma.trip_bill_copies.createMany({
    data: bills.map((b) => ({
      tripId: trip.id,
      orderId: b.orderId,
      obdNumber: b.obdNumber,
      invoiceNo: b.invoiceNo,
      kind: opts.kind,
      copiedAt: pressedAt,
      copiedById: opts.actorId,
    })),
    skipDuplicates: true,
  });

  if (created.count === 0) {
    return {
      ok: true,
      tripNumber: trip.tripNumber,
      recorded: 0,
      alreadyCopied: bills.length,
      obdNumbers: [],
      billingCopiedAt: trip.billingCopiedAt,
    };
  }

  // Which bills THIS press recorded — a skipped duplicate carries someone
  // else's (or an earlier) stamp. Same press time and actor = ours.
  const landedRows = await prisma.trip_bill_copies.findMany({
    where: {
      tripId: trip.id,
      orderId: { in: bills.map((b) => b.orderId) },
      copiedById: opts.actorId,
      copiedAt: pressedAt,
    },
    select: { orderId: true },
  });
  const landedIds = new Set(landedRows.map((r) => r.orderId));
  const landed = bills.filter((b) => landedIds.has(b.orderId));

  await prisma.trips.update({
    where: { id: trip.id },
    data: { billingCopiedAt: pressedAt, billingCopiedById: opts.actorId },
  });

  await logTripBillsCopied({
    tripId: trip.id,
    actorId: opts.actorId,
    tripNumber: trip.tripNumber,
    orderIds: landed.map((b) => b.orderId),
    obdNumbers: landed.map((b) => b.obdNumber),
    kind: opts.kind,
  });

  return {
    ok: true,
    tripNumber: trip.tripNumber,
    recorded: created.count,
    alreadyCopied: bills.length - created.count,
    obdNumbers: landed.map((b) => b.obdNumber),
    billingCopiedAt: pressedAt.toISOString(),
  };
}

export type DoneOutcome =
  | { ok: true; changed: boolean; tripNumber: string; billingDoneAt: string | null }
  | PrintRefusal;

/**
 * Billing pressed "Done — all copied". Allowed only when the trip has ≥ 1
 * non-held bill and every one of them is copied on this trip. The stamp is a
 * conditional update on `billingDoneAt IS NULL`, so two presses record once.
 * A trip already done answers `changed: false` and writes nothing.
 */
export async function markTripBillingDone(opts: { tripId: number; actorId: number }): Promise<DoneOutcome> {
  const [trip] = await loadPrintTrips([opts.tripId]);
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  if (trip.sentToBillingAt === null) {
    return { ok: false, status: 409, error: `${trip.tripNumber} is not sent to billing.` };
  }
  if (trip.status === "cancelled") {
    return { ok: false, status: 409, error: `${trip.tripNumber} is cancelled.` };
  }
  if (trip.billingDoneAt !== null) {
    return { ok: true, changed: false, tripNumber: trip.tripNumber, billingDoneAt: trip.billingDoneAt };
  }
  if (!trip.canDone) {
    const left = trip.eligible - trip.copiedCount;
    return {
      ok: false,
      status: 409,
      error:
        trip.eligible === 0
          ? `${trip.tripNumber} has no bills to copy.`
          : `${trip.tripNumber}: ${left} bill${left === 1 ? " is" : "s are"} not copied yet.`,
    };
  }

  const stamp = new Date();
  const updated = await prisma.trips.updateMany({
    where: { id: trip.id, billingDoneAt: null },
    data: { billingDoneAt: stamp, billingDoneById: opts.actorId },
  });
  if (updated.count === 0) {
    return { ok: true, changed: false, tripNumber: trip.tripNumber, billingDoneAt: null };
  }

  await logTripBillingDone({
    tripId: trip.id,
    actorId: opts.actorId,
    tripNumber: trip.tripNumber,
    copiedCount: trip.copiedCount,
  });

  return { ok: true, changed: true, tripNumber: trip.tripNumber, billingDoneAt: stamp.toISOString() };
}

/** Is this bill on this trip, and is the trip on the Print tab (sent, not cancelled)? */
export async function isBillOnSentTrip(orderId: number, tripId: number): Promise<boolean> {
  const hit = await prisma.orders.findFirst({
    where: {
      id: orderId,
      isRemoved: false,
      tripDrop: { tripId, trip: { sentToBillingAt: { not: null }, status: { not: "cancelled" } } },
    },
    select: { id: true },
  });
  return hit !== null;
}
