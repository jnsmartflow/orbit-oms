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
//   - the Sales Officer → lib/floor/queries.ts salesOfficerByOrder (Floor's SO column);
//   - totals / stop numbers → ./totals.ts summariseStops (shared with filterSheet);
//   - the share chips → ./share-groups.ts (v27.71).
//
// QUERY COUNT. The sheet core (loadSheetCore) is a fixed number of batched reads
// for ANY number of trips: drops, own bills, re-delivery rows, re-delivered
// bills, snapshots, bill-to, delivery points, pick assignments, user names, and
// at most two SO reads, one shareGroup read — never one per bill. The list adds
// one trip_share_log read. The summary builder adds its own
// fixed batch on top.

import { prisma } from "@/lib/prisma";
import { getTodayIST } from "@/lib/dates";
import { getTripsForDate, parseTripDate, type TripSummary } from "@/lib/trips/queries";
import { effectiveCustomerId } from "@/lib/trips/drop-key";
import { isAsPerChallanBill, isTypedShipTo } from "@/lib/ship-to/effective";
import { tripMixLabel } from "@/lib/floor/scope";
import { salesOfficerByOrder } from "@/lib/floor/queries";
import { billQuantities, isSiteDelivery, loadBillToByObd, loadSnapshots } from "@/lib/reports/bill-facts";
import { isGiftBill } from "@/lib/orders/gift";
import { onStopsWhere, placeOnTrips, stopRowsSelect } from "@/lib/order-invoices/trip-read";
import { loadSplitInvoiceRows } from "@/lib/order-invoices/invoice-load";
import { RECORD_OBD_SELECT, recordObdOf } from "@/lib/order-invoices/links";
import { invoicesLoad, placeLoad } from "@/lib/floor/invoice-rows";
import { groupRedeliveries } from "@/lib/order-invoices/redelivery-plan";
import { summariseStops } from "./totals";
import {
  SHARE_GROUP_LABEL,
  billShareGroups,
  groupOrderIds,
  parseSoShareGroup,
  sheetShareGroups,
  tripShareKind,
} from "./share-groups";
import type {
  TripShareChip,
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
  dispatchStatus: true,
  materialType: true,
  grossWeight: true,
  volume: true,
  customerId: true,
  shipToOverrideCustomerId: true,
  shipToCustomerId: true,
  // The typed ship-to (v27.73) — computeDropKey's t: branch needs both.
  shipToText: true,
  shipToAreaId: true,
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
  dispatchStatus: string | null;
  materialType: string | null;
  grossWeight: number | null;
  volume: number | null;
  customerId: number | null;
  shipToOverrideCustomerId: number | null;
  shipToCustomerId: string;
  shipToText: string | null;
  shipToAreaId: number | null;
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

/** The two trip facts the core needs: its id and its STORED type (the share chips' rule). */
type CoreTrip = { id: number; deliveryTypeName: string | null };

async function loadSheetCore(trips: CoreTrip[]): Promise<Map<number, SheetCore>> {
  const out = new Map<number, SheetCore>();
  if (trips.length === 0) return out;
  const tripIds = trips.map((t) => t.id);
  const kindByTrip = new Map(trips.map((t) => [t.id, tripShareKind(t.deliveryTypeName)]));

  // 1. Stops.
  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: tripIds } },
    select: { id: true, tripId: true, dropSeq: true, customerName: true, areaName: true },
  });
  const dropById = new Map(drops.map((d) => [d.id, d]));

  // 2. The trips' own bills — removed out here, held out below. THROUGH THE
  // INVOICE ROWS (v27.66, lib/order-invoices/trip-read.ts): each OBD once per
  // trip, on the stop of its lowest-seq row there. Totals stay per OBD.
  const dropIds = drops.map((d) => d.id);
  const own: Array<BillRow & { tripDropId: number }> = drops.length
    ? placeOnTrips(
        await prisma.orders.findMany({
          where: { ...onStopsWhere(dropIds), isRemoved: false },
          select: { ...BILL_SELECT, invoices: stopRowsSelect(dropIds) },
        }),
        new Map(drops.map((d) => [d.id, d.tripId])),
      )
    : [];

  // 3–4. Re-deliveries carried on these trucks (Schema v27.53). The bill's own
  // tripDropId points at its FIRST trip, so the stop comes from the row.
  // The OBD through the invoice row each re-delivery names (P5-4). One row per
  // INVOICE since v27.74 (P5-5): a split bill's records on one stop are ONE
  // sheet bill carrying just those invoices.
  const redelRows = (
    await prisma.trip_redeliveries.findMany({
      where: { tripId: { in: tripIds } },
      select: { tripId: true, tripDropId: true, orderInvoiceId: true, ...RECORD_OBD_SELECT },
    })
  ).map((r) => ({ ...r, orderId: recordObdOf(r) }));
  const redelOrders: BillRow[] = redelRows.length
    ? await prisma.orders.findMany({
        where: { id: { in: Array.from(new Set(redelRows.map((r) => r.orderId))) }, isRemoved: false },
        select: BILL_SELECT,
      })
    : [];
  const redelOrderById = new Map(redelOrders.map((o) => [o.id, o]));

  // Every bill that can appear, keyed to the stop it rides on THIS trip. A
  // re-delivery carries the invoice rows it names (`rowIds`, P5-5).
  const placed: Array<{ order: BillRow; dropId: number; redel: boolean; rowIds: number[] | null }> = [];
  for (const o of own) {
    if (o.dispatchStatus === HOLD) continue;
    placed.push({ order: o, dropId: o.tripDropId, redel: false, rowIds: null });
  }
  for (const g of groupRedeliveries(redelRows)) {
    const o = redelOrderById.get(g.first.orderId);
    if (!o || o.dispatchStatus === HOLD) continue;
    placed.push({ order: o, dropId: g.first.tripDropId, redel: true, rowIds: g.rowIds });
  }
  const uniqueOrders = Array.from(new Map(placed.map((p) => [p.order.id, p.order])).values());
  const orderIds = uniqueOrders.map((o) => o.id);

  // 5. Quantities (bill-facts). 6. Bill-to (bill-facts).
  const snapByOrder = await loadSnapshots(orderIds);
  // A SPLIT OBD carries only its invoices on THIS trip (Phase 5 commit 1) —
  // lib/order-invoices/invoice-load.ts; one index-only read when none is split.
  // A re-delivered split OBD carries only the invoices it names (P5-5).
  const splitRows = await loadSplitInvoiceRows(
    uniqueOrders,
    new Map(uniqueOrders.map((o) => [o.id, snapByOrder.get(o.id)?.totalWeight ?? null] as const)),
  );
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

  // 12. Share chips (v27.71): ONE batched read of the known SOs' "shareGroup".
  // salesOfficerByOrder is Floor's and stays untouched — the id is enough.
  const soIds = Array.from(
    new Set(Array.from(soByOrder.values()).map((so) => so.salesOfficerId).filter((id): id is number => id !== null)),
  );
  const soGroups = soIds.length
    ? await prisma.sales_officer_master.findMany({ where: { id: { in: soIds } }, select: { id: true, shareGroup: true } })
    : [];
  const shareGroupBySo = new Map(soGroups.map((m) => [m.id, parseSoShareGroup(m.shareGroup)]));

  // ── Assemble per trip ────────────────────────────────────────────────────
  const stopsByTrip = new Map<number, Map<number, TripSheetStop>>();
  for (const p of placed) {
    const drop = dropById.get(p.dropId);
    if (!drop) continue;
    const o = p.order;
    const whole = billQuantities(snapByOrder.get(o.id), o);
    const rows = splitRows.get(o.id);
    const inPlace = (r: { id: number; tripDropId: number | null }) =>
      p.rowIds !== null ? p.rowIds.includes(r.id) : r.tripDropId !== null && dropById.get(r.tripDropId)?.tripId === drop.tripId;
    const load = rows
      ? p.rowIds !== null
        ? invoicesLoad(rows, p.rowIds)
        : placeLoad(rows, (d) => d !== null && dropById.get(d)?.tripId === drop.tripId)
      : null;
    const q = load ? { ...whole, litres: load.litres, kg: load.kg } : whole;
    // A SPLIT bill's number is ITS invoices here, seq order (P5-5) — not
    // orders.invoiceNo, which is seq 1's.
    const hereNos = rows
      ? rows.filter(inPlace).map((r) => blank(r.invoiceNo)).filter((n): n is string => n !== null)
      : [];
    const shownNo = hereNos.length > 0 ? hereNos.join(", ") : blank(o.invoiceNo);
    const a = assignmentByOrder.get(o.id);
    const typed = a?.articleCount ?? null;
    const billTo = billToByObd.get(o.obdNumber);
    const billToCode = blank(billTo?.code);
    const eid = effectiveCustomerId(o);
    const deliveryCode = blank(eid !== null ? codeByPointId.get(eid) : null) ?? blank(o.shipToCustomerId);
    const directLoaded = o.directLoadedAt !== null;
    const checkerId = a?.checkedById ?? (directLoaded ? o.directLoadedById : null);
    const so = soByOrder.get(o.id);
    const soName = blank(so?.name);
    const bill: TripSheetBill = {
      orderId: o.id,
      number: shownNo ?? o.obdNumber,
      obd: o.obdNumber,
      invoiceNo: shownNo,
      gift: isGiftBill(o.materialType),
      redel: p.redel,
      articles: typed ?? q.articles,
      articleSource: typed !== null ? "typed" : "sap",
      litres: q.litres,
      kg: q.kg,
      // Codes differ, OR a typed ship-to (v27.73, step 7B, owner 2026-10-20):
      // a typed bill's effective point is its own dealer, so the codes match
      // and alone would never say it.
      shipToChanged:
        (billToCode !== null && deliveryCode !== null && billToCode !== deliveryCode) || isTypedShipTo(o),
      asPerChallan: isAsPerChallanBill(o),
      billToName: blank(billTo?.name),
      soName,
      soId: so?.salesOfficerId ?? null,
      soPhone: blank(so?.phone),
      pickerName: a ? blank(userName.get(a.pickerId)) : null,
      checkerName: checkerId !== null ? blank(userName.get(checkerId)) : null,
      directLoaded,
      shareGroups: billShareGroups(kindByTrip.get(drop.tripId) ?? null, {
        smu: o.smu,
        // No shown name = no salesman (the bill card shows none either).
        soSource: so && soName !== null ? so.source : null,
        shareGroup: so?.salesOfficerId != null ? (shareGroupBySo.get(so.salesOfficerId) ?? null) : null,
      }),
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
    out.set(tripId, summariseStops(stops));
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

  const core = (await loadSheetCore([summary])).get(tripId);
  if (!core) return null;
  return { header: headerFor(summary), ...core };
}

/** Same set of order ids? (Both sides de-duplicated.) */
function sameIds(a: number[], b: number[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && Array.from(sa).every((id) => sb.has(id));
}

/**
 * A card's share chips (v27.71): one per group with ≥1 bill, in chip order.
 * `shared` = the LATEST trip_share_log row for (trip, group); `stale` = its
 * snapshot is not the group's bills now — the card then shows it as not shared.
 * None on a Hand trip (no sheet, no Share — spec §3).
 */
function chipsFor(
  sheet: TripSheet,
  latest: Map<string, { sharedAt: Date; orderIds: number[]; byName: string | null }>,
): TripShareChip[] {
  if (sheet.header.isHand) return [];
  return sheetShareGroups(sheet).map((key) => {
    const orderIds = groupOrderIds(sheet, key);
    const log = latest.get(`${sheet.header.id}:${key}`);
    return {
      key,
      label: SHARE_GROUP_LABEL[key],
      billCount: orderIds.length,
      orderIds,
      shared: log ? { at: log.sharedAt.toISOString(), byName: blank(log.byName) } : null,
      stale: log ? !sameIds(log.orderIds, orderIds) : false,
    };
  });
}

/** List rows for already-built summaries — the ONE place a card's numbers come from. */
export async function listRowsFor(summaries: TripSummary[]): Promise<TripSheetListRow[]> {
  const live = summaries.filter((t) => t.status !== TRIP_CANCELLED);
  const core = await loadSheetCore(live);

  // The share log — ONE read for every card; newest first, so the first row
  // seen per (trip, group) is its latest.
  const logs = live.length
    ? await prisma.tripShareLog.findMany({
        where: { tripId: { in: live.map((t) => t.id) } },
        orderBy: [{ sharedAt: "desc" }, { id: "desc" }],
        select: { tripId: true, groupKey: true, sharedAt: true, orderIds: true, sharedBy: { select: { name: true } } },
      })
    : [];
  const latest = new Map<string, { sharedAt: Date; orderIds: number[]; byName: string | null }>();
  for (const l of logs) {
    const k = `${l.tripId}:${l.groupKey}`;
    if (!latest.has(k)) latest.set(k, { sharedAt: l.sharedAt, orderIds: l.orderIds, byName: l.sharedBy?.name ?? null });
  }

  const empty: SheetCore = summariseStops([]);
  return live.map((t) => {
    const c = core.get(t.id) ?? empty;
    const sheet: TripSheet = { header: headerFor(t), ...c };
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
      stops: c.totals.stops,
      bills: c.totals.bills,
      litres: c.totals.litres,
      kg: c.totals.kg,
      soNames: c.soNames,
      isReady: t.isReady,
      isHand: t.isHand,
      typeLabel: typeLabelFor(t),
      chips: chipsFor(sheet, latest),
      sheet,
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
