// lib/order-invoices/copy-plan.ts — PER-INVOICE COPIES ON THE PRINT TAB
// (Add invoices P5-5, 2026-10-23, Schema v27.74). PURE: no Prisma, no clock.
// Tests: copy-plan.test.ts (npx tsx --test lib/order-invoices/copy-plan.test.ts).
//
// Since PART 7 (v27.74) trip_bill_copies holds ONE row per INVOICE ROW per trip
// (UNIQUE "tripId","orderInvoiceId"; the old per-OBD unique is gone). The rules:
//
//   · UNSPLIT OBD → one row, on seq 1 — the whole OBD, exactly as before.
//   · SPLIT OBD → one row per invoice of it ON THAT TRIP that is not copied
//     there yet. A bulk / single / review press (OBD number on the clipboard)
//     writes every such invoice; a Copy inv press only the invoices whose
//     numbers went on the clipboard.
//   · AN INVOICE IS COPIED ON A TRIP when a copy row on that trip names it, OR
//     when a copy row on that trip names ANY row of the OBD and was taken
//     BEFORE THE SPLIT (copiedAt earlier than the first seq ≥ 2 row's
//     createdAt). Such a copy was of the whole bill — it covers every invoice
//     the OBD later turned into. Live: copy 276 (L-261006-05, 6 Oct, 'bulk',
//     on row 17010 = …716) predates 18648's split (12 Oct), so 713 + 715 on
//     that trip read copied, "whole OBD, before the split". It is never
//     rewritten.
//   · A split OBD reads COPIED on a trip when every one of its invoices there
//     is copied; partly copied → its picking state decides, and the next press
//     writes only the rest.

import { INVOICE_SOURCE } from "./source";

/** One copy row, as the rules read it. */
export interface CopyFact {
  tripId: number;
  orderInvoiceId: number;
  copiedAt: Date;
}

/**
 * The OBD's split moment: the earliest createdAt of a seq ≥ 2 row; null = never
 * split. A SPLIT LOAD truck part ('load' row) is NOT a split moment (design
 * Answer 3, Phase 4 batch 2): it is the same paper on another truck, so a copy
 * taken before it covers only the row it names. The same filter sits in
 * lib/billing/print.ts (its own read and its raw-SQL MIN).
 */
export function splitAtOf(rows: ReadonlyArray<{ seq: number; createdAt: Date; source?: string }>): Date | null {
  let at: Date | null = null;
  for (const r of rows) {
    if (r.seq > 1 && r.source !== INVOICE_SOURCE.LOAD && (at === null || r.createdAt.getTime() < at.getTime())) at = r.createdAt;
  }
  return at;
}

/** A copy of the WHOLE bill — taken before the OBD was split. */
export function isWholeObdCopy(c: Pick<CopyFact, "copiedAt">, splitAt: Date | null): boolean {
  return splitAt !== null && c.copiedAt.getTime() < splitAt.getTime();
}

/** Does copy `c` (one of the OBD's) cover invoice row `rowId`? */
export function copyCovers(c: Pick<CopyFact, "orderInvoiceId" | "copiedAt">, rowId: number, splitAt: Date | null): boolean {
  return c.orderInvoiceId === rowId || isWholeObdCopy(c, splitAt);
}

/**
 * The copy covering `rowId` on a trip that passes `onTrip`, from the OBD's
 * copies NEWEST FIRST — so the first hit is the latest. null = none.
 */
export function coveringCopy<C extends CopyFact>(
  copies: readonly C[],
  rowId: number,
  splitAt: Date | null,
  onTrip: (tripId: number) => boolean,
): C | null {
  for (const c of copies) if (onTrip(c.tripId) && copyCovers(c, rowId, splitAt)) return c;
  return null;
}

/** One invoice of a split OBD on the trip, as a press sees it. */
export interface CopyTarget {
  id: number;
  invoiceNo: string | null;
  copied: boolean;
}

/** An SAP invoice number worth copying: trimmed, non-empty. */
function noOf(invoiceNo: string | null): string | null {
  const t = invoiceNo?.trim() ?? "";
  return t === "" ? null : t;
}

/**
 * The invoice rows ONE bill's press writes. Unsplit → its seq-1 row (none when
 * Model A's seq 1 is missing — the caller reports it). Split → its invoices on
 * the trip not copied there yet; with `sentNos` (Copy inv) only those whose
 * number is in it.
 */
export function planCopyRows(
  bill: { split: boolean; seq1Id: number | null; here: readonly CopyTarget[] },
  sentNos: ReadonlySet<string> | null,
): Array<{ orderInvoiceId: number; invoiceNo: string | null }> {
  if (!bill.split) return bill.seq1Id === null ? [] : [{ orderInvoiceId: bill.seq1Id, invoiceNo: null }];
  return bill.here
    .filter((r) => !r.copied && (sentNos === null || (noOf(r.invoiceNo) !== null && sentNos.has(noOf(r.invoiceNo)!))))
    .map((r) => ({ orderInvoiceId: r.id, invoiceNo: r.invoiceNo }));
}

/**
 * Copy inv on a SPLIT bill: every sent number must be one of its invoices on
 * the trip that is not copied yet. Returns the first number that is not, or
 * null when all are good.
 */
export function badSentNo(here: readonly CopyTarget[], sentNos: ReadonlySet<string>): string | null {
  for (const no of Array.from(sentNos)) {
    if (!here.some((r) => !r.copied && noOf(r.invoiceNo) === no)) return no;
  }
  return null;
}
