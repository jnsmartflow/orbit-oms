// lib/trip-sheet/load.ts
//
// THE ORBIT TRIP SHEET — data loader (2026-10-09). Builds the view model in
// ./types.ts from Orbit's own trips. Spec: docs/prompts/drafts/
// web-update-2026-10-09-trip-sheet.md §3 (binding).
//
// 🔴 READ-ONLY. SELECTs only, sequential awaits, never prisma.$transaction
// (CORE §3). Every orders read carries isRemoved: false.
// 🔴 SERVER-ONLY — it imports prisma.
// 🔴 NO lib/trip-report/* OR components/trip-report/* IMPORT, EVER (types.ts header).
//
// The rules are BORROWED, never re-derived:
//   - which trips a day shows, the trip header, isReady, areaLabel →
//     getTripsForDate (lib/trips/queries.ts), which carries the desk rule
//     (lib/trips/live-trips.ts) and the one isReady definition;
//   - litres / kg / SAP articles / bill-to → lib/reports/bill-facts.ts;
//   - gifts → lib/orders/gift.ts;
//   - the delivery point → lib/trips/drop-key.ts effectiveCustomerId;
//   - the mixed-type label → lib/floor/scope.ts tripMixLabel.
//
// QUERY COUNT. The sheet core (loadSheetCore) is a fixed number of batched reads
// for ANY number of trips: drops, own bills, re-delivery rows, re-delivered
// bills, snapshots, bill-to, delivery points, pick assignments — never one per
// bill. getTripsForDate adds its own fixed batch on top.

import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";
import { getTripsForDate, parseTripDate, type TripSummary } from "@/lib/trips/queries";
import { effectiveCustomerId } from "@/lib/trips/drop-key";
import { tripMixLabel } from "@/lib/floor/scope";
import { billQuantities, loadBillToByObd, loadSnapshots } from "@/lib/reports/bill-facts";
import { isGiftBill, loadKg, loadLitres } from "@/lib/orders/gift";
import type {
  TripSheet,
  TripSheetBill,
  TripSheetHeader,
  TripSheetListRow,
  TripSheetStop,
  TripSheetTotals,
} from "./types";

const TRIP_CANCELLED = "cancelled";
const HOLD = "hold";

/** The order columns a sheet row needs — one select for own bills and re-deliveries alike. */
const BILL_SELECT = {
  id: true,
  obdNumber: true,
  invoiceNo: true,
  tripDropId: true,
  dispatchStatus: true,
  materialType: true,
  grossWeight: true,
  volume: true,
  customerId: true,
  shipToOverrideCustomerId: true,
  shipToCustomerId: true,
} as const;

type BillRow = {
  id: number;
  obdNumber: string;
  invoiceNo: string | null;
  tripDropId: number | null;
  dispatchStatus: string | null;
  materialType: string | null;
  grossWeight: number | null;
  volume: number | null;
  customerId: number | null;
  shipToOverrideCustomerId: number | null;
  shipToCustomerId: string;
};

const blank = (s: string | null | undefined): string | null => {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t === "" ? null : t;
};

/** manualDispatchAt as IST "HH:MM", else the window's time (the Old Format / Freight Report convention). */
function timeLabelFor(t: TripSummary): string | null {
  if (t.manualDispatchAt) {
    return new Date(t.manualDispatchAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    });
  }
  return blank(t.windowTime);
}

function typeLabelFor(t: TripSummary): string {
  return tripMixLabel(t) ?? t.deliveryTypeName ?? "—";
}

function vehicleNoFor(t: TripSummary): string | null {
  return blank(t.vehicleNo) ?? blank(t.adhocVehicleNo);
}

function headerFor(t: TripSummary): TripSheetHeader {
  const hasVehicle = t.vehicleId !== null || blank(t.adhocVehicleNo) !== null;
  return {
    id: t.id,
    tripNumber: t.tripNumber,
    tripDate: t.tripDate,
    timeLabel: timeLabelFor(t),
    typeLabel: typeLabelFor(t),
    vehicleNo: vehicleNoFor(t),
    driverName: blank(t.driverName),
    driverPhone: blank(t.driverPhone),
    transporterName: blank(t.transporterName),
    isHand: t.isHand,
    provisional: !hasVehicle || !t.isReady,
    isReady: t.isReady,
  };
}

/** Sheet body (stops, totals, caption areas) per trip id, for any number of trips. */
interface SheetCore {
  stops: TripSheetStop[];
  totals: TripSheetTotals;
  captionAreas: string[];
}

async function loadSheetCore(tripIds: number[]): Promise<Map<number, SheetCore>> {
  const out = new Map<number, SheetCore>();
  if (tripIds.length === 0) return out;

  // 1. Stops.
  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: tripIds } },
    select: { id: true, tripId: true, dropSeq: true, customerName: true, areaName: true },
  });
  const dropById = new Map(drops.map((d) => [d.id, d]));

  // 2. The trips' own bills — removed out here, held out below.
  const own: BillRow[] = drops.length
    ? await prisma.orders.findMany({
        where: { tripDropId: { in: drops.map((d) => d.id) }, isRemoved: false },
        select: BILL_SELECT,
      })
    : [];

  // 3–4. Re-deliveries carried on these trucks (Schema v27.53). The bill's own
  // tripDropId points at its FIRST trip, so the stop comes from the row.
  const redelRows = await prisma.trip_redeliveries.findMany({
    where: { tripId: { in: tripIds } },
    select: { tripId: true, tripDropId: true, orderId: true },
  });
  const redelOrders: BillRow[] = redelRows.length
    ? await prisma.orders.findMany({
        where: { id: { in: Array.from(new Set(redelRows.map((r) => r.orderId))) }, isRemoved: false },
        select: BILL_SELECT,
      })
    : [];
  const redelOrderById = new Map(redelOrders.map((o) => [o.id, o]));

  // Every bill that can appear, keyed to the stop it rides on THIS trip.
  const placed: Array<{ order: BillRow; dropId: number; redel: boolean }> = [];
  for (const o of own) {
    if (o.dispatchStatus === HOLD || o.tripDropId === null) continue;
    placed.push({ order: o, dropId: o.tripDropId, redel: false });
  }
  for (const r of redelRows) {
    const o = redelOrderById.get(r.orderId);
    if (!o || o.dispatchStatus === HOLD) continue;
    placed.push({ order: o, dropId: r.tripDropId, redel: true });
  }
  const orderIds = Array.from(new Set(placed.map((p) => p.order.id)));

  // 5. Quantities (bill-facts). 6. Bill-to (bill-facts).
  const snapByOrder = await loadSnapshots(orderIds);
  const billToByObd = await loadBillToByObd(Array.from(new Set(placed.map((p) => p.order.obdNumber))));

  // 7. The effective delivery points' codes — for shipToChanged.
  const pointIds = Array.from(
    new Set(placed.map((p) => effectiveCustomerId(p.order)).filter((id): id is number => id !== null)),
  );
  const points = pointIds.length
    ? await prisma.delivery_point_master.findMany({
        where: { id: { in: pointIds } },
        select: { id: true, customerCode: true },
      })
    : [];
  const codeByPointId = new Map(points.map((p) => [p.id, p.customerCode]));

  // 8. The supervisor's typed article count (Schema v27.58).
  const assignments = orderIds.length
    ? await prisma.pick_assignments.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, articleCount: true },
      })
    : [];
  const typedArticles = new Map<number, number>();
  for (const a of assignments) if (a.articleCount !== null) typedArticles.set(a.orderId, a.articleCount);

  // ── Assemble per trip ────────────────────────────────────────────────────
  const stopsByTrip = new Map<number, Map<number, TripSheetStop>>();
  for (const p of placed) {
    const drop = dropById.get(p.dropId);
    if (!drop) continue;
    const o = p.order;
    const q = billQuantities(snapByOrder.get(o.id), o);
    const typed = typedArticles.get(o.id);
    const billTo = billToByObd.get(o.obdNumber);
    const billToCode = blank(billTo?.code);
    const eid = effectiveCustomerId(o);
    const deliveryCode = blank(eid !== null ? codeByPointId.get(eid) : null) ?? blank(o.shipToCustomerId);
    const bill: TripSheetBill = {
      orderId: o.id,
      number: blank(o.invoiceNo) ?? o.obdNumber,
      obd: o.obdNumber,
      invoiceNo: blank(o.invoiceNo),
      gift: isGiftBill(o.materialType),
      redel: p.redel,
      articles: typed ?? q.articles,
      articleSource: typed !== undefined ? "typed" : "sap",
      litres: q.litres,
      kg: q.kg,
      shipToChanged: billToCode !== null && deliveryCode !== null && billToCode !== deliveryCode,
      billToName: blank(billTo?.name),
    };
    const tripStops = stopsByTrip.get(drop.tripId) ?? new Map<number, TripSheetStop>();
    const stop = tripStops.get(drop.id) ?? {
      no: 0,
      dropId: drop.id,
      dropSeq: drop.dropSeq,
      name: drop.customerName,
      area: blank(drop.areaName),
      bills: [],
    };
    stop.bills.push(bill);
    tripStops.set(drop.id, stop);
    stopsByTrip.set(drop.tripId, tripStops);
  }

  for (const tripId of tripIds) {
    // Sort: area A–Z (blank last) → dropSeq → OBD. Stop no = printed order.
    const stops = Array.from(stopsByTrip.get(tripId)?.values() ?? []).sort((a, b) => {
      if ((a.area === null) !== (b.area === null)) return a.area === null ? 1 : -1;
      const byArea = (a.area ?? "").localeCompare(b.area ?? "", "en", { sensitivity: "base" });
      return byArea || a.dropSeq - b.dropSeq;
    });
    const totals: TripSheetTotals = { stops: stops.length, bills: 0, articles: 0, litres: 0, kg: 0, kgUnknownCount: 0 };
    const captionAreas: string[] = [];
    stops.forEach((s, i) => {
      s.no = i + 1;
      s.bills.sort((a, b) => a.obd.localeCompare(b.obd));
      if (s.area !== null && !captionAreas.includes(s.area)) captionAreas.push(s.area);
      for (const b of s.bills) {
        totals.bills += 1;
        totals.articles += b.articles ?? 0;
        totals.litres += loadLitres(b.litres, b.gift);
        const kg = loadKg(b.kg, b.gift);
        if (kg === null) totals.kgUnknownCount += 1;
        else totals.kg += kg;
      }
    });
    out.set(tripId, { stops, totals, captionAreas });
  }
  return out;
}

/**
 * One trip's sheet, or null when the trip does not exist or is cancelled.
 * A Hand trip still answers (header.isHand) — the spec's "no sheet" is a UI rule.
 */
export async function getTripSheet(tripId: number): Promise<TripSheet | null> {
  const trip = await prisma.trips.findUnique({ where: { id: tripId }, select: { tripDate: true, status: true } });
  if (!trip || trip.status === TRIP_CANCELLED) return null;

  // A trip dated D always matches its own day's desk (tripsOnDeskWhere's
  // `tripDate = deskDate` arm), so this returns exactly this trip's summary —
  // header, isReady and labels by the Floor's own builder.
  const [summary] = await getTripsForDate(trip.tripDate, parseTripDate(getTodayIST()), [tripId]);
  if (!summary) return null;

  const core = (await loadSheetCore([tripId])).get(tripId);
  if (!core) return null;
  return { header: headerFor(summary), ...core };
}

/**
 * The phone list for one day: the Floor desk's trips for that date
 * (tripsOnDeskWhere, via getTripsForDate), cancelled excluded, newest created
 * first (the feed's own order). Stops / bills / litres come from the SAME core
 * as the sheet, so a card and its sheet can never disagree.
 */
export async function listTripSheets(date: string): Promise<TripSheetListRow[]> {
  const summaries = (await getTripsForDate(parseTripDate(date), parseTripDate(getTodayIST()))).filter(
    (t) => t.status !== TRIP_CANCELLED,
  );
  const core = await loadSheetCore(summaries.map((t) => t.id));
  return summaries.map((t) => {
    const c = core.get(t.id);
    const driver = blank(t.driverName);
    return {
      id: t.id,
      tripNumber: t.tripNumber,
      vehicleNo: vehicleNoFor(t),
      driverFirstName: driver ? driver.split(/\s+/)[0] : null,
      timeLabel: timeLabelFor(t),
      areaLabel: t.areaLabel,
      stops: c?.totals.stops ?? 0,
      bills: c?.totals.bills ?? 0,
      litres: c?.totals.litres ?? 0,
      isReady: t.isReady,
      isHand: t.isHand,
      typeLabel: typeLabelFor(t),
    };
  });
}
