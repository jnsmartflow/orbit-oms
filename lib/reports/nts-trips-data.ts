// lib/reports/nts-trips-data.ts
//
// The rows behind the NTS TRIPS report (2026-10-09, Smart Flow) — Nagadhiraj +
// JNL's (ids 4, 32) trip-wise summary, the old NTS "Tempo Report". ONE row per Floor trip.
// Read by app/api/reports/nts-trips/route.ts and nothing else.
//
// 🔴 READ-ONLY. SELECTs only, sequential awaits, never prisma.$transaction
// (CORE §3). Every read is batched — no per-trip query loop.
// 🔴 SERVER-ONLY — it imports prisma.
//
// ── WHICH TRIPS (owner, 2026-10-09) ──────────────────────────────────────────
//   Orbit FLOOR trips only (`trips`) — never freight_trips, never trip_report.
//   trips.transporterId in (4, 32) — Nagadhiraj + JNL (owner, 2026-10-24; ids
//   verified live that day). EVERY such trip that is not
//   cancelled — including trips with zero bills, and typed plates such as
//   "HAND", "CI" or "TESTTRIP", printed exactly as typed (owner: no exclusions).
//   Period: trips.tripDate — the day the truck LEFT (owner D7, 2026-10-24) —
//   compared as the plain @db.Date it is, no IST shift; sorted tripDate, then
//   trip number. Never manualDispatchAt (owner). A BACKDATED trip (tripDate
//   before the IST day of createdAt — made later from a past day on /floor)
//   prints its slot time as Dispatch Time (blank with no slot), never the
//   entry time, and "Entered DD-MM-YYYY HH:MM" (IST) in Remarks.
//   Was createdAt (owner choice) until 2026-10-24; now tripDate (D7) because past days can be edited. Do not revert.
//   Delivery type: the trip's OWN type (trips.deliveryTypeId).
//
// ── WHICH BILLS COUNT ON A TRIP ──────────────────────────────────────────────
//   the bill's invoice rows (v27.66, lib/order-invoices/trip-read.ts — each OBD
//   once per trip, on its lowest-seq row's stop) → trip_drops.tripId, not
//   isRemoved, not cancelled.
//   HELD bills COUNT — they are on the truck plan (owner).
//
// ── REMARKS — the name of every CHANGED ship-to (owner, 2026-10-09) ─────────
//   A master redirect (shipToOverrideCustomerId set AND not SAP's own point —
//   the same test as the area rule) prints that delivery_point_master row's
//   customerName as stored: a dealer or a transporter godown alike.
//   A legacy bill with shipToOverride = true and NO shipToOverrideCustomerId has no
//   master row, so no name on the order itself. The name the operator typed
//   lives on the MAIL ORDER: mo_orders.deliveryRemarks (same soNumber, its own
//   shipToOverride true), parsed by splitDeliveryRemarks — the read Billing's
//   review header uses (app/(mail-orders)/mail-orders/review-view.tsx). Place
//   still uses the area rule; such a bill falls back to its site / bill-to area.

import { prisma } from "@/lib/prisma";
import { onStopsWhere, placeOnTrips, stopRowsSelect } from "@/lib/order-invoices/trip-read";
import { loadSplitInvoiceRows } from "@/lib/order-invoices/invoice-load";
import { hasLoadGroup, placeLoad } from "@/lib/floor/invoice-rows";
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

/** transporter_master ids this report is for — Nagadhiraj + JNL (ids 4, 32;
 *  owner, 2026-10-24). */
export const NTS_TRANSPORTER_IDS = [4, 32] as const; // 4 Nagadhiraj, 32 JNL. Ids verified live 2026-10-24

/** One trip, already resolved to what the sheet prints. */
export interface NtsTripRow {
  tripNo: string;
  /** trips.tripDate (UTC midnight) — Month and Dispatch Date (D7). */
  tripDate: Date;
  /** trips.createdAt — the instant; the workbook takes its IST time for a normal trip. */
  createdAt: Date;
  /** tripDate is before the IST day of createdAt (made later from a past day). */
  backdated: boolean;
  /** The trip's dispatch slot (dispatch_slot_master.windowTime), or null. A
   *  backdated trip's Dispatch Time. */
  slotTime: string | null;
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
  /** Names of the changed ship-tos (master redirects + legacy typed names), ", " — "" when none. */
  remarks: string;
  /** trips.dieselAmount in rupees, rounded; 0 when null. */
  diesel: number;
  /** trips.note (the drawer's "Reason / note"), line breaks → space; "" when empty. */
  tripNote: string;
  /** transporter_master.name exactly as stored ("Nagadhiraj", "JNL"). */
  transporterName: string | null;
}

export interface NtsTripsParams {
  /** YYYY-MM-DD, inclusive — the trip's tripDate (D7, 2026-10-24). */
  from: string;
  to: string;
  /** The TRIP's own delivery type; null/absent = all. */
  deliveryTypeId?: number | null;
}

/** orders.workflowStage for a cancelled bill (no exported constant exists for the stage). */
const STAGE_CANCELLED = "cancelled";

const IST_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar day of an instant, as UTC midnight — tripDate's shape. */
function istDayOf(d: Date): Date {
  const s = new Date(d.getTime() + IST_MS);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
}

/** "24-10-2026 10:12" in IST — a backdated trip's Remarks note. */
function istDayTime(d: Date): string {
  const s = new Date(d.getTime() + IST_MS);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(s.getUTCDate())}-${p2(s.getUTCMonth() + 1)}-${s.getUTCFullYear()} ${p2(s.getUTCHours())}:${p2(s.getUTCMinutes())}`;
}

/** A delivery type as the sheet writes it: UPPERCASE, Upcountry → "UPC". */
function typeLabel(name: string): string {
  const n = name.trim().toUpperCase();
  return n === "UPCOUNTRY" ? "UPC" : n;
}

export async function getNtsTripsRows(params: NtsTripsParams): Promise<NtsTripRow[]> {
  const fromDate = parseReportDate(params.from);
  const toDate = parseReportDate(params.to);
  if (fromDate.getTime() > toDate.getTime()) throw new Error("`from` is after `to`");
  // ── 1. Nagadhiraj + JNL's (ids 4, 32) trips DATED in the period (D7) ──────
  // tripDate is a @db.Date (UTC midnight) — compared as a plain date, both ends
  // inclusive, exactly the shape parseReportDate returns.
  const trips = await prisma.trips.findMany({
    where: {
      transporterId: { in: [...NTS_TRANSPORTER_IDS] },
      status: { not: TRIP_CANCELLED },
      tripDate: { gte: fromDate, lte: toDate },
      ...(params.deliveryTypeId ? { deliveryTypeId: params.deliveryTypeId } : {}),
    },
    select: {
      id: true,
      tripNumber: true,
      typeCode: true,
      tripDate: true,
      createdAt: true,
      dispatchWindow: { select: { windowTime: true } },
      adhocVehicleNo: true,
      driverName: true,
      dieselAmount: true,
      note: true,
      deliveryType: { select: { id: true, name: true } },
      vehicle: { select: { vehicleNo: true, category: true } },
      transporter: { select: { name: true } },
    },
    orderBy: [{ tripDate: "asc" }, { tripNumber: "asc" }],
  });
  if (trips.length === 0) return [];

  // ── 2. Their stops and live bills ────────────────────────────────────────
  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    select: { id: true, tripId: true },
  });
  const tripIdByDrop = new Map(drops.map((d) => [d.id, d.tripId]));
  const dropIds = drops.map((d) => d.id);
  const orders = drops.length
    ? placeOnTrips(
        await prisma.orders.findMany({
          where: {
            ...onStopsWhere(dropIds),
            isRemoved: false,
            workflowStage: { not: STAGE_CANCELLED },
          },
          select: {
            id: true,
            obdNumber: true,
            soNumber: true,
            invoices: stopRowsSelect(dropIds),
            customerId: true,
            shipToOverride: true,
            shipToOverrideCustomerId: true,
            shipToCustomerId: true,
            // The typed ship-to (v27.73) — computeDropKey's t: branch needs both.
            shipToText: true,
            shipToAreaId: true,
            smu: true,
            grossWeight: true,
            volume: true,
            materialType: true,
          },
        }),
        tripIdByDrop,
      )
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
  // Split load (Phase 4 batch 1, 2026-10-25): a bill whose truck PARTS ride
  // different trips adds only the part on THIS trip (placeLoad). Every other
  // bill — Add invoices included — keeps its whole litres / kg. Index-only and
  // empty when no bill here is split.
  const splitRows = await loadSplitInvoiceRows(
    orders,
    new Map(orders.map((o) => [o.id, snapByOrder.get(o.id)?.totalWeight ?? null] as const)),
  );

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
    const whole = billQuantities(snapByOrder.get(o.id), o);
    const loadRows = splitRows.get(o.id);
    const part = loadRows && hasLoadGroup(loadRows) ? placeLoad(loadRows, (d) => d !== null && tripIdByDrop.get(d) === tripId) : null;
    const { kg, litres } = part ? { kg: part.kg, litres: part.litres } : whole;
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

    // Remarks — the CHANGED ship-to's name. A master redirect (the same test
    // as the area above) prints the override point's name as stored — a
    // dealer or a transporter godown alike.
    const redirectName = blank(redirect?.customerName);
    if (redirectName !== null && !acc.remarks.includes(redirectName)) acc.remarks.push(redirectName);
    // Legacy free-text redirects (no override point) print the typed name.
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
    // BACKDATED (D7): the trip's day is before the IST day it was entered.
    const backdated = t.tripDate.getTime() < istDayOf(t.createdAt).getTime();
    const entered = backdated ? `Entered ${istDayTime(t.createdAt)}` : null;
    const others = Array.from(acc.types.keys())
      .filter((n) => n !== own)
      .sort((a, b) => (typeRank.get(a) ?? 0) - (typeRank.get(b) ?? 0));
    return {
      tripNo: t.tripNumber,
      tripDate: t.tripDate,
      createdAt: t.createdAt,
      backdated,
      slotTime: blank(t.dispatchWindow?.windowTime),
      dealerCount: acc.stops.size,
      place: Array.from(acc.places).sort((a, b) => a.localeCompare(b)).join(", "),
      litres: Math.round(acc.litres),
      kg: Math.round(acc.kg * 1000) / 1000,
      vehicleNo: blank(t.vehicle?.vehicleNo) ?? blank(t.adhocVehicleNo),
      driverName: blank(t.driverName),
      vehicleModel: t.vehicle ? blank(t.vehicle.category) : null,
      deliveryTypes: [own, ...others].map(typeLabel).join(", "),
      typeLetter: t.typeCode,
      remarks: [acc.remarks.join(", "), entered].filter((x): x is string => x !== null && x !== "").join(" · "),
      diesel: t.dieselAmount === null ? 0 : Math.round(t.dieselAmount.toNumber()),
      tripNote: (t.note ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim(),
      transporterName: blank(t.transporter?.name),
    };
  });
}
