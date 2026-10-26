// lib/order-invoices/load-split.ts — SPLIT LOAD, the reads and writes behind
// app/api/floor/orders/[orderId]/load-split (GET / POST split + repair) and
// …/load-merge (POST) — phase 2, 2026-10-24, Schema v27.76. Server-only
// (Prisma). The rules are lib/order-invoices/load-plan.ts (pure).
// Design: docs/prompts/drafts/code-design-2026-10-24-split-load-writer.md.
//
// SPLIT LOAD = ONE SAP invoice row whose tins go on several trucks. The source
// row keeps its id, seq, number, trip, hold, copies and re-deliveries — only
// its lines change to truck 1's share; each other truck is a NEW 'load' row
// (loadParentId = the group's root, number / date copied from the root, hold
// copied from the source, on no trip). Merge puts waiting parts back into one.
//
// 🔴 NO TRANSACTION (CORE §3) — THE WRITE ORDER IS THE SAFETY. Each step is ONE
// statement. SPLIT:
//   0. read; guards (load-plan.ts E.1–E.11); plan (pure). Refuse → NOTHING written
//   1. order_invoices.createMany — the new parts, NO lines yet. This claims the
//      seqs: two presses at once collide on UNIQUE (orderId, seq) (P2002 → 409)
//      before anything else is touched
//   2. order_invoices.findMany — their ids
//   3. order_invoice_lines.deleteMany — the source's old lines (skipped on an
//      unsplit seq 1, which has none)
//   4. order_invoice_lines.createMany — EVERY line row (source + parts), ONE statement
//   5. orders.update — ONLY if the derived tripDropId / partlyOnTrip changed
//   6. re-read; re-validate; [order-invoices] console.error if it does not add up
//   7. ONE order_status_logs row
// MERGE: 0 · 1 delete the survivor's lines · 2 delete the parts ('load' only;
// lines CASCADE; a RESTRICT link fails the whole statement) · 3 the survivor's
// new lines (skipped going back to unsplit) · 4 orders only if derived moved ·
// 5 re-read · 6 one log row.
// HALF-FAILURE ANSWER: the only half states are "parts with no lines" and "a
// source / survivor with no lines". GET reports both (halfWritten → stale; the
// board's invoice-rows.ts marks a lineless row stale too), every press refuses
// with "press Repair first", and Repair (repairLoadWrite) puts the bill back
// by the remainder rule (load-plan.ts planLoadRepair).
//
// ⚠ EXACTLY ONE orders.update PER PRESS, and only when a derived value moves —
// the markers key on MAX(orders.updatedAt). Hold never changes: new parts copy
// the source's hold, so "every row held ⇔ OBD held" is unchanged. Nothing here
// touches a trip, a stop, picking, CI, a copy or a re-delivery. The rows' own
// writes fire the order_invoices live triggers; order_invoice_lines has its own
// join-based trigger (v27.67).
//
// Sequential awaits only — never prisma.$transaction.

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { SPLIT_LOAD_MERGED_NOTE, SPLIT_LOAD_NOTE, SPLIT_LOAD_REPAIRED_NOTE } from "../floor/hold-log";
import { mirrorObdHold } from "./hold";
import { learnedKgPerUnit } from "./kg-per-unit";
import { detectStale } from "./rules";
import { loadActiveLines, type SplitActiveLine } from "./split";
import { INVOICE_SOURCE } from "./source";
import { deriveObdTripDropId, derivePartlyOnTrip } from "./trip-read";
import {
  LOAD_CHANGED,
  LOAD_SAME_MOMENT,
  isHalfWritten,
  loadBillRefusal,
  loadGroupsOf,
  loadMergeRefusal,
  loadPartText,
  loadPartsText,
  loadSplitRefusal,
  mergeAwayRefusal,
  paperLabel,
  planLoadMerge,
  planLoadRepair,
  planLoadSplit,
  rootOf,
  rowsKey,
  tinsOfRow,
  type LoadBill,
  type LoadFacts,
  type LoadLine,
  type LoadRow,
  type TruckInput,
} from "./load-plan";

export type LoadResult =
  | { ok: true; changed: boolean; rowIds: number[] }
  | { ok: false; status: number; error: string; errors?: string[] };

export interface LoadViewRow {
  id: number;
  seq: number;
  source: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  rootId: number;
  k: number;
  n: number;
  tripDropId: number | null;
  tripNumber: string | null;
  isHeld: boolean;
  isDispatched: boolean;
  /** Resolved: an unsplit seq 1 → every active line. */
  lines: LoadLine[];
  /** null = may be split; else the refusal (E.2–E.11). */
  canSplit: string | null;
  /** null = may be merged away into its group; else why not. A root is never merged away. */
  canMergeAway: string | null;
}

export interface LoadView {
  orderId: number;
  obdNumber: string;
  expectKey: string;
  stale: boolean;
  halfWritten: boolean;
  /** The bill-level refusal (E.1). */
  blockedReason: string | null;
  activeLines: SplitActiveLine[];
  rows: LoadViewRow[];
  /**
   * PHASE 3 (2026-10-24) — what the Split load dialog needs to show each
   * truck's kg by the BOARD's own ladder (lib/floor/invoice-rows.ts invoiceKg:
   * SAP line kg → SAP's learned kg per tin → the header kg shared by litres,
   * "~"). Per active line: SAP's line kg ("totalWeight") and the learned kg per
   * tin of its SKU (lib/order-invoices/kg-per-unit.ts); the OBD's header kg.
   * Additive — the Add invoices GET (SplitActiveLine) is not touched.
   */
  kg: {
    obdKg: number | null;
    lines: Array<{ rawLineItemId: number; totalWeight: number | null; unitKg: number | null }>;
  };
}

/** The dialog's kg facts (LoadView.kg) — two SELECTs, GET only. */
async function loadKgFacts(orderId: number, obdNumber: string): Promise<LoadView["kg"]> {
  const snap = await prisma.import_obd_query_summary.findUnique({ where: { orderId }, select: { totalWeight: true } });
  const raw = await prisma.import_raw_line_items.findMany({
    where: { obdNumber, lineStatus: "active" },
    select: { id: true, skuCodeRaw: true, totalWeight: true },
  });
  const unit = await learnedKgPerUnit(raw.map((l) => l.skuCodeRaw));
  return {
    // 0 is a MISSING header kg (status-pill formatWeightKg), never a weight.
    obdKg: snap && snap.totalWeight > 0 ? snap.totalWeight : null,
    lines: raw.map((l) => ({ rawLineItemId: l.id, totalWeight: l.totalWeight ?? null, unitKg: unit.get(l.skuCodeRaw) ?? null })),
  };
}

interface LoadState {
  bill: LoadBill & { id: number; tripDropId: number | null; partlyOnTrip: boolean; workflowStage: string };
  rows: LoadRow[];
  facts: LoadFacts & { active: SplitActiveLine[] };
}

/** Step 0's reads: the order, ALL its rows with what points at them, its CIs,
 *  copies, freight trip and active lines. null = no such order. */
async function loadState(orderId: number): Promise<LoadState | null> {
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      obdNumber: true,
      isRemoved: true,
      workflowStage: true,
      dispatchStatus: true,
      tripDropId: true,
      partlyOnTrip: true,
    },
  });
  if (!order) return null;
  const found = await prisma.order_invoices.findMany({
    where: { orderId },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      source: true,
      loadParentId: true,
      invoiceNo: true,
      invoiceDate: true,
      tripDropId: true,
      tripDrop: { select: { tripId: true, trip: { select: { tripNumber: true } } } },
      isHeld: true,
      heldAt: true,
      heldById: true,
      isDispatched: true,
      createdAt: true,
      lines: { select: { rawLineItemId: true, qty: true }, orderBy: { rawLineItemId: "asc" } },
      billCopies: { select: { trip: { select: { tripNumber: true } } }, orderBy: { id: "asc" } },
      redeliveries: { select: { trip: { select: { tripNumber: true } } }, orderBy: { id: "asc" } },
    },
  });
  // EVERY ci_returns row on the OBD, any status, void included: the per-row FK
  // guard reads them all; the split / merge CI guard reads the non-voided ones.
  const cis = await prisma.ci_returns.findMany({
    where: { orderId },
    orderBy: { id: "asc" },
    select: { id: true, ciNumber: true, status: true, isVoided: true, orderInvoiceId: true, returnType: true },
  });
  // Newest first — coveringCopy's contract.
  const copies = await prisma.trip_bill_copies.findMany({
    where: { orderId },
    orderBy: { copiedAt: "desc" },
    select: { tripId: true, orderInvoiceId: true, copiedAt: true, trip: { select: { tripNumber: true } } },
  });
  const freight = await prisma.freight_trip_bills.findFirst({
    where: { orderId, removedAt: null },
    select: { freightTrip: { select: { tripNumber: true } } },
  });
  const active = await loadActiveLines(order.obdNumber);

  const rows: LoadRow[] = found.map((r) => ({
    id: r.id,
    seq: r.seq,
    source: r.source,
    loadParentId: r.loadParentId,
    invoiceNo: r.invoiceNo,
    invoiceDate: r.invoiceDate,
    tripDropId: r.tripDropId,
    tripId: r.tripDrop?.tripId ?? null,
    tripNumber: r.tripDrop?.trip.tripNumber ?? null,
    isHeld: r.isHeld,
    heldAt: r.heldAt,
    heldById: r.heldById,
    isDispatched: r.isDispatched,
    createdAt: r.createdAt,
    lines: r.lines,
    copyTrips: r.billCopies.map((c) => c.trip.tripNumber),
    redeliveryTrips: r.redeliveries.map((d) => d.trip.tripNumber),
    ciNumbers: cis
      .filter((c) => c.orderInvoiceId === r.id)
      .map((c) => (c.ciNumber === null ? null : c.isVoided ? `${c.ciNumber} (void)` : c.ciNumber)),
  }));
  return {
    bill: order,
    rows,
    facts: {
      cis,
      copies: copies.map((c) => ({ tripId: c.tripId, orderInvoiceId: c.orderInvoiceId, copiedAt: c.copiedAt, tripNumber: c.trip.tripNumber })),
      freightTripNumber: freight?.freightTrip.tripNumber ?? null,
      active,
    },
  };
}

/** GET — the whole picture for one OBD. null = no such order. Writes nothing. */
export async function loadLoadView(orderId: number): Promise<LoadView | null> {
  const st = await loadState(orderId);
  if (!st) return null;
  const { bill, rows, facts } = st;
  const groups = loadGroupsOf(rows);
  const halfWritten = isHalfWritten(rows);
  const kg = await loadKgFacts(bill.id, bill.obdNumber);
  return {
    kg,
    orderId: bill.id,
    obdNumber: bill.obdNumber,
    expectKey: rowsKey(rows),
    stale: halfWritten || detectStale(facts.active, rows.flatMap((r) => r.lines)),
    halfWritten,
    blockedReason: loadBillRefusal(bill),
    activeLines: facts.active,
    rows: rows.map((r) => {
      const place = groups.get(r.id)!;
      return {
        id: r.id,
        seq: r.seq,
        source: r.source,
        invoiceNo: r.invoiceNo,
        invoiceDate: r.invoiceDate ? r.invoiceDate.toISOString() : null,
        rootId: place.rootId,
        k: place.k,
        n: place.n,
        tripDropId: r.tripDropId,
        tripNumber: r.tripNumber ?? null,
        isHeld: r.isHeld,
        isDispatched: r.isDispatched,
        lines: Array.from(tinsOfRow(r, rows, facts.active).entries()).map(([rawLineItemId, qty]) => ({ rawLineItemId, qty })),
        canSplit: loadSplitRefusal(bill, rows, r, facts),
        canMergeAway: r.source === INVOICE_SOURCE.LOAD ? mergeAwayRefusal(rows, r, bill.obdNumber) : "The invoice itself stays — merge its parts into it",
      };
    }),
  };
}

/** Step 5 (split) / 4 (merge): ONE orders.update, only when a derived value moved. */
async function landDerived(orderId: number, bill: LoadState["bill"]): Promise<void> {
  const after = await prisma.order_invoices.findMany({ where: { orderId }, select: { seq: true, tripDropId: true } });
  const tripDropId = deriveObdTripDropId(after);
  const partlyOnTrip = derivePartlyOnTrip(after);
  if (tripDropId === bill.tripDropId && partlyOnTrip === bill.partlyOnTrip) return;
  await prisma.orders.update({ where: { id: orderId }, data: { tripDropId, partlyOnTrip } });
}

/** The re-read every press ends with: the rows as they now stand. */
async function rereadRows(orderId: number) {
  return prisma.order_invoices.findMany({
    where: { orderId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, lines: { select: { rawLineItemId: true, qty: true } } },
  });
}

function sumTins(lines: readonly LoadLine[]): number {
  return lines.reduce((s, l) => s + l.qty, 0);
}

function isUniqueClash(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** POST split — see the header for the write order. */
export async function saveLoadSplit(
  orderId: number,
  req: { sourceRowId: number; trucks: TruckInput[]; expectKey: string; actorId: number },
): Promise<LoadResult> {
  // 0. Reads, guards (E.1 → E.11 in order), plan. A refusal writes nothing.
  const st = await loadState(orderId);
  if (!st) return { ok: false, status: 404, error: "Order not found" };
  const { bill, rows, facts } = st;
  const billRefusal = loadBillRefusal(bill);
  if (billRefusal !== null) return { ok: false, status: 409, error: billRefusal };
  if (req.expectKey !== rowsKey(rows)) return { ok: false, status: 409, error: LOAD_CHANGED };
  const source = rows.find((r) => r.id === req.sourceRowId);
  if (!source) return { ok: false, status: 400, error: `Invoice row ${req.sourceRowId} is not an invoice of ${bill.obdNumber}` };
  const refusal = loadSplitRefusal(bill, rows, source, facts);
  if (refusal !== null) return { ok: false, status: 409, error: refusal };
  const planned = planLoadSplit({
    rows,
    sourceRowId: source.id,
    trucks: req.trucks,
    active: facts.active,
    obdHeld: bill.dispatchStatus === "hold",
  });
  if (!planned.ok) return { ok: false, status: 400, error: planned.errors[0], errors: planned.errors };
  const plan = planned.plan;
  const before = tinsOfRow(source, rows, facts.active);

  // 1. The new parts, no lines — claims the seqs (the race lock).
  try {
    await prisma.order_invoices.createMany({
      data: plan.creates.map((c) => ({
        orderId,
        seq: c.seq,
        source: INVOICE_SOURCE.LOAD,
        loadParentId: c.loadParentId,
        invoiceNo: c.invoiceNo,
        invoiceDate: c.invoiceDate,
        createdById: req.actorId,
        tripDropId: null,
        isHeld: c.isHeld,
        heldAt: c.heldAt,
        heldById: c.heldById,
      })),
    });
  } catch (err) {
    if (isUniqueClash(err)) return { ok: false, status: 409, error: LOAD_SAME_MOMENT };
    throw err;
  }
  // 2. Their ids.
  const made = await prisma.order_invoices.findMany({
    where: { orderId, seq: { in: plan.creates.map((c) => c.seq) }, source: INVOICE_SOURCE.LOAD },
    select: { id: true, seq: true },
  });
  const idBySeq = new Map(made.map((r) => [r.seq, r.id]));
  // 3. The source's old lines (an unsplit seq 1 has none).
  if (!plan.sourceGainsLines) {
    await prisma.order_invoice_lines.deleteMany({ where: { orderInvoiceId: plan.sourceRowId } });
  }
  // 4. EVERY line row, one statement.
  const lineData = [
    ...plan.sourceLines.map((l) => ({ orderInvoiceId: plan.sourceRowId, rawLineItemId: l.rawLineItemId, qty: l.qty })),
    ...plan.creates.flatMap((c) => {
      const id = idBySeq.get(c.seq);
      return id === undefined ? [] : c.lines.map((l) => ({ orderInvoiceId: id, rawLineItemId: l.rawLineItemId, qty: l.qty }));
    }),
  ];
  await prisma.order_invoice_lines.createMany({ data: lineData });
  // 5. orders, only when the derived stop / partlyOnTrip moved.
  await landDerived(orderId, bill);

  // 6. Re-read and prove it.
  const newIds = plan.creates.map((c) => idBySeq.get(c.seq)).filter((id): id is number => id !== undefined);
  const saved = await rereadRows(orderId);
  const group = saved.filter((r) => r.id === plan.sourceRowId || newIds.includes(r.id));
  const after = new Map<number, number>();
  for (const r of group) for (const l of r.lines) after.set(l.rawLineItemId, (after.get(l.rawLineItemId) ?? 0) + l.qty);
  const tinsKept =
    after.size === before.size && Array.from(before.entries()).every(([id, q]) => after.get(id) === q);
  const ok =
    newIds.length === plan.creates.length &&
    saved.every((r) => r.lines.length > 0) &&
    !detectStale(facts.active, saved.flatMap((r) => r.lines)) &&
    tinsKept;
  if (!ok) {
    console.error(`[order-invoices] order ${orderId} split load did not save completely`, { newIds, tinsKept });
    return { ok: false, status: 500, error: "The split did not save completely — press Repair" };
  }

  // 7. One status log row.
  const root = rootOf(rows, source);
  const shares = [plan.sourceLines, ...plan.creates.map((c) => c.lines)].map((ls, i) => `${loadPartText(i + 1)}: ${sumTins(ls)} tins`);
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: bill.workflowStage,
      toStage: bill.workflowStage,
      changedById: req.actorId,
      note: `${SPLIT_LOAD_NOTE}: ${root.invoiceNo ?? "no invoice yet"} → ${plan.creates.length + 1} trucks (${shares.join(" · ")})`,
      orderInvoiceIds: [plan.sourceRowId, ...newIds],
    },
  });
  return { ok: true, changed: true, rowIds: [plan.sourceRowId, ...newIds] };
}

/** POST merge — see the header for the write order. */
export async function mergeLoadParts(
  orderId: number,
  req: { rowIds: number[]; expectKey: string; actorId: number },
): Promise<LoadResult> {
  // 0.
  const st = await loadState(orderId);
  if (!st) return { ok: false, status: 404, error: "Order not found" };
  const { bill, rows, facts } = st;
  const billRefusal = loadBillRefusal(bill);
  if (billRefusal !== null) return { ok: false, status: 409, error: billRefusal };
  if (req.expectKey !== rowsKey(rows)) return { ok: false, status: 409, error: LOAD_CHANGED };
  const refusal = loadMergeRefusal(bill, rows, req.rowIds, facts);
  if (refusal !== null) return { ok: false, status: 409, error: refusal };
  const planned = planLoadMerge(rows, req.rowIds, facts.active, bill.obdNumber);
  if (!planned.ok) return { ok: false, status: 409, error: planned.errors[0], errors: planned.errors };
  const plan = planned.plan;
  const groups = loadGroupsOf(rows);

  // 1. The survivor's lines.
  await prisma.order_invoice_lines.deleteMany({ where: { orderInvoiceId: plan.survivorId } });
  // 2. The parts — 'load' only, so a bug can never delete a SAP or typed row.
  await prisma.order_invoices.deleteMany({ where: { id: { in: plan.deleteIds }, orderId, source: INVOICE_SOURCE.LOAD } });
  // 3. The survivor's new lines (none going back to unsplit).
  if (!plan.backToUnsplit && plan.survivorLines.length > 0) {
    await prisma.order_invoice_lines.createMany({
      data: plan.survivorLines.map((l) => ({ orderInvoiceId: plan.survivorId, rawLineItemId: l.rawLineItemId, qty: l.qty })),
    });
  }
  // 4.
  await landDerived(orderId, bill);

  // 5. Re-read and prove it.
  const saved = await rereadRows(orderId);
  const gone = plan.deleteIds.every((id) => !saved.some((r) => r.id === id));
  const shapeOk = plan.backToUnsplit
    ? saved.length === 1 && saved[0].id === plan.survivorId && saved[0].lines.length === 0
    : saved.every((r) => r.lines.length > 0);
  if (!gone || !shapeOk) {
    console.error(`[order-invoices] order ${orderId} split load merge did not finish`, { gone, shapeOk });
    return { ok: false, status: 500, error: "The merge did not finish — press Repair" };
  }

  // 6. One status log row.
  const survivor = rows.find((r) => r.id === plan.survivorId)!;
  const ks = plan.deleteIds.map((id) => groups.get(id)!.k).sort((a, b) => a - b);
  const tins = plan.backToUnsplit
    ? facts.active.reduce((s, a) => s + Math.max(0, a.unitQty), 0)
    : sumTins(plan.survivorLines);
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: bill.workflowStage,
      toStage: bill.workflowStage,
      changedById: req.actorId,
      note: `${SPLIT_LOAD_MERGED_NOTE}: ${loadPartsText(ks)} of ${paperLabel(rootOf(rows, survivor), bill.obdNumber)} into ${loadPartText(groups.get(plan.survivorId)!.k)} (${tins} tins)`,
      orderInvoiceIds: [plan.survivorId],
    },
  });
  return { ok: true, changed: true, rowIds: [plan.survivorId] };
}

/** POST repair (E.8) — the two shapes a dead press can leave, and the unsplit
 *  hold mirror (E.6). Anything else is refused. */
export async function repairLoadWrite(orderId: number, actorId: number): Promise<LoadResult> {
  // 0.
  const st = await loadState(orderId);
  if (!st) return { ok: false, status: 404, error: "Order not found" };
  const { bill, rows, facts } = st;
  const billRefusal = loadBillRefusal(bill);
  if (billRefusal !== null) return { ok: false, status: 409, error: billRefusal };
  const planned = planLoadRepair(rows, facts.active, bill.dispatchStatus === "hold");
  if (!planned.ok) return { ok: false, status: 409, error: planned.errors[0], errors: planned.errors };
  const plan = planned.plan;
  if (!plan.changed) return { ok: true, changed: false, rowIds: [] };

  // (a) one deleteMany — lineless, waiting 'load' rows only (re-stated in the where).
  if (plan.deleteIds.length > 0) {
    await prisma.order_invoices.deleteMany({
      where: { id: { in: plan.deleteIds }, orderId, source: INVOICE_SOURCE.LOAD, tripDropId: null, isDispatched: false, lines: { none: {} } },
    });
  }
  // (b) one createMany — the remainder for the one lineless row.
  if (plan.fill !== null) {
    const rowId = plan.fill.rowId;
    await prisma.order_invoice_lines.createMany({
      data: plan.fill.lines.map((l) => ({ orderInvoiceId: rowId, rawLineItemId: l.rawLineItemId, qty: l.qty })),
    });
  }
  // E.6 — the unsplit hold mirror, by the existing writer.
  if (plan.mirrorHeld !== null) await mirrorObdHold(orderId, plan.mirrorHeld, actorId);
  await landDerived(orderId, bill);

  const saved = await rereadRows(orderId);
  const unsplit = saved.length === 1 && saved[0].lines.length === 0;
  if (!unsplit && (saved.some((r) => r.lines.length === 0) || detectStale(facts.active, saved.flatMap((r) => r.lines)))) {
    console.error(`[order-invoices] order ${orderId} split load repair did not leave a whole bill`);
    return { ok: false, status: 500, error: "The repair did not leave a whole bill — ask an admin" };
  }

  const touched = [...plan.deleteIds, ...(plan.fill ? [plan.fill.rowId] : [])];
  const parts = [
    plan.deleteIds.length > 0 ? `removed ${plan.deleteIds.length} unfinished part${plan.deleteIds.length > 1 ? "s" : ""}` : null,
    plan.fill ? `refilled invoice row ${plan.fill.rowId} (${sumTins(plan.fill.lines)} tins)` : null,
    plan.mirrorHeld !== null ? `hold record set to ${plan.mirrorHeld ? "held" : "not held"}` : null,
  ].filter((p): p is string => p !== null);
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: bill.workflowStage,
      toStage: bill.workflowStage,
      changedById: actorId,
      note: `${SPLIT_LOAD_REPAIRED_NOTE}: ${parts.join("; ")}`,
      // Deleted ids are gone; the refilled row (or, for a mirror, every row) is named.
      orderInvoiceIds: plan.fill ? [plan.fill.rowId] : plan.mirrorHeld !== null ? saved.map((r) => r.id) : [],
    },
  });
  return { ok: true, changed: true, rowIds: touched };
}
