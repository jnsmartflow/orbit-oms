// lib/order-invoices/links.ts — WHICH INVOICE ROW a new trip_bill_copies /
// trip_redeliveries / ci_returns row points at (Schema v27.66, Phase 3 commit
// 2, 2026-10-12). The rule is pure (linkRowFor, tested in trip-link.test.ts);
// invoiceRowLinks is the one read behind it.
//
// Today every copy, re-delivery and CI is WHOLE-OBD. The rule:
//   · UNSPLIT OBD → its seq-1 row. Exact: seq 1 IS the whole OBD (the PART 4
//     back-fill made the same choice for the 727 existing rows).
//   · SPLIT OBD, copy or re-delivery → seq 1, the SAP invoice. Forced as well as
//     safe: the OLD UNIQUE (tripId, orderId) is still live until the Phase 5
//     gate, so ONE row per (trip, OBD) is all the table can hold — one row per
//     invoice row is impossible before PART 7. Seq 1 is the row a "Copy inv"
//     press actually copied (orders.invoiceNo = seq 1's number), it is never
//     deleted by Add invoices save / undo, and it matches the owner's hand
//     decision for copy 276 (PART 6a). Until Phase 5, a seq-1 link on a split
//     OBD means "the whole OBD".
//   · SPLIT OBD, CI → NULL. A CI feeds the v27.66 derived dispatched rule ("a
//     row that came back whole is finished"); pinning a whole-OBD CI on seq 1
//     would mark the WRONG row returned. NULL is honest — PART 8 row 11 shows
//     it as a NULL to resolve, and Phase 6 assigns CI rows from their lines.
//     (A CI already blocks any further Add invoices edit, 335e874c.)
//   · No seq-1 row at all (Model A says impossible) → NULL, logged.

import { prisma } from "../prisma";

export type LinkKind = "copy" | "redelivery" | "ci";

/** What the rule needs to know about one OBD's invoice rows. */
export interface ObdInvoiceRows {
  /** The seq-1 row's id; null if it is missing. */
  seq1Id: number | null;
  /** n ≥ 2 rows, or any line row at all (the split.ts definition). */
  split: boolean;
}

/** The orderInvoiceId a new whole-OBD record of `kind` gets. */
export function linkRowFor(rows: ObdInvoiceRows, kind: LinkKind): number | null {
  if (rows.seq1Id === null) return null;
  if (!rows.split) return rows.seq1Id;
  return kind === "ci" ? null : rows.seq1Id;
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

/** The orderInvoiceId for one OBD's new record — the read and the rule. */
export async function linkRowForOrder(orderId: number, kind: LinkKind): Promise<number | null> {
  const rows = (await invoiceRowLinks([orderId])).get(orderId)!;
  if (rows.seq1Id === null) {
    console.error(`[order-invoices] order ${orderId} has no seq-1 row — ${kind} written with orderInvoiceId NULL; re-run v27.63 PART 3`);
  }
  return linkRowFor(rows, kind);
}
