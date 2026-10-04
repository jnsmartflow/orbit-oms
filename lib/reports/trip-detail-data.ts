// lib/reports/trip-detail-data.ts
//
// The rows behind the Trip Detail report — one row per bill loaded on a Floor
// trip (trips / trip_drops, CLAUDE_FLOOR_TRIPS.md). NOT the NTS mirror
// (trip_report): that is a different table with a different meaning (§2 there).
// Read by app/api/reports/trip-detail/route.ts and nothing else.
//
// 🔴 READ-ONLY. Not one write in this file — no update, no upsert, no "tidy"
// of a stale tripDropId. Six SELECTs, sequential awaits, never
// prisma.$transaction (CORE §3).
//
// 🔴 SERVER-ONLY. It imports prisma. The workbook builder that consumes it
// (trip-detail-workbook.ts) takes its row type with `import type`.

import { prisma } from "@/lib/prisma";
import {
  STAGE_LADDER,
  SUPPORT_DONE_OUTPUT,
  PICK_ASSIGNED,
  PICK_DONE,
  PICK_CHECKED,
  DISPATCHED,
} from "@/lib/workflow-stages";
import { isGiftBill, loadKg, loadLitres } from "@/lib/orders/gift";
import {
  billQuantities,
  blank,
  invTypeFor,
  isSiteDelivery,
  istDay,
  loadBillToAreas,
  loadBillToByObd,
  loadCustomers,
  loadSnapshots,
} from "@/lib/reports/bill-facts";

/** One bill on one trip, already resolved to what the sheet prints. `null` =
 *  unknown, which the workbook writes as NO CELL (never 0, "—" or "N/A"). */
export interface TripDetailRow {
  /** @db.Date — a calendar day at UTC midnight. Read with UTC getters. */
  tripDate: Date;
  tripNo: string;
  deliveryType: string;
  dispatchSlot: string | null;
  tripStatus: string;
  vehicleNo: string | null;
  vehicleType: string | null;
  driverName: string | null;
  driverMobile: string | null;
  transporter: string | null;
  billToCode: string | null;
  billToName: string | null;
  shipToCode: string | null;
  shipToName: string | null;
  /** isSiteDelivery() — the same rule the old layout's Site columns use. */
  site: "Yes" | "No";
  area: string | null;
  route: string | null;
  obdNo: string;
  soNo: string | null;
  invoiceNo: string | null;
  /** Already reduced to a calendar day (UTC midnight) — see istDay(). */
  invoiceDate: Date | null;
  smu: string | null;
  tint: "Yes" | "No";
  articles: number | null;
  litres: number | null;
  kg: number | null;
  billStage: string | null;
  tripNote: string | null;
  /** Sort key only — not a column. */
  dropSeq: number;

  // ── Fields only the OLD NTS layout prints (trip-detail-old-workbook.ts).
  // The current workbook does not read them, so its output is unchanged. ──

  /** dispatch_slot_master.windowTime alone — no label fallback. */
  dispatchWindowTime: string | null;
  /** vehicle_master.category alone — no trips.vehicleSize fallback. */
  vehicleCategory: string | null;
  /** The BILL-TO party's area, through delivery_point_master by its code. */
  billToArea: string | null;
  /** INV or PROMO — see invTypeFor(). */
  invType: "INV" | "PROMO";
  /** B — SAP's ship-to, ONLY when isSiteDelivery() says it is a real site that
   *  is not the billed party. Otherwise both null. */
  siteName: string | null;
  siteArea: string | null;
  /** C — the floor's redirect target (shipToOverrideCustomer), when there is
   *  one with a master row. Otherwise both null. */
  redirectName: string | null;
  redirectArea: string | null;
  /** The TRIP's totals over the bills in this report, repeated on each row.
   *  Gifts add 0 L / 0 kg (lib/orders/gift.ts); unknown kg adds nothing. */
  tripTotalLitres: number;
  tripTotalKg: number;
  /** Distinct stops on the trip that hold at least one bill in this report. */
  tripDealerCount: number;
  /** trips.createdBy.name and trips.createdAt. */
  entryBy: string | null;
  entryAt: Date;
}

export interface TripDetailParams {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  /** The TRIP's stored delivery type (trips.deliveryTypeId — the type it was
   *  numbered under, CLAUDE_FLOOR_TRIPS.md §6), not its bills' types. */
  deliveryTypeId?: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-01" → the @db.Date value for that day (UTC midnight). Throws on a
 *  bad shape or a date that does not exist (2026-02-30). Same rule as
 *  lib/trips/queries.ts's parser. */
export function parseReportDate(s: string): Date {
  if (!DATE_RE.test(s)) throw new Error(`Invalid date "${s}" — expected YYYY-MM-DD`);
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.toISOString().slice(0, 10) !== s) throw new Error(`Invalid calendar date "${s}"`);
  return dt;
}

const TRIP_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  released: "Released",
  dispatched: "Dispatched",
  // cancelled never reaches here — filtered in the WHERE.
};

/**
 * The bill's stage in the words the floor uses. The five picking rungs get the
 * report's own short words; anything earlier (tinting, support) falls back to
 * the ladder's label, so a bill put on a trip before it was picked still reads
 * as words, never as `pending_tint_assignment`. Unknown stage → blank.
 */
const PICK_STAGE_WORD: Record<string, string> = {
  [SUPPORT_DONE_OUTPUT]: "Waiting",
  [PICK_ASSIGNED]: "Picking",
  [PICK_DONE]: "Picked",
  [PICK_CHECKED]: "Checked",
  [DISPATCHED]: "Dispatched",
};
const LADDER_LABEL = new Map(STAGE_LADDER.map((s) => [s.stage, s.label]));
/** The word for a Direct Loaded bill (pick_checked, no picker — v27.52). */
const DIRECT_LOADING_WORD = "Direct Loading";
function billStageWord(stage: string, directLoadedAt: Date | null = null): string | null {
  // Before the stage map: a Direct Loaded bill sits at pick_checked but nobody
  // picked or checked it, so "Checked" would be false on the sheet.
  if (stage === PICK_CHECKED && directLoadedAt !== null) return DIRECT_LOADING_WORD;
  return PICK_STAGE_WORD[stage] ?? LADDER_LABEL.get(stage) ?? null;
}

// isSiteDelivery, istDay, invTypeFor, blank and the batched bill reads moved to
// lib/reports/bill-facts.ts (2026-10-04), shared with the Freight Report.

export async function getTripDetailRows(params: TripDetailParams): Promise<TripDetailRow[]> {
  const fromDate = parseReportDate(params.from);
  const toDate = parseReportDate(params.to);
  if (fromDate.getTime() > toDate.getTime()) throw new Error("`from` is after `to`");

  // ── 1. Trips in range, not cancelled ─────────────────────────────────────
  const trips = await prisma.trips.findMany({
    where: {
      tripDate: { gte: fromDate, lte: toDate },
      status: { not: "cancelled" },
      ...(params.deliveryTypeId ? { deliveryTypeId: params.deliveryTypeId } : {}),
    },
    select: {
      id: true,
      tripNumber: true,
      tripDate: true,
      status: true,
      note: true,
      vehicleSize: true,
      adhocVehicleNo: true,
      driverName: true,
      driverPhone: true,
      deliveryType: { select: { name: true } },
      dispatchWindow: { select: { windowTime: true, label: true } },
      vehicle: { select: { vehicleNo: true, category: true } },
      transporter: { select: { name: true } },
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
  if (trips.length === 0) return [];
  const tripById = new Map(trips.map((t) => [t.id, t]));

  // ── 2. Their stops ───────────────────────────────────────────────────────
  const drops = await prisma.trip_drops.findMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
    select: {
      id: true,
      tripId: true,
      dropSeq: true,
      shipToCode: true,
      customerName: true,
      areaName: true,
      routeName: true,
    },
  });
  if (drops.length === 0) return [];
  const dropById = new Map(drops.map((d) => [d.id, d]));

  // ── 3. The bills on those stops ──────────────────────────────────────────
  // 🔴 THE HOLD FILTER IS AN OR, NOT `dispatchStatus: { not: "hold" }`. In SQL
  // `NULL <> 'hold'` is NULL, so Prisma's `not` silently drops every bill whose
  // dispatchStatus is NULL — most of them. Removed bills keep their tripDropId
  // (CLAUDE_FLOOR_TRIPS.md §7), so `isRemoved: false` is what keeps them out.
  const orders = await prisma.orders.findMany({
    where: {
      tripDropId: { in: drops.map((d) => d.id) },
      isRemoved: false,
      OR: [{ dispatchStatus: null }, { dispatchStatus: { not: "hold" } }],
    },
    select: {
      id: true,
      obdNumber: true,
      tripDropId: true,
      customerId: true,
      shipToOverrideCustomerId: true,
      shipToCustomerId: true,
      shipToCustomerName: true,
      soNumber: true,
      invoiceNo: true,
      invoiceDate: true,
      smu: true,
      orderType: true,
      workflowStage: true,
      // Direct Loading (v27.52) — tells a loaded-from-stock bill from a checked one.
      directLoadedAt: true,
      grossWeight: true,
      volume: true,
      materialType: true,
    },
  });
  if (orders.length === 0) return [];

  // ── 4. Quantities (the import's per-OBD snapshot) ────────────────────────
  const snapByOrder = await loadSnapshots(orders.map((o) => o.id));

  // ── 5. Bill-to, from SAP's raw summary — latest row wins ─────────────────
  const billToByObd = await loadBillToByObd(orders.map((o) => o.obdNumber));

  // ── 6. The EFFECTIVE delivery point: shipToOverrideCustomerId ?? customerId
  // (lib/trips/drop-key.ts effectiveCustomerId) ─────────────────────────────
  const effId = (o: { customerId: number | null; shipToOverrideCustomerId: number | null }) =>
    o.shipToOverrideCustomerId ?? o.customerId;
  // Also SAP's own ship-to point (customerId, "B") and the redirect target
  // (shipToOverrideCustomerId, "C") — the effective id is always one of these
  // two, so one read covers all three.
  const custById = await loadCustomers(
    Array.from(
      new Set(
        orders
          .flatMap((o) => [o.customerId, o.shipToOverrideCustomerId])
          .filter((id): id is number => id !== null),
      ),
    ),
  );

  // ── 7. The bill-to party's area (old layout's Customer Area) ─────────────
  const billToAreaByCode = await loadBillToAreas(billToByObd);

  // ── Assemble ─────────────────────────────────────────────────────────────
  const rows: TripDetailRow[] = [];
  // Parallel to `rows` (same index) — needed for the totals, not columns.
  const giftByRow: boolean[] = [];
  const dropIdByRow: number[] = [];
  for (const o of orders) {
    const drop = o.tripDropId !== null ? dropById.get(o.tripDropId) : undefined;
    const trip = drop ? tripById.get(drop.tripId) : undefined;
    if (!drop || !trip) continue;

    const eid = effId(o);
    const cust = eid !== null ? custById.get(eid) : undefined;
    const billTo = billToByObd.get(o.obdNumber);
    const snap = snapByOrder.get(o.id);

    // KG / litres / articles — billQuantities (lib/reports/bill-facts.ts) holds
    // the rules: a stored 0 kg is UNKNOWN only when grossWeight is null.
    const { kg, litres, articles } = billQuantities(snap, o);

    // B — SAP's own ship-to point (orders.customerId), and whether it is a site.
    const sapShipTo = o.customerId !== null ? custById.get(o.customerId) : undefined;
    const isSite = isSiteDelivery({
      billToCode: billTo?.code ?? null,
      sapShipToCode: o.shipToCustomerId,
      shipToType: sapShipTo?.customerType?.name ?? sapShipTo?.premisesType?.name ?? null,
      smu: o.smu,
    });
    // C — where the floor sent it. Only a master row carries a name and area;
    // a legacy flag-only redirect (shipToOverride true, no id) stores no name
    // anywhere on the order, so it leaves both blank. Never "(Unmatched)".
    // An override pointing at SAP's own ship-to point (C = B) changed nothing,
    // so it is not a redirect either (seen live: OBD 9109619675).
    const redirect =
      o.shipToOverrideCustomerId !== null && o.shipToOverrideCustomerId !== o.customerId
        ? custById.get(o.shipToOverrideCustomerId)
        : undefined;

    rows.push({
      tripDate: trip.tripDate,
      tripNo: trip.tripNumber,
      deliveryType: trip.deliveryType.name,
      dispatchSlot: blank(trip.dispatchWindow?.windowTime) ?? blank(trip.dispatchWindow?.label),
      tripStatus: TRIP_STATUS_LABEL[trip.status] ?? trip.status,
      vehicleNo: blank(trip.vehicle?.vehicleNo) ?? blank(trip.adhocVehicleNo),
      vehicleType: blank(trip.vehicle?.category) ?? blank(trip.vehicleSize),
      driverName: blank(trip.driverName),
      driverMobile: blank(trip.driverPhone),
      transporter: blank(trip.transporter?.name),
      billToCode: blank(billTo?.code),
      billToName: blank(billTo?.name),
      shipToCode: blank(cust?.customerCode) ?? blank(o.shipToCustomerId) ?? blank(drop.shipToCode),
      shipToName: blank(cust?.customerName) ?? blank(o.shipToCustomerName) ?? blank(drop.customerName),
      site: isSite ? "Yes" : "No",
      area: blank(cust?.area.name) ?? blank(drop.areaName),
      route: blank(cust?.primaryRoute?.name) ?? blank(drop.routeName),
      obdNo: o.obdNumber,
      soNo: blank(o.soNumber),
      invoiceNo: blank(o.invoiceNo),
      invoiceDate: istDay(o.invoiceDate),
      smu: blank(o.smu),
      tint: o.orderType === "tint" ? "Yes" : "No",
      articles,
      litres,
      kg,
      billStage: billStageWord(o.workflowStage, o.directLoadedAt),
      tripNote: blank(trip.note),
      dropSeq: drop.dropSeq,

      dispatchWindowTime: blank(trip.dispatchWindow?.windowTime),
      vehicleCategory: blank(trip.vehicle?.category),
      billToArea: (() => {
        const code = blank(billTo?.code);
        return code !== null ? (billToAreaByCode.get(code) ?? null) : null;
      })(),
      invType: invTypeFor(o.materialType),
      siteName: isSite ? (blank(sapShipTo?.customerName) ?? blank(o.shipToCustomerName)) : null,
      siteArea: isSite ? blank(sapShipTo?.area.name) : null,
      redirectName: blank(redirect?.customerName),
      redirectArea: blank(redirect?.area.name),
      // Filled in below, once every bill of the trip is known.
      tripTotalLitres: 0,
      tripTotalKg: 0,
      tripDealerCount: 0,
      entryBy: blank(trip.createdBy.name),
      entryAt: trip.createdAt,
    });
    giftByRow.push(isGiftBill(o.materialType));
    dropIdByRow.push(drop.id);
  }

  // ── Per-trip totals (old layout's Total LT / Total KG / Total Dealer) ─────
  // Over the bills in THIS report (held and removed bills are already out).
  // Gifts add 0 L and 0 kg — the house rule (lib/orders/gift.ts) every other
  // trip total follows; an unknown kg adds nothing.
  const totals = new Map<string, { litres: number; kg: number; drops: Set<number> }>();
  rows.forEach((r, i) => {
    const t = totals.get(r.tripNo) ?? { litres: 0, kg: 0, drops: new Set<number>() };
    t.litres += loadLitres(r.litres, giftByRow[i]);
    t.kg += loadKg(r.kg, giftByRow[i]) ?? 0;
    t.drops.add(dropIdByRow[i]);
    totals.set(r.tripNo, t);
  });
  for (const r of rows) {
    const t = totals.get(r.tripNo);
    if (!t) continue;
    r.tripTotalLitres = t.litres;
    r.tripTotalKg = t.kg;
    r.tripDealerCount = t.drops.size;
  }

  // Trip Date, Trip No, stop order, OBD No.
  rows.sort(
    (a, b) =>
      a.tripDate.getTime() - b.tripDate.getTime() ||
      a.tripNo.localeCompare(b.tripNo) ||
      a.dropSeq - b.dropSeq ||
      a.obdNo.localeCompare(b.obdNo),
  );
  return rows;
}
