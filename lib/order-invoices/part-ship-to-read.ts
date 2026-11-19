// lib/order-invoices/part-ship-to-read.ts — THE READERS' VIEW OF PER-PART
// SHIP-TO (Schema v27.81, owner 2026-11-19 — batch 5, "readers ahead of the UI
// switch-on"). Server-only for the two loaders; stopPart / shopCountsOf are pure
// and tested in part-ship-to-read.test.ts.
//
// WHY ONE FILE. The trip sheet, Billing's Print tab, the three Orbit-side trip
// reports, the Picking queue, Billing's Picking list and the freight pool all
// need the same two facts — "which part's ship-to does THIS stop go by" and
// "how many shops do this OBD's parts go to" — and each would otherwise carry
// its own copy of the same read. The RULE stays in lib/ship-to/effective.ts
// (effectiveDropInput, partsShopCount); this file only fetches the columns.
//
// 🔴 IDENTITY. A row whose shipToOverride is NULL INHERITS the OBD (rule 1),
// and every row at v27.81 is NULL — so loadOwnPartShipTos returns an EMPTY map,
// stopPart returns null for every stop, effectiveDropInput(order, null) is the
// order's own four columns, and every reader prints exactly what it printed
// before. Only an OBD with 2+ invoice rows can hold a part ship-to (owner Q8),
// so callers ask only for split OBDs and run no read when there are none.
//
// SELECT-only, sequential awaits, never prisma.$transaction (CORE §3).

import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { partsShopCount, type PartShipToCols, type ShipToFacts } from "@/lib/ship-to/effective";

/** order_invoices' four ship-to columns (v27.81). */
export const PART_SHIP_TO_SELECT = {
  shipToOverride: true,
  shipToOverrideCustomerId: true,
  shipToText: true,
  shipToAreaId: true,
} as const satisfies Prisma.order_invoicesSelect;

function colsOf(r: PartShipToCols): PartShipToCols {
  return {
    shipToOverride: r.shipToOverride,
    shipToOverrideCustomerId: r.shipToOverrideCustomerId,
    shipToText: r.shipToText,
    shipToAreaId: r.shipToAreaId,
  };
}

/**
 * row id → the row's OWN ship-to, for the rows of these OBDs that do NOT
 * inherit (shipToOverride not NULL). An inheriting row is absent. ONE read;
 * none for an empty list. Pass split OBDs only (Q8: nothing else can have one).
 */
export async function loadOwnPartShipTos(orderIds: readonly number[]): Promise<Map<number, PartShipToCols>> {
  const ids = Array.from(new Set(orderIds));
  const out = new Map<number, PartShipToCols>();
  if (ids.length === 0) return out;
  const rows = await prisma.order_invoices.findMany({
    where: { orderId: { in: ids }, shipToOverride: { not: null } },
    select: { id: true, ...PART_SHIP_TO_SELECT },
  });
  for (const r of rows) out.set(r.id, colsOf(r));
  return out;
}

/**
 * The part a STOP goes by, from the rows of one OBD sitting on it: the own
 * ship-to of the first of them that has one, else null (= the OBD's, rule 1).
 * Every row on one stop has that stop's drop key (rule 4, the bills route), so
 * any one of them names the same shop. Feed the result to effectiveDropInput.
 */
export function stopPart(
  rowIds: readonly number[] | null | undefined,
  own: ReadonlyMap<number, PartShipToCols>,
): PartShipToCols | null {
  if (!rowIds || own.size === 0) return null;
  for (const id of rowIds) {
    const p = own.get(id);
    if (p) return p;
  }
  return null;
}

type ShopOrder = ShipToFacts & { id: number; shipToOverride?: boolean | null };

/**
 * PURE — rule 6: orderId → how many shops its parts go to (partsShopCount),
 * from EVERY invoice row of each OBD listed. An OBD with no rows here is
 * absent (callers read absent as 1).
 */
export function shopCountsOf(
  orders: readonly ShopOrder[],
  rows: ReadonlyArray<PartShipToCols & { orderId: number }>,
): Map<number, number> {
  const byOrder = new Map<number, PartShipToCols[]>();
  for (const r of rows) {
    const arr = byOrder.get(r.orderId) ?? [];
    arr.push(colsOf(r));
    byOrder.set(r.orderId, arr);
  }
  const out = new Map<number, number>();
  for (const o of orders) {
    const parts = byOrder.get(o.id);
    if (parts) out.set(o.id, partsShopCount(o, parts));
  }
  return out;
}

/**
 * Rule 6 — the "2 shops" tag: orderId → shop count for the OBDs with 2+
 * invoice rows (absent = one shop). ONE read on order_invoices, whose WHERE
 * keeps only rows of OBDs that have a seq > 1 row
 * (order_invoices_orderId_seq_key); none for an empty list.
 */
export async function loadShopCounts(orders: readonly ShopOrder[]): Promise<Map<number, number>> {
  const ids = Array.from(new Set(orders.map((o) => o.id)));
  if (ids.length === 0) return new Map();
  const rows = await prisma.order_invoices.findMany({
    where: { orderId: { in: ids }, order: { invoices: { some: { seq: { gt: 1 } } } } },
    select: { orderId: true, ...PART_SHIP_TO_SELECT },
  });
  return shopCountsOf(orders, rows);
}
