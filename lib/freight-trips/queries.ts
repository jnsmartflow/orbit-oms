// lib/freight-trips/queries.ts — the reads behind the freight trip rail and one trip.
//
// READ-ONLY. Sequential awaits, never prisma.$transaction (CORE §3).
//
// Bills on a trip are its ACTIVE membership rows (removedAt IS NULL). A bill that
// was released on Floor STAYS on the trip (owner decision) — so a trip can hold
// bills that are no longer held. Those are built by a small read with the same
// row shape and marked `currentlyHeld: false`; the held ones come from Floor's
// own getFloorHold (imported read-only), so the shared HoldTable renders both.
// isRemoved bills are dropped at read time and never counted.

import { prisma } from "@/lib/prisma";
import { getFloorHold } from "@/lib/floor/queries";
import { computeDropKey } from "@/lib/trips/drop-key";
import { formatRouteLabel, rankRouteName } from "@/lib/trips/route-label";
import { dealerDisplayName } from "@/lib/orders/dealer-name";
import { isGiftBill, loadKg, loadLitres } from "@/lib/orders/gift";
import type { FloorHoldRow } from "@/lib/floor/types";
import { getFreightActivity, type FreightActivityRow } from "./activity";
import { FREIGHT_TRIP_STATUS } from "./status";

/** A bill on a freight trip: Floor's hold row shape + two freight facts. */
export interface FreightBillRow extends FloorHoldRow {
  /** dispatchStatus === 'hold' right now. False = released on Floor since it was added. */
  currentlyHeld: boolean;
  /** computeDropKey — the stop this bill belongs to. */
  stopKey: string;
  /** When it joined this trip (ISO). */
  addedAt: string;
}

export interface FreightStop {
  stopKey: string;
  name: string;
  route: string | null;
  area: string | null;
  bills: FreightBillRow[];
}

export interface FreightTripCounts {
  bills: number;
  stops: number;
  /** Load litres (gift = 0). */
  litres: number;
  /** Known load kg (gift = 0); `kgUnknown` bills had no weight. */
  kg: number;
  kgUnknown: number;
  /** Bills on the trip that are no longer held. */
  released: number;
}

export interface FreightTripSummary {
  id: number;
  tripNumber: string;
  tripDate: string; // YYYY-MM-DD
  status: string;
  vehicleId: number | null;
  vehicleNo: string | null;
  adhocVehicleNo: string | null;
  /** What a person reads: the master plate, else the ad-hoc plate, else null. */
  vehicleLabel: string | null;
  transporterId: number | null;
  transporterName: string | null;
  driverName: string | null;
  driverPhone: string | null;
  note: string | null;
  /** The planner's dispatch time, ISO, or null on an older trip (v27.55). Shown in IST. */
  manualDispatchAt: string | null;
  createdAt: string;
  createdByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  /** "Adajan +2" — the trip's main route over its stops. */
  routeLabel: string | null;
  counts: FreightTripCounts;
}

export interface FreightTripDetail extends FreightTripSummary {
  stops: FreightStop[];
  activity: FreightActivityRow[];
}

const TRIP_SELECT = {
  id: true,
  tripNumber: true,
  tripDate: true,
  status: true,
  vehicleId: true,
  adhocVehicleNo: true,
  transporterId: true,
  driverName: true,
  driverPhone: true,
  note: true,
  manualDispatchAt: true,
  createdAt: true,
  cancelledAt: true,
  vehicle: { select: { vehicleNo: true } },
  transporter: { select: { name: true } },
  createdBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
} as const;

/** The effective dealer select — the same shape as Floor's (private) FLOOR_DEALER_SELECT. */
const DEALER_SELECT = {
  id: true,
  customerName: true,
  isKeyCustomer: true,
  area: {
    select: {
      name: true,
      primaryRoute: { select: { id: true, name: true } },
      deliveryType: { select: { name: true } },
    },
  },
} as const;

/** The ACTIVE membership rows of these trips, with what counts and stops need. */
async function activeMembership(tripIds: number[]) {
  if (tripIds.length === 0) return [];
  return prisma.freight_trip_bills.findMany({
    where: { freightTripId: { in: tripIds }, removedAt: null, order: { isRemoved: false } },
    orderBy: [{ addedAt: "asc" }, { id: "asc" }],
    select: {
      freightTripId: true,
      orderId: true,
      addedAt: true,
      order: {
        select: {
          dispatchStatus: true,
          customerId: true,
          shipToOverrideCustomerId: true,
          shipToCustomerId: true,
          materialType: true,
          customer: { select: { area: { select: { primaryRoute: { select: { name: true } } } } } },
          shipToOverrideCustomer: { select: { area: { select: { primaryRoute: { select: { name: true } } } } } },
          querySnapshot: { select: { totalVolume: true, totalWeight: true } },
        },
      },
    },
  });
}
type Membership = Awaited<ReturnType<typeof activeMembership>>[number];

function countsOf(members: Membership[]): FreightTripCounts {
  const stops = new Set<string>();
  let litres = 0;
  let kg = 0;
  let kgUnknown = 0;
  let released = 0;
  for (const m of members) {
    const o = m.order;
    stops.add(computeDropKey(o));
    const gift = isGiftBill(o.materialType);
    litres += loadLitres(o.querySnapshot?.totalVolume ?? null, gift);
    const rawKg = o.querySnapshot?.totalWeight ?? null;
    const w = loadKg(rawKg !== null && rawKg > 0 ? rawKg : null, gift);
    if (w === null) kgUnknown += 1;
    else kg += w;
    if (o.dispatchStatus !== "hold") released += 1;
  }
  return { bills: members.length, stops: stops.size, litres, kg, kgUnknown, released };
}

function routeLabelOf(members: Membership[]): string | null {
  const items = members.map((m, i) => {
    const dealer = m.order.shipToOverrideCustomer ?? m.order.customer;
    return { name: dealer?.area?.primaryRoute?.name ?? null, order: i, hasBills: true };
  });
  return formatRouteLabel(rankRouteName(items));
}

type TripRecord = NonNullable<Awaited<ReturnType<typeof loadTrip>>>;
function loadTrip(id: number) {
  return prisma.freight_trips.findUnique({ where: { id }, select: TRIP_SELECT });
}

function summaryOf(t: TripRecord, members: Membership[]): FreightTripSummary {
  return {
    id: t.id,
    tripNumber: t.tripNumber,
    tripDate: t.tripDate.toISOString().slice(0, 10),
    status: t.status,
    vehicleId: t.vehicleId,
    vehicleNo: t.vehicle?.vehicleNo ?? null,
    adhocVehicleNo: t.adhocVehicleNo,
    vehicleLabel: t.vehicle?.vehicleNo ?? t.adhocVehicleNo ?? null,
    transporterId: t.transporterId,
    transporterName: t.transporter?.name ?? null,
    driverName: t.driverName,
    driverPhone: t.driverPhone,
    note: t.note,
    manualDispatchAt: t.manualDispatchAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    createdByName: t.createdBy?.name ?? null,
    cancelledAt: t.cancelledAt ? t.cancelledAt.toISOString() : null,
    cancelledByName: t.cancelledBy?.name ?? null,
    routeLabel: routeLabelOf(members),
    counts: countsOf(members),
  };
}

/** Every freight trip dated `tripDate` (active AND cancelled), newest created first. */
export async function getFreightTripsForDate(tripDate: Date): Promise<FreightTripSummary[]> {
  const trips = await prisma.freight_trips.findMany({
    where: { tripDate },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: TRIP_SELECT,
  });
  const members = await activeMembership(trips.map((t) => t.id));
  const byTrip = new Map<number, Membership[]>();
  for (const m of members) {
    const list = byTrip.get(m.freightTripId) ?? [];
    list.push(m);
    byTrip.set(m.freightTripId, list);
  }
  return trips.map((t) => summaryOf(t, byTrip.get(t.id) ?? []));
}

/**
 * EVERY freight trip, any date (2026-10-03 — the rail lists all active trips and
 * the "Cancelled (n)" link all cancelled ones): newest tripDate first, then
 * newest created. Additive beside getFreightTripsForDate, which `?date=` keeps.
 */
export async function getAllFreightTrips(): Promise<FreightTripSummary[]> {
  const trips = await prisma.freight_trips.findMany({
    orderBy: [{ tripDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: TRIP_SELECT,
  });
  const members = await activeMembership(trips.map((t) => t.id));
  const byTrip = new Map<number, Membership[]>();
  for (const m of members) {
    const list = byTrip.get(m.freightTripId) ?? [];
    list.push(m);
    byTrip.set(m.freightTripId, list);
  }
  return trips.map((t) => summaryOf(t, byTrip.get(t.id) ?? []));
}

/**
 * Rows for bills that are on a trip but NOT returned by getFloorHold (released
 * on Floor since, or hidden by a hide rule). Same FloorHoldRow shape, built from
 * one read; the hold-only facts read as "not held".
 */
async function plainRows(orderIds: number[]): Promise<Map<number, FloorHoldRow>> {
  const out = new Map<number, FloorHoldRow>();
  if (orderIds.length === 0) return out;
  const orders = await prisma.orders.findMany({
    where: { id: { in: orderIds }, isRemoved: false },
    include: {
      customer: { select: DEALER_SELECT },
      shipToOverrideCustomer: { select: DEALER_SELECT },
      querySnapshot: { select: { articleTag: true, totalVolume: true, totalWeight: true } },
    },
  });
  for (const o of orders) {
    const dealer = o.shipToOverrideCustomer ?? o.customer;
    const w = o.querySnapshot?.totalWeight ?? null;
    out.set(o.id, {
      orderId: o.id,
      obdNumber: o.obdNumber,
      isHand: o.handAt !== null,
      // FloorHoldRow shape (2026-10-07) — an `include`, so the scalar is loaded.
      isChallanOrder: o.isChallanOrder,
      dealerName: dealerDisplayName(dealer?.customerName, o.shipToCustomerName),
      billToName: null,
      isShipToOverride: o.shipToOverrideCustomerId !== null,
      smu: o.smu,
      route: dealer?.area?.primaryRoute?.name ?? null,
      area: dealer?.area?.name ?? null,
      deliveryType: dealer?.area?.deliveryType?.name ?? null,
      isKeyCustomer: dealer?.isKeyCustomer ?? false,
      priorityLevel: o.priorityLevel,
      isTint: o.orderType === "tint",
      colourWork: null,
      volumeLitres: o.querySnapshot?.totalVolume ?? null,
      articleTag: o.querySnapshot?.articleTag ?? null,
      obdDateTime: (o.obdEmailDate ?? o.orderDateTime)?.toISOString() ?? null,
      heldAt: o.heldAt?.toISOString() ?? null,
      heldSince: null,
      heldSinceSource: "unknown",
      invoiceNo: o.invoiceNo ?? null,
      soNumber: o.soNumber ?? null,
      dealerInMaster: dealer != null,
      invoiceDate: o.invoiceDate ? o.invoiceDate.toISOString() : null,
      weightKg: w !== null && w > 0 ? w : null,
      isGift: isGiftBill(o.materialType),
      heldFrom: "Unknown",
      heldById: null,
      heldByName: null,
    });
  }
  return out;
}

/** One freight trip: header, its active bills grouped into stops, its history. */
export async function getFreightTrip(id: number): Promise<FreightTripDetail | null> {
  const trip = await loadTrip(id);
  if (!trip) return null;
  const members = await activeMembership([id]);
  const ids = members.map((m) => m.orderId);

  // Held bills: Floor's own rows (same predicate, same hide exclusion).
  const held = ids.length > 0 ? await getFloorHold("All", undefined, ids) : [];
  const heldById = new Map(held.map((r) => [r.orderId, r]));
  // Everything else on the trip: the small same-shape read.
  const rest = await plainRows(ids.filter((oid) => !heldById.has(oid)));

  const stopsByKey = new Map<string, FreightStop>();
  for (const m of members) {
    const base = heldById.get(m.orderId) ?? rest.get(m.orderId);
    if (!base) continue; // removed between the two reads
    const stopKey = computeDropKey(m.order);
    const row: FreightBillRow = {
      ...base,
      currentlyHeld: m.order.dispatchStatus === "hold",
      stopKey,
      addedAt: m.addedAt.toISOString(),
    };
    let stop = stopsByKey.get(stopKey);
    if (!stop) {
      stop = { stopKey, name: row.dealerName, route: row.route, area: row.area, bills: [] };
      stopsByKey.set(stopKey, stop);
    }
    stop.bills.push(row);
  }

  const activity = await getFreightActivity(id);
  return { ...summaryOf(trip, members), stops: Array.from(stopsByKey.values()), activity };
}

/** For the bills route: is this trip editable? Null when it does not exist. */
export async function getFreightTripState(
  id: number,
): Promise<{ id: number; tripNumber: string; status: string } | null> {
  return prisma.freight_trips.findUnique({ where: { id }, select: { id: true, tripNumber: true, status: true } });
}

export function isCancelled(status: string): boolean {
  return status === FREIGHT_TRIP_STATUS.cancelled;
}
