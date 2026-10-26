// lib/order-invoices/dispatch.ts — DISPATCHED PER INVOICE + THE OBD DONE RULE
// (Add invoices 6.4, 2026-10-19). Server-only (Prisma); the rules are the pure
// functions at the top, tested in dispatch.test.ts
// (npx tsx --test lib/order-invoices/dispatch.test.ts).
//
// THE DONE RULE (spec, sql/2026-10-12-order-invoices-dispatch-unit.sql):
//   orders."workflowStage" = 'dispatched' ⇔ EVERY invoice row is "isDispatched"
//   OR is covered by a FULL, submitted (not draft, not voided) CI — its own
//   (ci_returns."orderInvoiceId" = the row) or a whole-OBD one (NULL).
// For an UNSPLIT OBD row == OBD: lib/floor/dispatch.ts markBillsDispatched
// writes the OBD exactly as before and mirrorObdDispatched copies it onto the
// row. A SPLIT OBD goes through markRowsDispatched — only the invoices on the
// dispatched trip ship; the OBD reaches 'dispatched' with its LAST open invoice.
//
// 🔴 ONE MORE GUARD THAN THE SPEC SAYS: the OBD is only ever written to
// 'dispatched' when at least ONE row really is "isDispatched". An OBD whose
// every invoice came back on a CI shipped nothing — it is left at its stage
// (the CIs are on the Cancel & CI tab), never called dispatched.
//
// 🔴 WRITE ORDER, PER OBD — rows first, the OBD second, the log last:
//   1. read the OBD (stage, status), ALL its rows and its live FULL CIs
//   2. ONE order_invoices.updateMany — the target rows not yet dispatched:
//      "isDispatched" true + "dispatchedAt" / "dispatchedById" (never a held
//      row: chk_order_invoices_held_not_dispatched)
//   3. ONE orders.update {workflowStage: 'dispatched'} — ONLY when the done
//      rule now holds and the OBD is not there yet
//   4. ONE order_status_logs row for the press, "orderInvoiceIds" = the rows
//      step 2 changed (v27.72 — the per-invoice Activity reads it)
// HALF-FAILURE ANSWER. Dying after 2 leaves the rows dispatched and the OBD
// behind. A RETRY CONVERGES: step 2 finds nothing to change and step 3 still
// compares the rule with orders and lands it (settleObdDone does the same from
// any caller). A press that changes no row and leaves orders right writes
// nothing.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import { prisma } from "../prisma";
import { DISPATCHED, PICK_CHECKED } from "../workflow-stages";
import { ciCoversRow } from "./ci-plan";
import { detectStale } from "./rules";
import { isHalfWritten, partLabel } from "./load-plan";
import { INVOICE_SOURCE } from "./source";

/** One invoice row, as the done rule needs it. */
export interface DoneRow {
  id: number;
  seq: number;
  invoiceNo: string | null;
  isDispatched: boolean;
  isHeld: boolean;
  /** Split load — a truck part's root (read only for the stale refusal's
   *  "part k of n"). Omitted = not a part. */
  loadParentId?: number | null;
}

/** A live FULL CI of the OBD (submitted / closed — never a draft, never voided). */
export interface FullCi {
  orderInvoiceId: number | null;
}

/** Is this invoice row finished — dispatched, or returned on a full CI? */
export function rowDone(row: Pick<DoneRow, "id" | "isDispatched">, cis: readonly FullCi[]): boolean {
  return row.isDispatched || cis.some((c) => ciCoversRow(c, row.id));
}

/**
 * THE OBD DONE RULE: every row finished, and at least one really shipped (the
 * header's extra guard). An OBD with no rows is never done by this rule.
 */
export function obdDone(rows: readonly Pick<DoneRow, "id" | "isDispatched">[], cis: readonly FullCi[]): boolean {
  return rows.length > 0 && rows.every((r) => rowDone(r, cis)) && rows.some((r) => r.isDispatched);
}

export interface RowsDispatchPlan {
  /** Target rows not yet dispatched — the one updateMany. */
  rowIdsToUpdate: number[];
  /** Target rows that may not ship (held), one by one. */
  refused: Array<{ rowId: number; invoiceNo: string | null; error: string }>;
  /** true = write orders 'dispatched' (the rule holds after the press and it is not there yet). */
  obdToDispatched: boolean;
}

/**
 * SPLIT LOAD, owner answer 2 (Phase 4 batch 2): a load-split bill SAP changed
 * after it was split does not go — its parts no longer add up to the bill.
 */
export function staleLoadRefusal(label: string): string {
  return `${label} — SAP changed this bill after it was split. Take the parts off their trips, merge them back, split again.`;
}

/**
 * Dispatch some of ONE split OBD's rows. `rowIds` that are not this OBD's rows
 * are ignored. The OBD gate (stage pick_checked, not wholly held) is the
 * caller's — markRowsDispatched applies it before planning.
 *
 * `stale` (split load only — loadObd sets it for an OBD with a 'load' row):
 * every chosen row not yet dispatched is refused with staleLoadRefusal and
 * nothing is written. Omitted / false = exactly as before.
 */
export function planRowsDispatch(
  rows: readonly DoneRow[],
  rowIds: readonly number[],
  obd: { workflowStage: string; obdNumber?: string },
  cis: readonly FullCi[],
  stale = false,
): RowsDispatchPlan {
  const chosen = new Set(rowIds);
  const refused: RowsDispatchPlan["refused"] = [];
  const move = new Set<number>();
  for (const r of rows) {
    if (!chosen.has(r.id) || r.isDispatched) continue;
    if (stale) {
      const label = partLabel(
        rows.map((x) => ({ ...x, loadParentId: x.loadParentId ?? null })),
        { ...r, loadParentId: r.loadParentId ?? null },
        obd.obdNumber ?? "",
      );
      refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: staleLoadRefusal(label) });
      continue;
    }
    if (r.isHeld) {
      refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: `${r.invoiceNo ?? `Invoice ${r.seq}`} is on hold — it does not go` });
      continue;
    }
    move.add(r.id);
  }
  const after = rows.map((r) => ({ id: r.id, isDispatched: r.isDispatched || move.has(r.id) }));
  return {
    rowIdsToUpdate: rows.filter((r) => move.has(r.id)).map((r) => r.id),
    refused,
    obdToDispatched: !stale && obd.workflowStage !== DISPATCHED && obdDone(after, cis),
  };
}

export type RowsDispatchResult =
  | { kind: "dispatched"; rowIds: number[]; obdDispatched: boolean; refused: RowsDispatchPlan["refused"] }
  | { kind: "already"; refused: RowsDispatchPlan["refused"] }
  | { kind: "held" }
  | { kind: "notChecked"; workflowStage: string }
  /** Split load: SAP changed the bill after the split — nothing written; the
   *  caller reports it as failed (never held), so the trip stays open. */
  | { kind: "stale"; error: string }
  | { kind: "failed"; error: string };

async function loadObd(orderId: number) {
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    select: { id: true, obdNumber: true, workflowStage: true, dispatchStatus: true, isRemoved: true },
  });
  if (!order) return null;
  const found = await prisma.order_invoices.findMany({
    where: { orderId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, invoiceNo: true, isDispatched: true, isHeld: true, source: true, loadParentId: true },
  });
  const rows: DoneRow[] = found.map((r) => ({
    id: r.id,
    seq: r.seq,
    invoiceNo: r.invoiceNo,
    isDispatched: r.isDispatched,
    isHeld: r.isHeld,
    loadParentId: r.loadParentId,
  }));
  const cis = await prisma.ci_returns.findMany({
    where: { orderId, isVoided: false, status: { not: "draft" }, returnType: "full" },
    select: { orderInvoiceId: true },
  });
  // SPLIT LOAD ONLY (owner answer 5): stale = the saved parts no longer match
  // SAP's active lines (rules.ts detectStale, unchanged) or a press died
  // half-way. Two more reads, and only when a row is a truck part — an
  // Add-invoices or unsplit bill reads exactly what it did before.
  let stale = false;
  if (found.some((r) => r.source === INVOICE_SOURCE.LOAD)) {
    const lines = await prisma.order_invoice_lines.findMany({
      where: { orderInvoiceId: { in: found.map((r) => r.id) } },
      select: { orderInvoiceId: true, rawLineItemId: true, qty: true },
    });
    const active = await prisma.import_raw_line_items.findMany({
      where: { obdNumber: order.obdNumber, lineStatus: "active" },
      select: { id: true, lineId: true, skuCodeRaw: true, unitQty: true },
    });
    const withLines = found.map((r) => ({ lines: lines.filter((l) => l.orderInvoiceId === r.id) }));
    stale =
      isHalfWritten(withLines) ||
      detectStale(
        active.map((l) => ({ rawLineItemId: l.id, lineId: l.lineId, skuCodeRaw: l.skuCodeRaw, unitQty: l.unitQty })),
        lines,
      );
  }
  return { order, rows, cis, stale };
}

/**
 * Mark these invoice rows of ONE split OBD dispatched (the header's four
 * steps). The OBD gate is markBillsDispatched's: an OBD that is not at
 * pick_checked has not shipped (`notChecked`); a wholly held OBD does not go
 * (`held`). A held ROW is refused one by one.
 */
export async function markRowsDispatched(opts: {
  orderId: number;
  rowIds: readonly number[];
  actorId: number;
  at: Date;
  noteLabel: string;
}): Promise<RowsDispatchResult> {
  const { orderId, rowIds, actorId, at, noteLabel } = opts;
  const loaded = await loadObd(orderId);
  if (!loaded || loaded.order.isRemoved) return { kind: "failed", error: "Order not found" };
  const { order, rows, cis, stale } = loaded;
  if (order.dispatchStatus === "hold") return { kind: "held" };
  if (order.workflowStage !== PICK_CHECKED && order.workflowStage !== DISPATCHED) {
    return { kind: "notChecked", workflowStage: order.workflowStage };
  }
  const plan = planRowsDispatch(rows, rowIds, order, cis, stale);
  if (stale && plan.refused.length > 0) return { kind: "stale", error: plan.refused.map((r) => r.error).join("; ") };
  if (plan.rowIdsToUpdate.length === 0 && !plan.obdToDispatched) {
    return plan.refused.length > 0 && rowIds.every((id) => plan.refused.some((r) => r.rowId === id))
      ? { kind: "held" }
      : { kind: "already", refused: plan.refused };
  }
  // 2.
  if (plan.rowIdsToUpdate.length > 0) {
    await prisma.order_invoices.updateMany({
      where: { id: { in: plan.rowIdsToUpdate }, isHeld: false },
      data: { isDispatched: true, dispatchedAt: at, dispatchedById: actorId },
    });
  }
  // 3.
  if (plan.obdToDispatched) {
    await prisma.orders.update({ where: { id: orderId }, data: { workflowStage: DISPATCHED } });
  }
  // 4.
  const changed = rows.filter((r) => plan.rowIdsToUpdate.includes(r.id));
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: plan.obdToDispatched ? DISPATCHED : order.workflowStage,
      changedById: actorId,
      note: `${noteLabel}${changed.length > 0 ? ` · ${changed.map((r) => r.invoiceNo ?? `Invoice ${r.seq}`).join(", ")}` : ""}`,
      orderInvoiceIds: changed.map((r) => r.id),
    },
  });
  return { kind: "dispatched", rowIds: plan.rowIdsToUpdate, obdDispatched: plan.obdToDispatched, refused: plan.refused };
}

/**
 * Re-apply the done rule to ONE split OBD after something else finished one
 * of its invoices (a per-invoice CI, 6.3). Writes ONLY the orders stage when
 * the rule now holds — ONE update, ONE log. Never throws.
 */
export async function settleObdDone(orderId: number, actorId: number, note: string): Promise<boolean> {
  try {
    const loaded = await loadObd(orderId);
    if (!loaded || loaded.order.isRemoved || loaded.rows.length < 2) return false;
    const { order, rows, cis } = loaded;
    if (order.workflowStage !== PICK_CHECKED || order.dispatchStatus === "hold") return false;
    if (!obdDone(rows, cis)) return false;
    await prisma.orders.update({ where: { id: orderId }, data: { workflowStage: DISPATCHED } });
    await prisma.order_status_logs.create({
      data: { orderId, fromStage: order.workflowStage, toStage: DISPATCHED, changedById: actorId, note },
    });
    return true;
  } catch (err) {
    console.error(`[order-invoices] settleObdDone(${orderId}) failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** The mirror's one updateMany — pure, tested. A held row is never dispatched. */
export function mirrorDispatchedArgs(orderId: number, actorId: number | null, at: Date) {
  return {
    where: { orderId, isDispatched: false, isHeld: false },
    data: { isDispatched: true, dispatchedAt: at, dispatchedById: actorId },
  };
}

/**
 * UNSPLIT OBD dispatched by markBillsDispatched: its seq-1 row follows (row ==
 * OBD). After the OBD's own write and log; never throws (the bill's own write
 * stands — PART 3c of the dispatch-unit SQL repairs a missed mirror).
 */
export async function mirrorObdDispatchedSafe(orderId: number, actorId: number | null, at: Date): Promise<void> {
  try {
    await prisma.order_invoices.updateMany(mirrorDispatchedArgs(orderId, actorId, at));
  } catch (err) {
    console.error(`[order-invoices] dispatched mirror failed for order ${orderId}:`, err instanceof Error ? err.message : err);
  }
}
