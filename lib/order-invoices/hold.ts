// lib/order-invoices/hold.ts — HOLD PER INVOICE (Add invoices, Phase 6 commit
// 1 "6.1", 2026-10-19; Schema v27.66 columns + v27.72 status-log ids).
// Server-only (Prisma); the rules are the pure functions at the top, tested in
// hold.test.ts (npx tsx --test lib/order-invoices/hold.test.ts).
//
// THE ONLY ROW-HOLD WRITER FOR SPLIT OBDs: holdRows / releaseRows. A split OBD's
// invoice row carries its own hold (order_invoices."isHeld" / "heldAt" — the
// WALL-CLOCK hold moment, never orders."heldAt", which is the ARRIVAL date —
// / "heldById").
//
// DERIVED OBD RULE (spec, sql/2026-10-12-order-invoices-dispatch-unit.sql):
//   orders."dispatchStatus" = 'hold' ⇔ EVERY row "isHeld". A partly-held OBD
//   stays as it is ('dispatch'). The moment an all-held OBD stops being all
//   held (a release of ANY of its rows) it takes the existing unhold rule
//   (lib/floor/bill-actions.ts): 'dispatch' at FLOOR_CLEAR_HOLD_STAGES, else
//   NULL. Becoming all held writes 'hold' + orders."heldAt" = the arrival date,
//   exactly what every OBD hold path writes.
//
// OWNER RULES (2026-10-19): an invoice ON A TRIP is never held — "I536230716 is
// on L-261019-02 — remove it from the trip first" — and a dispatched one is
// never held. Those rows are refused ONE BY ONE; the rest of the press goes on.
// Release refuses the whole OBD while it carries a LIVE CI (the unhold rule).
//
// 🔴 WRITE ORDER, PER OBD — rows first, the OBD second, the log last:
//   1. read the OBD (stage, status, arrival date) and ALL its rows
//   2. ONE order_invoices.updateMany for the target rows whose isHeld changes
//   3. ONE orders.update — ONLY when the derived dispatchStatus differs from
//      orders (the markers key on MAX(orders.updatedAt): no idle write)
//   4. ONE order_status_logs row for the press, "orderInvoiceIds" = the rows
//      step 2 changed (v27.72 — the panel's per-invoice Activity reads it)
// HALF-FAILURE ANSWER. Dying after 2 leaves the rows held and orders stale. A
// RETRY CONVERGES: step 1 re-reads the rows, step 2 finds nothing to change, and
// step 3 still compares the derived status with orders and lands it; the retry's
// log names no row (nothing changed) — the earlier step 2 already happened.
// A press that changes no row AND leaves orders right is `skipped` (no write).
//
// UNSPLIT OBDs NEVER COME HERE: their row "isHeld" drifted after the v27.66
// back-fill (nothing wrote it until this commit), so orders."dispatchStatus"
// stays their only truth. The OBD-level writers mirror every row with
// mirrorObdHold (below) so new holds keep the rows right; PART 3b of
// sql/2026-10-12-order-invoices-dispatch-unit.sql repairs the old drift.
//
// Sequential awaits, never prisma.$transaction (CORE §3).

import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { FLOOR_CLEAR_HOLD_STAGES } from "../floor/release-stages";
import { findLiveCi, liveCiRefusal } from "../ci/live-ci";
import { INVOICE_HOLD_NOTE, INVOICE_CLEAR_HOLD_NOTE } from "../floor/hold-log";

/** One invoice row, as the hold rule needs it. */
export interface HoldRow {
  id: number;
  seq: number;
  invoiceNo: string | null;
  isHeld: boolean;
  isDispatched: boolean;
  tripDropId: number | null;
  /** The trip of the row's stop — the refusal's words. */
  tripNumber: string | null;
}

/** The OBD facts the derived status needs. */
export interface HoldObd {
  dispatchStatus: string | null;
  workflowStage: string;
}

export interface RowRefusal {
  rowId: number;
  invoiceNo: string | null;
  error: string;
}

export interface RowsHoldPlan {
  /** Target rows whose isHeld changes — the one updateMany. */
  rowIdsToUpdate: number[];
  /** Asked-for rows that cannot be held (on a trip / dispatched), one by one. */
  refused: RowRefusal[];
  /** What orders."dispatchStatus" becomes; `undefined` = unchanged (no orders write). */
  obdStatus: string | null | undefined;
  /** Every row held after the press. */
  allHeld: boolean;
}

/** "I536230716" — the invoice number, or "Invoice 2" when SAP has not stamped one. */
export function invoiceLabel(r: Pick<HoldRow, "seq" | "invoiceNo">): string {
  return r.invoiceNo ?? `Invoice ${r.seq}`;
}

/** The on-trip / dispatched refusal for holding ONE row, else null. */
export function rowHoldRefusal(r: HoldRow): string | null {
  if (r.isDispatched) return `${invoiceLabel(r)} is dispatched — it cannot be held`;
  if (r.tripDropId !== null) {
    return `${invoiceLabel(r)} is on ${r.tripNumber ?? "a trip"} — remove it from the trip first`;
  }
  return null;
}

/** The existing unhold rule (lib/floor/bill-actions.ts "unhold"), from the stage. */
export function unholdStatusFor(workflowStage: string): string | null {
  return FLOOR_CLEAR_HOLD_STAGES.includes(workflowStage) ? "dispatch" : null;
}

/**
 * Hold (`hold` true) or release some of ONE OBD's rows. `rowIds` that are not
 * this OBD's rows are ignored (the caller validates them first).
 */
export function planRowsHold(
  rows: readonly HoldRow[],
  rowIds: readonly number[],
  hold: boolean,
  obd: HoldObd,
): RowsHoldPlan {
  const chosen = new Set(rowIds);
  const refused: RowRefusal[] = [];
  const change = new Set<number>();
  for (const r of rows) {
    if (!chosen.has(r.id)) continue;
    if (hold) {
      const why = rowHoldRefusal(r);
      if (why !== null) {
        refused.push({ rowId: r.id, invoiceNo: r.invoiceNo, error: why });
        continue;
      }
    }
    if (r.isHeld !== hold) change.add(r.id);
  }
  const after = rows.map((r) => (change.has(r.id) ? hold : r.isHeld));
  const allHeld = rows.length > 0 && after.every(Boolean);
  const isHold = obd.dispatchStatus === "hold";
  let obdStatus: string | null | undefined;
  if (allHeld) obdStatus = isHold ? undefined : "hold";
  else obdStatus = isHold ? unholdStatusFor(obd.workflowStage) : undefined;
  return { rowIdsToUpdate: rows.filter((r) => change.has(r.id)).map((r) => r.id), refused, obdStatus, allHeld };
}

export type RowsHoldResult =
  | { kind: "done"; rowIds: number[]; refused: RowRefusal[]; obdStatus: string | null | undefined }
  | { kind: "skipped"; refused: RowRefusal[] }
  | { kind: "failed"; error: string; refused: RowRefusal[] };

const ROW_SELECT = {
  id: true,
  seq: true,
  invoiceNo: true,
  isHeld: true,
  isDispatched: true,
  tripDropId: true,
  tripDrop: { select: { trip: { select: { tripNumber: true } } } },
} satisfies Prisma.order_invoicesSelect;

async function setRowsHeld(orderId: number, rowIds: readonly number[], hold: boolean, actorId: number): Promise<RowsHoldResult> {
  // 1.
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    select: { id: true, isRemoved: true, workflowStage: true, dispatchStatus: true, obdEmailDate: true },
  });
  if (!order || order.isRemoved) return { kind: "failed", error: "Order not found", refused: [] };
  if (order.workflowStage === "cancelled") {
    return { kind: "failed", error: hold ? "Cannot hold a cancelled bill" : "Bill is cancelled", refused: [] };
  }
  const found = await prisma.order_invoices.findMany({ where: { orderId }, orderBy: { seq: "asc" }, select: ROW_SELECT });
  const rows: HoldRow[] = found.map((r) => ({
    id: r.id,
    seq: r.seq,
    invoiceNo: r.invoiceNo,
    isHeld: r.isHeld,
    isDispatched: r.isDispatched,
    tripDropId: r.tripDropId,
    tripNumber: r.tripDrop?.trip.tripNumber ?? null,
  }));
  if (rows.length < 2) return { kind: "failed", error: "Not a split OBD — hold the whole bill", refused: [] };
  const own = new Set(rows.map((r) => r.id));
  const foreign = rowIds.filter((id) => !own.has(id));
  if (foreign.length > 0) return { kind: "failed", error: `Invoice row ${foreign.join(", ")} is not an invoice of this OBD`, refused: [] };

  const plan = planRowsHold(rows, rowIds, hold, order);
  if (plan.rowIdsToUpdate.length === 0 && plan.obdStatus === undefined) {
    return plan.refused.length > 0 && plan.refused.length === new Set(rowIds).size
      ? { kind: "failed", error: plan.refused[0].error, refused: plan.refused }
      : { kind: "skipped", refused: plan.refused };
  }
  // 🔴 A bill carrying a LIVE CI stays held (bill-actions "unhold", 2026-09-24).
  if (!hold) {
    const liveCi = await findLiveCi(orderId);
    if (liveCi !== null) return { kind: "failed", error: liveCiRefusal(liveCi, "released"), refused: [] };
  }

  // 2.
  const now = new Date();
  if (plan.rowIdsToUpdate.length > 0) {
    await prisma.order_invoices.updateMany({
      where: { id: { in: plan.rowIdsToUpdate } },
      data: hold ? { isHeld: true, heldAt: now, heldById: actorId } : { isHeld: false, heldAt: null, heldById: null },
    });
  }
  // 3. Only when the derived status moves.
  if (plan.obdStatus !== undefined) {
    await prisma.orders.update({
      where: { id: orderId },
      // Becoming held writes the ARRIVAL-date heldAt every hold path writes
      // (CLAUDE_FLOOR §4.5); a release leaves heldAt alone, as unhold does.
      data: plan.obdStatus === "hold" ? { dispatchStatus: "hold", heldAt: order.obdEmailDate ?? now } : { dispatchStatus: plan.obdStatus },
    });
  }
  // 4. ONE log per press. Its NOTE is kept OUT of HOLD_LOG_NOTES (hold-log.ts):
  // the per-invoice "held since" is the row's own heldAt.
  const changed = rows.filter((r) => plan.rowIdsToUpdate.includes(r.id));
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: order.workflowStage,
      changedById: actorId,
      note: `${hold ? INVOICE_HOLD_NOTE : INVOICE_CLEAR_HOLD_NOTE}${changed.length > 0 ? ` · ${changed.map(invoiceLabel).join(", ")}` : ""}`,
      orderInvoiceIds: changed.map((r) => r.id),
    },
  });
  return { kind: "done", rowIds: plan.rowIdsToUpdate, refused: plan.refused, obdStatus: plan.obdStatus };
}

/** Hold these invoice rows of ONE split OBD (the header's four steps). */
export function holdRows(orderId: number, rowIds: readonly number[], actorId: number): Promise<RowsHoldResult> {
  return setRowsHeld(orderId, rowIds, true, actorId);
}

/** Release these invoice rows of ONE split OBD (the header's four steps). */
export function releaseRows(orderId: number, rowIds: readonly number[], actorId: number): Promise<RowsHoldResult> {
  return setRowsHeld(orderId, rowIds, false, actorId);
}

// ── THE MIRROR — every OBD-level hold / release / cancel writer ──────────────
//
// After a writer holds or releases a WHOLE OBD in orders (Floor, Tint Manager,
// Billing, import, Telephonic, challan reconcile, release, every cancel), it
// calls this so EVERY row of that OBD carries the same "isHeld": a whole-OBD
// hold keeps the rows true, a release or cancel clears them. ONE updateMany,
// only rows that differ (an unchanged row is not re-stamped). Never called by a
// write that leaves the hold alone (a tint Done setting 'dispatch' on a
// partly-held split OBD must not clear its held invoices).
//
// `where` = one order id, or an orders where (the SO-keyed import updateMany).
// Runs AFTER the writer's orders.update — orders stays the commit point; a
// failed mirror leaves rows stale, the drift PART 3b repairs and the next press
// of that OBD rewrites. A row going TRUE gets the wall-clock heldAt and the
// actor (null = system); going FALSE clears both.
export async function mirrorObdHold(
  where: number | Prisma.ordersWhereInput,
  held: boolean,
  actorId: number | null = null,
): Promise<number> {
  const r = await prisma.order_invoices.updateMany(mirrorArgs(where, held, actorId, new Date()));
  return r.count;
}

/** The mirror's one updateMany — pure, so the rule is tested (hold.test.ts). */
export function mirrorArgs(
  where: number | Prisma.ordersWhereInput,
  held: boolean,
  actorId: number | null,
  now: Date,
): Prisma.order_invoicesUpdateManyArgs {
  const order: Prisma.ordersWhereInput = typeof where === "number" ? { id: where } : where;
  return {
    // A dispatched row is never held (chk_order_invoices_held_not_dispatched) —
    // skipped, so one gone invoice cannot fail the OBD's whole mirror.
    where: held ? { order, isHeld: false, isDispatched: false } : { order, isHeld: true },
    data: held ? { isHeld: true, heldAt: now, heldById: actorId } : { isHeld: false, heldAt: null, heldById: null },
  };
}

/** mirrorObdHold that never throws — the writer's own write already stood. */
export async function mirrorObdHoldSafe(
  where: number | Prisma.ordersWhereInput,
  held: boolean,
  actorId: number | null = null,
): Promise<void> {
  try {
    await mirrorObdHold(where, held, actorId);
  } catch (err) {
    console.error("[order-invoices] hold mirror failed:", err instanceof Error ? err.message : err, JSON.stringify(where));
  }
}
