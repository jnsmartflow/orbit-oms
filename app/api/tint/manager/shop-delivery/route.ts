import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setShipToOverride } from "@/lib/floor/ship-to";
import { checkTintAction, tintBillRefusal } from "@/lib/tint/manager-bill";
import { effectiveCustomerId } from "@/lib/trips/drop-key";

export const dynamic = "force-dynamic";

// POST /api/tint/manager/shop-delivery — "Shop delivery" (owner, 2026-10-01):
// every selected TINT bill's ship-to becomes its own BILL-TO dealer. Tint
// Manager only — Floor and Billing have no such action.
//
// Body: { orderIds: number[] }
// Response: { done: number[], failed: [{ orderId, error }], skipped: [{ orderId, reason }] },
// 422 when nothing landed and something failed (Floor's { done, failed } rule).
//
// Gate: tint_manager canEdit AND tint_shop_delivery canEdit — its OWN tick,
// independent of tint_ship_to (owner).
//
// The dealer: the bill's latest import_raw_summary row → billToCustomerId (SAP's
// sold-to code) → delivery_point_master.customerCode (@unique). The same
// "latest raw row wins" read as lib/floor/order-detail.ts and
// lib/reports/trip-detail-data.ts. Gate check 2026-10-01: 177 of 187 open tint
// bills resolve; 0 OBDs carry two different bill-to codes across raw rows.
//
// The write is lib/floor/ship-to.ts setShipToOverride — the SAME function
// Floor's and the Tint Manager's single-bill routes call — so the on-a-trip
// refusal (Billing's words), the no-op skip and the one-update + one-log
// contract are inherited, not re-implemented. Sequential awaits, no $transaction.
// When the dealer IS the bill's own delivery point, the redirect is CLEARED
// (null) rather than pointed at the bill's own site: the effective ship-to is
// the dealer either way, and no redirect flag is left set to nowhere new.
// `orders.customerId` never changes (plan decision 12).

const NOTE = "Shop delivery — ship to dealer";

interface Body {
  orderIds?: number[];
}

interface Failed {
  orderId: number;
  error: string;
}

interface Skipped {
  orderId: number;
  reason: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, "shop-delivery");
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });

  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const orderIds = body.orderIds;
  if (!Array.isArray(orderIds) || orderIds.length === 0 || !orderIds.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array of positive integers" }, { status: 400 });
  }

  const done: number[] = [];
  const failed: Failed[] = [];
  const skipped: Skipped[] = [];

  for (const orderId of orderIds) {
    try {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { obdNumber: true, orderType: true, isRemoved: true, customerId: true, shipToOverrideCustomerId: true, shipToCustomerId: true },
      });
      const notTint = tintBillRefusal(order);
      if (notTint !== null || order === null) {
        failed.push({ orderId, error: notTint ?? "Order not found" });
        continue;
      }

      // Bill-to dealer code — latest raw summary row wins.
      const summary = await prisma.import_raw_summary.findFirst({
        where: { obdNumber: order.obdNumber },
        orderBy: { createdAt: "desc" },
        select: { billToCustomerId: true },
      });
      const code = summary?.billToCustomerId?.trim() ?? "";
      const dealer = code === ""
        ? null
        : await prisma.delivery_point_master.findUnique({ where: { customerCode: code }, select: { id: true } });
      if (dealer === null) {
        failed.push({ orderId, error: "Dealer not in customer master" });
        continue;
      }

      if (effectiveCustomerId(order) === dealer.id) {
        skipped.push({ orderId, reason: "Already the dealer's shop" });
        continue;
      }

      const r = await setShipToOverride({
        orderId,
        customerId: dealer.id === order.customerId ? null : dealer.id,
        changedById,
        note: NOTE,
      });
      if (!r.ok) failed.push({ orderId, error: r.error });
      else if (!r.changed) skipped.push({ orderId, reason: "Already the dealer's shop" });
      else done.push(orderId);
    } catch (err) {
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  const status = done.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ done, failed, skipped }, { status });
}
