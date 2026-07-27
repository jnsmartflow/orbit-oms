import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST /api/floor/ship-to — redirect ONE bill's ship-to to a different delivery
// point (CLAUDE_FLOOR.md §4.4). Support retirement step 2/8.
//
// Deliberately NOT a copy of PATCH /api/support/orders/[id]: that route carries
// four unrelated fields (dispatchStatus / priorityLevel / dispatchSlot / ship-to),
// a dispatch_change_queue side effect, and a prisma.$transaction. This one does a
// single job with sequential awaits (CORE §3).
//
// Contract per bill, non-negotiable (CORE §3 + CLAUDE_FLOOR §5/§10):
//   - sequential awaits, never prisma.$transaction
//   - EXACTLY ONE orders.update — a second write fires a false "changed" on every
//     board's MAX(orders.updatedAt) live-sync marker
//   - EXACTLY ONE order_status_logs row
//   - an UNCHANGED value writes NOTHING AT ALL, for the same marker reason
//
// `customerId: null` (clear the redirect) is accepted so a future clear action
// needs no route change. Floor's UI never sends it today — detail-panel.tsx types
// onChangeShipTo as (orderId, customerId: number).

interface Body {
  orderId?: number;
  customerId?: number | null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // session.user.id is a numeric string (lib/auth.ts). Require a real positive
  // integer so an empty/absent id can never become changedById: 0.
  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "orderId is required and must be a positive integer" }, { status: 400 });
  }

  // Absent and null are NOT the same: `undefined` is a malformed body, `null` is
  // an explicit "clear the redirect".
  const customerId = body.customerId === undefined ? undefined : body.customerId;
  if (customerId !== null && (typeof customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0)) {
    return NextResponse.json(
      { error: "customerId must be a positive integer, or null to clear" },
      { status: 400 },
    );
  }

  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: { id: true, shipToOverrideCustomerId: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Validate the target up front rather than letting the FK surface as a 500 —
  // Support's route relied on the database to reject a bad id.
  if (customerId !== null) {
    const customer = await prisma.delivery_point_master.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json(
        { error: `No customer found for id ${customerId}` },
        { status: 400 },
      );
    }
  }

  // Nothing changed → write NOTHING. Bumping updatedAt here would tell every open
  // floor board that this bill moved when it did not (CLAUDE_FLOOR §5).
  if (order.shipToOverrideCustomerId === customerId) {
    return NextResponse.json({ orderId, shipToOverrideCustomerId: customerId, changed: false });
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
      note: null,
    },
  });

  return NextResponse.json({ orderId, shipToOverrideCustomerId: customerId, changed: true });
}
