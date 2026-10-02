import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setShipToOverride } from "@/lib/floor/ship-to";
import { checkTintAction, tintManagerBillRefusal } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

// POST /api/tint/manager/ship-to — redirect ONE tint bill's ship-to, or clear
// it (2026-10-01, tabs build step 2 — plan §C).
//
// Body: { orderId: number, customerId: number | null }  (null clears)
// Response: Floor's exactly — { orderId, shipToOverrideCustomerId, changed }.
//
// Base bills too (non-tint SMU 74/77 — Base tab, owner 2026-10-01 §I), via
// tintManagerBillRefusal(order, "ship-to").
//
// Gate: tint_manager canEdit AND tint_ship_to canEdit. Tint bills only, then
// lib/floor/ship-to.ts setShipToOverride — the SAME write Floor's route calls,
// which also refuses a bill ON A TRIP (409, Billing's wording, owner 2026-10-01).
// `orders.customerId` never changes: TI and sampling stay on the original site
// (plan decision 12).

interface Body {
  orderId?: number;
  customerId?: number | null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, "ship-to");
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });

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
  const customerId = body.customerId;
  if (customerId !== null && (typeof customerId !== "number" || !Number.isInteger(customerId) || customerId <= 0)) {
    return NextResponse.json(
      { error: "customerId must be a positive integer, or null to clear" },
      { status: 400 },
    );
  }

  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    select: { orderType: true, smu: true, isRemoved: true },
  });
  const notTint = tintManagerBillRefusal(order, "ship-to");
  if (notTint !== null) {
    return NextResponse.json({ error: notTint }, { status: order === null || order.isRemoved ? 404 : 409 });
  }

  const r = await setShipToOverride({ orderId, customerId, changedById });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({ orderId: r.orderId, shipToOverrideCustomerId: r.shipToOverrideCustomerId, changed: r.changed });
}
