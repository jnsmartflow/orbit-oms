// lib/floor/ship-to.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE OWNER FOR THE SHIP-TO REDIRECT WRITE AND ITS SEARCH
// ═══════════════════════════════════════════════════════════════════════════
//
// Extracted from app/api/floor/ship-to/route.ts and
// app/api/floor/ship-to-search/route.ts (2026-10-01, Tint Manager tabs build
// step 2 — docs/prompts/drafts/code-discovery-2026-10-01-tint-manager-build-plan.md
// §C). Floor's routes and the Tint Manager's (app/api/tint/manager/ship-to,
// /ship-to-search) call these; each route keeps only its own gate.
//
// Deliberately NOT a copy of PATCH /api/support/orders/[id]: that route carried
// four unrelated fields (dispatchStatus / priorityLevel / dispatchSlot / ship-to),
// a dispatch_change_queue side effect, and a prisma.$transaction. This does a
// single job with sequential awaits (CORE §3).
//
// Contract per bill, non-negotiable (CORE §3 + CLAUDE_FLOOR §5/§10):
//   - sequential awaits, never prisma.$transaction
//   - EXACTLY ONE orders.update — a second write fires a false "changed" on every
//     board's MAX(orders.updatedAt) live-sync marker
//   - EXACTLY ONE order_status_logs row
//   - an UNCHANGED value writes NOTHING AT ALL, for the same marker reason
//
// 🔴 ON A TRIP → REFUSED, ON EVERY DESK (owner, 2026-10-01 — plan §J-2). A
// redirect after the bill is on a stop leaves its trip drop pointing at the old
// site. The refusal is Billing's own on-a-trip rule and wording
// (lib/billing/refusal.ts onTripRefusal), so Floor, the Tint Manager and
// Billing all say the same thing. It is the ONLY behaviour Floor's route gained
// in the extraction. Billing's own actions route does not call this function
// (it writes per SO) and applies the same rule through billingRefusal.
//
// 🔴 TYPED SHIP-TO (v27.73, 2026-10-19 — design web-update-2026-10-19-ship-to-
// freetext.md). A target is a dealer, a typed name + area, or Reset. Last save
// wins: each kind clears the others' columns (shipToColumns). "Unchanged"
// compares all four columns. setShipToOverride stays as the dealer-or-clear
// wrapper its three older callers use.
//
// Server-only (Prisma).

import { prisma } from "@/lib/prisma";
import { onTripRefusal } from "@/lib/billing/refusal";
import { INVOICE_TRIPS_SELECT, invoiceTripsOf, type InvoiceTrip } from "@/lib/order-invoices/trip-refusal";
import { activeOwnCopiesWhere, softRemoveCopies } from "@/lib/ship-to/copies-server";
import { isInheriting } from "@/lib/ship-to/effective";

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 PER-PART SHIP-TO (v27.81, owner 2026-11-19 — reverses Model A for ship-to)
// ═══════════════════════════════════════════════════════════════════════════
// The writes HERE stay OBD-WIDE (orders). A part with its OWN ship-to
// (order_invoices."shipToOverride" not NULL) does not follow them (rule 3), so:
//   · the on-a-trip refusal counts only the rows that MOVE — the inheriting
//     ones (invoiceTripsThatMove). With every part NULL that is every row,
//     i.e. exactly today's refusal.
//   · the log note says how many parts keep their own ship-to.
//   · allParts (owner Q1): writes orders AND sets every part back to NULL —
//     every row moves, so its refusal counts ALL rows (today's input).
// A PART's own change is lib/order-invoices/ship-to.ts setPartShipTo.

/** What a ship-to write points the bill at (v27.73 free-text ship-to). */
export type ShipToTarget =
  | { kind: "dealer"; customerId: number }
  /** A typed name or "As per challan" — area REQUIRED (chk_orders_ship_to_text_area). */
  | { kind: "typed"; text: string; areaId: number }
  | { kind: "reset" };

export type ShipToResult =
  | {
      ok: true;
      orderId: number;
      shipToOverrideCustomerId: number | null;
      shipToText: string | null;
      shipToAreaId: number | null;
      changed: boolean;
      /** v27.81 — parts that keep their own ship-to (did not follow); 0 on an unsplit bill. */
      keptParts?: number;
      /** v27.81 allParts — parts set back to "same as the bill". */
      partsReset?: number;
    }
  | { ok: false; status: number; error: string };

/**
 * INVOICE_TRIPS_SELECT plus each row's id and ship-to flag (v27.81): the trip
 * refusal is built from the rows that MOVE (invoiceTripsThatMove). Shared with
 * lib/billing/ship-to-write.ts.
 */
export const MOVING_INVOICES_SELECT = {
  orderBy: INVOICE_TRIPS_SELECT.orderBy,
  select: { ...INVOICE_TRIPS_SELECT.select, id: true, shipToOverride: true },
} as const;

/**
 * Rule 3's refusal input: the OBD's invoice rows with every row that has its
 * OWN ship-to shown as on no trip — it does not move, so it cannot block. The
 * row COUNT is kept (a split stays a split: the sentence still says "1 of 2
 * invoices on L-02", and never falls back to the OBD's derived stop). Every
 * part NULL → identical to invoiceTripsOf.
 */
export function invoiceTripsThatMove(
  rows: ReadonlyArray<{
    tripDropId: number | null;
    tripDrop: { trip: { tripNumber: string } } | null;
    shipToOverride: boolean | null;
  }>,
): InvoiceTrip[] {
  return invoiceTripsOf(rows).map((t, i) => (isInheriting(rows[i]) ? t : { tripDropId: null, tripNumber: null }));
}

/** How many of these rows keep their own ship-to (0 on an unsplit bill). */
export function ownShipToCount(rows: ReadonlyArray<{ shipToOverride: boolean | null }>): number {
  return rows.length < 2 ? 0 : rows.filter((r) => !isInheriting(r)).length;
}

/** The "n part(s) keep their own ship-to" suffix, or "" when none does. */
export function keptPartsText(n: number): string {
  return n === 0 ? "" : `${n} part${n === 1 ? "" : "s"} keep${n === 1 ? "s" : ""} ${n === 1 ? "its" : "their"} own ship-to`;
}

const BILL_SELECT = {
  id: true,
  soNumber: true,
  shipToOverride: true,
  shipToOverrideCustomerId: true,
  shipToText: true,
  shipToAreaId: true,
  tripDropId: true,
  tripDrop: { select: { trip: { select: { tripNumber: true } } } },
  // Each invoice row's trip — the partly-on-a-trip message (Phase 5 commit 2);
  // + its id and ship-to flag (v27.81 — only inheriting rows can block).
  invoices: MOVING_INVOICES_SELECT,
} as const;

/**
 * THE CHECK, without the trip rule (2026-10-24 split): one live bill, or 404.
 * Shared by loadShipToBill below and the trip path
 * (lib/trips/ship-to-on-trip.ts), which moves an on-trip bill instead of
 * refusing it — so both paths find "the bill" by the same rule.
 */
export async function readShipToBill(orderId: number) {
  const order = await prisma.orders.findFirst({ where: { id: orderId, isRemoved: false }, select: BILL_SELECT });
  if (!order) {
    return { ok: false as const, status: 404, error: "Order not found" };
  }
  return { ok: true as const, order };
}

/**
 * Read ONE live bill and apply the on-a-trip refusal. Exported so Floor's
 * multipart save can refuse BEFORE it uploads any copy; setShipTo re-runs it.
 * Every caller but the trip path keeps this refusal (owner, 2026-10-24).
 */
export async function loadShipToBill(orderId: number, opts: { allParts?: boolean } = {}) {
  const read = await readShipToBill(orderId);
  if (!read.ok) return read;
  const order = read.order;
  // On a trip → refused (owner 2026-10-01). Before the target check, as
  // Billing refuses before anything else: the answer does not depend on which
  // site was asked for. v27.81: only rows that MOVE can block — the inheriting
  // ones; allParts moves every row, so every row counts (today's input).
  const onTrip = onTripRefusal({
    tripDropId: order.tripDropId,
    tripNumber: order.tripDrop?.trip.tripNumber ?? null,
    invoiceTrips: opts.allParts === true ? invoiceTripsOf(order.invoices) : invoiceTripsThatMove(order.invoices),
  });
  if (onTrip !== null) {
    return { ok: false as const, status: 409, error: onTrip };
  }
  return { ok: true as const, order };
}

/**
 * Check a target against the masters — a dealer that exists, an area that is
 * active. Returns the refusal, or null. Up front rather than letting the FK
 * surface as a 500 (Support's route relied on the database to reject a bad id).
 */
export async function validateShipToTarget(target: ShipToTarget): Promise<{ status: number; error: string } | null> {
  if (target.kind === "dealer") {
    const customer = await prisma.delivery_point_master.findUnique({
      where: { id: target.customerId },
      select: { id: true },
    });
    if (!customer) return { status: 400, error: `No customer found for id ${target.customerId}` };
  } else if (target.kind === "typed") {
    if (target.text.trim() === "") return { status: 400, error: "Ship-to name is blank" };
    const area = await prisma.area_master.findFirst({ where: { id: target.areaId, isActive: true }, select: { id: true } });
    if (!area) return { status: 400, error: "Unknown or inactive area" };
  }
  return null;
}

/**
 * The four ship-to columns a target writes. LAST SAVE WINS (design §2): a typed
 * name clears the dealer, a dealer clears the typed name, Reset clears both.
 * The flag is true for both kinds of redirect. Shared with Billing's write
 * (lib/billing/ship-to-write.ts) so the two desks cannot drift.
 */
export function shipToColumns(target: ShipToTarget): {
  shipToOverride: boolean;
  shipToOverrideCustomerId: number | null;
  shipToText: string | null;
  shipToAreaId: number | null;
} {
  if (target.kind === "dealer") {
    return { shipToOverride: true, shipToOverrideCustomerId: target.customerId, shipToText: null, shipToAreaId: null };
  }
  if (target.kind === "typed") {
    return { shipToOverride: true, shipToOverrideCustomerId: null, shipToText: target.text.trim(), shipToAreaId: target.areaId };
  }
  return { shipToOverride: false, shipToOverrideCustomerId: null, shipToText: null, shipToAreaId: null };
}

/** All four ship-to columns equal → nothing to write (not even updatedAt). */
export function isShipToUnchanged(
  order: { shipToOverride: boolean; shipToOverrideCustomerId: number | null; shipToText: string | null; shipToAreaId: number | null },
  next: ReturnType<typeof shipToColumns>,
): boolean {
  return (
    order.shipToOverride === next.shipToOverride &&
    order.shipToOverrideCustomerId === next.shipToOverrideCustomerId &&
    order.shipToText === next.shipToText &&
    order.shipToAreaId === next.shipToAreaId
  );
}

/**
 * The ONE order_status_logs row a ship-to change writes — same shape Support's
 * route wrote for a dealer. Shared with the trip path so both log alike.
 */
export async function logShipToChange(args: {
  orderId: number;
  before: { shipToOverrideCustomerId: number | null; shipToText: string | null };
  next: ReturnType<typeof shipToColumns>;
  target: ShipToTarget;
  changedById: number;
  note?: string | null;
  /** v27.81 — WHICH PART(S) (order_status_logs."orderInvoiceIds", v27.72): a
   *  part's own change names its row; the per-part Activity filters on it
   *  (lib/floor/detail-scope.ts activityForInvoice). Omitted → [] (whole bill). */
  orderInvoiceIds?: number[];
  /** v27.81 — parts that did NOT follow this OBD-wide change; > 0 appends
   *  "n part(s) keep their own ship-to" to the note. */
  keptParts?: number;
  /** v27.81 — a part's from / to ("inherit" / "site" / dealer id / "typed"),
   *  computed by the part writer. Omitted → today's stateLabel pair. */
  labels?: { from: string | null; to: string };
}): Promise<void> {
  const base = args.note !== undefined ? args.note : args.target.kind === "typed" ? `Ship-to typed: ${args.next.shipToText}` : null;
  const kept = keptPartsText(args.keptParts ?? 0);
  await prisma.order_status_logs.create({
    data: {
      orderId: args.orderId,
      fromStage: args.labels !== undefined ? args.labels.from : stateLabel(args.before),
      toStage: args.labels !== undefined ? args.labels.to : (stateLabel(args.next) ?? "cleared"),
      changedById: args.changedById,
      note: kept === "" ? base : base === null || base === "" ? kept : `${base} · ${kept}`,
      ...(args.orderInvoiceIds !== undefined && args.orderInvoiceIds.length > 0 ? { orderInvoiceIds: args.orderInvoiceIds } : {}),
    },
  });
}

/** Dealer and Reset hide the bill's own Floor copies (they belonged to the
 *  typed ship-to). Billing's SO copies are never touched from here. v27.81:
 *  the OBD's OWN copies only — a part's copies belong to that part's own
 *  typed ship-to and go only with it (lib/order-invoices/ship-to.ts). */
export async function finishShipToCopies(target: ShipToTarget, orderId: number, changedById: number): Promise<void> {
  if (target.kind !== "typed") {
    await softRemoveCopies(activeOwnCopiesWhere("floor", orderId, null), changedById);
  }
}

/** The log's from / to value: the dealer id (as before), "typed", or null. */
function stateLabel(s: { shipToOverrideCustomerId: number | null; shipToText: string | null }): string | null {
  if (s.shipToOverrideCustomerId !== null) return String(s.shipToOverrideCustomerId);
  if (s.shipToText !== null) return "typed";
  return null;
}

/**
 * Point ONE bill's ship-to at a dealer, a typed name, or back at its own site.
 * `target` must already be shape-checked by the caller; the masters are checked
 * here. `orderId` is not re-checked for tint or any other kind — a caller that
 * scopes (the Tint Manager) does that before calling.
 *
 * Dealer and Reset also SOFT-REMOVE the bill's own Floor copies (they belonged
 * to the typed ship-to). Billing's SO copies are never touched from here.
 */
export async function setShipTo(args: {
  orderId: number;
  target: ShipToTarget;
  changedById: number;
  /** The log row's note. Omitted → null for dealer / reset, exactly what Floor
   *  and the single-bill Tint Manager route have always written; a typed save
   *  notes its text. Shop delivery passes its own. */
  note?: string | null;
  /**
   * v27.81, owner Q1 — "Apply to all parts": also set EVERY part of the OBD
   * back to "same as the bill" (its four columns NULL), so the whole bill goes
   * to the new ship-to. Every row moves, so the trip refusal counts every row.
   * Omitted / false → rule 3: parts with their own ship-to keep it.
   */
  allParts?: boolean;
}): Promise<ShipToResult> {
  const { orderId, target, changedById } = args;
  const allParts = args.allParts === true;

  const loaded = await loadShipToBill(orderId, { allParts });
  if (!loaded.ok) return loaded;
  const order = loaded.order;

  const bad = await validateShipToTarget(target);
  if (bad !== null) return { ok: false, ...bad };

  const next = shipToColumns(target);
  const ownRows = order.invoices.length < 2 ? [] : order.invoices.filter((r) => !isInheriting(r));
  const resetIds = allParts ? ownRows.map((r) => r.id) : [];
  const keptParts = allParts ? 0 : ownRows.length;
  const obdChanged = !isShipToUnchanged(order, next);

  // Nothing changed → write NOTHING. Bumping updatedAt here would tell every
  // open board that this bill moved when it did not (CLAUDE_FLOOR §5). All
  // four columns are compared: a typed bill has no dealer id, so comparing the
  // id alone would make Reset a silent no-op on it. (allParts: also nothing to
  // reset.)
  if (!obdChanged && resetIds.length === 0) {
    return { ok: true, orderId, ...shownIds(next), changed: false, keptParts };
  }

  // ONE orders.update. The flag moves with the id / text on this path (the flag
  // CAN legitimately be true with a null id AND null text on legacy rows from
  // mail-order enrichment — CLAUDE_SUPPORT.md §4.18 — only write paths pair them).
  // allParts with the OBD already right writes no orders row: the parts' own
  // write below fires the order_invoices live trigger.
  if (obdChanged) await prisma.orders.update({ where: { id: orderId }, data: next });

  // allParts: ONE statement puts every part back on the bill's ship-to
  // (re-stated in the where: only rows that still have their own).
  if (resetIds.length > 0) {
    await prisma.order_invoices.updateMany({
      where: { id: { in: resetIds }, orderId, shipToOverride: { not: null } },
      data: { shipToOverride: null, shipToOverrideCustomerId: null, shipToText: null, shipToAreaId: null },
    });
  }

  // ONE log row. Same shape Support's route wrote for a dealer, so the audit
  // trail reads identically either side of the retirement.
  const allPartsNote =
    resetIds.length > 0
      ? `Ship-to applied to all parts — ${resetIds.length} part${resetIds.length === 1 ? "" : "s"} back to the bill's ship-to`
      : null;
  const baseNote = args.note !== undefined ? args.note : target.kind === "typed" ? `Ship-to typed: ${next.shipToText}` : null;
  await logShipToChange({
    orderId,
    before: order,
    next,
    target,
    changedById,
    note: allPartsNote === null ? args.note : baseNote === null ? allPartsNote : `${baseNote} · ${allPartsNote}`,
    keptParts,
    orderInvoiceIds: resetIds.length > 0 ? resetIds : undefined,
  });

  await finishShipToCopies(target, orderId, changedById);
  // The reset parts' own copies belonged to their own typed ship-to.
  for (const rowId of resetIds) {
    await softRemoveCopies(activeOwnCopiesWhere("floor", orderId, rowId), changedById);
  }

  return { ok: true, orderId, ...shownIds(next), changed: true, keptParts, ...(allParts ? { partsReset: resetIds.length } : {}) };
}

function shownIds(next: ReturnType<typeof shipToColumns>) {
  return {
    shipToOverrideCustomerId: next.shipToOverrideCustomerId,
    shipToText: next.shipToText,
    shipToAreaId: next.shipToAreaId,
  };
}

/**
 * The dealer-or-clear form every caller used before v27.73 — Floor's JSON
 * route and both Tint Manager routes. `customerId: null` = Reset, which now
 * also clears a typed name and hides the bill's own copies.
 */
export async function setShipToOverride(args: {
  orderId: number;
  customerId: number | null;
  changedById: number;
  note?: string | null;
}): Promise<ShipToResult> {
  const { customerId, ...rest } = args;
  return setShipTo({ ...rest, target: customerId === null ? { kind: "reset" } : { kind: "dealer", customerId } });
}

/** One search hit — the bare-array element the detail panel reads. */
export interface ShipToSearchHit {
  id: number;
  customerName: string;
  area: string | null;
  /** Added 2026-10-19 for the shared ship-to modal (tells two same-name ORB
   *  customers apart). The Tint Manager editor ignores both. */
  customerCode: string | null;
  deliveryType: string | null;
}

/**
 * Customer lookup for a "Change ship-to" picker. READ-ONLY. Under 2 characters
 * → []. Active delivery points whose name OR code contains `q`,
 * case-insensitive (code added 2026-10-05 so an Orbit customer's ORB- code can
 * be typed), first `take` by name — 8 by default (the Tint Manager's inline
 * editor); Floor's route asks for 20 since the shared ship-to modal's taller
 * list (2026-10-19), the same cap as Billing's search.
 */
export async function searchShipTo(rawQ: string | null, take = 8): Promise<ShipToSearchHit[]> {
  const q = rawQ?.trim() ?? "";
  if (q.length < 2) return [];

  const matches = await prisma.delivery_point_master.findMany({
    where: {
      OR: [
        { customerName: { contains: q, mode: "insensitive" } },
        { customerCode: { contains: q, mode: "insensitive" } },
      ],
      isActive: true,
    },
    select: {
      id: true,
      customerName: true,
      customerCode: true,
      area: { select: { name: true, deliveryType: { select: { name: true } } } },
    },
    take,
    orderBy: { customerName: "asc" },
  });

  return matches.map((m) => ({
    id: m.id,
    customerName: m.customerName,
    area: m.area?.name ?? null,
    customerCode: m.customerCode,
    deliveryType: m.area?.deliveryType?.name ?? null,
  }));
}
