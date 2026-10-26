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
//      trip_bill_copies row per bill (UNIQUE tripId + orderInvoiceId — a
//      second press on the same bill is skipped); the next press copies only
//      bills that became ready since. A SPLIT OBD (Add invoices P5-5, v27.74 —
//      PART 7 dropped the old per-OBD unique) gets ONE ROW PER INVOICE of it on
//      the trip, and reads copied there when every one is
//      (lib/order-invoices/copy-plan.ts — incl. the whole-OBD copy taken
//      before a split, e.g. copy 276). Slice 9's "never a partial set" (a trip copyable only
//      once every bill had an invoice number) was REMOVED on purpose — do not
//      restore it.
//   5. DONE IS A PRESS. When every non-held bill is copied, billing presses
//      "Done — all copied" (trips.billingDoneAt). A done trip whose bills change
//      (a bill joins, a hold lifts) REOPENS until those are copied — except a
//      DISPATCHED done trip, which never reopens. Trips with work outstanding
//      are listed from every date; done trips on the IST day of billingDoneAt.
//   6. CHALLAN ORDERS ARE NEVER ON PRINT (owner, 2026-10-06; Challan orders
//      slice 2b). An ORB order (orders.isChallanOrder) is the challan itself —
//      there is nothing to invoice, and its ORB-… number must never reach the
//      SAP clipboard. It is not shown, not counted, never copyable, and never
//      makes a trip ready or not ready: a mixed trip is exactly its SAP bills.
//      A trip carrying ONLY ORB orders is not on the tab at all (`challanOnly`;
//      getPrintWorkTripIds drops it too) and Send to billing refuses it
//      (lib/trips/billing.ts). A SAP bill linked to a challan order
//      ('challan_linked') never sits on a trip, but is filtered the same way so
//      the rule holds if one ever slips on. One owner: BILLABLE_BILL_WHERE.
//   7. COPY INV — AN INVOICED BILL NEEDS NO CHECKS (owner, 2026-10-07; Schema
//      v27.61). OBD copy waits for picking Done because a pick finding can force
//      a revision; once SAP has stamped an invoice number the bill is final. So
//      "Copy inv" copies every bill that HAS an invoice number and has NO copy
//      row on this trip yet — any picking state, HELD INCLUDED — as
//      trip_bill_copies kind 'invoice'. It is an ordinary copy row: the bill
//      counts as copied for Done / reopen / the pending list exactly like an OBD
//      copy. A held bill's row is harmless while it is held (held bills are
//      outside every count) and makes it copied once the hold lifts. The
//      clipboard carries each distinct INVOICE number once; every bill carrying
//      it is recorded.
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
import { CHALLAN_LINKED, DISPATCHED, PICK_ASSIGNED, PICK_CHECKED, PICK_DONE } from "@/lib/workflow-stages";
import { BILLABLE_BILL_WHERE } from "@/lib/challan-orders/where";
import { logTripBillingDone, logTripBillsCopied } from "@/lib/trips/activity";
import { invoiceRowLinks, RECORD_OBD_SELECT, recordObdOf, recordsOfObds } from "@/lib/order-invoices/links";
import { badSentNo, coveringCopy, isWholeObdCopy, planCopyRows } from "@/lib/order-invoices/copy-plan";
import { onStopsWhere, onTripsWhere, placeOnTrips, stopRowsSelect } from "@/lib/order-invoices/trip-read";
import { loadSplitInvoiceRows } from "@/lib/order-invoices/invoice-load";
import { placeLoad } from "@/lib/floor/invoice-rows";
import { INVOICE_SOURCE } from "@/lib/order-invoices/source";

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

/**
 * What a copy press records — trip_bill_copies.kind minus the one-off 'backfill'
 * (chk_trip_bill_copies_kind). 'invoice' = "Copy inv" (rule 7, v27.61).
 */
export type PrintCopyKind = "bulk" | "single" | "review" | "invoice";

export const PRINT_COPY_KINDS: readonly PrintCopyKind[] = ["bulk", "single", "review", "invoice"];

/** An SAP invoice number worth copying: trimmed, non-empty. Null otherwise. */
function invoiceOf(invoiceNo: string | null): string | null {
  const t = invoiceNo?.trim() ?? "";
  return t === "" ? null : t;
}

/**
 * One invoice of a SPLIT OBD on the trip (P5-5) — the tab draws one line each.
 * Its copy state is its OWN: a copy row on this trip naming it, or the OBD's
 * whole-bill copy taken before the split (`copiedWhole`, copy-plan.ts).
 */
export interface PrintInvoiceLine {
  /** order_invoices.id */
  id: number;
  seq: number;
  /** 1-based among ALL the OBD's invoices, and their count — "2/4". */
  k: number;
  n: number;
  invoiceNo: string | null;
  invoiceDate: string | null;
  litres: number;
  /** null = unknown. Exact (rules 1-2) or "~" shared (rule 3, never here: no header kg is read). */
  kg: number | null;
  kgExact: boolean;
  copiedAt: string | null;
  copiedByName: string | null;
  copyKind: string | null;
  /** The covering copy is the OBD's whole-bill copy from before the split. */
  copiedWhole: boolean;
  /** This invoice's latest copy on ANOTHER trip — a quiet note. */
  copiedOnOtherTrip: { tripNumber: string; at: string } | null;
}

export interface PrintBillRow {
  /**
   * A SPLIT OBD (Add invoices): the invoices of it that are on THIS trip, seq
   * order, each with its own copy state (P5-5). null = not split. `litres`
   * below is theirs when only some are on the trip (lib/floor/invoice-rows.ts
   * placeLoad), else the OBD's own. The bill's own copy fields say "copied"
   * only when EVERY line is.
   */
  invoices: PrintInvoiceLine[] | null;
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
  /** Non-removed bills on the trip, held included — challan orders NOT (rule 6). */
  bills: number;
  /** No billable bill, and at least one live ORB order: nothing to invoice, so
   *  the trip is kept off the tab and Send to billing refuses it (rule 6). */
  challanOnly: boolean;
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
  /** Copy inv's set (rule 7): bills with an invoice number and NO copy row on
   *  this trip, held included, any picking state — in table order. A SPLIT
   *  bill appears once PER uncopied invoice (P5-5). */
  invoicePendingOrderIds: number[];
  /** Parallel to invoicePendingOrderIds: the number each entry copies — what
   *  the Copy inv press sends back as `invoiceNos`. */
  invoicePendingBillNos: string[];
  /** Their invoice numbers, trimmed, each DISTINCT number once, in table order. */
  invoicePendingNos: string[];
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

  // THROUGH THE INVOICE ROWS (v27.66 readers B, lib/order-invoices/trip-read.ts):
  // a bill is on a trip when any of its invoice rows sits on one of the trip's
  // stops; it comes back ONCE per trip, on its lowest-seq row's stop there.
  // The COUNT stays per OBD (one bill line). A split OBD's litres are its
  // invoices on THAT trip (onTripOf, below) and its copies are per invoice row
  // (trip_bill_copies, v27.74). (Said "counts, litres and copies stay PER OBD
  // until Phase 5" until 2026-10-24.)
  const dropIds = drops.map((d) => d.id);
  const orders = drops.length
    ? placeOnTrips(
        await prisma.orders.findMany({
          // Rule 6: challan orders and linked bills never enter the Print view —
          // every count, state and copy set below is built from this list alone.
          where: { ...onStopsWhere(dropIds), isRemoved: false, ...BILLABLE_BILL_WHERE },
          select: {
            id: true,
            invoices: stopRowsSelect(dropIds),
            obdNumber: true,
            invoiceNo: true,
            dispatchStatus: true,
            workflowStage: true,
            orderType: true,
            smu: true,
            // The TINT pill on a hand-pulled bill of any division (colour-work-query.ts).
            manualTintEntry: true,
            directLoadedAt: true,
            shipToCustomerName: true,
            materialType: true,
            shipToOverrideCustomer: { select: { customerName: true } },
            pickAssignment: { select: { assignedAt: true, pickedAt: true, checkedAt: true } },
          },
          orderBy: { id: "asc" },
        }),
        new Map(drops.map((d) => [d.id, d.tripId])),
      )
    : [];
  const orderIds = Array.from(new Set(orders.map((o) => o.id)));

  const snapshots = orderIds.length
    ? await prisma.import_obd_query_summary.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, totalVolume: true },
      })
    : [];
  const litresByOrderId = new Map<number, number>();
  for (const s of snapshots) if (s.orderId !== null) litresByOrderId.set(s.orderId, s.totalVolume);

  // ── A SPLIT OBD on a trip carries only its invoices on THAT trip (Phase 5
  // commit 1). lib/order-invoices/invoice-load.ts — one index-only read when no
  // bill is split. Kg is not read here (Print shows litres), so no header kg.
  const splitRows = await loadSplitInvoiceRows(orders, new Map());
  const tripIdByDrop = new Map(drops.map((d) => [d.id, d.tripId] as const));
  const onTripOf = (o: { id: number; tripId: number }) => {
    const rows = splitRows.get(o.id);
    if (!rows) return null;
    return { rows: rows.filter((r) => r.tripDropId !== null && tripIdByDrop.get(r.tripDropId) === o.tripId), all: rows };
  };
  /** The litres a bill brings to ITS trip — the OBD's own unless only some of
   *  its invoices are on the trip. */
  const litresOn = (o: { id: number; tripId: number }): number => {
    const rows = splitRows.get(o.id);
    const load = rows ? placeLoad(rows, (d) => d !== null && tripIdByDrop.get(d) === o.tripId) : null;
    return load ? load.litres : litresByOrderId.get(o.id) ?? 0;
  };

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
  // another trip's row is the quiet note. Reached THROUGH the invoice row each
  // copy names (P5-4, lib/order-invoices/links.ts) — any copy on a trip naming
  // one of the OBD's rows makes it copied there.
  const copyRows = orderIds.length
    ? (
        await prisma.trip_bill_copies.findMany({
          where: recordsOfObds(orderIds),
          select: { tripId: true, orderInvoiceId: true, ...RECORD_OBD_SELECT, copiedAt: true, copiedById: true, kind: true },
          orderBy: { copiedAt: "desc" },
        })
      ).map((c) => ({ ...c, orderId: recordObdOf(c) }))
    : [];
  // P5-5 — each split OBD's split moment (its first seq ≥ 2 row): a copy older
  // than it was of the whole bill (lib/order-invoices/copy-plan.ts). None read
  // when no bill here is split.
  const splitIds = Array.from(splitRows.keys());
  const splitAtByOrder = new Map<number, Date>();
  if (splitIds.length > 0) {
    for (const r of await prisma.order_invoices.findMany({
      // A split-load truck part is not a split moment (copy-plan.ts splitAtOf).
      where: { orderId: { in: splitIds }, seq: { gt: 1 }, source: { not: INVOICE_SOURCE.LOAD } },
      select: { orderId: true, createdAt: true },
    })) {
      const at = splitAtByOrder.get(r.orderId);
      if (at === undefined || r.createdAt.getTime() < at.getTime()) splitAtByOrder.set(r.orderId, r.createdAt);
    }
  }

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
    orders.map((o) => ({ orderId: o.id, smu: o.smu, orderType: o.orderType, manualTintEntry: o.manualTintEntry })),
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

  // Rule 6: which of the trips with NO billable bill carry an ORB order. Asked
  // only for those trips, so a normal load runs no extra query.
  const emptyTripIds = trips.filter((t) => !ordersByTripId.has(t.id)).map((t) => t.id);
  const emptyDropIds = drops.filter((d) => emptyTripIds.includes(d.tripId)).map((d) => d.id);
  // Through the invoice rows too (v27.66) — every order, ORB orders included,
  // has its seq-1 row (Model A).
  const challanDropRows = emptyDropIds.length
    ? await prisma.order_invoices.findMany({
        where: { tripDropId: { in: emptyDropIds }, order: { isRemoved: false, isChallanOrder: true } },
        select: { tripDropId: true },
      })
    : [];
  const challanTripIds = new Set(
    challanDropRows
      .map((o) => (o.tripDropId !== null ? dropById.get(o.tripDropId)?.tripId : undefined))
      .filter((id): id is number => id !== undefined),
  );

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
      const other = copyRows.find((c) => c.orderId === o.id && c.tripId !== t.id) ?? null;
      // A SPLIT bill: one line per invoice here, each with its own copy (P5-5).
      const on = onTripOf(o);
      const splitAt = splitAtByOrder.get(o.id) ?? null;
      const ownCopies = on ? copyRows.filter((c) => c.orderId === o.id) : [];
      const lines: PrintInvoiceLine[] | null = on
        ? on.rows.map((r) => {
            const c = coveringCopy(ownCopies, r.id, splitAt, (tid) => tid === t.id);
            const oc = coveringCopy(ownCopies, r.id, splitAt, (tid) => tid !== t.id);
            return {
              id: r.id,
              seq: r.seq,
              k: on.all.findIndex((a) => a.id === r.id) + 1,
              n: on.all.length,
              invoiceNo: r.invoiceNo,
              invoiceDate: r.invoiceDate,
              litres: r.litres,
              kg: r.kg,
              kgExact: r.kgExact,
              copiedAt: iso(c?.copiedAt),
              copiedByName: nameOf(c?.copiedById ?? null),
              copyKind: c?.kind ?? null,
              copiedWhole: c ? isWholeObdCopy(c, splitAt) : false,
              copiedOnOtherTrip: oc
                ? { tripNumber: tripNumberById.get(oc.tripId) ?? `#${oc.tripId}`, at: oc.copiedAt.toISOString() }
                : null,
            };
          })
        : null;
      // Unsplit: the bill's copy on this trip. Split: copied only when every
      // line is — then the latest of their copies stands for the bill.
      const mine = !lines
        ? (copyRows.find((c) => c.orderId === o.id && c.tripId === t.id) ?? null)
        : lines.length > 0 && lines.every((l) => l.copiedAt !== null)
          ? (ownCopies
              .filter((c) => c.tripId === t.id && on!.rows.some((r) => coveringCopy([c], r.id, splitAt, () => true) !== null))
              .sort((a, b) => b.copiedAt.getTime() - a.copiedAt.getTime())[0] ?? null)
          : null;
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
        litres: litresOn(o),
        invoices: lines,
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
    // Rule 7: keyed on the copy row, NOT on `state` — a held bill reads "held"
    // whatever its copy row says, and Copy inv includes held bills. A SPLIT
    // bill: each of its invoices here without a copy (P5-5).
    const invoicePending: Array<{ orderId: number; no: string }> = [];
    for (const r of rows) {
      if (r.invoices) {
        for (const l of r.invoices) {
          const no = invoiceOf(l.invoiceNo);
          if (l.copiedAt === null && no !== null) invoicePending.push({ orderId: r.orderId, no });
        }
      } else {
        const no = invoiceOf(r.invoiceNo);
        if (r.copiedAt === null && no !== null) invoicePending.push({ orderId: r.orderId, no });
      }
    }

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
      challanOnly: own.length === 0 && challanTripIds.has(t.id),
      stops: new Set(own.map((o) => o.tripDropId)).size,
      // A GIFT bill adds no litres (lib/orders/gift.ts); `bills` and `stops` above count it.
      litres: own.reduce((sum, o) => sum + loadLitres(litresOn(o), isGiftBill(o.materialType)), 0),
      held: own.length - eligible,
      eligible,
      invoiced: eligibleRows.filter((r) => r.invoiceNo !== null).length,
      copiedCount,
      readyCount: readyRows.length,
      reviewCount: eligibleRows.filter((r) => r.state === "review").length,
      waitingCount: eligibleRows.filter((r) => r.state === "waiting").length,
      readyOrderIds: readyRows.map((r) => r.orderId),
      readyObds: readyRows.map((r) => r.obdNumber),
      invoicePendingOrderIds: invoicePending.map((p) => p.orderId),
      invoicePendingBillNos: invoicePending.map((p) => p.no),
      invoicePendingNos: Array.from(new Set(invoicePending.map((p) => p.no))),
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
 *
 * Rule 6 (challan orders, 2026-10-06) in SQL — the twin of BILLABLE_BILL_WHERE:
 * an ORB order or a linked bill never counts as outstanding work, and a trip
 * whose live bills are ALL ORB orders is dropped (loadPrintTrips' challanOnly).
 * Both columns are NOT NULL, so `= false` / `<>` need no null arm (CORE §13);
 * the existing `IS DISTINCT FROM` hold arm is untouched.
 *
 * Bills are reached THROUGH THE INVOICE ROWS (v27.66 readers B): trip_drops →
 * order_invoices."tripDropId" → orders. Inside EXISTS, a bill with several rows
 * on the trip cannot count twice. Copies are PER INVOICE ROW (P5-5): an
 * invoice row on the trip with no copy covering it is outstanding.
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
               JOIN order_invoices oi ON oi."tripDropId" = d.id
               JOIN orders o ON o.id = oi."orderId"
              WHERE d."tripId" = t.id
                AND o."isRemoved" = false
                AND o."dispatchStatus" IS DISTINCT FROM ${HOLD}
                AND o."isChallanOrder" = false
                AND o."workflowStage" <> ${CHALLAN_LINKED}
                AND NOT EXISTS (
                      SELECT 1 FROM trip_bill_copies c
                        JOIN order_invoices ci ON ci.id = c."orderInvoiceId"
                       WHERE c."tripId" = t.id AND ci."orderId" = o.id
                         -- P5-5: the copy names THIS invoice row, or is the
                         -- OBD's whole-bill copy from before its split. An
                         -- unsplit OBD has no seq >= 2 row, so the MIN is NULL
                         -- and only the first arm (its one row) can hold.
                         AND (c."orderInvoiceId" = oi.id
                              OR c."copiedAt" < (SELECT MIN(x."createdAt") FROM order_invoices x
                                                  WHERE x."orderId" = o.id AND x.seq > 1
                                                    -- A split-load part is not a split moment (copy-plan.ts splitAtOf).
                                                    AND x.source <> ${INVOICE_SOURCE.LOAD})))
           )
         )
       )
       AND NOT (
         EXISTS (
           SELECT 1 FROM trip_drops d JOIN order_invoices oi ON oi."tripDropId" = d.id JOIN orders o ON o.id = oi."orderId"
            WHERE d."tripId" = t.id AND o."isRemoved" = false AND o."isChallanOrder" = true)
         AND NOT EXISTS (
           SELECT 1 FROM trip_drops d JOIN order_invoices oi ON oi."tripDropId" = d.id JOIN orders o ON o.id = oi."orderId"
            WHERE d."tripId" = t.id AND o."isRemoved" = false
              AND o."isChallanOrder" = false AND o."workflowStage" <> ${CHALLAN_LINKED})
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
 *
 * "Sent trips' bills" are reached THROUGH THE INVOICE ROWS (v27.66 readers B).
 * A MAX cannot be inflated by a bill with several rows on a trip.
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
         JOIN order_invoices oi ON oi."orderId" = o.id
         JOIN trip_drops d ON d.id = oi."tripDropId"
         JOIN trips t ON t.id = d."tripId"
        WHERE t."sentToBillingAt" IS NOT NULL),
      (SELECT MAX(GREATEST(f."recordedAt", f."createdAt"))
         FROM pick_findings f
         JOIN order_invoices oi ON oi."orderId" = f."orderId"
         JOIN trip_drops d ON d.id = oi."tripDropId"
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
      /** Distinct invoice numbers of the bills this press recorded (an `invoice` press; empty otherwise). */
      invoiceNos: string[];
      billingCopiedAt: string | null;
    }
  | PrintRefusal;

/** The state each OBD kind requires, per bill. `invoice` has no state rule (rule 7). */
function requiredState(kind: Exclude<PrintCopyKind, "invoice">): PrintBillState {
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
 * in with createMany skipDuplicates over trip_bill_copies_trip_invoice_key.
 * Both presses name the same invoice rows (copy-plan.ts planCopyRows: seq 1 on
 * an unsplit bill, each uncopied invoice here on a split one). A bill none of
 * whose rows landed was copied by someone else first; the answer says how
 * many. `single` and `review` take exactly one bill.
 *
 * `invoice` ("Copy inv", rule 7) puts INVOICE numbers on the clipboard and
 * sends every bill carrying them, with `invoiceNos[i]` = the number the screen
 * showed for `orderIds[i]`. Picking state and hold are ignored; each bill must
 * still have NO copy row on this trip and its live invoice number (trimmed)
 * must equal the one sent — else 409 and nothing is written, so a row never
 * claims a number that was not on the clipboard. A SPLIT bill is sent once per
 * invoice (P5-5): every number sent must be one of its invoices here with no
 * copy yet, and exactly those invoices get a row.
 *
 * Then: trips.billingCopiedAt / ById (the latest copy press — an `invoice`
 * press is one too) and one `bills_copied` activity row (`detail.kind` names
 * the press) — both only when something landed.
 */
export async function copyTripBills(opts: {
  tripId: number;
  orderIds: number[];
  kind: PrintCopyKind;
  actorId: number;
  /** `invoice` only: parallel to `orderIds`. */
  invoiceNos?: string[];
}): Promise<CopyBillsOutcome> {
  const isInvoice = opts.kind === "invoice";
  // invoice: the numbers the screen showed per bill, keyed by order id — one
  // on an unsplit bill (checked once the trip is loaded), one per invoice on a
  // split one.
  const sentNosById = new Map<number, Set<string>>();
  if (isInvoice) {
    if (!opts.invoiceNos || opts.invoiceNos.length !== opts.orderIds.length) {
      return { ok: false, status: 400, error: "An invoice copy needs one invoice number per bill." };
    }
    for (let i = 0; i < opts.orderIds.length; i++) {
      const no = invoiceOf(opts.invoiceNos[i]);
      if (no === null) return { ok: false, status: 400, error: "An invoice copy needs one invoice number per bill." };
      const set = sentNosById.get(opts.orderIds[i]) ?? new Set<string>();
      set.add(no);
      sentNosById.set(opts.orderIds[i], set);
    }
  }

  const wanted = Array.from(new Set(opts.orderIds));
  if (wanted.length === 0) return { ok: false, status: 400, error: "No bills to copy." };
  if ((opts.kind === "single" || opts.kind === "review") && wanted.length !== 1) {
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

  const rowById = new Map(trip.rows.map((r) => [r.orderId, r]));
  const bills: PrintBillRow[] = [];
  for (const id of wanted) {
    const r = rowById.get(id);
    if (!r) {
      return { ok: false, status: 409, error: `A bill is no longer on ${trip.tripNumber} — nothing was recorded. Refresh.` };
    }
    if (isInvoice && r.invoices) {
      // A SPLIT bill (P5-5): every number sent is one of its invoices here
      // with no copy yet.
      const bad = badSentNo(
        r.invoices.map((l) => ({ id: l.id, invoiceNo: l.invoiceNo, copied: l.copiedAt !== null })),
        sentNosById.get(id) ?? new Set(),
      );
      if (bad !== null) {
        return {
          ok: false,
          status: 409,
          error: `Invoice ${bad} of OBD ${r.obdNumber} was already copied or is no longer on ${trip.tripNumber} — nothing was recorded. Refresh.`,
        };
      }
      bills.push(r);
      continue;
    }
    if (isInvoice) {
      if ((sentNosById.get(id)?.size ?? 0) > 1) {
        return { ok: false, status: 400, error: "A bill was sent with two different invoice numbers." };
      }
      // Rule 7: no state rule — only "not copied yet" and "same number".
      // `copiedAt`, not `state`: a held bill reads "held" whatever its copy row.
      if (r.copiedAt !== null) {
        return { ok: false, status: 409, error: `OBD ${r.obdNumber} was already copied — nothing was recorded. Refresh.` };
      }
      if (invoiceOf(r.invoiceNo) !== Array.from(sentNosById.get(id) ?? [])[0]) {
        return {
          ok: false,
          status: 409,
          error: `OBD ${r.obdNumber}'s invoice number changed since your screen loaded — nothing was recorded. Refresh.`,
        };
      }
      bills.push(r);
      continue;
    }
    if (r.state !== requiredState(opts.kind as Exclude<PrintCopyKind, "invoice">)) {
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
  // Which invoice rows each bill's copy names (lib/order-invoices/copy-plan.ts):
  // seq 1 on an unsplit bill; on a split one EACH invoice here not copied yet —
  // a Copy inv press only the ones whose numbers were sent (P5-5).
  const seq1 = await invoiceRowLinks(bills.filter((b) => !b.invoices).map((b) => b.orderId));
  const data: Array<{
    tripId: number;
    orderId: number;
    orderInvoiceId: number;
    obdNumber: string;
    invoiceNo: string | null;
    kind: PrintCopyKind;
    copiedAt: Date;
    copiedById: number;
  }> = [];
  for (const b of bills) {
    const planned = planCopyRows(
      {
        split: b.invoices !== null,
        seq1Id: seq1.get(b.orderId)?.seq1Id ?? null,
        here: (b.invoices ?? []).map((l) => ({ id: l.id, invoiceNo: l.invoiceNo, copied: l.copiedAt !== null })),
      },
      isInvoice && b.invoices ? (sentNosById.get(b.orderId) ?? new Set()) : null,
    );
    if (planned.length === 0 && !b.invoices) {
      console.error(`[print] order ${b.orderId} has no seq-1 invoice row — its copy was not recorded; re-run v27.63 PART 3`);
    }
    for (const p of planned) {
      data.push({
        tripId: trip.id,
        orderId: b.orderId,
        orderInvoiceId: p.orderInvoiceId,
        obdNumber: b.obdNumber,
        // A split bill's row records ITS invoice's number; unsplit as before.
        invoiceNo: b.invoices ? p.invoiceNo : b.invoiceNo,
        kind: opts.kind,
        copiedAt: pressedAt,
        copiedById: opts.actorId,
      });
    }
  }
  const created = data.length > 0 ? await prisma.trip_bill_copies.createMany({ data, skipDuplicates: true }) : { count: 0 };

  if (created.count === 0) {
    return {
      ok: true,
      tripNumber: trip.tripNumber,
      recorded: 0,
      alreadyCopied: bills.length,
      obdNumbers: [],
      invoiceNos: [],
      billingCopiedAt: trip.billingCopiedAt,
    };
  }

  // Which rows THIS press recorded — a skipped duplicate carries someone
  // else's (or an earlier) stamp. Same press time and actor = ours. A bill is
  // recorded when any of its rows landed.
  const landedRows = await prisma.trip_bill_copies.findMany({
    where: {
      tripId: trip.id,
      ...recordsOfObds(bills.map((b) => b.orderId)),
      copiedById: opts.actorId,
      copiedAt: pressedAt,
    },
    select: { ...RECORD_OBD_SELECT, invoiceNo: true },
  });
  const landedIds = new Set(landedRows.map(recordObdOf));
  const landed = bills.filter((b) => landedIds.has(b.orderId));
  const landedInvoiceNos = isInvoice
    ? Array.from(new Set(landedRows.map((r) => invoiceOf(r.invoiceNo)).filter((n): n is string => n !== null)))
    : [];

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
    invoiceNos: isInvoice ? landedInvoiceNos : undefined,
  });

  return {
    ok: true,
    tripNumber: trip.tripNumber,
    recorded: landed.length,
    alreadyCopied: bills.length - landed.length,
    obdNumbers: landed.map((b) => b.obdNumber),
    invoiceNos: landedInvoiceNos,
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

/** Is this bill on this trip, and is the trip on the Print tab (sent, not cancelled)?
 *  "On this trip" = any of its invoice rows on one of the trip's stops (v27.66
 *  readers C, lib/order-invoices/trip-read.ts onTripsWhere). */
export async function isBillOnSentTrip(orderId: number, tripId: number): Promise<boolean> {
  const hit = await prisma.orders.findFirst({
    where: {
      id: orderId,
      isRemoved: false,
      ...onTripsWhere({ id: tripId, sentToBillingAt: { not: null }, status: { not: "cancelled" } }),
    },
    select: { id: true },
  });
  return hit !== null;
}
