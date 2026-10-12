// lib/order-invoices/plan.ts — ADD INVOICES, the save / undo PLAN (Schema
// v27.66, Phase 3 commit 1, 2026-10-12). PURE: no Prisma, no clock, no React.
// Tests: lib/order-invoices/plan.test.ts (npx tsx --test lib/order-invoices/plan.test.ts).
//
// 🔴 SAVE AND UNDO EDIT IN PLACE, BY SEQ. Until v27.66 a save deleted every
// 'manual' row and re-created it. Since v27.66 three tables point at an
// order_invoices row ON DELETE RESTRICT (trip_bill_copies, trip_redeliveries,
// ci_returns "orderInvoiceId"), and a row now carries its own trip / hold /
// dispatched state — so a row KEEPS ITS ID across edits: the row at seq k is
// updated to the k-th invoice, only rows past the new count are deleted, and
// only rows whose lines actually change get their lines replaced. Do not revert
// to delete + re-create.
//
// 🔴 A ROW THAT CARRIES STATE IS LOCKED. It cannot be deleted, re-numbered or
// have its lines (items or tins) changed while it is on a trip, held,
// dispatched, or referenced by a copy, a re-delivery or a CI — that state was
// recorded against THIS paper with THESE items. Its invoice date may still be
// corrected. The refusal names the invoice and why, in plain English.
//
// The plan never touches the state columns (tripDropId, isHeld, heldAt,
// heldById, isDispatched, dispatchedAt, dispatchedById) — save/undo never write
// them.

import type { InvoiceLineInput } from "./rules";

/** Everything that locks a row, as the server read it. */
export interface RowState {
  /** The trip number of the stop the row is on; null = not on a trip. */
  tripNumber: string | null;
  isHeld: boolean;
  isDispatched: boolean;
  /** Trip numbers billing copied this row for. */
  copyTrips: string[];
  /** Trip numbers this row is re-delivered on. */
  redeliveryTrips: string[];
  /** CI numbers raised against this row (a draft has none: "a draft CI"). */
  ciNumbers: (string | null)[];
}

/** One order_invoices row as it stands. */
export interface CurrentRow extends RowState {
  id: number;
  seq: number;
  invoiceNo: string | null;
  invoiceDate: Date | null;
  source: string;
  lines: InvoiceLineInput[];
}

/** One row as it should stand after the write. Index 0 is seq 1 (SAP's). */
export interface TargetRow {
  invoiceNo: string;
  invoiceDate: Date | null;
  lines: InvoiceLineInput[];
}

export interface WritePlan {
  /** Manual rows past the new count — deleted (their lines CASCADE). */
  deleteRowIds: number[];
  /** Existing manual rows whose number or date changes. */
  updates: { id: number; seq: number; invoiceNo: string; invoiceDate: Date | null }[];
  /** New manual rows. */
  creates: { seq: number; invoiceNo: string; invoiceDate: Date | null }[];
  /** Every seq whose lines are replaced — an existing row whose lines change,
   *  and every created row. Its lines are deleted, then written fresh. */
  relineSeqs: number[];
}

export type PlanResult = { ok: true; plan: WritePlan; changed: boolean } | { ok: false; refusals: string[] };

/** The plain-English reasons a row is locked, or [] when it is free. */
export function rowLockReasons(s: RowState): string[] {
  const out: string[] = [];
  if (s.isDispatched) out.push("it has been dispatched");
  if (s.tripNumber !== null) out.push(`it is on trip ${s.tripNumber}`);
  if (s.isHeld) out.push("it is on hold");
  for (const t of s.copyTrips) out.push(`billing copied it for trip ${t}`);
  for (const t of s.redeliveryTrips) out.push(`it is re-delivered on trip ${t}`);
  for (const n of s.ciNumbers) out.push(n === null ? "a draft CI is open on it" : `it has CI ${n}`);
  return out;
}

/** The same set of (line, tins), in any order. */
export function sameLines(a: InvoiceLineInput[], b: InvoiceLineInput[]): boolean {
  if (a.length !== b.length) return false;
  const key = (l: InvoiceLineInput) => `${l.rawLineItemId}:${l.qty}`;
  const bs = new Set(b.map(key));
  return a.every((l) => bs.has(key(l)));
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

function refusal(row: CurrentRow, what: string, reasons: string[]): string {
  const name = row.invoiceNo ?? `Invoice ${row.seq}`;
  return `${name} cannot be ${what} — ${reasons.join(", ")}.`;
}

/**
 * The diff from `current` to `target`, or every refusal. `current` is the OBD's
 * rows (seq 1 included); `target` is the whole wanted split in seq order —
 * for Undo, `[{ seq 1's number and date, lines: [] }]`.
 *
 * Seq 1 is SAP's row: its number and date are never written here (the route's
 * validateSplit already demands the SAP number at index 0); only its lines move.
 *
 * Re-running a plan on a half-written state reaches the same target, because
 * the plan is always the diff from what the database holds NOW.
 */
export function planSplitWrite(current: CurrentRow[], target: TargetRow[]): PlanResult {
  const bySeq = new Map(current.map((r) => [r.seq, r]));
  const refusals: string[] = [];
  const plan: WritePlan = { deleteRowIds: [], updates: [], creates: [], relineSeqs: [] };

  target.forEach((t, i) => {
    const seq = i + 1;
    const row = bySeq.get(seq);
    if (!row) {
      plan.creates.push({ seq, invoiceNo: t.invoiceNo, invoiceDate: t.invoiceDate });
      plan.relineSeqs.push(seq);
      return;
    }
    const locked = rowLockReasons(row);
    const renumbered = seq !== 1 && row.invoiceNo !== t.invoiceNo;
    const relined = !sameLines(row.lines, t.lines);
    if (locked.length > 0 && renumbered) refusals.push(refusal(row, `changed to ${t.invoiceNo}`, locked));
    else if (locked.length > 0 && relined) refusals.push(refusal(row, "given different items", locked));
    if (seq !== 1 && (renumbered || !sameDay(row.invoiceDate, t.invoiceDate))) {
      plan.updates.push({ id: row.id, seq, invoiceNo: t.invoiceNo, invoiceDate: t.invoiceDate });
    }
    if (relined) plan.relineSeqs.push(seq);
  });

  for (const row of current) {
    if (row.seq <= target.length) continue;
    const locked = rowLockReasons(row);
    if (locked.length > 0) refusals.push(refusal(row, "removed", locked));
    plan.deleteRowIds.push(row.id);
  }

  if (refusals.length > 0) return { ok: false, refusals };
  const changed =
    plan.deleteRowIds.length + plan.updates.length + plan.creates.length + plan.relineSeqs.length > 0;
  return { ok: true, plan, changed };
}
