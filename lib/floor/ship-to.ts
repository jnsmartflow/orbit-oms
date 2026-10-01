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
// Server-only (Prisma).

import { prisma } from "@/lib/prisma";
import { onTripRefusal } from "@/lib/billing/refusal";

export type ShipToResult =
  | { ok: true; orderId: number; shipToOverrideCustomerId: number | null; changed: boolean }
  | { ok: false; status: number; error: string };

/**
 * Redirect ONE bill's ship-to to a different delivery point, or clear the
 * redirect (`customerId: null`). `customerId` must already be validated as a
 * positive integer or null by the caller. `orderId` is not re-checked for tint
 * or any other kind here — a caller that scopes (the Tint Manager) does that
 * before calling.
 */
export async function setShipToOverride(args: {
  orderId: number;
  customerId: number | null;
  changedById: number;
  /** The log row's note. Omitted → null, exactly what Floor and the single-bill
   *  Tint Manager route have always written. Shop delivery passes its own. */
  note?: string | null;
}): Promise<ShipToResult> {
  const { orderId, customerId, changedById, note = null } = args;

  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: {
      id: true,
      shipToOverrideCustomerId: true,
      tripDropId: true,
      tripDrop: { select: { trip: { select: { tripNumber: true } } } },
    },
  });
  if (!order) {
    return { ok: false, status: 404, error: "Order not found" };
  }

  // On a trip → refused (owner 2026-10-01). Before the target check, as
  // Billing refuses before anything else: the answer does not depend on which
  // site was asked for.
  const onTrip = onTripRefusal({
    tripDropId: order.tripDropId,
    tripNumber: order.tripDrop?.trip.tripNumber ?? null,
  });
  if (onTrip !== null) {
    return { ok: false, status: 409, error: onTrip };
  }

  // Validate the target up front rather than letting the FK surface as a 500 —
  // Support's route relied on the database to reject a bad id.
  if (customerId !== null) {
    const customer = await prisma.delivery_point_master.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      return { ok: false, status: 400, error: `No customer found for id ${customerId}` };
    }
  }

  // Nothing changed → write NOTHING. Bumping updatedAt here would tell every open
  // board that this bill moved when it did not (CLAUDE_FLOOR §5).
  if (order.shipToOverrideCustomerId === customerId) {
    return { ok: true, orderId, shipToOverrideCustomerId: customerId, changed: false };
  }

  // ONE orders.update. `shipToOverride` is the legacy boolean flag; it is kept in
  // step with the id so the two can never disagree (CLAUDE_SUPPORT.md §4.18 —
  // note the flag CAN legitimately be true with a null id from mail-order
  // enrichment, so only this write path pairs them).
  await prisma.orders.update({
    where: { id: orderId },
    data: {
      shipToOverrideCustomerId: customerId,
      shipToOverride: customerId !== null,
    },
  });

  // ONE log row. Same shape Support's route wrote, so the audit trail reads
  // identically either side of the retirement.
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.shipToOverrideCustomerId !== null ? String(order.shipToOverrideCustomerId) : null,
      toStage: customerId !== null ? String(customerId) : "cleared",
      changedById,
      note,
    },
  });

  return { ok: true, orderId, shipToOverrideCustomerId: customerId, changed: true };
}

/** One search hit — the bare-array element the detail panel reads. */
export interface ShipToSearchHit {
  id: number;
  customerName: string;
  area: string | null;
}

/**
 * Customer lookup for a "Change ship-to" picker. READ-ONLY. Under 2 characters
 * → []. Active delivery points whose name contains `q`, case-insensitive,
 * first 8 by name.
 */
export async function searchShipTo(rawQ: string | null): Promise<ShipToSearchHit[]> {
  const q = rawQ?.trim() ?? "";
  if (q.length < 2) return [];

  const matches = await prisma.delivery_point_master.findMany({
    where: {
      customerName: { contains: q, mode: "insensitive" },
      isActive: true,
    },
    select: { id: true, customerName: true, area: { select: { name: true } } },
    take: 8,
    orderBy: { customerName: "asc" },
  });

  return matches.map((m) => ({ id: m.id, customerName: m.customerName, area: m.area?.name ?? null }));
}
