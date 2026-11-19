// lib/order-invoices/ship-to.ts — PER-PART SHIP-TO, the part writer (Schema
// v27.81, owner 2026-11-19 — REVERSES Model A for ship-to only; do not revert).
// Plan: docs/prompts/drafts/code-plan-2026-11-19-split-load-per-part-ship-to.md
// §B, §C.1. Route: app/api/floor/order-invoices/[rowId]/ship-to. Server-only
// (Prisma); the rules are the pure functions at the top, tested in
// lib/order-invoices/ship-to.test.ts.
//
// A PART = one order_invoices row of an OBD with 2+ rows (a split-load part OR
// an Add-invoices row — owner Q8). Its ship-to is the tri-state on the row
// (lib/ship-to/effective.ts): NULL = inherit the OBD, TRUE = own redirect,
// FALSE = own reset to SAP's site. A change here writes THAT ROW ONLY (rule 2);
// orders is never written for the ship-to.
//
// 🔴 NO TRANSACTION (CORE §3) — sequential awaits; each step one statement.
//   0. read the row, its OBD, its siblings, its stop / trip, its CIs; refuse
//      (partShipToRefusal) → NOTHING written. Unchanged → nothing written.
//   OFF A TRIP:
//   1. ONE order_invoices.updateMany (id + "tripDropId" IS NULL re-stated — a
//      row that joined a trip meanwhile is refused, never re-pointed blind).
//      orders is NOT touched: the v27.65 order_invoices live trigger carries
//      the change (the per-invoice hold precedent).
//   ON A TRIP (the part moves to the stop of its NEW shop, same trip):
//   1. the target stop: the current one if the key is unchanged, else an
//      existing stop for that shop, else a new one (findOrCreateTripDrop over
//      effectiveDropInput — the part's own columns, never the OBD's)
//   2. same stop → ONE order_invoices.updateMany (id + its stop re-stated);
//      new stop → ONE setRowsTrip([row], stop, onlyFromTripId, rowData) — the
//      ship-to rides the SAME row write as the stop, then ONE orders.update
//      with the derived values (ORDER_INVOICES §4.3)
//   3. a stop made for this press and left empty by a failure is closed again;
//      the old stop closes when nothing is left on it (deleteTripDropIfEmpty)
//   THEN (both): ONE order_status_logs row naming the part
//   ("orderInvoiceIds" = [row], from → to by name) · on a trip, ONE
//   trip_activity 'ship_to_changed' row · copies: a typed target keeps the
//   part's own copies, anything else soft-removes them.

import { prisma } from "../prisma";
import {
  effectiveDropInput,
  effectiveShipTo,
  isInheriting,
  isTypedShipTo,
  type ObdShipToCols,
  type PartShipToCols,
  type ShipToFacts,
} from "@/lib/ship-to/effective";
import { dealerDisplayName } from "@/lib/orders/dealer-name";
import { computeDropKey } from "@/lib/trips/drop-key";
import { deleteTripDropIfEmpty, findOrCreateTripDrop } from "@/lib/trips/drop";
import { logTripShipToChanged } from "@/lib/trips/activity";
import { activeOwnCopiesWhere, softRemoveCopies } from "@/lib/ship-to/copies-server";
import { logShipToChange, validateShipToTarget, type ShipToTarget } from "@/lib/floor/ship-to";
import { loadBillRefusal, loadChallanRefusal, loadPartsOf } from "./load-plan";
import { invoiceLabel } from "./trip-bills";
import { setRowsTrip, type RowsTripRowData } from "./trip-link";

// ── PURE ─────────────────────────────────────────────────────────────────────

/** A part save: the OBD-wide targets, plus "same as the bill" (inherit). */
export type PartShipToTarget = ShipToTarget | { kind: "inherit" };

/** The four columns a target writes on the PART (last save wins). */
export function partColumns(target: PartShipToTarget): RowsTripRowData {
  switch (target.kind) {
    case "dealer":
      return { shipToOverride: true, shipToOverrideCustomerId: target.customerId, shipToText: null, shipToAreaId: null };
    case "typed":
      return { shipToOverride: true, shipToOverrideCustomerId: null, shipToText: target.text.trim(), shipToAreaId: target.areaId };
    case "reset":
      // The part's OWN reset: SAP's own site, even when the OBD is redirected.
      return { shipToOverride: false, shipToOverrideCustomerId: null, shipToText: null, shipToAreaId: null };
    case "inherit":
      return { shipToOverride: null, shipToOverrideCustomerId: null, shipToText: null, shipToAreaId: null };
  }
}

/** All four of the row's own columns equal → nothing to write. */
export function isPartUnchanged(row: PartShipToCols, next: RowsTripRowData): boolean {
  return (
    row.shipToOverride === next.shipToOverride &&
    row.shipToOverrideCustomerId === next.shipToOverrideCustomerId &&
    row.shipToText === next.shipToText &&
    row.shipToAreaId === next.shipToAreaId
  );
}

/** The log's from / to for a part: "inherit" / "site" / the dealer id / "typed". */
export function partStateLabel(cols: PartShipToCols): string {
  if (cols.shipToOverride === null) return "inherit";
  if (cols.shipToOverrideCustomerId !== null) return String(cols.shipToOverrideCustomerId);
  if (cols.shipToText !== null) return "typed";
  return "site";
}

export const PART_NOT_SPLIT = "This bill is not split — change the bill's ship-to instead.";
export const PART_CHANGED = "This invoice changed while you were editing — reopen it and try again.";

/** What the refusals read (step 0). */
export interface PartShipToFacts {
  obdNumber: string;
  isRemoved: boolean;
  workflowStage: string;
  dispatchStatus: string | null;
  rowCount: number;
  label: string;
  row: { isDispatched: boolean; isHeld: boolean; tripDropId: number | null };
  trip: { status: string; tripNumber: string } | null;
  /** The row's non-voided CI, if any (its number, or null for a draft). */
  ci: { ciNumber: string | null } | null;
}

/** Why this part's ship-to cannot change now, or null. First refusal wins. */
export function partShipToRefusal(f: PartShipToFacts): { status: number; error: string } | null {
  if (f.isRemoved) return { status: 404, error: "Order not found" };
  const bill = loadBillRefusal({ obdNumber: f.obdNumber, isRemoved: false, workflowStage: f.workflowStage, dispatchStatus: f.dispatchStatus });
  if (bill !== null) return { status: 409, error: bill };
  const challan = loadChallanRefusal({ obdNumber: f.obdNumber, workflowStage: f.workflowStage });
  if (challan !== null) return { status: 409, error: challan };
  // Owner Q8: ANY OBD with 2+ rows (load parts and Add-invoices rows alike).
  if (f.rowCount < 2) return { status: 409, error: PART_NOT_SPLIT };
  if (f.row.isDispatched) return { status: 409, error: `${f.label} is dispatched — its ship-to can't change` };
  if (f.ci !== null) return { status: 409, error: `${f.label} is returned on ${f.ci.ciNumber ?? "a CI"} — it does not go out` };
  if (f.row.tripDropId !== null) {
    if (f.trip === null) return { status: 409, error: PART_CHANGED };
    if (f.trip.status === "cancelled") return { status: 409, error: "Cannot change the bills on a cancelled trip." };
    // The 6.3 add rule: a held invoice never joins a stop — and this would put it on one.
    if (f.row.isHeld) return { status: 409, error: `${f.label} is on hold — release it first` };
  }
  return null;
}

// ── SHOP NAMES (server) ──────────────────────────────────────────────────────

/** The OBD facts a shop name and a stop key need. */
export interface ShopObd extends ShipToFacts, Omit<ObdShipToCols, "shipToOverrideCustomerId" | "shipToText" | "shipToAreaId"> {
  shipToCustomerName: string | null;
}

/**
 * The shop each part goes to, by name — the typed text, else the effective
 * dealer's master name, else SAP's ship-to name (deskShipToName's ladder). ONE
 * delivery_point_master read for the lot. `parts[i]` null = the OBD itself.
 */
export async function shopNamesFor(order: ShopObd, parts: ReadonlyArray<PartShipToCols | null | undefined>): Promise<string[]> {
  const effs = parts.map((p) => effectiveShipTo(order, p));
  const ids = Array.from(
    new Set(
      effs
        .filter((e) => !isTypedShipTo(e))
        .map((e) => e.shipToOverrideCustomerId ?? order.customerId)
        .filter((id): id is number => id !== null),
    ),
  );
  const masters =
    ids.length === 0
      ? []
      : await prisma.delivery_point_master.findMany({ where: { id: { in: ids } }, select: { id: true, customerName: true } });
  const nameById = new Map(masters.map((m) => [m.id, m.customerName]));
  return effs.map((e) => {
    if (isTypedShipTo(e)) return (e.shipToText as string).trim();
    const id = e.shipToOverrideCustomerId ?? order.customerId;
    return dealerDisplayName(id !== null ? nameById.get(id) : null, order.shipToCustomerName);
  });
}

// ── READ ─────────────────────────────────────────────────────────────────────

const PART_COLS = { shipToOverride: true, shipToOverrideCustomerId: true, shipToText: true, shipToAreaId: true } as const;

async function readPart(rowId: number) {
  const row = await prisma.order_invoices.findUnique({
    where: { id: rowId },
    select: {
      id: true,
      orderId: true,
      seq: true,
      invoiceNo: true,
      isHeld: true,
      isDispatched: true,
      tripDropId: true,
      tripDrop: { select: { id: true, dropKey: true, customerName: true, tripId: true, trip: { select: { id: true, status: true, tripNumber: true } } } },
      ...PART_COLS,
    },
  });
  if (!row) return null;
  const order = await prisma.orders.findUnique({
    where: { id: row.orderId },
    select: {
      id: true,
      obdNumber: true,
      soNumber: true,
      isRemoved: true,
      workflowStage: true,
      dispatchStatus: true,
      customerId: true,
      shipToCustomerId: true,
      shipToCustomerName: true,
      ...PART_COLS,
    },
  });
  if (!order) return null;
  const siblings = await prisma.order_invoices.findMany({
    where: { orderId: row.orderId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, loadParentId: true },
  });
  const ci = await prisma.ci_returns.findFirst({
    where: { orderInvoiceId: rowId, isVoided: false },
    orderBy: { id: "asc" },
    select: { ciNumber: true },
  });
  const label = invoiceLabel({ seq: row.seq, invoiceNo: row.invoiceNo, part: loadPartsOf(siblings).get(row.id) }, order.obdNumber);
  return { row, order, rowCount: siblings.length, ci, label };
}

type PartRead = NonNullable<Awaited<ReturnType<typeof readPart>>>;

function factsOf(p: PartRead): PartShipToFacts {
  return {
    obdNumber: p.order.obdNumber,
    isRemoved: p.order.isRemoved,
    workflowStage: p.order.workflowStage,
    dispatchStatus: p.order.dispatchStatus,
    rowCount: p.rowCount,
    label: p.label,
    row: { isDispatched: p.row.isDispatched, isHeld: p.row.isHeld, tripDropId: p.row.tripDropId },
    trip: p.row.tripDrop ? { status: p.row.tripDrop.trip.status, tripNumber: p.row.tripDrop.trip.tripNumber } : null,
    ci: p.ci,
  };
}

/** What the route needs before it uploads any copy. */
export type PartShipToCheck =
  | { ok: true; orderId: number; soNumber: string | null; label: string }
  | { ok: false; status: number; error: string };

/**
 * THE CHECK without writing: the part exists, may change, and the target is a
 * real dealer / active area. The route calls it before uploading copies;
 * setPartShipTo re-runs it.
 */
export async function checkPartShipTo(rowId: number, target: PartShipToTarget): Promise<PartShipToCheck> {
  const p = await readPart(rowId);
  if (!p) return { ok: false, status: 404, error: "Invoice not found" };
  const refusal = partShipToRefusal(factsOf(p));
  if (refusal !== null) return { ok: false, ...refusal };
  if (target.kind !== "inherit") {
    const bad = await validateShipToTarget(target);
    if (bad !== null) return { ok: false, ...bad };
  }
  return { ok: true, orderId: p.order.id, soNumber: p.order.soNumber, label: p.label };
}

// ── WRITE ────────────────────────────────────────────────────────────────────

export type PartShipToResult =
  | {
      ok: true;
      rowId: number;
      orderId: number;
      changed: boolean;
      shipTo: RowsTripRowData;
      /** Set when the part is on a trip and the save ran there. */
      onTrip: { tripNumber: string; newShop: string; oldShop: string | null; moved: boolean; oldStopClosed: boolean } | null;
    }
  | { ok: false; status: number; error: string };

/** Change ONE part's ship-to — the header's write order. */
export async function setPartShipTo(args: { rowId: number; target: PartShipToTarget; changedById: number }): Promise<PartShipToResult> {
  const { rowId, target, changedById } = args;

  // 0.
  const p = await readPart(rowId);
  if (!p) return { ok: false, status: 404, error: "Invoice not found" };
  const refusal = partShipToRefusal(factsOf(p));
  if (refusal !== null) return { ok: false, ...refusal };
  if (target.kind !== "inherit") {
    const bad = await validateShipToTarget(target);
    if (bad !== null) return { ok: false, ...bad };
  }
  const { row, order } = p;
  const next = partColumns(target);
  if (isPartUnchanged(row, next)) {
    return { ok: true, rowId, orderId: order.id, changed: false, shipTo: next, onTrip: null };
  }
  const [fromShop, toShop] = await shopNamesFor(order, [row, next]);

  let onTrip: Extract<PartShipToResult, { ok: true }>["onTrip"] = null;
  if (row.tripDrop === null) {
    // OFF A TRIP — 1. one row write; orders untouched.
    const w = await prisma.order_invoices.updateMany({ where: { id: rowId, orderId: order.id, tripDropId: null }, data: next });
    if (w.count !== 1) return { ok: false, status: 409, error: PART_CHANGED };
  } else {
    // ON A TRIP — 1. the target stop.
    const fromDrop = row.tripDrop;
    const tripId = fromDrop.trip.id;
    const dropInput = effectiveDropInput(order, next);
    const toKey = computeDropKey(dropInput);
    if (toKey === fromDrop.dropKey) {
      // 2a. Same shop, same stop — the ship-to only.
      const w = await prisma.order_invoices.updateMany({ where: { id: rowId, orderId: order.id, tripDropId: fromDrop.id }, data: next });
      if (w.count !== 1) return { ok: false, status: 409, error: PART_CHANGED };
      onTrip = { tripNumber: fromDrop.trip.tripNumber, newShop: fromDrop.customerName, oldShop: fromDrop.customerName, moved: false, oldStopClosed: false };
    } else {
      const existing = await prisma.trip_drops.findFirst({ where: { tripId, dropKey: toKey }, select: { id: true } });
      const toDrop = await findOrCreateTripDrop(tripId, dropInput);
      try {
        // 2b. ONE row write (stop + ship-to) + ONE orders.update (derived).
        await setRowsTrip(order.id, [rowId], toDrop.id, { onlyFromTripId: tripId }, undefined, next);
      } catch (err) {
        // 3. A stop made for this press and left empty is closed again.
        if (existing === null && toDrop.id !== fromDrop.id) await deleteTripDropIfEmpty(toDrop.id).catch(() => false);
        throw err;
      }
      const oldStopClosed = await deleteTripDropIfEmpty(fromDrop.id);
      const landed = await prisma.trip_drops.findUnique({ where: { id: toDrop.id }, select: { customerName: true } });
      const newShop = landed?.customerName ?? toShop;
      onTrip = { tripNumber: fromDrop.trip.tripNumber, newShop, oldShop: fromDrop.customerName, moved: true, oldStopClosed };
      await logTripShipToChanged({
        tripId,
        actorId: changedById,
        orderId: order.id,
        obdNumber: order.obdNumber,
        newShop,
        oldShop: fromDrop.customerName,
        fromDropId: fromDrop.id,
        toDropId: toDrop.id,
        oldStopClosed,
        orderInvoiceId: rowId,
        partLabel: p.label,
      });
    }
  }

  // ONE status log row, naming the part (rule 7).
  const fromWord = isInheriting(row) ? `${fromShop} (same as the bill)` : fromShop;
  const toWord = next.shipToOverride === null ? `${toShop} (same as the bill)` : toShop;
  await logShipToChange({
    orderId: order.id,
    before: row,
    next: { ...next, shipToOverride: next.shipToOverride ?? false },
    // The log's default note is never used here (note is given); a part's
    // "inherit" has no OBD-wide twin, so it is logged under reset's kind.
    target: target.kind === "inherit" ? { kind: "reset" } : target,
    changedById,
    note: `Ship-to · ${p.label} · ${fromWord} → ${toWord}`,
    orderInvoiceIds: [rowId],
    labels: { from: partStateLabel(row), to: partStateLabel(next) },
  });

  // Copies: a typed target keeps the part's own; anything else hides them.
  if (target.kind !== "typed") {
    await softRemoveCopies(activeOwnCopiesWhere("floor", order.id, rowId), changedById);
  }

  return { ok: true, rowId, orderId: order.id, changed: true, shipTo: next, onTrip };
}
