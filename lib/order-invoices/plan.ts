// lib/order-invoices/plan.ts — ADD INVOICES, the save / undo PLAN (Schema
// v27.66, Phase 3 commit 1, 2026-10-12). PURE: no Prisma, no clock, no React.
// Tests: lib/order-invoices/plan.test.ts (npx tsx --test lib/order-invoices/plan.test.ts).
//
// 🔴 SAVE AND UNDO EDIT IN PLACE, BY SEQ. Until v27.66 a save deleted every
// 'manual' row and re-created it. Since v27.66 three tables point at an
// order_invoices row ON DELETE RESTRICT (trip_bill_copies, trip_redeliveries,
// ci_returns "orderInvoiceId"), and a row carries its own trip / hold /
// dispatched state — so a row KEEPS ITS ID across edits: the row at seq k is
// updated to the k-th invoice, only rows past the new count are deleted, and
// only rows whose lines actually change get their lines replaced. Do not revert
// to delete + re-create.
//
// 🔴 "SPLIT INSIDE THE TRIP" (owner, 2026-10-12). The first v27.66 code refused
// to split any row on a trip / held / copied — 3,679 of 3,728 splittable bills
// blocked. The owner's rule, which replaced it (do not revert):
//   · The OBD's rows must all be in ONE state — the same stop (or all off a
//     trip) and all held or none. An unsplit OBD always is. Rows that differ
//     (since Phase 5 one row can move or be held alone) → edit and undo refused.
//   · New rows INHERIT seq 1's state: tripDropId, isHeld, heldAt, heldById.
//     So a first split of a bill on a trip / on hold is allowed and nothing on
//     the trip or the OBD changes — every row sits on the same stop, and all
//     rows held ⇔ OBD held, exactly the v27.66 derived rules. Undo merges back
//     to seq 1, which already carries that shared state.
//   · Always refused: any row dispatched, or ANY ci_returns row on the OBD
//     (every status, void included).
//   · A copy / re-delivery link does NOT block — it stays on the row it points
//     at (history). But a row such a link points at is never DELETED (the FK is
//     RESTRICT): a plan that would delete one is refused in plain English.
// This file plans the ONE write of state columns save ever makes: the inherited
// state on a CREATED row. A kept row's state is never written; isDispatched /
// dispatchedAt / dispatchedById never are.

import type { InvoiceLineInput } from "./rules";

/** A row's dispatch-unit state (v27.66) and the links that point at it. */
export interface RowState {
  tripDropId: number | null;
  isHeld: boolean;
  heldAt: Date | null;
  heldById: number | null;
  isDispatched: boolean;
  /** Trip numbers billing copied this row for. */
  copyTrips: string[];
  /** Trip numbers this row is re-delivered on. */
  redeliveryTrips: string[];
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

/** The OBD facts the refusal reads besides its rows. */
export interface ObdFacts {
  obdNumber: string;
  /** EVERY ci_returns row on the OBD, any status, void included. null = a
   *  draft with no number yet. */
  ciNumbers: (string | null)[];
}

/** One row as it should stand after the write. Index 0 is seq 1 (SAP's). */
export interface TargetRow {
  invoiceNo: string;
  invoiceDate: Date | null;
  lines: InvoiceLineInput[];
}

/** The state a CREATED row inherits — seq 1's. */
export interface InheritedState {
  tripDropId: number | null;
  isHeld: boolean;
  heldAt: Date | null;
  heldById: number | null;
}

export interface WritePlan {
  /** Manual rows past the new count — deleted (their lines CASCADE). */
  deleteRowIds: number[];
  /** Existing manual rows whose number or date changes (state untouched). */
  updates: { id: number; seq: number; invoiceNo: string; invoiceDate: Date | null }[];
  /** New manual rows — each written WITH `inherit`. */
  creates: { seq: number; invoiceNo: string; invoiceDate: Date | null }[];
  /** seq 1's state, copied onto every created row. */
  inherit: InheritedState;
  /** Every seq whose lines are replaced — an existing row whose lines change,
   *  and every created row. Its lines are deleted, then written fresh. */
  relineSeqs: number[];
}

export type PlanResult = { ok: true; plan: WritePlan; changed: boolean } | { ok: false; refusals: string[] };

/**
 * Why the invoices of this OBD cannot be added / edited / undone AT ALL, or
 * null. The same message is GET's blockedReason (the More menu's hint) and the
 * save / undo refusal.
 */
export function obdStateRefusal(rows: RowState[], obd: ObdFacts): string | null {
  if (rows.some((r) => r.isDispatched)) return "Already dispatched — invoices can't be changed.";
  if (obd.ciNumbers.length > 0) {
    const names = obd.ciNumbers.map((n) => n ?? "draft").join(", ");
    return `Has a CI (${names}) — invoices can't be changed.`;
  }
  const first = rows[0];
  if (first && rows.some((r) => r.tripDropId !== first.tripDropId || r.isHeld !== first.isHeld)) {
    return `Invoices of ${obd.obdNumber} are on different trips / holds — move them back together first.`;
  }
  return null;
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

/** The RESTRICT guard: what points at a row, in plain English, or []. */
function linkReasons(r: RowState): string[] {
  return [
    ...r.copyTrips.map((t) => `billing copied it for trip ${t}`),
    ...r.redeliveryTrips.map((t) => `it is re-delivered on trip ${t}`),
  ];
}

/**
 * The diff from `current` to `target`, or every refusal. `current` is the OBD's
 * rows (seq 1 included, seq order); `target` is the whole wanted split in seq
 * order — for Undo, `[{ seq 1's number, lines: [] }]`.
 *
 * Seq 1 is SAP's row: its number and date are never written here (the route's
 * validateSplit already demands the SAP number at index 0); only its lines move.
 *
 * Re-running a plan on a half-written state reaches the same target, because
 * the plan is always the diff from what the database holds NOW.
 */
export function planSplitWrite(current: CurrentRow[], target: TargetRow[], obd: ObdFacts): PlanResult {
  const blocked = obdStateRefusal(current, obd);
  if (blocked !== null) return { ok: false, refusals: [blocked] };

  const seq1 = current.find((r) => r.seq === 1);
  const inherit: InheritedState = {
    tripDropId: seq1?.tripDropId ?? null,
    isHeld: seq1?.isHeld ?? false,
    heldAt: seq1?.isHeld ? seq1.heldAt : null,
    heldById: seq1?.isHeld ? seq1.heldById : null,
  };
  const bySeq = new Map(current.map((r) => [r.seq, r]));
  const plan: WritePlan = { deleteRowIds: [], updates: [], creates: [], inherit, relineSeqs: [] };

  target.forEach((t, i) => {
    const seq = i + 1;
    const row = bySeq.get(seq);
    if (!row) {
      plan.creates.push({ seq, invoiceNo: t.invoiceNo, invoiceDate: t.invoiceDate });
      plan.relineSeqs.push(seq);
      return;
    }
    if (seq !== 1 && (row.invoiceNo !== t.invoiceNo || !sameDay(row.invoiceDate, t.invoiceDate))) {
      plan.updates.push({ id: row.id, seq, invoiceNo: t.invoiceNo, invoiceDate: t.invoiceDate });
    }
    if (!sameLines(row.lines, t.lines)) plan.relineSeqs.push(seq);
  });

  const refusals: string[] = [];
  for (const row of current) {
    if (row.seq <= target.length) continue;
    const links = linkReasons(row);
    if (links.length > 0) {
      refusals.push(`${row.invoiceNo ?? `Invoice ${row.seq}`} cannot be removed — ${links.join(", ")}, and that record stays on it.`);
    }
    plan.deleteRowIds.push(row.id);
  }

  if (refusals.length > 0) return { ok: false, refusals };
  const changed =
    plan.deleteRowIds.length + plan.updates.length + plan.creates.length + plan.relineSeqs.length > 0;
  return { ok: true, plan, changed };
}
