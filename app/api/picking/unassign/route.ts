import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT, PICK_ASSIGNED } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit, NOT canView (corrected 2026-07-20) — supervisor action. Full
  // reasoning at the identical gate in app/api/picking/assign/route.ts.
  // Admin bypass lives inside checkAnyPermission, so no wrapper is needed.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Same non-empty-string guard as assign/route.ts — Number.isFinite alone
  // would let an empty session id ("") silently become 0.
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: number };
  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId)) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // a. Fetch the order.
  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: { id: true, workflowStage: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // b. Must currently be assigned.
  if (order.workflowStage !== PICK_ASSIGNED) {
    return NextResponse.json({ error: "Order is not assigned." }, { status: 409 });
  }

  // c. FIRST write — revert the stage. Mirrors the undo-dispatch pattern
  // (app/api/support/orders/[id]/undo-dispatch/route.ts): if the SECOND
  // write (d, below) fails, the bill is already back in the queue — visible,
  // mutable, with a stale pick_assignments row left over. That's a fixable
  // leftover, not a lost order. Reversed, a failed second write would strand
  // the order at PICK_ASSIGNED with its assignment record already gone —
  // locked, with no trace of who had it. Never reverse this order.
  await prisma.orders.update({
    where: { id: orderId },
    data: { workflowStage: SUPPORT_DONE_OUTPUT },
  });

  // d. SECOND write — delete the assignment row. deleteMany (not delete) so
  // a missing row is NOT an error — undo must work even if the row was
  // already cleared some other way; log and continue rather than throw.
  const deleted = await prisma.pick_assignments.deleteMany({ where: { orderId } });
  if (deleted.count === 0) {
    console.warn(`[picking/unassign] No pick_assignments row found for order ${orderId} during undo.`);
  }

  // e. Audit log.
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: PICK_ASSIGNED,
      toStage: SUPPORT_DONE_OUTPUT,
      changedById: userId,
      note: "Unassigned (test)",
    },
  });

  return NextResponse.json({ ok: true, orderId });
}
