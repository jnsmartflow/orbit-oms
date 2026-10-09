// lib/reports/nts-trips-data.ts
//
// The rows behind the NTS TRIPS report (2026-10-09, Smart Flow) — Nagadhiraj's
// trip-wise summary, the old NTS "Tempo Report". ONE row per Floor trip.
// Read by app/api/reports/nts-trips/route.ts and nothing else.
//
// 🔴 READ-ONLY. SELECTs only, sequential awaits, never prisma.$transaction
// (CORE §3). Every read is batched — no per-trip query loop.
// 🔴 SERVER-ONLY — it imports prisma.
//
// ── WHICH TRIPS (owner, 2026-10-09) ──────────────────────────────────────────
//   Orbit FLOOR trips only (`trips`) — never freight_trips, never trip_report.
//   trips.transporterId = 4, Nagadhiraj (verified 2026-10-09 as the only
//   transporter_master row of that name). EVERY such trip that is not
//   cancelled — including trips with zero bills, and typed plates such as
//   "HAND", "CI" or "TESTTRIP", printed exactly as typed (owner: no exclusions).
//   Period: trips.createdAt as an IST date (NOT manualDispatchAt — owner).
//   Delivery type: the trip's OWN type (trips.deliveryTypeId).
//
// ── WHICH BILLS COUNT ON A TRIP ──────────────────────────────────────────────
//   orders.tripDropId → trip_drops.tripId, not isRemoved, not cancelled.
//   HELD bills COUNT — they are on the truck plan (owner).
//
// ── REMARKS — the typed ship-to of a free-text redirect ──────────────────────
//   A bill with shipToOverride = true and NO shipToOverrideCustomerId has no
//   master row, so no name on the order itself. The name the operator typed
//   lives on the MAIL ORDER: mo_orders.deliveryRemarks (same soNumber, its own
//   shipToOverride true), parsed by splitDeliveryRemarks — the read Billing's
//   review header uses (app/(mail-orders)/mail-orders/review-view.tsx). Place
//   still uses the area rule; such a bill falls back to its site / bill-to area.

import { prisma } from "@/lib/prisma";
import { isGiftBill, loadKg, loadLitres } from "@/lib/orders/gift";
import { effectiveCustomerId } from "@/lib/trips/drop-key";
import { TRIP_CANCELLED } from "@/lib/trips/live-trips";
import { splitDeliveryRemarks } from "@/lib/mail-orders/utils";
import { resolveDeliveryArea } from "@/lib/trip-report/display";
import { parseReportDate } from "@/lib/reports/trip-detail-data";
import {
  billQuantities,
  blank,
  isSiteDelivery,
  loadBillToAreas,
  loadBillToByObd,
  loadCustomers,
  loadSnapshots,
} from "@/lib/reports/bill-facts";

/** transporter_master.id of Nagadhiraj — the transporter this report is for
 *  (owner, 2026-10-09; the only row of that name, verified live that day). */
export const NTS_TRANSPORTER_ID = 4;

/** One trip, already resolved to what the sheet prints. */
export interface NtsTripRow {
  tripNo: string;
  /** trips.createdAt — the instant; the workbook takes its IST day and time. */
  createdAt: Date;
  dealerCount: number;
  /** Distinct effective areas, UPPERCASE, A–Z, ", " — "" for an empty trip. */
  place: string;
  /** Whole litres (gifts add 0). */
  litres: number;
  /** Kilos, up to 3 decimals (gifts and unknown add 0). */
  kg: number;
  vehicleNo: string | null;
  driverName: string | null;
  /** vehicle_master.category; null for a typed plate. */
  vehicleModel: string | null;
  /** The trip's own type first, then the bills' others — "LOCAL, UPC". */
  deliveryTypes: string;
  /** The trip's own letter — L / U / I / C. */
  typeLetter: string;
  /** Typed ship-to names of free-text redirects, ", " — "" when none. */
  remarks: string;
  /** trips.dieselAmount in rupees, rounded; 0 when null. */
  diesel: number;
  /** trips.note (the drawer's "Reason / note"), line breaks → space; "" when empty. */
  tripNote: string;
}

export interface NtsTripsParams {
  /** YYYY-MM-DD, inclusive — the trip's CREATED date (IST). */
  from: string;
  to: string;
  /** The TRIP's own delivery type; null/absent = all. */
  deliveryTypeId?: number | null;
}

/** orders.workflowStage for a cancelled bill (no exported constant exists for the stage). */
const STAGE_CANCELLED = "cancelled";

const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A delivery type as the sheet writes it: UPPERCASE, Upcountry → "UPC". */
function typeLabel(name: string): string {
  const n = name.trim().toUpperCase();
  return n === "UPCOUNTRY" ? "UPC" : n;
}

export async function getNtsTripsRows(params: NtsTripsParams): Promise<NtsTripRow[]> {
  const fromDate = parseReportDate(params.from);
  const toDate = parseReportDate(params.to);
  if (fromDate.getTime() > toDate.getTime()) throw new Error("`from` is after `to`");
  // The period as instants: IST midnight of `from` to IST midnight after `to`.
  const winStart = new Date(fromDate.getTime() - IST_MS);
  const winEnd = new Date(toDate.getTime() + DAY_MS - IST_MS);

  // ── 1. Nagadhiraj's trips created in the period ─────────────────────────
  const trips = await prisma.trips.findMany({
    where: {
      transporterId: NTS_TRANSPORTER_ID,
      status: { not: TRIP_CANCELLED },
      createdAt: { gte: winStart, lt: winEnd },
      ...(params.deliveryTypeId ? { deliveryTypeId: params.deliveryTypeId } : {}),
    },
    select: {
      id: true,
      tripNumber: true,
      typeCode: true,
      createdAt: true,
      adhocVehicleNo: true,
      driverName: true,
      dieselAmount: true,
      note: true,
      deliveryType: { select: { id: true, name: true } },
      vehicle: { select: { vehicleNo: true, category: true } },
    },
    orderBy: [{ createdAt: "asc" }, { tripNumber: "asc" }],
  });
  if (trips.length === 0) return [];

  // ── 2. Their stops and live bills ────────────────────────────────────────
  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    select: { id: true, tripId: true },
  });
  const tripIdByDrop = new Map(drops.map((d) => [d.id, d.tripId]));
  const orders = drops.length
    ? await prisma.orders.findMany({
        where: {
          tripDropId: { in: drops.map((d) => d.id) },
          isRemoved: false,
          workflowStage: { not: STAGE_CANCELLED },
        },
        select: {
          id: true,
          obdNumber: true,
          soNumber: true,
          tripDropId: true,
          customerId: true,
          shipToOverride: true,
          shipToOverrideCustomerId: true,
          shipToCustomerId: true,
          smu: true,
          grossWeight: true,
          volume: true,
          materialType: true,
        },
      })
    : [];

  // ── 3. The per-bill facts (shared with the other trip reports) ───────────
  const allIds = orders.map((o) => o.id);
  const snapByOrder = await loadSnapshots(allIds);
  const billToByObd = await loadBillToByObd(orders.map((o) => o.obdNumber));
  const custById = await loadCustomers(
    Array.from(
      new Set(
        orders.flatMap((o) => [o.customerId, o.shipToOverrideCustomerId]).filter((id): id is number => id !== null),
      ),
    ),
  );
  const billToAreaByCode = await loadBillToAreas(billToByObd);

  // ── 4. Typed ship-to names for free-text redirects ───────────────────────
  const freeTextSos = Array.from(
    new Set(
      orders
        .filter((o) => o.shipToOverride && o.shipToOverrideCustomerId === null)
        .map((o) => blank(o.soNumber))
        .filter((s): s is string => s !== null),
    ),
  );
  const mailOrders = freeTextSos.length
    ? await prisma.mo_orders.findMany({
        where: { soNumber: { in: freeTextSos }, shipToOverride: true },
        select: { soNumber: true, deliveryRemarks: true },
        orderBy: { id: "asc" },
      })
    : [];
  const typedNamesBySo = new Map<string, string[]>();
  for (const m of mailOrders) {
    const so = blank(m.soNumber);
    const name = blank(splitDeliveryRemarks(m.deliveryRemarks, true).shipToName);
    if (so === null || name === null) continue;
    const list = typedNamesBySo.get(so) ?? [];
    if (!list.includes(name)) list.push(name);
    typedNamesBySo.set(so, list);
  }

  // Delivery-type order for the "others" after the trip's own: master id order.
  const typeRank = new Map<string, number>();

  // ── Assemble, per trip ───────────────────────────────────────────────────
  interface Acc {
    stops: Set<number>;
    places: Set<string>;
    types: Map<string, number>; // name → id
    litres: number;
    kg: number;
    remarks: string[];
  }
  const accByTrip = new Map<number, Acc>();
  for (const t of trips) {
    accByTrip.set(t.id, { stops: new Set(), places: new Set(), types: new Map(), litres: 0, kg: 0, remarks: [] });
  }

  for (const o of orders) {
    const tripId = o.tripDropId !== null ? tripIdByDrop.get(o.tripDropId) : undefined;
    const acc = tripId !== undefined ? accByTrip.get(tripId) : undefined;
    if (!acc || o.tripDropId === null) continue;

    acc.stops.add(o.tripDropId);

    const gift = isGiftBill(o.materialType);
    const { kg, litres } = billQuantities(snapByOrder.get(o.id), o);
    acc.litres += loadLitres(litres, gift);
    acc.kg += loadKg(kg, gift) ?? 0;

    // Place — the freight report's area rule (freight-report-data.ts), in
    // resolveDeliveryArea's order: Other Delivery Area → Site Area → Customer Area.
    const billTo = billToByObd.get(o.obdNumber);
    const billToCode = blank(billTo?.code);
    const sapShipTo = o.customerId !== null ? custById.get(o.customerId) : undefined;
    const isSite = isSiteDelivery({
      billToCode,
      sapShipToCode: o.shipToCustomerId,
      shipToType: sapShipTo?.customerType?.name ?? sapShipTo?.premisesType?.name ?? null,
      smu: o.smu,
    });
    const redirect =
      o.shipToOverrideCustomerId !== null && o.shipToOverrideCustomerId !== o.customerId
        ? custById.get(o.shipToOverrideCustomerId)
        : undefined;
    const area = resolveDeliveryArea({
      otherDelAreaName: redirect?.area.name ?? null,
      siteArea: isSite ? (sapShipTo?.area.name ?? null) : null,
      custAreaName: billToCode !== null ? (billToAreaByCode.get(billToCode) ?? null) : null,
    });
    if (area !== "") acc.places.add(area.toUpperCase());

    // The bill's own delivery type: effective point → area → type.
    const eid = effectiveCustomerId(o);
    const dt = eid !== null ? custById.get(eid)?.area.deliveryType : undefined;
    if (dt) {
      acc.types.set(dt.name, dt.id);
      typeRank.set(dt.name, dt.id);
    }

    // Remarks — free-text redirects only.
    if (o.shipToOverride && o.shipToOverrideCustomerId === null) {
      const so = blank(o.soNumber);
      for (const name of so !== null ? (typedNamesBySo.get(so) ?? []) : []) {
        if (!acc.remarks.includes(name)) acc.remarks.push(name);
      }
    }
  }

  return trips.map((t) => {
    const acc = accByTrip.get(t.id)!;
    const own = t.deliveryType.name;
    const others = Array.from(acc.types.keys())
      .filter((n) => n !== own)
      .sort((a, b) => (typeRank.get(a) ?? 0) - (typeRank.get(b) ?? 0));
    return {
      tripNo: t.tripNumber,
      createdAt: t.createdAt,
      dealerCount: acc.stops.size,
      place: Array.from(acc.places).sort((a, b) => a.localeCompare(b)).join(", "),
      litres: Math.round(acc.litres),
      kg: Math.round(acc.kg * 1000) / 1000,
      vehicleNo: blank(t.vehicle?.vehicleNo) ?? blank(t.adhocVehicleNo),
      driverName: blank(t.driverName),
      vehicleModel: t.vehicle ? blank(t.vehicle.category) : null,
      deliveryTypes: [own, ...others].map(typeLabel).join(", "),
      typeLetter: t.typeCode,
      remarks: acc.remarks.join(", "),
      diesel: t.dieselAmount === null ? 0 : Math.round(t.dieselAmount.toNumber()),
      tripNote: (t.note ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim(),
    };
  });
}
