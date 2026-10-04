// lib/reports/freight-report-data.ts
//
// The rows behind the FREIGHT REPORT (2026-10-04, Smart Flow) — the MIS sheet
// in the NTS "Trip Detail Report" layout. ONE row per bill (OBD), never
// repeated. Read by app/api/reports/freight-report/route.ts and nothing else.
//
// 🔴 READ-ONLY. SELECTs only, sequential awaits, never prisma.$transaction
// (CORE §3). Every read is batched — no per-bill query loop.
// 🔴 SERVER-ONLY — it imports prisma.
//
// ── WHICH BILL, AND WHICH KIND (owner, 2026-10-04 — first match wins) ────────
//   isRemoved bills are never read (CORE §3 soft delete).
//   1. CI           — workflowStage 'cancelled' AND a live ci_returns row
//                     (isVoided false, status not 'draft').
//   2. PICK DELETED — cancelled AND (an active pick_delete_decisions row —
//                     kind 'pick_delete', undoneAt null — OR its LATEST cancel
//                     log note carries the "Pick delete" cancel reason).
//                     ⚠ Billing's own Pick delete logs "Duplicate bill"
//                     (lib/billing/pick-delete.ts), so the decision row is the
//                     reliable signal; the note covers the desk / picking forms.
//   3. CANCEL       — any other cancelled bill.
//      → 1–3 win EVEN IF the bill is still on a trip: the goods did not go.
//   4. FREIGHT      — on an ACTIVE freight trip (bill row removedAt null).
//   5. FLOOR        — on a Floor trip (orders.tripDropId → trip_drops → trips,
//                     trip not cancelled). Hand and courier trips are ordinary.
//   6. anything else has no dispatch date and is not in the report.
//   A manual /ci CI on a delivered (not cancelled) bill keeps its trip row; only
//   the Remark shows the CI number.
//
// ── THE DISPATCH DATE / TIME (the period filters on this date, IST) ──────────
//   FREIGHT: freight_trips.manualDispatchAt; null (older trips) → tripDate, no time.
//   FLOOR:   trips.manualDispatchAt; null → tripDate + the slot's windowTime —
//            the SAME fallback the Old Format prints (hhmmss of windowTime).
//   CI: ci_returns.submittedAt · PICK DELETED: decidedAt, else the cancel log ·
//   CANCEL: the latest toStage='cancelled' log row.

import { prisma } from "@/lib/prisma";
import { isGiftBill, loadKg, loadLitres } from "@/lib/orders/gift";
import { computeDropKey, effectiveCustomerId } from "@/lib/trips/drop-key";
import { TRIP_CANCELLED } from "@/lib/trips/live-trips";
import { FREIGHT_TRIP_STATUS } from "@/lib/freight-trips/status";
import type { CiStatus } from "@/lib/ci/types";
import { parseCancelNote } from "@/lib/floor/off-floor";
import { CANCEL_REASON_LABELS } from "@/lib/picking/cancel-reasons";
import type { PickDeleteKind } from "@/lib/billing/pick-delete-types";
import { parseReportDate } from "@/lib/reports/trip-detail-data";
import { hhmmss } from "@/lib/reports/trip-detail-old-workbook";
import {
  billQuantities,
  blank,
  invTypeFor,
  isSiteDelivery,
  loadBillToAreas,
  loadBillToByObd,
  loadCustomers,
  loadSnapshots,
} from "@/lib/reports/bill-facts";

export type FreightRowKind = "freight" | "floor" | "ci" | "pick_deleted" | "cancel";

/** One bill, already resolved to what the sheet prints. `null` = no cell. */
export interface FreightReportRow {
  kind: FreightRowKind;
  /** Freight / Floor trip number, or "0" for CI, PICK DELETED, CANCEL. */
  tripNo: string;
  /** The IST calendar day at UTC midnight (read with UTC getters). */
  dispatchDay: Date;
  /** "HH:mm:ss", or null (a freight trip with no manual time). */
  dispatchTime: string | null;
  vehicleNo: string | null;
  mobile: string | null;
  driverName: string | null;
  transporter: string | null;
  vehicleModel: string | null;
  route: string | null;
  obdNo: string;
  billToCode: string | null;
  billToName: string | null;
  siteName: string | null;
  /** The BILL's own delivery type (effective point → area → type). */
  deliveryType: string | null;
  billToArea: string | null;
  siteArea: string | null;
  redirectArea: string | null;
  articles: number | null;
  litres: number | null;
  kg: number | null;
  tripTotalLitres: number;
  tripTotalKg: number;
  tripDealerCount: number;
  invType: "INV" | "PROMO";
  /** Live CI numbers on the bill, joined " / ". */
  remark: string | null;
  /** Floor trips.dieselAmount; null otherwise (the sheet writes "0"). */
  diesel: number | null;
  entryBy: string | null;
  entryAt: Date | null;
  entryType: "SAP" | "Manual";
  invoiceNo: string | null;
}

export interface FreightReportParams {
  /** YYYY-MM-DD, inclusive — a DISPATCH date. */
  from: string;
  to: string;
  /** The BILL's own delivery type. Trip totals stay whole-trip. */
  deliveryTypeId?: number | null;
}

/** orders.workflowStage for a cancelled bill (no exported constant exists for the stage). */
const STAGE_CANCELLED = "cancelled";
const CI_DRAFT: CiStatus = "draft";
const PICK_DELETE: PickDeleteKind = "pick_delete";
/** The manual-template import batches — headerFile `[<templateId>] …` (CLAUDE_IMPORT §4). */
const MANUAL_BATCH_PREFIXES = ["[combined_v2]", "[two_file_v1]"];

const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** An instant → its IST day (UTC midnight) and "HH:mm:ss". */
function istDayTime(d: Date): { day: Date; time: string } {
  const s = new Date(d.getTime() + IST_MS);
  return {
    day: new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate())),
    time: `${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}:${pad2(s.getUTCSeconds())}`,
  };
}

const ORDER_SELECT = {
  id: true,
  obdNumber: true,
  tripDropId: true,
  customerId: true,
  shipToOverrideCustomerId: true,
  shipToCustomerId: true,
  shipToCustomerName: true,
  invoiceNo: true,
  smu: true,
  workflowStage: true,
  grossWeight: true,
  volume: true,
  materialType: true,
  batch: { select: { headerFile: true } },
} as const;

export async function getFreightReportRows(params: FreightReportParams): Promise<FreightReportRow[]> {
  const fromDate = parseReportDate(params.from);
  const toDate = parseReportDate(params.to);
  if (fromDate.getTime() > toDate.getTime()) throw new Error("`from` is after `to`");
  // The period as instants: IST midnight of `from` to IST midnight after `to`.
  const winStart = new Date(fromDate.getTime() - IST_MS);
  const winEnd = new Date(toDate.getTime() + DAY_MS - IST_MS);
  const inPeriod = (day: Date) => day.getTime() >= fromDate.getTime() && day.getTime() <= toDate.getTime();

  // ── 1. Freight trips dispatched in the period ────────────────────────────
  const freightTrips = await prisma.freight_trips.findMany({
    where: {
      status: FREIGHT_TRIP_STATUS.active,
      OR: [
        { manualDispatchAt: { gte: winStart, lt: winEnd } },
        { manualDispatchAt: null, tripDate: { gte: fromDate, lte: toDate } },
      ],
    },
    select: {
      id: true,
      tripNumber: true,
      tripDate: true,
      manualDispatchAt: true,
      adhocVehicleNo: true,
      driverName: true,
      driverPhone: true,
      vehicle: { select: { vehicleNo: true, category: true } },
      transporter: { select: { name: true } },
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
  const freightTripById = new Map(freightTrips.map((t) => [t.id, t]));
  const freightBills = freightTrips.length
    ? await prisma.freight_trip_bills.findMany({
        where: { freightTripId: { in: freightTrips.map((t) => t.id) }, removedAt: null },
        select: { orderId: true, freightTripId: true },
      })
    : [];
  const freightTripIdByOrder = new Map(freightBills.map((b) => [b.orderId, b.freightTripId]));

  // ── 2. Floor trips dispatched in the period, and their stops ─────────────
  const floorTrips = await prisma.trips.findMany({
    where: {
      status: { not: TRIP_CANCELLED },
      OR: [
        { manualDispatchAt: { gte: winStart, lt: winEnd } },
        { manualDispatchAt: null, tripDate: { gte: fromDate, lte: toDate } },
      ],
    },
    select: {
      id: true,
      tripNumber: true,
      tripDate: true,
      isHand: true,
      manualDispatchAt: true,
      dieselAmount: true,
      deliveryType: { select: { id: true, name: true } },
      dispatchWindow: { select: { windowTime: true } },
      adhocVehicleNo: true,
      driverName: true,
      driverPhone: true,
      vehicle: { select: { vehicleNo: true, category: true } },
      transporter: { select: { name: true } },
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
  const floorTripById = new Map(floorTrips.map((t) => [t.id, t]));
  const drops = floorTrips.length
    ? await prisma.trip_drops.findMany({
        where: { tripId: { in: floorTrips.map((t) => t.id) } },
        select: { id: true, tripId: true, routeName: true },
      })
    : [];
  const dropById = new Map(drops.map((d) => [d.id, d]));

  // ── 3. Cancelled bills whose CI / delete / cancel falls in the period ────
  const ciInPeriod = await prisma.ci_returns.findMany({
    where: { isVoided: false, status: { not: CI_DRAFT }, submittedAt: { gte: winStart, lt: winEnd } },
    select: { orderId: true },
  });
  const deletesInPeriod = await prisma.pick_delete_decisions.findMany({
    where: { kind: PICK_DELETE, undoneAt: null, deletedOrderId: { not: null }, decidedAt: { gte: winStart, lt: winEnd } },
    select: { deletedOrderId: true },
  });
  const cancelLogsInPeriod = await prisma.order_status_logs.findMany({
    where: { toStage: STAGE_CANCELLED, createdAt: { gte: winStart, lt: winEnd } },
    select: { orderId: true },
  });

  // ── 4. The bills ─────────────────────────────────────────────────────────
  const floorOrders = drops.length
    ? await prisma.orders.findMany({
        where: { tripDropId: { in: drops.map((d) => d.id) }, isRemoved: false },
        select: ORDER_SELECT,
      })
    : [];
  const loaded = new Set(floorOrders.map((o) => o.id));
  const otherIds = Array.from(
    new Set<number>([
      ...freightBills.map((b) => b.orderId),
      ...ciInPeriod.map((c) => c.orderId),
      ...deletesInPeriod.map((d) => d.deletedOrderId).filter((id): id is number => id !== null),
      ...cancelLogsInPeriod.map((l) => l.orderId),
    ]),
  ).filter((id) => !loaded.has(id));
  const otherOrders = otherIds.length
    ? await prisma.orders.findMany({ where: { id: { in: otherIds }, isRemoved: false }, select: ORDER_SELECT })
    : [];
  const orders = [...floorOrders, ...otherOrders];
  if (orders.length === 0) return [];
  const allIds = orders.map((o) => o.id);

  // A Floor-trip bill that is ALSO on an active freight trip (of any date) is a
  // FREIGHT bill — its row, if any, is the freight trip's.
  const onActiveFreight = new Set(
    (
      floorOrders.length
        ? await prisma.freight_trip_bills.findMany({
            where: {
              orderId: { in: floorOrders.map((o) => o.id) },
              removedAt: null,
              freightTrip: { status: FREIGHT_TRIP_STATUS.active },
            },
            select: { orderId: true },
          })
        : []
    ).map((b) => b.orderId),
  );

  // ── 5. What decides the cancelled kinds, and the Remark ──────────────────
  const liveCis = await prisma.ci_returns.findMany({
    where: { orderId: { in: allIds }, isVoided: false, status: { not: CI_DRAFT } },
    select: {
      orderId: true,
      ciNumber: true,
      submittedAt: true,
      createdAt: true,
      supervisor: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });
  const cisByOrder = new Map<number, (typeof liveCis)[number][]>();
  for (const c of liveCis) {
    const list = cisByOrder.get(c.orderId) ?? [];
    list.push(c);
    cisByOrder.set(c.orderId, list);
  }

  const cancelledIds = orders.filter((o) => o.workflowStage === STAGE_CANCELLED).map((o) => o.id);
  const deletes = cancelledIds.length
    ? await prisma.pick_delete_decisions.findMany({
        where: { kind: PICK_DELETE, undoneAt: null, deletedOrderId: { in: cancelledIds } },
        select: { deletedOrderId: true, decidedAt: true, decidedBy: { select: { name: true } } },
        orderBy: { decidedAt: "desc" },
      })
    : [];
  const deleteByOrder = new Map<number, (typeof deletes)[number]>();
  for (const d of deletes) if (d.deletedOrderId !== null && !deleteByOrder.has(d.deletedOrderId)) deleteByOrder.set(d.deletedOrderId, d);

  const cancelLogs = cancelledIds.length
    ? await prisma.order_status_logs.findMany({
        where: { orderId: { in: cancelledIds }, toStage: STAGE_CANCELLED },
        select: { orderId: true, note: true, createdAt: true, changedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const latestCancelLog = new Map<number, (typeof cancelLogs)[number]>();
  for (const l of cancelLogs) if (!latestCancelLog.has(l.orderId)) latestCancelLog.set(l.orderId, l);

  // ── 6. The per-bill facts (shared with Trip Detail) ──────────────────────
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

  // ── Assemble ─────────────────────────────────────────────────────────────
  type Built = FreightReportRow & {
    /** Whole-trip totals key — "F:<id>" / "T:<id>"; null for a word row. */
    tripKey: string | null;
    /** The stop, for Total Dealer — drop id (Floor) or drop key (Freight). */
    stopKey: string | null;
    isGift: boolean;
    deliveryTypeId: number | null;
    sortStamp: string;
    deliveryArea: string | null;
  };
  const built: Built[] = [];

  for (const o of orders) {
    let kind: FreightRowKind;
    let tripNo = "0";
    let dispatch: { day: Date; time: string | null };
    let vehicleNo: string | null = null;
    let mobile: string | null = null;
    let driverName: string | null = null;
    let transporter: string | null = null;
    let vehicleModel: string | null = null;
    let diesel: number | null = null;
    let entryBy: string | null = null;
    let entryAt: Date | null = null;
    let tripKey: string | null = null;
    let stopKey: string | null = null;
    let tripRoute: string | null = null;
    let tripType: { id: number; name: string } | null = null;

    if (o.workflowStage === STAGE_CANCELLED) {
      // ── Kinds 1–3: a word row, dated by its own event ─────────────────────
      const ci = cisByOrder.get(o.id)?.[0];
      const del = deleteByOrder.get(o.id);
      const log = latestCancelLog.get(o.id);
      let at: Date | null = null;
      if (ci) {
        kind = "ci";
        at = ci.submittedAt ?? ci.createdAt;
        entryBy = blank(ci.supervisor.name);
      } else if (del) {
        kind = "pick_deleted";
        at = del.decidedAt;
        entryBy = blank(del.decidedBy.name);
      } else if (log && parseCancelNote(log.note).reason === CANCEL_REASON_LABELS.pick_delete) {
        kind = "pick_deleted";
        at = log.createdAt;
        entryBy = blank(log.changedBy.name);
      } else if (log) {
        kind = "cancel";
        at = log.createdAt;
        entryBy = blank(log.changedBy.name);
      } else {
        continue; // cancelled with no record of when — no date, not reportable
      }
      dispatch = istDayTime(at);
      entryAt = at;
      const word = kind === "ci" ? "CI" : kind === "pick_deleted" ? "PICK DELETED" : "CANCEL";
      vehicleNo = word;
      driverName = word;
      transporter = word;
      vehicleModel = word;
    } else if (freightTripIdByOrder.has(o.id)) {
      // ── Kind 4: FREIGHT ───────────────────────────────────────────────────
      const t = freightTripById.get(freightTripIdByOrder.get(o.id)!)!;
      kind = "freight";
      tripNo = t.tripNumber;
      dispatch = t.manualDispatchAt ? istDayTime(t.manualDispatchAt) : { day: t.tripDate, time: null };
      vehicleNo = blank(t.vehicle?.vehicleNo) ?? blank(t.adhocVehicleNo);
      mobile = blank(t.driverPhone);
      driverName = blank(t.driverName);
      transporter = blank(t.transporter?.name);
      vehicleModel = blank(t.vehicle?.category);
      entryBy = blank(t.createdBy.name);
      entryAt = t.createdAt;
      tripKey = `F:${t.id}`;
      stopKey = computeDropKey(o);
    } else {
      // ── Kind 5: FLOOR ─────────────────────────────────────────────────────
      const drop = o.tripDropId !== null ? dropById.get(o.tripDropId) : undefined;
      const t = drop ? floorTripById.get(drop.tripId) : undefined;
      if (!drop || !t || onActiveFreight.has(o.id)) continue;
      kind = "floor";
      tripNo = t.tripNumber;
      dispatch = t.manualDispatchAt
        ? istDayTime(t.manualDispatchAt)
        : { day: t.tripDate, time: hhmmss(blank(t.dispatchWindow?.windowTime)) };
      if (t.isHand) {
        vehicleNo = "HAND";
        driverName = "HAND";
        transporter = "HAND";
        vehicleModel = "HAND";
      } else {
        vehicleNo = blank(t.vehicle?.vehicleNo) ?? blank(t.adhocVehicleNo);
        mobile = blank(t.driverPhone);
        driverName = blank(t.driverName);
        transporter = blank(t.transporter?.name);
        vehicleModel = blank(t.vehicle?.category);
      }
      diesel = t.dieselAmount === null ? null : t.dieselAmount.toNumber();
      entryBy = blank(t.createdBy.name);
      entryAt = t.createdAt;
      tripKey = `T:${t.id}`;
      stopKey = `d:${drop.id}`;
      tripRoute = blank(drop.routeName);
      tripType = t.deliveryType;
    }

    // The period — on the row's own dispatch day.
    if (!inPeriod(dispatch.day)) continue;

    const eid = effectiveCustomerId(o);
    const cust = eid !== null ? custById.get(eid) : undefined;
    const billTo = billToByObd.get(o.obdNumber);
    const { kg, litres, articles } = billQuantities(snapByOrder.get(o.id), o);
    const sapShipTo = o.customerId !== null ? custById.get(o.customerId) : undefined;
    const isSite = isSiteDelivery({
      billToCode: billTo?.code ?? null,
      sapShipToCode: o.shipToCustomerId,
      shipToType: sapShipTo?.customerType?.name ?? sapShipTo?.premisesType?.name ?? null,
      smu: o.smu,
    });
    // C — where the floor sent it; an override equal to SAP's own point is no redirect.
    const redirect =
      o.shipToOverrideCustomerId !== null && o.shipToOverrideCustomerId !== o.customerId
        ? custById.get(o.shipToOverrideCustomerId)
        : undefined;
    const billToCode = blank(billTo?.code);
    const billToArea = billToCode !== null ? (billToAreaByCode.get(billToCode) ?? null) : null;
    const siteArea = isSite ? blank(sapShipTo?.area.name) : null;
    const redirectArea = blank(redirect?.area.name);
    // The bill's OWN type; a Floor bill with no matched point falls back to its trip's.
    const billType = cust?.area.deliveryType ?? tripType;
    const remark = (cisByOrder.get(o.id) ?? [])
      .map((c) => c.ciNumber)
      .filter((n): n is string => n !== null)
      .join(" / ");
    const headerFile = o.batch?.headerFile ?? "";

    built.push({
      kind,
      tripNo,
      dispatchDay: dispatch.day,
      dispatchTime: dispatch.time,
      vehicleNo,
      mobile,
      driverName,
      transporter,
      vehicleModel,
      route: blank(cust?.primaryRoute?.name) ?? tripRoute,
      obdNo: o.obdNumber,
      billToCode,
      billToName: blank(billTo?.name),
      siteName: isSite ? (blank(sapShipTo?.customerName) ?? blank(o.shipToCustomerName)) : null,
      deliveryType: billType?.name ?? null,
      billToArea,
      siteArea,
      redirectArea,
      articles,
      litres,
      kg,
      tripTotalLitres: 0,
      tripTotalKg: 0,
      tripDealerCount: 0,
      invType: invTypeFor(o.materialType),
      remark: remark === "" ? null : remark,
      diesel,
      entryBy,
      entryAt,
      entryType: MANUAL_BATCH_PREFIXES.some((p) => headerFile.startsWith(p)) ? "Manual" : "SAP",
      invoiceNo: blank(o.invoiceNo),
      tripKey,
      stopKey,
      isGift: isGiftBill(o.materialType),
      deliveryTypeId: billType?.id ?? null,
      sortStamp: `${dispatch.day.toISOString().slice(0, 10)} ${dispatch.time ?? "00:00:00"}`,
      // NTS's delivery-area rule: Other Delivery Area → Site Area → Customer Area.
      deliveryArea: redirectArea ?? siteArea ?? billToArea,
    });
  }

  // ── Totals — WHOLE trip, before the delivery-type filter ─────────────────
  // Gifts add 0 L / 0 kg (lib/orders/gift.ts); an unknown kg adds nothing.
  const totals = new Map<string, { litres: number; kg: number; stops: Set<string> }>();
  for (const r of built) {
    if (r.tripKey === null) continue;
    const t = totals.get(r.tripKey) ?? { litres: 0, kg: 0, stops: new Set<string>() };
    t.litres += loadLitres(r.litres, r.isGift);
    t.kg += loadKg(r.kg, r.isGift) ?? 0;
    if (r.stopKey !== null) t.stops.add(r.stopKey);
    totals.set(r.tripKey, t);
  }
  for (const r of built) {
    if (r.tripKey === null) {
      // A word row: the bill's own load, one dealer.
      r.tripTotalLitres = loadLitres(r.litres, r.isGift);
      r.tripTotalKg = loadKg(r.kg, r.isGift) ?? 0;
      r.tripDealerCount = 1;
      continue;
    }
    const t = totals.get(r.tripKey)!;
    r.tripTotalLitres = t.litres;
    r.tripTotalKg = t.kg;
    r.tripDealerCount = t.stops.size;
  }

  // ── Delivery type (per bill), then sort ──────────────────────────────────
  const kept = params.deliveryTypeId ? built.filter((r) => r.deliveryTypeId === params.deliveryTypeId) : built;
  // Dispatch date + time DESC, Trip No, delivery area A–Z (blank last), Deilvery No ASC.
  kept.sort(
    (a, b) =>
      b.sortStamp.localeCompare(a.sortStamp) ||
      a.tripNo.localeCompare(b.tripNo) ||
      (a.deliveryArea ?? "￿").localeCompare(b.deliveryArea ?? "￿") ||
      a.obdNo.localeCompare(b.obdNo),
  );

  return kept.map((r) => {
    const { tripKey, stopKey, isGift, deliveryTypeId, sortStamp, deliveryArea, ...row } = r;
    void tripKey; void stopKey; void isGift; void deliveryTypeId; void sortStamp; void deliveryArea;
    return row;
  });
}
