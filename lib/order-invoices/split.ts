// lib/order-invoices/split.ts — ADD INVOICES, the reads and writes behind
// app/api/floor/orders/[orderId]/invoices (2026-10-10, Phase 2, RECORD ONLY).
// Server-only (Prisma). The rules are lib/order-invoices/rules.ts (pure).
//
// 🔴 RECORD ONLY. Nothing here writes `orders`, a trip, a hold, picking or CI —
// those still act on the whole OBD. The one other write is ONE
// order_status_logs row per save / undo.
//
// 🔴 NO TRANSACTION (CORE §3) — THE WRITE ORDER IS THE SAFETY. Every step is one
// SQL statement, so each is all-or-nothing on its own:
//   1. delete seq-1's line rows                  (deleteMany)
//   2. delete every 'manual' row; lines CASCADE  (deleteMany)
//   3. create the manual rows seq 2..n           (createMany)
//   4. read their ids back                       (findMany)
//   5. create EVERY line row, seq 1 included     (createMany — one statement)
//   6. re-read and re-validate; log [order-invoices] if it does not add up
//   7. one order_status_logs row
// Dying after 1-2 leaves the OBD UNSPLIT (seq 1, no lines) — a valid state,
// the same as Undo. Dying after 3-4 leaves manual rows with NO lines — never a
// valid split, so GET reports it `stale` (detectStale: saved lines no longer
// cover the bill) and validateSplit fails on it. In both cases the route
// returned an error, and the fix is to press Save again: a save is a FULL
// REPLACE, so it starts by deleting whatever a dead attempt left. Lines are
// written in ONE statement after all rows exist, so a half set of lines cannot
// happen. Two saves racing on one OBD collide on UNIQUE (orderId, seq) at step
// 3 — the loser gets an error and re-reads.
//
// ⚠ NO LIVE REFRESH IS SENT, ON PURPOSE (owner question, 2026-10-10). The Floor
// board refreshes from the live feed; the feed's orders trigger SKIPS an update
// that only moves "updatedAt" (sql/2026-09-30-live-changes.sql:19-21), so
// touching orders.updatedAt would wake only the legacy 15 s markers — and nothing
// on any screen shows order_invoices yet, so there is nothing to refresh. The
// first screen read (the Phase 3 UI) adds a live_changes child trigger on
// order_invoices + order_invoice_lines (parent "orderId"), CORE §13.

import { prisma } from "../prisma";
import { syncSapInvoiceRow } from "./sap-row";
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
    blockedReason: addInvoicesRefusal({ isRemoved: order.isRemoved, workflowStage: order.workflowStage, sapInvoiceNo: sapNo }),
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

/** POST — save or edit: a FULL replace of the split. See the header for the order. */
export async function saveSplit(
  orderId: number,
  invoices: SaveInvoiceInput[],
  actorId: number,
  confirmOtherObd: boolean,
): Promise<SplitResult> {
  const p = await prepare(orderId);
  if ("error" in p) return p.error!;
  const { order, rows, seq1, sapNo } = p;

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

  const wasSplit = rows.length > 1;
  const defaultDate = seq1.invoiceDate ?? order.invoiceDate;

  // 1-2. Clear whatever is there (a dead attempt's leftovers included).
  await prisma.order_invoice_lines.deleteMany({ where: { orderInvoiceId: seq1.id } });
  await prisma.order_invoices.deleteMany({ where: { orderId, source: SOURCE_MANUAL } });
  // 3-4. The typed rows, seq 2..n.
  await prisma.order_invoices.createMany({
    data: typed.map((inv, i) => ({
      orderId,
      seq: i + 2,
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate ?? defaultDate,
      source: SOURCE_MANUAL,
      createdById: actorId,
    })),
  });
  const after = await loadRows(orderId);
  const idBySeq = new Map(after.map((r) => [r.seq, r.id]));
  // 5. Every line row in ONE statement.
  await prisma.order_invoice_lines.createMany({
    data: invoices.flatMap((inv, i) =>
      inv.lines.map((l) => ({ orderInvoiceId: idBySeq.get(i + 1)!, rawLineItemId: l.rawLineItemId, qty: l.qty })),
    ),
  });

  // 6. Re-read and prove it.
  const saved = await loadRows(orderId);
  const savedAsInput: SplitInvoiceInput[] = saved.map((r) => ({ invoiceNo: r.invoiceNo ?? "", lines: r.lines }));
  const recheck = validateSplit(activeLines, savedAsInput, sapNo);
  if (recheck.length > 0 || saved.length !== invoices.length) {
    console.error(`[order-invoices] order ${orderId} saved split does not re-validate`, recheck);
    return { ok: false, status: 500, error: "The invoices did not save completely — please press Save again", errors: recheck };
  }

  // 7. One status log row.
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

/** DELETE — Undo: back to unsplit (seq 1, no lines). Same refusals as save. */
export async function undoSplit(orderId: number, actorId: number): Promise<SplitResult> {
  const p = await prepare(orderId);
  if ("error" in p) return p.error!;
  const { order, rows, seq1 } = p;

  const seq1HasLines = seq1.lines.length > 0;
  if (rows.length === 1 && !seq1HasLines) return { ok: true, changed: false };

  const removed = rows.filter((r) => r.source === SOURCE_MANUAL).map((r) => r.invoiceNo);
  // Manual rows first (their lines cascade), then seq 1's lines. Dying between
  // the two leaves seq 1 alone WITH lines — reported stale; Undo again repairs.
  await prisma.order_invoices.deleteMany({ where: { orderId, source: SOURCE_MANUAL } });
  await prisma.order_invoice_lines.deleteMany({ where: { orderInvoiceId: seq1.id } });

  const after = await loadRows(orderId);
  if (after.length !== 1 || after[0].seq !== SAP_SEQ || after[0].lines.length > 0) {
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
