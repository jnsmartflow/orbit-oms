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
function billStageWord(stage: string): string | null {
  return PICK_STAGE_WORD[stage] ?? LADDER_LABEL.get(stage) ?? null;
}

/** The project SMUs — the same set Floor's own site badge uses
 *  (lib/floor/filter.ts:35, components/floor/floor-table.tsx:78,
 *  app/api/floor/order/[orderId]/route.ts:20). Here it is only the FALLBACK
 *  for a ship-to point the master has not typed — see isSiteDelivery(). */
const PROJECT_SMUS = new Set(["Retail Offtake", "Decorative Projects"]);

/**
 * Is SAP's ship-to (B) a real SITE, and a different party from the dealer
 * billed (A)? The ONE site rule — both workbooks read its answer (`site`,
 * `siteName`, `siteArea`). Owner's rule, 2026-10-01.
 *
 * 1. Same party → never a site: B's code equals A's code (SAP's own ship-to
 *    and bill-to codes).
 * 2. The PLACE decides, when the master says what it is: the ship-to point's
 *    customerType (falling back to premisesType) — "Site" is a site, anything
 *    else (Dealer / Shop …) is not. Verified 2026-10-01 over trip bills of the
 *    last 60 days: the two fields always agree (Site/Site, Dealer/Shop).
 * 3. Only when the point is UNTYPED (or not in the master) does the ORDER's
 *    SMU decide — project SMU = site. 272 of the 378 project-SMU bills on
 *    trips sat on untyped or unmatched points, so the fallback is needed.
 *
 * ⚠ Unlike Floor's badge, a ship-to REDIRECT does not unmark a site here: B is
 * SAP's ship-to, and where the floor sent it (C) is reported separately.
 */
function isSiteDelivery(args: {
  billToCode: string | null;
  sapShipToCode: string | null;
  shipToType: string | null;
  smu: string | null;
}): boolean {
  const a = args.billToCode?.trim() || null;
  const b = args.sapShipToCode?.trim() || null;
  if (a !== null && b !== null && a === b) return false;
  const type = args.shipToType?.trim() || null;
  if (type !== null) return type.toLowerCase() === "site";
  return args.smu !== null && PROJECT_SMUS.has(args.smu);
}

/**
 * orders.invoiceDate is a plain timestamp, not @db.Date. The import builds it
 * with LOCAL-time `new Date(y, m, d)` (app/api/import/obd/route.ts
 * parseDateCell), so the same SAP day lands at UTC midnight from a UTC host and
 * at 18:30 UTC the day before from an IST host. Taking the IST calendar day is
 * right for both: +5:30 keeps a UTC-midnight value on its day and moves an
 * IST-midnight value forward onto its day.
 */
function istDay(d: Date | null): Date | null {
  if (d === null || Number.isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** INV or PROMO for one bill — the ONE place both workbooks get it from. */
function invTypeFor(materialType: string | null): "INV" | "PROMO" {
  // GIFTS = free goods = PROMO; FG = ordinary finished goods = INV. Owner's rule, 2026-10-01.
  return isGiftBill(materialType) ? "PROMO" : "INV";
}

const blank = (s: string | null | undefined): string | null => {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t === "" ? null : t;
};

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
      grossWeight: true,
      volume: true,
      materialType: true,
    },
  });
  if (orders.length === 0) return [];

  // ── 4. Quantities (the import's per-OBD snapshot) ────────────────────────
  const snaps = await prisma.import_obd_query_summary.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    select: { orderId: true, totalArticle: true, totalVolume: true, totalWeight: true },
  });
  const snapByOrder = new Map<number, (typeof snaps)[number]>();
  for (const s of snaps) if (s.orderId !== null) snapByOrder.set(s.orderId, s);

  // ── 5. Bill-to, from SAP's raw summary — latest row wins ─────────────────
  // Same read as lib/floor/queries.ts billToByObd(), plus the code column it
  // does not fetch.
  const raws = await prisma.import_raw_summary.findMany({
    where: { obdNumber: { in: orders.map((o) => o.obdNumber) } },
    select: { obdNumber: true, billToCustomerId: true, billToCustomerName: true },
    orderBy: { createdAt: "desc" },
  });
  const billToByObd = new Map<string, { code: string | null; name: string | null }>();
  for (const r of raws) {
    if (!billToByObd.has(r.obdNumber)) {
      billToByObd.set(r.obdNumber, { code: r.billToCustomerId, name: r.billToCustomerName });
    }
  }

  // ── 6. The EFFECTIVE delivery point: shipToOverrideCustomerId ?? customerId
  // (lib/trips/drop-key.ts effectiveCustomerId) ─────────────────────────────
  const effId = (o: { customerId: number | null; shipToOverrideCustomerId: number | null }) =>
    o.shipToOverrideCustomerId ?? o.customerId;
  // Also SAP's own ship-to point (customerId, "B") and the redirect target
  // (shipToOverrideCustomerId, "C") — the effective id is always one of these
  // two, so one read covers all three.
  const custIds = Array.from(
    new Set(
      orders
        .flatMap((o) => [o.customerId, o.shipToOverrideCustomerId])
        .filter((id): id is number => id !== null),
    ),
  );
  const customers = custIds.length
    ? await prisma.delivery_point_master.findMany({
        where: { id: { in: custIds } },
        select: {
          id: true,
          customerCode: true,
          customerName: true,
          area: { select: { name: true } },
          primaryRoute: { select: { name: true } },
          customerType: { select: { name: true } },
          premisesType: { select: { name: true } },
        },
      })
    : [];
  const custById = new Map(customers.map((c) => [c.id, c]));

  // ── 7. The bill-to party's area (old layout's Customer Area) ─────────────
  // SAP's bill-to code → delivery_point_master.customerCode → area.
  const billToCodes = Array.from(
    new Set(
      Array.from(billToByObd.values())
        .map((b) => blank(b.code))
        .filter((c): c is string => c !== null),
    ),
  );
  const billToCusts = billToCodes.length
    ? await prisma.delivery_point_master.findMany({
        where: { customerCode: { in: billToCodes } },
        select: { customerCode: true, area: { select: { name: true } } },
      })
    : [];
  const billToAreaByCode = new Map(billToCusts.map((c) => [c.customerCode, c.area.name]));

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

    // KG — 🔴 BLANK WHEN UNKNOWN, NEVER 0. The import writes
    // `totalWeight = grossWeight ?? 0` (app/api/import/obd/route.ts:854), so a
    // stored 0 is ambiguous. The test used: a snapshot 0 counts as UNKNOWN only
    // when the order's own `grossWeight` is NULL (SAP sent no weight); if
    // grossWeight is non-null, the 0 is a real 0 and is written as 0. With no
    // snapshot row at all, fall back to orders.grossWeight (null → blank).
    let kg: number | null;
    if (snap) kg = snap.totalWeight === 0 && o.grossWeight === null ? null : snap.totalWeight;
    else kg = o.grossWeight;

    // Litres: snapshot, else the order header's volume. Articles: snapshot
    // only — the order header has no article count (totalUnitQty is units, not
    // articles), so a bill with no snapshot leaves the cell blank.
    const litres = snap ? snap.totalVolume : o.volume;
    const articles = snap ? snap.totalArticle : null;

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
      billStage: billStageWord(o.workflowStage),
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
