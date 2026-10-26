// lib/order-invoices/redelivery-plan.ts — PER-INVOICE RE-DELIVERIES (Add
// invoices P5-5, 2026-10-23, Schema v27.74). PURE: no Prisma, no clock.
// Tests: redelivery-plan.test.ts (npx tsx --test lib/order-invoices/redelivery-plan.test.ts).
//
// Since PART 7 (v27.74) trip_redeliveries holds ONE row per INVOICE ROW per
// trip. The rules (lib/trips/redelivery.ts applies them):
//
//   · UNSPLIT OBD → one row, on seq 1 — the whole OBD, exactly as before.
//   · SPLIT OBD → one row per invoice the planner ticks. Each invoice is its
//     own attempt line: its attempts are ITS OWN trip (the row's stop) plus
//     every re-delivery naming it, so attempt no. and prevTripId are per
//     invoice. Live: 18648's 713 + 715 left on L-261006-05 (605) and came back
//     on L-261007-20 (668) — re-deliveries 28 → 36798 and 86 → 36800, both
//     attempt 2, prevTripId 605.
//   · A held invoice, or one that never went on a truck, is refused.
//   · LOAD: a re-delivery of invoice X carries only X's litres / kg — the
//     invoices of one OBD on one stop of a trip are summed (placeLoad's rule:
//     all of them, or unsplit → the OBD's own totals). Trip 668: 18648 = 713 +
//     715 = 460 L, not the OBD's 1,000 L.
//   · COUNTS stay per OBD (owner, 2026-10-13): two invoices of one OBD
//     re-delivered on one trip are ONE re-delivery in "+n re-del".

import type { AttemptHistoryEntry } from "../trips/redelivery";

export const MSG_INVOICE_HELD = "On hold — release it before it goes out again.";
export const MSG_INVOICE_NOT_GONE = "Not gone out yet — add it to a trip normally.";

/** One invoice row of an OBD, as the search sees it. */
export interface RedeliveryRowFact {
  id: number;
  seq: number;
  invoiceNo: string | null;
}

/**
 * What one found OBD offers the dialog: null = the whole OBD (unsplit, seq 1);
 * else the invoice rows, one tick each. An INVOICE number offers the rows it
 * named — one on an Add-invoices bill, EVERY truck part of a split load (its
 * parts share the number; Phase 4 batch 4); an OBD / SO number (no row named,
 * or none of this OBD's) offers every row.
 */
export function redeliveryTargetsOf(
  obd: { split: boolean; rows: readonly RedeliveryRowFact[] },
  matchedRowIds: readonly number[],
): RedeliveryRowFact[] | null {
  if (!obd.split) return null;
  const rows = obd.rows.slice().sort((a, b) => a.seq - b.seq);
  const hits = rows.filter((r) => matchedRowIds.includes(r.id));
  return hits.length > 0 ? hits : rows;
}

/** A split invoice the dialog may not tick, or null. `history` = its own attempts. */
export function invoiceRefusal(row: { isHeld: boolean; isDispatched: boolean }, history: readonly unknown[]): string | null {
  if (row.isHeld) return MSG_INVOICE_HELD;
  if (history.length === 0 && !row.isDispatched) return MSG_INVOICE_NOT_GONE;
  return null;
}

/** One trip_redeliveries row, as the loaders read it. */
export interface RedeliveryRecord {
  tripId: number;
  tripDropId: number;
  orderId: number;
  orderInvoiceId: number;
}

/**
 * The records grouped per (trip, stop, OBD), first-seen order: one carried bill
 * with the invoice rows it brings. An unsplit OBD has one record per trip, so
 * every group is a single record — the lists the loaders built before.
 */
export function groupRedeliveries<R extends RedeliveryRecord>(records: readonly R[]): Array<{ first: R; rowIds: number[] }> {
  const byKey = new Map<string, { first: R; rowIds: number[] }>();
  for (const r of records) {
    const key = `${r.tripId}:${r.tripDropId}:${r.orderId}`;
    const g = byKey.get(key);
    if (g) g.rowIds.push(r.orderInvoiceId);
    else byKey.set(key, { first: r, rowIds: [r.orderInvoiceId] });
  }
  return Array.from(byKey.values());
}

/** "+n re-del" per trip — DISTINCT OBDs (counts stay per OBD). */
export function redeliveryCountsByTrip(records: readonly Pick<RedeliveryRecord, "tripId" | "orderId">[]): Map<number, number> {
  const seen = new Set<string>();
  const out = new Map<number, number>();
  for (const r of records) {
    const key = `${r.tripId}:${r.orderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(r.tripId, (out.get(r.tripId) ?? 0) + 1);
  }
  return out;
}

/**
 * An OBD's attempt list: several invoices re-delivered on ONE trip are ONE
 * attempt of the OBD there — the later duplicates are dropped. Unsplit OBDs
 * have at most one re-delivery per trip, so their list is unchanged.
 */
export function dedupeObdAttempts(entries: readonly AttemptHistoryEntry[]): AttemptHistoryEntry[] {
  const seen = new Set<number>();
  return entries.filter((h) => {
    if (h.kind !== "redelivery") return true;
    if (seen.has(h.tripId)) return false;
    seen.add(h.tripId);
    return true;
  });
}
