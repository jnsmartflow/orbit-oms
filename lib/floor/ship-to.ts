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
import { INVOICE_TRIPS_SELECT, invoiceTripsOf } from "@/lib/order-invoices/trip-refusal";
import { activeOwnCopiesWhere, softRemoveCopies } from "@/lib/ship-to/copies-server";

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
    }
  | { ok: false; status: number; error: string };

const BILL_SELECT = {
  id: true,
  soNumber: true,
  shipToOverride: true,
  shipToOverrideCustomerId: true,
  shipToText: true,
  shipToAreaId: true,
  tripDropId: true,
  tripDrop: { select: { trip: { select: { tripNumber: true } } } },
  // Each invoice row's trip — the partly-on-a-trip message (Phase 5 commit 2).
  invoices: INVOICE_TRIPS_SELECT,
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
export async function loadShipToBill(orderId: number) {
  const read = await readShipToBill(orderId);
  if (!read.ok) return read;
  const order = read.order;
  // On a trip → refused (owner 2026-10-01). Before the target check, as
  // Billing refuses before anything else: the answer does not depend on which
  // site was asked for.
  const onTrip = onTripRefusal({
    tripDropId: order.tripDropId,
    tripNumber: order.tripDrop?.trip.tripNumber ?? null,
    invoiceTrips: invoiceTripsOf(order.invoices),
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
}): Promise<void> {
  await prisma.order_status_logs.create({
    data: {
      orderId: args.orderId,
      fromStage: stateLabel(args.before),
      toStage: stateLabel(args.next) ?? "cleared",
      changedById: args.changedById,
      note: args.note !== undefined ? args.note : args.target.kind === "typed" ? `Ship-to typed: ${args.next.shipToText}` : null,
    },
  });
}

/** Dealer and Reset hide the bill's own Floor copies (they belonged to the
 *  typed ship-to). Billing's SO copies are never touched from here. */
export async function finishShipToCopies(target: ShipToTarget, orderId: number, changedById: number): Promise<void> {
  if (target.kind !== "typed") {
    await softRemoveCopies(activeOwnCopiesWhere("floor", orderId), changedById);
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
}): Promise<ShipToResult> {
  const { orderId, target, changedById } = args;

  const loaded = await loadShipToBill(orderId);
  if (!loaded.ok) return loaded;
  const order = loaded.order;

  const bad = await validateShipToTarget(target);
  if (bad !== null) return { ok: false, ...bad };

  const next = shipToColumns(target);

  // Nothing changed → write NOTHING. Bumping updatedAt here would tell every
  // open board that this bill moved when it did not (CLAUDE_FLOOR §5). All
  // four columns are compared: a typed bill has no dealer id, so comparing the
  // id alone would make Reset a silent no-op on it.
  if (isShipToUnchanged(order, next)) {
    return { ok: true, orderId, ...shownIds(next), changed: false };
  }

  // ONE orders.update. The flag moves with the id / text on this path (the flag
  // CAN legitimately be true with a null id AND null text on legacy rows from
  // mail-order enrichment — CLAUDE_SUPPORT.md §4.18 — only write paths pair them).
  await prisma.orders.update({ where: { id: orderId }, data: next });

  // ONE log row. Same shape Support's route wrote for a dealer, so the audit
  // trail reads identically either side of the retirement.
  await logShipToChange({ orderId, before: order, next, target, changedById, note: args.note });

  await finishShipToCopies(target, orderId, changedById);

  return { ok: true, orderId, ...shownIds(next), changed: true };
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
