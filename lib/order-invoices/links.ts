// lib/order-invoices/links.ts — WHICH INVOICE ROW a new trip_bill_copies /
// trip_redeliveries / ci_returns row points at (Schema v27.66, Phase 3 commit
// 2, 2026-10-12). The rule is pure (linkRowFor, tested in trip-link.test.ts);
// invoiceRowLinks is the one read behind it.
//
// THE RULE FOR A WHOLE-OBD RECORD:
//   · UNSPLIT OBD → its seq-1 row. Exact: seq 1 IS the whole OBD (the PART 4
//     back-fill made the same choice for the 727 existing rows).
//   · SPLIT OBD → NULL, for every kind. A split OBD has no "whole" row:
//       - copy / re-delivery: since PART 7 (v27.74, run 23 Oct 2026) the tables
//         hold ONE row PER INVOICE per trip, and the writers name each invoice
//         themselves (P5-5 — lib/order-invoices/copy-plan.ts planCopyRows,
//         lib/trips/redelivery.ts addRedeliveries). The P5-4 stopgap — "the
//         lowest-seq row on the trip stands for the OBD", forced while the old
//         UNIQUE (tripId, orderId) allowed one row per OBD — is GONE.
//       - CI: a whole-OBD CI pinned on seq 1 would mark the WRONG row returned
//         (the derived dispatched rule). 6.3 raises one CI per invoice
//         (lib/floor/raise-ci.ts); a whole-OBD CI on a split OBD stays NULL.
//   · No seq-1 row at all (Model A says impossible) → NULL, logged.
//
// READERS (P5-4): a record is found THROUGH its invoice row — recordsOfObds /
// recordObdOf below — never by "orderId", which stays on both tables as a
// denormalised read key only. Since PART 7 "orderInvoiceId" is NOT NULL on
// copies and re-deliveries, so every record HAS its row.

import { prisma } from "../prisma";

export type LinkKind = "copy" | "redelivery" | "ci";

/** What the rule needs to know about one OBD's invoice rows. */
export interface ObdInvoiceRows {
  /** The seq-1 row's id; null if it is missing. */
  seq1Id: number | null;
  /** n ≥ 2 rows, or any line row at all (the split.ts definition). */
  split: boolean;
}

/** The orderInvoiceId a new WHOLE-OBD record of `kind` gets (header). */
export function linkRowFor(rows: ObdInvoiceRows, _kind: LinkKind): number | null {
  if (rows.seq1Id === null || rows.split) return null;
  return rows.seq1Id;
}

/** Prisma where: the copy / re-delivery records of these OBDs, reached THROUGH
 *  the invoice row they name (P5-4). Spread into a trip_bill_copies or
 *  trip_redeliveries where. */
export function recordsOfObds(orderIds: number[]) {
  return { orderInvoice: { orderId: { in: orderIds } } };
}

/** Select a record's OBD key — recordObdOf reads it. */
export const RECORD_OBD_SELECT = { orderInvoice: { select: { orderId: true } } } as const;

/** A record's OBD, through its invoice row (NOT NULL since PART 7). */
export function recordObdOf(r: { orderInvoice: { orderId: number } }): number {
  return r.orderInvoice.orderId;
}

/** ONE read for many OBDs: each one's seq-1 id and whether it is split. */
export async function invoiceRowLinks(orderIds: number[]): Promise<Map<number, ObdInvoiceRows>> {
  const out = new Map<number, ObdInvoiceRows>();
  if (orderIds.length === 0) return out;
  const rows = await prisma.order_invoices.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true, orderId: true, seq: true, _count: { select: { lines: true } } },
  });
  for (const id of orderIds) out.set(id, { seq1Id: null, split: false });
  for (const r of rows) {
    const cur = out.get(r.orderId)!;
    if (r.seq === 1) cur.seq1Id = r.id;
    else cur.split = true;
    if (r._count.lines > 0) cur.split = true;
  }
  return out;
}

/** The orderInvoiceId for one OBD's new whole-OBD record — the read and the rule. */
export async function linkRowForOrder(orderId: number, kind: LinkKind): Promise<number | null> {
  const rows = (await invoiceRowLinks([orderId])).get(orderId)!;
  if (rows.seq1Id === null) {
    console.error(`[order-invoices] order ${orderId} has no seq-1 row — ${kind} written with orderInvoiceId NULL; re-run v27.63 PART 3`);
  }
  return linkRowFor(rows, kind);
}
