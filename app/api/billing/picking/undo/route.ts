import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Same cap and reasoning as the mark-done route. */
const MAX_BATCH = 200;

/**
 * POST /api/billing/picking/undo — reverse a mark-done. Body: { orderIds }.
 *
 * EXACTLY ONE WRITE: a single `orders.updateMany` clearing invoicedAt +
 * invoicedById back to null, which returns the bill to the Pending list (that
 * list's predicate is invoicedAt IS NULL). Never prisma.$transaction (CORE §3).
 *
 * 🔴 `invoiceNo: null` IS A CORRECTNESS GUARD, NOT A TIDY-UP. DO NOT REMOVE IT.
 * Once SAP fills orders.invoiceNo, undo MUST refuse. Clearing invoicedAt on a
 * row that already has an invoiceNo would make the bill vanish from BOTH lists:
 *   · Pending requires invoiceNo IS NULL — it has one now, so it is excluded.
 *   · Done requires invoicedAt within today — we just nulled it, so excluded.
 * The bill would silently disappear from the operator's screen while remaining
 * perfectly valid in the database. Undo is for "I ticked the wrong row", not
 * for un-invoicing something SAP has already invoiced — that is not reversible
 * from this screen and must not pretend to be.
 *
 * Scoped to TODAY (the same getISTDayRange window the Done strip renders) for
 * the same reason mark-done carries the pending predicate: the update can only
 * touch rows the operator can actually see. A row marked before midnight cannot
 * be undone after it — but it has also already dropped off the Done strip by
 * then, so there is nothing on screen to click.
 *
 * Idempotent for the same reason as mark-done: a second call finds invoicedAt
 * already null, matches 0 rows, and reports updated: 0.
 *
 * NO order_status_logs ROW, for the same deliberate/deferred reason as
 * mark-done — see that route's header. v1 decision, 2026-07-30.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit — undo is a write, same gate as mark-done.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "mail_orders", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderIds?: unknown };

  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    return NextResponse.json(
      { error: "orderIds must be a non-empty array" },
      { status: 400 },
    );
  }
  if (!body.orderIds.every((v) => typeof v === "number" && Number.isInteger(v) && v > 0)) {
    return NextResponse.json(
      { error: "orderIds must all be positive integers" },
      { status: 400 },
    );
  }
  // Array.from around the Set iterator — target < ES2015 (CORE §3).
  const orderIds = Array.from(new Set(body.orderIds as number[]));
  if (orderIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Too many orders in one batch (max ${MAX_BATCH})` },
      { status: 400 },
    );
  }

  const { start, end } = getISTDayRange();

  const result = await prisma.orders.updateMany({
    where: {
      id: { in: orderIds },
      invoicedAt: { gte: start, lt: end },
      isRemoved: false,
      // See the block comment above — this guard is load-bearing.
      invoiceNo: null,
    },
    data: { invoicedAt: null, invoicedById: null },
  });

  return NextResponse.json({
    ok: true,
    updated: result.count,
    requested: orderIds.length,
  });
}
