// lib/order-invoices/split.ts — ADD INVOICES, the reads and writes behind
// app/api/floor/orders/[orderId]/invoices (2026-10-10, Phase 2; save/undo
// rewritten to EDIT IN PLACE 2026-10-12, Schema v27.66, Phase 3 commit 1).
// Server-only (Prisma). The rules are lib/order-invoices/rules.ts and the
// save/undo diff is lib/order-invoices/plan.ts (both pure).
//
// 🔴 RECORD ONLY. Nothing here writes `orders`, a trip, a hold, picking or CI.
// The one other write is ONE order_status_logs row per save / undo.
//
// 🔴 THE ONE PLACE SAVE WRITES STATE COLUMNS: step 3. A CREATED row (seq 2..n)
// is written WITH seq 1's tripDropId / isHeld / heldAt / heldById — "split
// inside the trip" (owner, 2026-10-12). Every row then sits on the same stop
// and is held iff the OBD is, so orders.tripDropId / orders.dispatchStatus are
// already right and are NOT written. A kept row's state is never written, and
// isDispatched / dispatchedAt / dispatchedById never are.
//
// 🔴 SAVE AND UNDO EDIT IN PLACE, BY SEQ (v27.66). Save used to delete every
// 'manual' row and re-create it; since v27.66 copies, re-deliveries and CI
// point at a row ON DELETE RESTRICT, so rows KEEP THEIR IDS: the row at seq k
// becomes the k-th invoice, only rows past the new count are deleted, and only
// rows whose lines change get new lines. Do not revert to delete + re-create.
// The refusals (plan.ts obdStateRefusal — also GET's blockedReason, the More
// menu's hint): a row dispatched; ANY ci_returns row on the OBD (void
// included); rows on different stops / holds. A copy or re-delivery does NOT
// block, but a row one points at is never deleted (RESTRICT guard).
//
// 🔴 NO TRANSACTION (CORE §3) — THE WRITE ORDER IS THE SAFETY. Every step is one
// SQL statement (step 2 is one per changed row), each all-or-nothing on its own:
//   0. read rows + their state; plan (pure); refuse → NOTHING written
//   1. delete the manual rows past the new count; lines CASCADE  (deleteMany)
//   2. re-number / re-date kept manual rows                        (update each)
//   3. create the new manual rows                                  (createMany)
//   4. read their ids back                                         (findMany)
//   5. delete the lines of every row being re-lined                (deleteMany)
//   6. create the lines of every row being re-lined                (createMany — one statement)
//   7. re-read: re-validate, and every kept row still has its id; log
//      [order-invoices] if it does not add up
//   8. one order_status_logs row
// HALF-FAILURE ANSWER: press Save (or Undo) again. The plan is always the diff
// from what the database holds NOW, so a re-run finishes whatever a dead
// attempt left and reaches the same target. In between, the OBD is never
// silently wrong: dying after 1 leaves lines that no longer cover the bill,
// after 3-5 leaves rows with no lines — GET reports both `stale`, and
// validateSplit fails on them. Dying after 2 leaves re-numbered rows with their
// old lines; the route already returned an error, so the person saves again.
// Lines are written in ONE statement after every row exists, so a half set of
// lines cannot happen. A row a copy / re-delivery points at is never in step 1.
// Rows created in step 3 already carry the inherited state, so a dead attempt
// never leaves a row off the OBD's stop or hold. Two saves racing on one OBD collide on UNIQUE
// (orderId, seq) at step 3 — the loser gets an error and re-reads.
// Undo is the same engine with the target "seq 1 only, no lines": steps 1 and
// 5 only — manual rows first, then seq 1's lines, as before.
//
// ⚠ NO LIVE REFRESH IS SENT FROM HERE, and orders.updatedAt is NOT touched
// (owner question, 2026-10-10 — it would wake only the legacy 15 s markers).
// order_invoices carries live_changes child triggers (v27.65, parent
// "orderId"), so the database records a row change itself — and (v27.66) a
// created row WITH a tripDropId fires trg_live_changes_order_invoices_trip_ins,
// a 'trip' line for that stop's trip: an open Floor re-reads the trip
// (floor-page refreshTripsByIds) as well as the bill row. No orders write needed.
// ⚠ order_invoice_lines has NO trigger (no "orderId" column). Since v27.66 a
// save that only moves tins between rows writes ONLY lines (steps 5-6) and so
// records NO live line. Harmless today — the one live-patched read is the
// board's '+n' chip (invoice NUMBERS, lib/floor/queries.ts getAddedInvoiceNos),
// which a line-only edit cannot change; the dialog and detail panel read on
// open. A screen that shows a row's lines live must add its own signal first.

import { prisma } from "../prisma";
import { syncSapInvoiceRow } from "./sap-row";
import { obdStateRefusal, planSplitWrite, type CurrentRow, type ObdFacts, type TargetRow, type WritePlan } from "./plan";
import {
  addInvoicesRefusal,
  detectStale,
  validateSplit,
  type ActiveLine,
  type SplitInvoiceInput,
} from "./rules";

const SAP_SEQ = 1;
const SOURCE_SAP = "sap";
const SOURCE_MANUAL = "manual";

export interface SplitActiveLine extends ActiveLine {
  description: string | null;
  volumeLine: number | null;
}

export interface SplitInvoiceRow {
  seq: number;
  invoiceNo: string | null;
  invoiceDate: string | null;
  source: string;
  lines: { rawLineItemId: number; qty: number }[];
}

export interface SplitView {
  orderId: number;
  obdNumber: string;
  sapInvoice: { invoiceNo: string; invoiceDate: string | null } | null;
  invoices: SplitInvoiceRow[];
  activeLines: SplitActiveLine[];
  /** n ≥ 2 rows, or any line row at all. */
  split: boolean;
  stale: boolean;
  blockedReason: string | null;
}

interface OrderFacts {
  id: number;
  obdNumber: string;
  isRemoved: boolean;
  workflowStage: string;
  invoiceNo: string | null;
  invoiceDate: Date | null;
}

async function loadOrder(orderId: number): Promise<OrderFacts | null> {
  return prisma.orders.findUnique({
    where: { id: orderId },
    select: { id: true, obdNumber: true, isRemoved: true, workflowStage: true, invoiceNo: true, invoiceDate: true },
  });
}

async function loadRows(orderId: number) {
  return prisma.order_invoices.findMany({
    where: { orderId },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      invoiceNo: true,
      invoiceDate: true,
      source: true,
      lines: { select: { rawLineItemId: true, qty: true }, orderBy: { rawLineItemId: "asc" } },
    },
  });
}

/** The rows WITH their state and the copy / re-delivery links that point at
 *  them — the input to save / undo and to GET's blockedReason. */
async function loadCurrentRows(orderId: number): Promise<CurrentRow[]> {
  const rows = await prisma.order_invoices.findMany({
    where: { orderId },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      invoiceNo: true,
      invoiceDate: true,
      source: true,
      tripDropId: true,
      isHeld: true,
      heldAt: true,
      heldById: true,
      isDispatched: true,
      billCopies: { select: { trip: { select: { tripNumber: true } } }, orderBy: { id: "asc" } },
      redeliveries: { select: { trip: { select: { tripNumber: true } } }, orderBy: { id: "asc" } },
      lines: { select: { rawLineItemId: true, qty: true }, orderBy: { rawLineItemId: "asc" } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    invoiceNo: r.invoiceNo,
    invoiceDate: r.invoiceDate,
    source: r.source,
    lines: r.lines,
    tripDropId: r.tripDropId,
    isHeld: r.isHeld,
    heldAt: r.heldAt,
    heldById: r.heldById,
    isDispatched: r.isDispatched,
    copyTrips: r.billCopies.map((c) => c.trip.tripNumber),
    redeliveryTrips: r.redeliveries.map((d) => d.trip.tripNumber),
  }));
}

/** EVERY ci_returns row on the OBD — by orderId, any status, void included
 *  (owner, 2026-10-12: any CI blocks). A void one is named "(void)". */
async function loadObdFacts(orderId: number, obdNumber: string): Promise<ObdFacts> {
  const cis = await prisma.ci_returns.findMany({
    where: { orderId },
    orderBy: { id: "asc" },
    select: { ciNumber: true, isVoided: true },
  });
  return {
    obdNumber,
    ciNumbers: cis.map((c) => (c.ciNumber === null ? null : c.isVoided ? `${c.ciNumber} (void)` : c.ciNumber)),
  };
}

/** Steps 1-6 of the header: carry out a plan. Sequential, one statement each
 *  (step 2: one per re-numbered row). Writes state ONLY on created rows (step
 *  3, the inherited seq-1 state); a kept row's state is never touched. */
async function applyPlan(orderId: number, plan: WritePlan, actorId: number, linesBySeq: Map<number, TargetRow["lines"]>) {
  // 1. Rows past the new count (their lines CASCADE).
  if (plan.deleteRowIds.length > 0) {
    await prisma.order_invoices.deleteMany({ where: { id: { in: plan.deleteRowIds }, source: SOURCE_MANUAL } });
  }
  // 2. Kept manual rows: new number / date, same id.
  for (const u of plan.updates) {
    await prisma.order_invoices.update({
      where: { id: u.id },
      data: { invoiceNo: u.invoiceNo, invoiceDate: u.invoiceDate },
    });
  }
  // 3-4. New manual rows, then their ids.
  if (plan.creates.length > 0) {
    await prisma.order_invoices.createMany({
      data: plan.creates.map((c) => ({
        orderId,
        seq: c.seq,
        invoiceNo: c.invoiceNo,
        invoiceDate: c.invoiceDate,
        source: SOURCE_MANUAL,
        createdById: actorId,
        // "Split inside the trip": seq 1's stop and hold, never dispatched.
        tripDropId: plan.inherit.tripDropId,
        isHeld: plan.inherit.isHeld,
        heldAt: plan.inherit.heldAt,
        heldById: plan.inherit.heldById,
      })),
    });
  }
  if (plan.relineSeqs.length === 0) return;
  const after = await prisma.order_invoices.findMany({
    where: { orderId, seq: { in: plan.relineSeqs } },
    select: { id: true, seq: true },
  });
  const idBySeq = new Map(after.map((r) => [r.seq, r.id]));
  const relineIds = plan.relineSeqs.map((seq) => idBySeq.get(seq)).filter((id): id is number => id !== undefined);
  // 5. Old lines of every re-lined row, in ONE statement.
  await prisma.order_invoice_lines.deleteMany({ where: { orderInvoiceId: { in: relineIds } } });
  // 6. Their new lines, in ONE statement (none for Undo's seq 1).
  const data = plan.relineSeqs.flatMap((seq) => {
    const id = idBySeq.get(seq);
    if (id === undefined) return [];
    return (linesBySeq.get(seq) ?? []).map((l) => ({ orderInvoiceId: id, rawLineItemId: l.rawLineItemId, qty: l.qty }));
  });
  if (data.length > 0) await prisma.order_invoice_lines.createMany({ data });
}

/** Step 7's id check: every row the plan kept still has the id it had. */
function keptIdsIntact(before: CurrentRow[], after: { id: number; seq: number }[], deleted: number[]): boolean {
  const afterById = new Map(after.map((r) => [r.id, r.seq]));
  return before.every((r) => deleted.includes(r.id) || afterById.get(r.id) === r.seq);
}

/** The OBD's ACTIVE raw lines — the same set the detail panel shows
 *  (lib/floor/order-detail.ts): joined on obdNumber, lineStatus 'active'. */
async function loadActiveLines(obdNumber: string): Promise<SplitActiveLine[]> {
  const raw = await prisma.import_raw_line_items.findMany({
    where: { obdNumber, lineStatus: "active" },
    orderBy: { lineId: "asc" },
    select: { id: true, lineId: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true, volumeLine: true },
  });
  // 🔴 Names resolve by `material` (the SAP code) ONLY — never through an
  // enriched line's skuId, which points at the OLD catalog's disjoint id space
  // and prints a confidently WRONG product (CORE §13). Same as order-detail.ts.
  const codes = Array.from(new Set(raw.map((l) => l.skuCodeRaw).filter((c) => c !== "")));
  const catalog =
    codes.length > 0
      ? await prisma.sku_master_v2.findMany({ where: { material: { in: codes } }, select: { material: true, description: true } })
      : [];
  const nameByCode = new Map(catalog.map((c) => [c.material, c.description]));
  return raw.map((l) => ({
    rawLineItemId: l.id,
    lineId: l.lineId,
    skuCodeRaw: l.skuCodeRaw,
    description: nameByCode.get(l.skuCodeRaw) ?? l.skuDescriptionRaw ?? null,
    unitQty: l.unitQty,
    volumeLine: l.volumeLine,
  }));
}

/** The SAP number: the seq-1 row's, falling back to orders.invoiceNo (they
 *  mirror each other — sap-row.ts; the fallback covers a missing seq-1 row). */
function sapNumberOf(order: OrderFacts, rows: Awaited<ReturnType<typeof loadRows>>): string | null {
  const seq1 = rows.find((r) => r.seq === SAP_SEQ);
  return seq1?.invoiceNo ?? order.invoiceNo ?? null;
}

/** GET — the whole picture for one OBD. null = no such order. */
export async function loadSplitView(orderId: number): Promise<SplitView | null> {
  const order = await loadOrder(orderId);
  if (!order) return null;
  const rows = await loadRows(orderId);
  const activeLines = await loadActiveLines(order.obdNumber);
  const seq1 = rows.find((r) => r.seq === SAP_SEQ);
  const sapNo = sapNumberOf(order, rows);
  const savedLines = rows.flatMap((r) => r.lines);
  const split = rows.length > 1 || savedLines.length > 0;
  // A row with no lines inside a split is a half-written save: stale too.
  const halfWritten = split && rows.some((r) => r.lines.length === 0);
  const sapDate = seq1?.invoiceDate ?? order.invoiceDate;

  return {
    orderId: order.id,
    obdNumber: order.obdNumber,
    sapInvoice: sapNo === null ? null : { invoiceNo: sapNo, invoiceDate: sapDate ? sapDate.toISOString() : null },
    invoices: rows.map((r) => ({
      seq: r.seq,
      invoiceNo: r.invoiceNo,
      invoiceDate: r.invoiceDate ? r.invoiceDate.toISOString() : null,
      source: r.source,
      lines: r.lines,
    })),
    activeLines,
    split,
    stale: halfWritten || detectStale(activeLines, savedLines),
    // The bill-level refusal first, then the row-state one (plan.ts) — the SAME
    // message save / undo would return, so the More menu's hint never lies.
    blockedReason:
      addInvoicesRefusal({ isRemoved: order.isRemoved, workflowStage: order.workflowStage, sapInvoiceNo: sapNo }) ??
      obdStateRefusal(await loadCurrentRows(orderId), await loadObdFacts(orderId, order.obdNumber)),
  };
}

/** One invoice as the route hands it in: numbers ALREADY normalised, index 0 = SAP. */
export interface SaveInvoiceInput extends SplitInvoiceInput {
  /** Typed rows only; null → seq 1's date. Ignored for seq 1, which never changes. */
  invoiceDate: Date | null;
}

export type SplitResult =
  | { ok: true; changed: boolean }
  | { ok: false; status: number; error: string; errors?: string[]; otherObds?: { invoiceNo: string; obdNumbers: string[] }[] };

/** Typed numbers already on ANOTHER OBD (live or not) — the invoice-pair case. */
async function numbersOnOtherObds(orderId: number, invoiceNos: string[]) {
  if (invoiceNos.length === 0) return [];
  const hits = await prisma.order_invoices.findMany({
    where: { invoiceNo: { in: invoiceNos }, orderId: { not: orderId } },
    select: { invoiceNo: true, order: { select: { obdNumber: true } } },
  });
  const byNo = new Map<string, Set<string>>();
  for (const h of hits) {
    if (h.invoiceNo === null) continue;
    const set = byNo.get(h.invoiceNo) ?? new Set<string>();
    set.add(h.order.obdNumber);
    byNo.set(h.invoiceNo, set);
  }
  return Array.from(byNo.entries()).map(([invoiceNo, set]) => ({ invoiceNo, obdNumbers: Array.from(set).sort() }));
}

/** The shared front half of save and undo: the order, its refusal, a seq-1 row. */
async function prepare(orderId: number) {
  const order = await loadOrder(orderId);
  if (!order) return { error: { ok: false as const, status: 404, error: "Order not found" } };
  // Make sure seq 1 exists and mirrors orders (idempotent, never throws).
  await syncSapInvoiceRow(orderId);
  const rows = await loadRows(orderId);
  const sapNo = sapNumberOf(order, rows);
  const refusal = addInvoicesRefusal({ isRemoved: order.isRemoved, workflowStage: order.workflowStage, sapInvoiceNo: sapNo });
  if (refusal !== null) return { error: { ok: false as const, status: 409, error: refusal } };
  const seq1 = rows.find((r) => r.seq === SAP_SEQ && r.source === SOURCE_SAP);
  if (!seq1) return { error: { ok: false as const, status: 500, error: "This bill has no SAP invoice row — ask an admin" } };
  return { order, rows, seq1, sapNo: sapNo as string };
}

/** The save's TARGET: invoice k → seq k. A typed row with no date takes seq 1's
 *  (or the order's) date; seq 1's own number and date are never written. */
export function saveTargetOf(invoices: SaveInvoiceInput[], defaultDate: Date | null): TargetRow[] {
  return invoices.map((inv, i) => ({
    invoiceNo: inv.invoiceNo,
    invoiceDate: i === 0 ? null : inv.invoiceDate ?? defaultDate,
    lines: inv.lines,
  }));
}

/** Read-only: the rows with their lock state, as save / undo plan from them.
 *  Exported for read-only checks (a dry run); writes nothing. */
export { loadCurrentRows, loadObdFacts };

/** POST — save or edit, IN PLACE by seq. See the header for the write order. */
export async function saveSplit(
  orderId: number,
  invoices: SaveInvoiceInput[],
  actorId: number,
  confirmOtherObd: boolean,
): Promise<SplitResult> {
  const p = await prepare(orderId);
  if ("error" in p) return p.error!;
  const { order, seq1, sapNo } = p;

  const activeLines = await loadActiveLines(order.obdNumber);
  const errors = validateSplit(activeLines, invoices, sapNo);
  if (errors.length > 0) return { ok: false, status: 400, error: errors[0], errors };

  const typed = invoices.slice(1);
  const elsewhere = await numbersOnOtherObds(orderId, typed.map((i) => i.invoiceNo));
  if (elsewhere.length > 0 && !confirmOtherObd) {
    return {
      ok: false,
      status: 409,
      error: "Already on another OBD: " + elsewhere.map((e) => `${e.invoiceNo} (${e.obdNumbers.join(", ")})`).join("; "),
      otherObds: elsewhere,
    };
  }

  // 0. Plan from what the database holds NOW, state included. A refusal writes nothing.
  const current = await loadCurrentRows(orderId);
  const wasSplit = current.length > 1;
  const target = saveTargetOf(invoices, seq1.invoiceDate ?? order.invoiceDate);
  const planned = planSplitWrite(current, target, await loadObdFacts(orderId, order.obdNumber));
  if (!planned.ok) return { ok: false, status: 409, error: planned.refusals[0], errors: planned.refusals };
  if (!planned.changed) return { ok: true, changed: false };

  // 1-6.
  const linesBySeq = new Map(target.map((t, i) => [i + 1, t.lines]));
  await applyPlan(orderId, planned.plan, actorId, linesBySeq);

  // 7. Re-read and prove it: the split re-validates and no kept row lost its id.
  const saved = await loadRows(orderId);
  const savedAsInput: SplitInvoiceInput[] = saved.map((r) => ({ invoiceNo: r.invoiceNo ?? "", lines: r.lines }));
  const recheck = validateSplit(activeLines, savedAsInput, sapNo);
  const idsOk = keptIdsIntact(current, saved, planned.plan.deleteRowIds);
  if (recheck.length > 0 || saved.length !== invoices.length || !idsOk) {
    console.error(`[order-invoices] order ${orderId} saved split does not re-validate`, { recheck, idsOk });
    return { ok: false, status: 500, error: "The invoices did not save completely — please press Save again", errors: recheck };
  }

  // 8. One status log row.
  const numbers = saved.map((r) => r.invoiceNo).join(", ");
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: order.workflowStage,
      changedById: actorId,
      note: `${wasSplit ? "Invoices edited" : "Invoices added"}: ${numbers} (${saved.length} invoices)`,
    },
  });
  return { ok: true, changed: true };
}

/** DELETE — Undo: back to unsplit (seq 1, no lines). The same engine and the
 *  same refusals as save. Merges back to seq 1, which already carries the
 *  rows' shared stop and hold; a manual row a copy / re-delivery points at
 *  cannot be removed (RESTRICT guard), so undo is refused while one does. */
export async function undoSplit(orderId: number, actorId: number): Promise<SplitResult> {
  const p = await prepare(orderId);
  if ("error" in p) return p.error!;
  const { order, seq1 } = p;

  const current = await loadCurrentRows(orderId);
  const target: TargetRow[] = [{ invoiceNo: seq1.invoiceNo ?? "", invoiceDate: null, lines: [] }];
  const planned = planSplitWrite(current, target, await loadObdFacts(orderId, order.obdNumber));
  if (!planned.ok) return { ok: false, status: 409, error: planned.refusals[0], errors: planned.refusals };
  if (!planned.changed) return { ok: true, changed: false };

  const removed = current.filter((r) => r.source === SOURCE_MANUAL).map((r) => r.invoiceNo);
  // Steps 1 and 5 only: manual rows first (their lines cascade), then seq 1's
  // lines. Dying between the two leaves seq 1 alone WITH lines — reported
  // stale; Undo again repairs.
  await applyPlan(orderId, planned.plan, actorId, new Map());

  const after = await loadRows(orderId);
  if (after.length !== 1 || after[0].seq !== SAP_SEQ || after[0].id !== seq1.id || after[0].lines.length > 0) {
    console.error(`[order-invoices] order ${orderId} undo did not leave exactly seq 1 with no lines`);
    return { ok: false, status: 500, error: "Undo did not finish — please press Undo again" };
  }

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: order.workflowStage,
      changedById: actorId,
      note: `Invoices undone: back to ${seq1.invoiceNo} only (removed ${removed.join(", ") || "none"})`,
    },
  });
  return { ok: true, changed: true };
}
