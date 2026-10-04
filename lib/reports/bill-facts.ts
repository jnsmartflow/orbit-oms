// lib/reports/bill-facts.ts
//
// The per-BILL facts the trip reports print, in ONE place (2026-10-04): the
// site rule, INV/PROMO, the IST invoice day, and the batched reads behind them
// (quantity snapshot, SAP bill-to, delivery points, bill-to area). Moved here
// out of trip-detail-data.ts unchanged, so Trip Detail, its Old Format and the
// Freight Report (freight-report-data.ts) cannot drift apart.
//
// 🔴 READ-ONLY. SELECTs only, sequential awaits, never prisma.$transaction
// (CORE §3). 🔴 SERVER-ONLY — it imports prisma.

import { prisma } from "@/lib/prisma";
import { isGiftBill } from "@/lib/orders/gift";

export const blank = (s: string | null | undefined): string | null => {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t === "" ? null : t;
};

/** The project SMUs — the same set Floor's own site badge uses
 *  (lib/floor/filter.ts:35, components/floor/floor-table.tsx:78,
 *  app/api/floor/order/[orderId]/route.ts:20). Here it is only the FALLBACK
 *  for a ship-to point the master has not typed — see isSiteDelivery(). */
const PROJECT_SMUS = new Set(["Retail Offtake", "Decorative Projects"]);

/**
 * Is SAP's ship-to (B) a real SITE, and a different party from the dealer
 * billed (A)? The ONE site rule — every trip report reads its answer. Owner's
 * rule, 2026-10-01.
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
export function isSiteDelivery(args: {
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
export function istDay(d: Date | null): Date | null {
  if (d === null || Number.isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** INV or PROMO for one bill — the ONE place every report gets it from. */
export function invTypeFor(materialType: string | null): "INV" | "PROMO" {
  // GIFTS = free goods = PROMO; FG = ordinary finished goods = INV. Owner's rule, 2026-10-01.
  return isGiftBill(materialType) ? "PROMO" : "INV";
}

// ── The batched reads ───────────────────────────────────────────────────────

/** Quantities (the import's per-OBD snapshot), keyed by order id. */
export async function loadSnapshots(orderIds: number[]) {
  const snaps = orderIds.length
    ? await prisma.import_obd_query_summary.findMany({
        where: { orderId: { in: orderIds } },
        select: { orderId: true, totalArticle: true, totalVolume: true, totalWeight: true },
      })
    : [];
  const snapByOrder = new Map<number, (typeof snaps)[number]>();
  for (const s of snaps) if (s.orderId !== null) snapByOrder.set(s.orderId, s);
  return snapByOrder;
}
export type BillSnapshot = Awaited<ReturnType<typeof loadSnapshots>> extends Map<number, infer S> ? S : never;

/**
 * Bill-to, from SAP's raw summary — latest row wins. Same read as
 * lib/floor/queries.ts billToByObd(), plus the code column it does not fetch.
 */
export async function loadBillToByObd(obdNumbers: string[]) {
  const raws = obdNumbers.length
    ? await prisma.import_raw_summary.findMany({
        where: { obdNumber: { in: obdNumbers } },
        select: { obdNumber: true, billToCustomerId: true, billToCustomerName: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const billToByObd = new Map<string, { code: string | null; name: string | null }>();
  for (const r of raws) {
    if (!billToByObd.has(r.obdNumber)) {
      billToByObd.set(r.obdNumber, { code: r.billToCustomerId, name: r.billToCustomerName });
    }
  }
  return billToByObd;
}

/** Delivery points by id — SAP's ship-to (B), the redirect (C) and so the
 *  effective point, with area (+ its delivery type), route and type. */
export async function loadCustomers(ids: number[]) {
  const customers = ids.length
    ? await prisma.delivery_point_master.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          customerCode: true,
          customerName: true,
          area: { select: { name: true, deliveryType: { select: { id: true, name: true } } } },
          primaryRoute: { select: { name: true } },
          customerType: { select: { name: true } },
          premisesType: { select: { name: true } },
        },
      })
    : [];
  return new Map(customers.map((c) => [c.id, c]));
}

/** The bill-to party's area: SAP's bill-to code → delivery_point_master.customerCode → area. */
export async function loadBillToAreas(billToByObd: Map<string, { code: string | null }>) {
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
  return new Map(billToCusts.map((c) => [c.customerCode, c.area.name]));
}

/**
 * KG, litres and articles for one bill.
 *
 * KG — 🔴 BLANK WHEN UNKNOWN, NEVER 0. The import writes
 * `totalWeight = grossWeight ?? 0` (app/api/import/obd/route.ts:854), so a
 * stored 0 is ambiguous. The test used: a snapshot 0 counts as UNKNOWN only
 * when the order's own `grossWeight` is NULL (SAP sent no weight); if
 * grossWeight is non-null, the 0 is a real 0 and is written as 0. With no
 * snapshot row at all, fall back to orders.grossWeight (null → blank).
 *
 * Litres: snapshot, else the order header's volume. Articles: snapshot only —
 * the order header has no article count (totalUnitQty is units, not
 * articles), so a bill with no snapshot leaves the cell blank.
 */
export function billQuantities(
  snap: { totalArticle: number; totalVolume: number; totalWeight: number } | undefined,
  order: { grossWeight: number | null; volume: number | null },
): { kg: number | null; litres: number | null; articles: number | null } {
  let kg: number | null;
  if (snap) kg = snap.totalWeight === 0 && order.grossWeight === null ? null : snap.totalWeight;
  else kg = order.grossWeight;
  const litres = snap ? snap.totalVolume : order.volume;
  const articles = snap ? snap.totalArticle : null;
  return { kg, litres, articles };
}
