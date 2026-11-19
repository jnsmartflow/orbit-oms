// lib/trips/ship-to-on-trip.ts
//
// SHIP-TO CHANGE ON A BILL THAT IS ON A TRIP (owner D2 / D8, 2026-10-24).
//
// Every other ship-to path refuses an on-trip bill (lib/floor/ship-to.ts
// loadShipToBill, lib/billing/ship-to-write.ts) because the stop would keep
// pointing at the old site. This path does the opposite: the bill STAYS on its
// trip and moves to the stop for its new shop — an existing stop for that shop,
// else a new one at the end. The emptied old stop closes and the stops
// renumber (deleteTripDropIfEmpty, the remove path's own rule).
//
// 🔴 ONE orders.update PER BILL. The four ship-to columns ride in setRowsTrip's
// step-3 write beside tripDropId / partlyOnTrip (`orderData`) — never a ship-to
// write followed by a trip write. No order_status_logs row for the stop move;
// the ONE status row written is the ship-to change itself, the same row every
// ship-to save writes (logShipToChange).
//
// The stop identity is computeDropKey over the bill WITH the new columns — the
// typed `t:` key works unchanged. Never an inlined key.
//
// Refused (wording below): trip missing / cancelled, bill missing, a
// challan-linked bill (bills route wording), a bill whose invoices sit on
// different trips (D8), a bill not on this trip, a held invoice of a split
// bill on this trip (the add rule's wording).
//
// 🔴 PER-PART SHIP-TO (v27.81, owner 2026-11-19, batch 3 — plan §C.3). This is
// an OBD-WIDE change (orders), so it moves ONLY the rows that INHERIT the bill's
// ship-to (order_invoices."shipToOverride" NULL). A part with its OWN ship-to
// stays on its own stop and never blocks:
//   · D8 refuses only when the INHERITING rows sit on more than one trip;
//   · "on this trip", the held check and the stop it leaves read inheriting rows;
//   · the write moves the inheriting rows on this trip, never "all";
//   · when no inheriting row is on this trip (every part here has its own), the
//     change cannot move a stop here — it goes to the off-trip writer
//     (lib/floor/ship-to.ts setShipTo), which writes orders and refuses by its
//     own (inheriting-only) rule.
// With every part inheriting — every live row at v27.81 — each of these is
// exactly the old rule, byte for byte (same rows, same "all", same wording).
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "@/lib/prisma";
import { isInheriting } from "@/lib/ship-to/effective";
import { CHALLAN_LINKED } from "@/lib/workflow-stages";
import { computeDropKey } from "@/lib/trips/drop-key";
import { deleteTripDropIfEmpty, findOrCreateTripDrop } from "@/lib/trips/drop";
import { setRowsTrip } from "@/lib/order-invoices/trip-link";
import { invoiceLabel } from "@/lib/order-invoices/trip-bills";
import { loadPartsOf } from "@/lib/order-invoices/load-plan";
import { logTripShipToChanged } from "@/lib/trips/activity";
import { dealerDisplayName } from "@/lib/orders/dealer-name";
import { isAsPerChallanText } from "@/lib/ship-to/copy";
import {
  finishShipToCopies,
  isShipToUnchanged,
  keptPartsText,
  logShipToChange,
  setShipTo,
  shipToColumns,
  validateShipToTarget,
  type ShipToTarget,
} from "@/lib/floor/ship-to";

export type TripShipToRefusal = { ok: false; status: number; error: string };

/** What a save WOULD do — the modal's preview line, and the write's plan. */
export interface TripShipToPreview {
  tripNumber: string;
  /** Same four columns as now — a save writes nothing. */
  unchanged: boolean;
  /** The new shop is the stop the bill is already on. */
  sameStop: boolean;
  /** Joins another stop already on the trip (false = a new stop). */
  joinsExisting: boolean;
  /** The stop name the bill lands under. */
  newShop: string;
  /** The stop it leaves (null when it had none — no invoice rows, an old row). */
  oldShop: string | null;
  /** The old stop has nothing else on it and will close. */
  oldStopCloses: boolean;
  /** v27.81 — parts that keep their OWN ship-to and do not move (0 on an unsplit bill). */
  keptParts: number;
  /** v27.81 — the preview line for them ("1 part keeps its own ship-to"), or null. */
  keptPartsNote: string | null;
  /** v27.81 — no inheriting row is on this trip: the change writes the bill only
   *  (the off-trip writer) and moves no stop here. */
  offTrip: boolean;
}

interface Plan {
  ok: true;
  preview: TripShipToPreview;
  trip: { id: number; tripNumber: string };
  /** v27.81 — the inheriting rows on THIS trip that move; "all" when no row keeps its own (today's write). */
  moveRowIds: number[] | "all";
  bill: {
    id: number;
    obdNumber: string;
    soNumber: string | null;
    customerId: number | null;
    shipToOverride: boolean;
    shipToOverrideCustomerId: number | null;
    shipToCustomerId: string;
    shipToCustomerName: string | null;
    shipToText: string | null;
    shipToAreaId: number | null;
  };
  next: ReturnType<typeof shipToColumns>;
  fromDropId: number | null;
}

/**
 * The checks and the target stop, WITHOUT writing anything. The route calls it
 * for the preview and before any copy is uploaded; setTripShipTo re-runs it.
 */
export async function planTripShipTo(
  tripId: number,
  orderId: number,
  target: ShipToTarget,
): Promise<Plan | TripShipToRefusal> {
  const trip = await prisma.trips.findUnique({ where: { id: tripId }, select: { id: true, status: true, tripNumber: true } });
  if (!trip) return { ok: false, status: 404, error: "Trip not found" };
  if (trip.status === "cancelled") {
    return { ok: false, status: 409, error: "Cannot change the bills on a cancelled trip." };
  }

  // THE CHECK — a live bill (lib/floor/ship-to.ts readShipToBill's rule),
  // read wider: the drop key needs the customer and SAP's code.
  const bill = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: {
      id: true,
      obdNumber: true,
      soNumber: true,
      workflowStage: true,
      customerId: true,
      shipToOverride: true,
      shipToOverrideCustomerId: true,
      shipToCustomerId: true,
      shipToCustomerName: true,
      shipToText: true,
      shipToAreaId: true,
      tripDropId: true,
      tripDrop: { select: { tripId: true } },
    },
  });
  if (!bill) return { ok: false, status: 404, error: "Order not found" };

  // The bills route's challan rule, word for word.
  if (bill.workflowStage === CHALLAN_LINKED) {
    return {
      ok: false,
      status: 409,
      error: `${bill.obdNumber} is billed against a challan order — its goods already went out on the challan. It never goes on a trip.`,
    };
  }

  // Where each invoice row sits — the truth (v27.66); orders.tripDropId is derived.
  const rows = await prisma.order_invoices.findMany({
    where: { orderId },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      invoiceNo: true,
      tripDropId: true,
      isHeld: true,
      tripDrop: { select: { tripId: true, trip: { select: { tripNumber: true } } } },
      // F11 — a load part is named "I… part k of n" (loadPartsOf).
      loadParentId: true,
      // v27.81 — a part with its OWN ship-to does not move with the bill.
      shipToOverride: true,
    },
  });
  const parts = loadPartsOf(rows);
  // v27.81: only the INHERITING rows move. An unsplit bill's one row always
  // inherits; with no row keeping its own, `moving` is every row (today).
  const moving = rows.length >= 2 ? rows.filter((r) => isInheriting(r)) : rows;
  const keptParts = rows.length - moving.length;
  const onTrip = moving.filter((r) => r.tripDropId !== null && r.tripDrop !== null);

  // D8 — the rows that MOVE on DIFFERENT trips: refused, naming them. Moving
  // one trip's stop would leave the other's stale. A part with its own ship-to
  // does not move, so it never counts here (v27.81).
  const tripNumbers = Array.from(new Set(onTrip.map((r) => r.tripDrop?.trip.tripNumber ?? "(unknown)")));
  if (tripNumbers.length > 1) {
    const where = onTrip.map((r) => `${invoiceLabel({ ...r, part: parts.get(r.id) }, bill.obdNumber)} on ${r.tripDrop?.trip.tripNumber ?? "(unknown)"}`).join(", ");
    return {
      ok: false,
      status: 409,
      error:
        keptParts === 0
          ? `${bill.obdNumber} is split across trips: ${where}. Ship-to can't change while its invoices are on different trips — take one invoice off its trip first.`
          : `${bill.obdNumber}'s parts that follow the bill's ship-to are on different trips: ${where}. Ship-to can't change while they are — take one off its trip first, or change those parts one by one.`,
    };
  }

  const here = onTrip.filter((r) => r.tripDrop?.tripId === tripId);
  // Any row of the bill on this trip at all (own ship-to included).
  const anyHere = rows.some((r) => r.tripDrop?.tripId === tripId);
  const onThisTrip = rows.length > 0 ? anyHere : bill.tripDrop?.tripId === tripId;
  if (!onThisTrip) {
    return { ok: false, status: 409, error: `${bill.obdNumber} is not on ${trip.tripNumber}` };
  }
  const keptPartsNote = keptPartsText(keptParts) === "" ? null : keptPartsText(keptParts);

  // v27.81 — the bill IS on this trip, but only through parts with their own
  // ship-to: nothing moves here. The change is the bill's alone → the off-trip
  // writer (it refuses by its own inheriting-only rule). Preview says so.
  if (rows.length > 0 && here.length === 0) {
    const bad = await validateShipToTarget(target);
    if (bad !== null) return { ok: false, ...bad };
    const next = shipToColumns(target);
    const name = await shopNameOf(next, bill);
    return {
      ok: true,
      preview: {
        tripNumber: trip.tripNumber,
        unchanged: isShipToUnchanged(bill, next),
        sameStop: true,
        joinsExisting: false,
        newShop: name,
        oldShop: null,
        oldStopCloses: false,
        keptParts,
        keptPartsNote,
        offTrip: true,
      },
      trip: { id: trip.id, tripNumber: trip.tripNumber },
      moveRowIds: [],
      bill,
      next,
      fromDropId: null,
    };
  }

  // A split bill's HELD invoice never joins a stop (the add rule, 6.3) — and
  // this press would put it on a new one.
  if (rows.length >= 2) {
    const held = here.find((r) => r.isHeld);
    if (held) return { ok: false, status: 409, error: `${invoiceLabel({ ...held, part: parts.get(held.id) }, bill.obdNumber)} is on hold — release it first` };
  }

  const fromDropIds = Array.from(new Set(here.map((r) => r.tripDropId as number)));
  if (fromDropIds.length > 1) {
    return { ok: false, status: 409, error: `Already attached to a different stop on ${trip.tripNumber}.` };
  }
  const fromDropId = fromDropIds[0] ?? bill.tripDropId;

  const bad = await validateShipToTarget(target);
  if (bad !== null) return { ok: false, ...bad };

  const next = shipToColumns(target);
  const after = { ...bill, ...next };
  const targetKey = computeDropKey(after);

  const fromDrop =
    fromDropId !== null
      ? await prisma.trip_drops.findUnique({ where: { id: fromDropId }, select: { id: true, dropKey: true, customerName: true } })
      : null;
  const sameStop = fromDrop !== null && fromDrop.dropKey === targetKey;
  const existing = sameStop
    ? fromDrop
    : await prisma.trip_drops.findFirst({ where: { tripId, dropKey: targetKey }, select: { id: true, customerName: true } });

  // The name the bill lands under: the stop's own snapshot when it exists,
  // else what findOrCreateTripDrop will snapshot (typed text, else the dealer
  // ladder of the effective customer).
  const newShop = existing?.customerName ?? (await shopNameOf(next, bill));

  // Closes when nothing else is left on it: no other bill, no other bill's
  // invoice row, no re-delivery (deleteTripDropIfEmpty's three counts) — and
  // (v27.81) none of THIS bill's own-ship-to parts, which stay where they are.
  let oldStopCloses = false;
  if (fromDrop !== null && !sameStop) {
    const otherOrders = await prisma.orders.count({ where: { tripDropId: fromDrop.id, id: { not: orderId } } });
    const otherRows = await prisma.order_invoices.count({ where: { tripDropId: fromDrop.id, orderId: { not: orderId } } });
    const redeliveries = await prisma.trip_redeliveries.count({ where: { tripDropId: fromDrop.id } });
    const ownStaying = rows.filter((r) => r.tripDropId === fromDrop.id && !moving.includes(r)).length;
    oldStopCloses = otherOrders + otherRows + redeliveries + ownStaying === 0;
  }

  return {
    ok: true,
    preview: {
      tripNumber: trip.tripNumber,
      unchanged: isShipToUnchanged(bill, next),
      sameStop,
      joinsExisting: !sameStop && existing !== null,
      newShop,
      oldShop: fromDrop?.customerName ?? null,
      oldStopCloses,
      keptParts,
      keptPartsNote,
      offTrip: false,
    },
    trip: { id: trip.id, tripNumber: trip.tripNumber },
    // With no part keeping its own, today's "all" (onlyFromTripId keeps it to this trip).
    moveRowIds: keptParts === 0 ? "all" : here.map((r) => r.id),
    bill,
    next,
    fromDropId,
  };
}

/**
 * The name a stop for `next` would be snapshotted under (findOrCreateTripDrop's
 * ladder): the typed text, else the effective dealer's master name, else SAP's
 * ship-to name. One read at most.
 */
async function shopNameOf(
  next: ReturnType<typeof shipToColumns>,
  bill: { customerId: number | null; shipToCustomerName: string | null },
): Promise<string> {
  if (next.shipToText !== null && !isAsPerChallanText(next.shipToText)) return next.shipToText;
  const effectiveId = next.shipToOverrideCustomerId ?? bill.customerId;
  const master =
    effectiveId !== null
      ? await prisma.delivery_point_master.findUnique({ where: { id: effectiveId }, select: { customerName: true } })
      : null;
  return dealerDisplayName(master?.customerName, bill.shipToCustomerName);
}

export type TripShipToResult =
  | { ok: true; changed: boolean; preview: TripShipToPreview; toDropId: number | null; oldStopClosed: boolean }
  | TripShipToRefusal;

/**
 * THE WRITE. Same four columns as now → nothing at all (not even updatedAt).
 * Otherwise: target stop (find or create) → ONE setRowsTrip with the ship-to
 * columns → the ship-to status row → copies → old stop closes if empty → one
 * `ship_to_changed` activity row (pastDay stamped by writeActivity).
 */
export async function setTripShipTo(args: {
  tripId: number;
  orderId: number;
  target: ShipToTarget;
  changedById: number;
}): Promise<TripShipToResult> {
  const { tripId, orderId, target, changedById } = args;
  const plan = await planTripShipTo(tripId, orderId, target);
  if (!plan.ok) return plan;
  if (plan.preview.unchanged) {
    return { ok: true, changed: false, preview: plan.preview, toDropId: plan.fromDropId, oldStopClosed: false };
  }

  // v27.81 — only own-ship-to parts are on this trip: the bill's change moves
  // no stop here; the off-trip writer owns it (one orders.update, one log).
  if (plan.preview.offTrip) {
    const r = await setShipTo({ orderId, target, changedById });
    if (!r.ok) return r;
    return { ok: true, changed: r.changed, preview: plan.preview, toDropId: null, oldStopClosed: false };
  }

  const { bill, next, fromDropId } = plan;
  // The stop for the NEW shop — the bill's facts with the new columns, so the
  // key and the snapshot describe where it goes.
  const toDrop = await findOrCreateTripDrop(tripId, {
    customerId: bill.customerId,
    shipToOverrideCustomerId: next.shipToOverrideCustomerId,
    shipToCustomerId: bill.shipToCustomerId,
    shipToText: next.shipToText,
    shipToAreaId: next.shipToAreaId,
    shipToCustomerName: bill.shipToCustomerName,
  });

  try {
    // ONE orders.update: tripDropId + partlyOnTrip + the four ship-to columns.
    // Only this trip's rows move (onlyFromTripId); a split bill's rows on no
    // trip stay where they are. v27.81: only the INHERITING rows here
    // (plan.moveRowIds) — "all" when no part keeps its own, exactly as before.
    await setRowsTrip(orderId, plan.moveRowIds, toDrop.id, { onlyFromTripId: tripId }, next);
  } catch (err) {
    // A stop made for this press and left empty is closed again, so a failed
    // save leaves no blank stop behind. Never the bill's own old stop.
    if (toDrop.id !== fromDropId && !plan.preview.joinsExisting) await deleteTripDropIfEmpty(toDrop.id).catch(() => false);
    throw err;
  }

  await logShipToChange({ orderId, before: bill, next, target, changedById, keptParts: plan.preview.keptParts });
  await finishShipToCopies(target, orderId, changedById);

  const oldStopClosed = fromDropId !== null && fromDropId !== toDrop.id ? await deleteTripDropIfEmpty(fromDropId) : false;

  const landed = await prisma.trip_drops.findUnique({ where: { id: toDrop.id }, select: { customerName: true } });
  await logTripShipToChanged({
    tripId,
    actorId: changedById,
    orderId,
    obdNumber: bill.obdNumber,
    newShop: landed?.customerName ?? plan.preview.newShop,
    oldShop: plan.preview.oldShop,
    fromDropId,
    toDropId: toDrop.id,
    oldStopClosed,
  });

  return { ok: true, changed: true, preview: plan.preview, toDropId: toDrop.id, oldStopClosed };
}
