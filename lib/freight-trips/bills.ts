// lib/freight-trips/bills.ts — put bills on a freight trip, take them off.
//
// 🔴 WRITES freight_trip_bills ONLY (and one freight_trip_activity row per press).
// Never orders, trips, trip_drops, trip_activity or order_status_logs — a freight
// trip is paper; the bill stays exactly as Floor left it.
//
// 🔴 ONE ACTIVE FREIGHT TRIP PER BILL is enforced by the DATABASE:
//   freight_trip_bills_order_active_key UNIQUE ("orderId") WHERE "removedAt" IS NULL
// The pre-read below only turns the common case into a readable refusal; the
// index is the lock, and a P2002 from a race is caught per bill.
//
// Sequential awaits, one insert per bill, never prisma.$transaction (CORE §3).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logFreightBills } from "./activity";
import { REMOVED_REASON } from "./status";

export interface BillSkip {
  orderId: number;
  reason: string;
}

export interface BillsResult {
  /** orderIds that actually moved. */
  done: number[];
  skipped: BillSkip[];
}

function uniqueIds(orderIds: readonly number[]): number[] {
  return Array.from(new Set(orderIds.filter((n) => Number.isInteger(n) && n > 0)));
}

/** The active freight trip number each of these bills is on, if any. */
async function activeTripOf(orderIds: number[]): Promise<Map<number, { tripId: number; tripNumber: string }>> {
  const rows =
    orderIds.length > 0
      ? await prisma.freight_trip_bills.findMany({
          where: { orderId: { in: orderIds }, removedAt: null },
          select: { orderId: true, freightTripId: true, freightTrip: { select: { tripNumber: true } } },
        })
      : [];
  return new Map(rows.map((r) => [r.orderId, { tripId: r.freightTripId, tripNumber: r.freightTrip.tripNumber }]));
}

function isActiveRowCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return text.includes("orderId") || text.includes("freight_trip_bills_order_active_key");
}

/**
 * Add bills to a trip. Each must exist, not be removed, and be HELD right now
 * (dispatchStatus = 'hold'). The caller has already refused a cancelled trip.
 */
export async function addFreightBills(opts: {
  freightTripId: number;
  orderIds: readonly number[];
  actorId: number;
}): Promise<BillsResult> {
  const ids = uniqueIds(opts.orderIds);
  const orders =
    ids.length > 0
      ? await prisma.orders.findMany({
          where: { id: { in: ids } },
          select: { id: true, obdNumber: true, isRemoved: true, dispatchStatus: true },
        })
      : [];
  const byId = new Map(orders.map((o) => [o.id, o]));
  const onTrip = await activeTripOf(ids);

  const done: number[] = [];
  const movedObds: string[] = [];
  const skipped: BillSkip[] = [];

  for (const orderId of ids) {
    const o = byId.get(orderId);
    if (!o) { skipped.push({ orderId, reason: "Bill not found" }); continue; }
    if (o.isRemoved) { skipped.push({ orderId, reason: `${o.obdNumber} is removed` }); continue; }
    if (o.dispatchStatus !== "hold") { skipped.push({ orderId, reason: `${o.obdNumber} is not on hold` }); continue; }
    const current = onTrip.get(orderId);
    if (current) {
      skipped.push({
        orderId,
        reason: current.tripId === opts.freightTripId
          ? `${o.obdNumber} is already on this trip`
          : `Already on ${current.tripNumber} — remove it first`,
      });
      continue;
    }
    try {
      await prisma.freight_trip_bills.create({
        data: { freightTripId: opts.freightTripId, orderId, addedById: opts.actorId },
      });
      done.push(orderId);
      movedObds.push(o.obdNumber);
    } catch (err) {
      if (!isActiveRowCollision(err)) throw err;
      // Lost a race: somebody put it on a trip between the pre-read and the insert.
      const now = (await activeTripOf([orderId])).get(orderId);
      skipped.push({ orderId, reason: `Already on ${now?.tripNumber ?? "another freight trip"} — remove it first` });
    }
  }

  await logFreightBills({ freightTripId: opts.freightTripId, actorId: opts.actorId, direction: "added", obdNumbers: movedObds });
  return { done, skipped };
}

/** Take bills off a trip: stamp the ACTIVE row of THIS trip only. Rows are kept. */
export async function removeFreightBills(opts: {
  freightTripId: number;
  orderIds: readonly number[];
  actorId: number;
}): Promise<BillsResult> {
  const ids = uniqueIds(opts.orderIds);
  const active =
    ids.length > 0
      ? await prisma.freight_trip_bills.findMany({
          where: { freightTripId: opts.freightTripId, orderId: { in: ids }, removedAt: null },
          select: { orderId: true, order: { select: { obdNumber: true } } },
        })
      : [];
  const activeIds = active.map((r) => r.orderId);
  const skipped: BillSkip[] = ids
    .filter((id) => !activeIds.includes(id))
    .map((orderId) => ({ orderId, reason: "Not on this trip" }));

  if (activeIds.length > 0) {
    await prisma.freight_trip_bills.updateMany({
      where: { freightTripId: opts.freightTripId, orderId: { in: activeIds }, removedAt: null },
      data: { removedAt: new Date(), removedById: opts.actorId, removedReason: REMOVED_REASON.removed },
    });
  }

  await logFreightBills({
    freightTripId: opts.freightTripId,
    actorId: opts.actorId,
    direction: "removed",
    obdNumbers: active.map((r) => r.order.obdNumber),
  });
  return { done: activeIds, skipped };
}
