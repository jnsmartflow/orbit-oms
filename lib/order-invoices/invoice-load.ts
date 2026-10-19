// lib/order-invoices/invoice-load.ts — A SPLIT OBD'S INVOICES WITH THEIR LOAD
// AND THEIR TRIP (Add invoices, Phase 5 commit 1, 2026-10-13). Server-only,
// SELECT-only, sequential awaits (CORE §3).
//
// THE one read of "each invoice of a split OBD: number, date, tins, litres, kg
// (+ exact flag), stale, and its own trip stop". Moved here from
// lib/floor/queries.ts getBoardInvoiceRows (Phase 4 commit 1), which now calls
// it, so the Floor board and every trip total (lib/trips/queries.ts, Print,
// trip sheet, load plan) read ONE set of invoice facts. The maths is the pure
// buildInvoiceRows (lib/floor/invoice-rows.ts); "how much of an OBD is in a
// place" is the pure placeLoad beside it.
//
// READS — the first always, the rest only when it finds a split OBD:
//   1. order_invoices, orderId IN (asked) AND seq > 1 — which are split
//      (order_invoices_orderId_seq_key, index-only).
//   2. their rows with lines and the row's stop → trip number / status.
//   3. their ACTIVE raw lines (litres, SAP line kg).
//   4. SAP's learned kg per tin for those lines' SKUs (kg rule 2,
//      lib/order-invoices/kg-per-unit.ts).
// An OBD absent from the map is not split: callers use the OBD's own totals.

import { prisma } from "../prisma";
import { buildInvoiceRows, type FloorInvoiceRow } from "../floor/invoice-rows";
import { learnedKgPerUnit } from "./kg-per-unit";

/**
 * orderId → the OBD's invoice rows (seq order), for SPLIT OBDs only.
 * `kgByOrder` = each OBD's header kg (querySnapshot.totalWeight) — kg rule 3.
 */
export async function loadSplitInvoiceRows(
  orders: ReadonlyArray<{ id: number; obdNumber: string }>,
  kgByOrder: ReadonlyMap<number, number | null>,
): Promise<Map<number, FloorInvoiceRow[]>> {
  const map = new Map<number, FloorInvoiceRow[]>();
  if (orders.length === 0) return map;
  const typed = await prisma.order_invoices.findMany({
    where: { orderId: { in: Array.from(new Set(orders.map((o) => o.id))) }, seq: { gt: 1 } },
    select: { orderId: true },
    distinct: ["orderId"],
  });
  if (typed.length === 0) return map;

  const splitIds = typed.map((t) => t.orderId);
  const rows = await prisma.order_invoices.findMany({
    where: { orderId: { in: splitIds } },
    orderBy: [{ orderId: "asc" }, { seq: "asc" }],
    select: {
      id: true,
      orderId: true,
      seq: true,
      invoiceNo: true,
      invoiceDate: true,
      // Phase 5 — the row's OWN stop, and that stop's trip.
      tripDropId: true,
      tripDrop: { select: { trip: { select: { tripNumber: true, status: true } } } },
      // 6.1 — the row's own hold (split OBDs only reach here; an unsplit row's
      // isHeld drifted and is never read).
      isHeld: true,
      heldAt: true,
      heldById: true,
      // 6.3 — the row's own CI, if any (not voided; newest first).
      ciReturns: { where: { isVoided: false }, orderBy: { id: "desc" }, take: 1, select: { ciNumber: true, status: true } },
      lines: { select: { rawLineItemId: true, qty: true } },
    },
  });
  const obdById = new Map(orders.map((o) => [o.id, o.obdNumber]));
  const obds = splitIds.map((id) => obdById.get(id)).filter((n): n is string => n !== undefined);
  // ACTIVE lines only — a removed line is the "stale" case, as loadSplitView reads it.
  const lines = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: { in: obds }, lineStatus: "active" },
    select: { id: true, obdNumber: true, lineId: true, skuCodeRaw: true, unitQty: true, volumeLine: true, totalWeight: true },
  });
  // Kg rule 2's source — SAP's kg per tin learned from every line that carried
  // it (median per SKU). Only these OBDs' SKUs.
  const unitKgBySku = await learnedKgPerUnit(lines.map((l) => l.skuCodeRaw));
  for (const id of splitIds) {
    const obd = obdById.get(id);
    const built = buildInvoiceRows({
      rows: rows
        .filter((r) => r.orderId === id)
        .map((r) => ({
          ...r,
          tripNumber: r.tripDrop?.trip.tripNumber ?? null,
          tripStatus: r.tripDrop?.trip.status ?? null,
          ci: r.ciReturns[0] ?? null,
        })),
      activeLines: lines
        .filter((l) => l.obdNumber === obd)
        .map((l) => ({ rawLineItemId: l.id, lineId: l.lineId, skuCodeRaw: l.skuCodeRaw, unitQty: l.unitQty, volumeLine: l.volumeLine, totalWeight: l.totalWeight })),
      obdKg: kgByOrder.get(id) ?? null,
      unitKgBySku,
    });
    if (built.length > 0) map.set(id, built);
  }
  return map;
}
