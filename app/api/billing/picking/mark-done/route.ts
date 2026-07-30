import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildBillingPendingWhere } from "@/lib/billing/picking-where";

export const dynamic = "force-dynamic";

/** Safety cap on one batch. The depot invoices ~100 bills on a busy day
 *  (measured 2026-07-30), so this is far above any real selection and exists
 *  only to stop a malformed or hostile request updating the whole table. */
const MAX_BATCH = 200;

/**
 * POST /api/billing/picking/mark-done — the billing operator marks selected
 * bills invoiced. Body: { orderIds: number[] }.
 *
 * EXACTLY ONE WRITE: a single `orders.updateMany` stamping invoicedAt +
 * invoicedById. Bulk is the real shape of this action (the bulk bar selects N
 * bills and marks them together), and updateMany keeps N bills at ONE statement
 * rather than N. Never prisma.$transaction (CORE §3).
 *
 * NO order_status_logs ROW — deliberate and DEFERRED, not an oversight (decided
 * 2026-07-30, v1). invoicedAt/invoicedById already carry the who and the when,
 * and the Done strip reads them back directly. A per-row log would also force a
 * second query: updateMany returns a COUNT, not the ids it touched, so we would
 * have to re-select the affected rows purely to log them — complicating exactly
 * the clean single-statement design this route exists to keep. Revisit only if
 * an audit requirement appears that invoicedAt/ById cannot answer.
 *
 * 🔒 THE PENDING PREDICATE IS PART OF THE WHERE, NOT JUST A PRE-CHECK.
 * buildBillingPendingWhere() is AND-ed into the update itself, so a bill can be
 * marked invoiced ONLY while it genuinely qualifies — approved, uninvoiced, not
 * removed, not hidden. Two things fall out of that, both wanted:
 *   · A crafted request naming any other order id updates NOTHING. There is no
 *     window between a check and the write for the row to change under us,
 *     because there is no separate check.
 *   · It is IDEMPOTENT. A double-tap or a retried request re-runs the same
 *     statement; the first call cleared invoicedAt IS NULL for those rows, so
 *     the second matches 0 and reports updated: 0. No 409 dance needed.
 *
 * `updated` may therefore be less than `requested` — that is information, not
 * an error (someone else marked it, or SAP invoiced it, between render and
 * click). The caller should refresh rather than treat a shortfall as failure.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit, NOT canView — this is a write. A view-only role (tint_manager has
  // mail_orders canView but canEdit false) must not be able to invoice. The
  // read routes (list / marker) stay on canView. Admin bypass lives inside
  // checkAnyPermission, so no wrapper is needed — same shape as
  // app/api/picking/approve/route.ts.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "mail_orders", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Who actually performed this — the real session, never a request body claim.
  const invoicedById = Number(session.user.id);
  if (!Number.isInteger(invoicedById) || invoicedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
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

  // Sequential awaits only, never prisma.$transaction (CORE §3).
  const pendingWhere = await buildBillingPendingWhere();

  const result = await prisma.orders.updateMany({
    where: { AND: [pendingWhere, { id: { in: orderIds } }] },
    data: { invoicedAt: new Date(), invoicedById },
  });

  return NextResponse.json({
    ok: true,
    updated: result.count,
    requested: orderIds.length,
  });
}
