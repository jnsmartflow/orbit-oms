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
//     getTripsForDate / getTripSummariesByIds (lib/trips/queries.ts), one
//     builder carrying the desk rule (lib/trips/live-trips.ts) and isReady;
//   - litres / kg / SAP articles / bill-to → lib/reports/bill-facts.ts;
//   - gifts → lib/orders/gift.ts;
//   - the delivery point → lib/trips/drop-key.ts effectiveCustomerId;
//   - the mixed-type label → lib/floor/scope.ts tripMixLabel;
//   - the Sales Officer → lib/floor/queries.ts salesOfficerByOrder (Floor's SO column).
//
// QUERY COUNT. The sheet core (loadSheetCore) is a fixed number of batched reads
// for ANY number of trips: drops, own bills, re-delivery rows, re-delivered
// bills, snapshots, bill-to, delivery points, pick assignments, user names, and
// at most two SO reads — never one per bill. The summary builder adds its own
// fixed batch on top.

import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";
import { getTripsForDate, parseTripDate, type TripSummary } from "@/lib/trips/queries";
import { effectiveCustomerId } from "@/lib/trips/drop-key";
import { tripMixLabel } from "@/lib/floor/scope";
import { salesOfficerByOrder } from "@/lib/floor/queries";
import { billQuantities, isSiteDelivery, loadBillToByObd, loadSnapshots } from "@/lib/reports/bill-facts";
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
  // Phone-only facts (2026-10-10): the SO rule's inputs and Direct Loading.
  smu: true,
  soNumber: true,
  directLoadedAt: true,
  directLoadedById: true,
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
  smu: string | null;
  soNumber: string | null;
  directLoadedAt: Date | null;
  directLoadedById: number | null;
};

export const blank = (s: string | null | undefined): string | null => {
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

export function vehicleNoFor(t: { vehicleNo: string | null; adhocVehicleNo: string | null }): string | null {
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
    pending: !hasVehicle && !t.isReady ? "both" : !hasVehicle ? "vehicle" : !t.isReady ? "picking" : null,
    isReady: t.isReady,
  };
}

/** Sheet body (stops, totals, caption areas, SO names) per trip id. */
interface SheetCore {
  stops: TripSheetStop[];
  totals: TripSheetTotals;
  captionAreas: string[];
  soNames: string[];
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
  const uniqueOrders = Array.from(new Map(placed.map((p) => [p.order.id, p.order])).values());
  const orderIds = uniqueOrders.map((o) => o.id);

  // 5. Quantities (bill-facts). 6. Bill-to (bill-facts).
  const snapByOrder = await loadSnapshots(orderIds);
  const billToByObd = await loadBillToByObd(uniqueOrders.map((o) => o.obdNumber));

  // 7. The effective delivery points: code (shipToChanged) and type (isSite).
  const pointIds = Array.from(
    new Set(uniqueOrders.map((o) => effectiveCustomerId(o)).filter((id): id is number => id !== null)),
  );
  const points = pointIds.length
    ? await prisma.delivery_point_master.findMany({
        where: { id: { in: pointIds } },
        select: {
          id: true,
          customerCode: true,
          customerType: { select: { name: true } },
          premisesType: { select: { name: true } },
        },
      })
    : [];
  const codeByPointId = new Map(points.map((p) => [p.id, p.customerCode]));
  // The point's own type, customerType then premisesType — the order the Trip
  // Detail report reads them in (trip-detail-data.ts) before isSiteDelivery.
  const typeByPointId = new Map(points.map((p) => [p.id, p.customerType?.name ?? p.premisesType?.name ?? null]));

  // 8. Pick assignments: the typed article count (v27.58), the picker, the checker.
  const assignments = orderIds.length
    ? await prisma.pick_assignments.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, articleCount: true, pickerId: true, checkedById: true },
      })
    : [];
  const assignmentByOrder = new Map(assignments.map((a) => [a.orderId, a]));

  // 9. Names for pickers, checkers and Direct Loading supervisors — one read.
  const userIds = Array.from(
    new Set(
      [
        ...assignments.flatMap((a) => [a.pickerId, a.checkedById]),
        ...uniqueOrders.map((o) => o.directLoadedById),
      ].filter((id): id is number => id !== null),
    ),
  );
  const users = userIds.length
    ? await prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));

  // 10–11. Sales Officer — Floor's rule, at most two reads.
  const soByOrder = await salesOfficerByOrder(uniqueOrders);

  // ── Assemble per trip ────────────────────────────────────────────────────
  const stopsByTrip = new Map<number, Map<number, TripSheetStop>>();
  for (const p of placed) {
    const drop = dropById.get(p.dropId);
    if (!drop) continue;
    const o = p.order;
    const q = billQuantities(snapByOrder.get(o.id), o);
    const a = assignmentByOrder.get(o.id);
    const typed = a?.articleCount ?? null;
    const billTo = billToByObd.get(o.obdNumber);
    const billToCode = blank(billTo?.code);
    const eid = effectiveCustomerId(o);
    const deliveryCode = blank(eid !== null ? codeByPointId.get(eid) : null) ?? blank(o.shipToCustomerId);
    const directLoaded = o.directLoadedAt !== null;
    const checkerId = a?.checkedById ?? (directLoaded ? o.directLoadedById : null);
    const bill: TripSheetBill = {
      orderId: o.id,
      number: blank(o.invoiceNo) ?? o.obdNumber,
      obd: o.obdNumber,
      invoiceNo: blank(o.invoiceNo),
      gift: isGiftBill(o.materialType),
      redel: p.redel,
      articles: typed ?? q.articles,
      articleSource: typed !== null ? "typed" : "sap",
      litres: q.litres,
      kg: q.kg,
      shipToChanged: billToCode !== null && deliveryCode !== null && billToCode !== deliveryCode,
      billToName: blank(billTo?.name),
      soName: blank(soByOrder.get(o.id)?.name),
      pickerName: a ? blank(userName.get(a.pickerId)) : null,
      checkerName: checkerId !== null ? blank(userName.get(checkerId)) : null,
      directLoaded,
    };
    const tripStops = stopsByTrip.get(drop.tripId) ?? new Map<number, TripSheetStop>();
    // Is the EFFECTIVE point a site? isSiteDelivery on the point the truck goes
    // to (the redirect when there is one): same party as the bill-to → no; the
    // point's own type decides; untyped → the bill's project SMU decides.
    const site = isSiteDelivery({
      billToCode,
      sapShipToCode: deliveryCode,
      shipToType: eid !== null ? (typeByPointId.get(eid) ?? null) : null,
      smu: o.smu,
    });
    const stop = tripStops.get(drop.id) ?? {
      no: 0,
      dropId: drop.id,
      dropSeq: drop.dropSeq,
      name: drop.customerName,
      area: blank(drop.areaName),
      isSite: false,
      bills: [],
    };
    if (site) stop.isSite = true;
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
    const soNames: string[] = [];
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
        if (b.soName !== null && !soNames.includes(b.soName)) soNames.push(b.soName);
      }
    });
    out.set(tripId, { stops, totals, captionAreas, soNames });
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

/** List rows for already-built summaries — the ONE place a card's numbers come from. */
export async function listRowsFor(summaries: TripSummary[]): Promise<TripSheetListRow[]> {
  const live = summaries.filter((t) => t.status !== TRIP_CANCELLED);
  const core = await loadSheetCore(live.map((t) => t.id));
  return live.map((t) => {
    const c = core.get(t.id);
    const driver = blank(t.driverName);
    return {
      id: t.id,
      tripNumber: t.tripNumber,
      tripDate: t.tripDate,
      deliveryTypeName: t.deliveryTypeName,
      deliveryTypes: t.deliveryTypes,
      vehicleNo: vehicleNoFor(t),
      driverFirstName: driver ? driver.split(/\s+/)[0] : null,
      driverName: driver,
      driverPhone: blank(t.driverPhone),
      timeLabel: timeLabelFor(t),
      areaLabel: t.areaLabel,
      stops: c?.totals.stops ?? 0,
      bills: c?.totals.bills ?? 0,
      litres: c?.totals.litres ?? 0,
      kg: c?.totals.kg ?? 0,
      soNames: c?.soNames ?? [],
      isReady: t.isReady,
      isHand: t.isHand,
      typeLabel: typeLabelFor(t),
    };
  });
}

/**
 * The phone list for one day: the Floor desk's trips for that date
 * (tripsOnDeskWhere, via getTripsForDate), cancelled excluded, newest created
 * first (the feed's own order). Stops / bills / kg come from the SAME core as
 * the sheet, so a card and its sheet can never disagree.
 */
export async function listTripSheets(date: string): Promise<TripSheetListRow[]> {
  return listRowsFor(await getTripsForDate(parseTripDate(date), parseTripDate(getTodayIST())));
}
