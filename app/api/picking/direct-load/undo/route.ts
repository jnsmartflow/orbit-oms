import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PICK_CHECKED, SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import { DIRECT_LOAD_UNDO_NOTE } from "@/lib/picking/direct-load";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/direct-load/undo — take back a Direct Loading. Body
 * `{ orderId }`. Allowed any time until the bill is invoiced (owner,
 * 2026-10-03): directLoadedAt set, stage pick_checked, invoiceNo AND invoicedAt
 * both null, not removed. Otherwise 409 with a plain reason.
 *
 * The bill goes back to pending_picking — the Assign tab, waiting for a picker.
 * NOT back to the picker who held it before the press: his assignment row was
 * deleted then, and re-creating it would hand him a bill nobody told him about.
 * No push.
 *
 * ONE guarded orders.updateMany (the same five conditions, so a race with
 * billing's mark-done or SAP's invoice cannot slip past the read), then ONE
 * order_status_logs row. Sequential, never prisma.$transaction (CORE §3).
 *
 * ⚠ The trip pointer (orders.tripDropId) is NOT touched — no picking path
 * writes trip membership (CLAUDE_FLOOR_TRIPS.md §13).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: unknown };
  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      workflowStage: true,
      isRemoved: true,
      invoiceNo: true,
      invoicedAt: true,
      directLoadedAt: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.isRemoved) {
    return NextResponse.json({ error: "This bill has been removed." }, { status: 409 });
  }
  if (order.directLoadedAt === null) {
    return NextResponse.json({ error: "This bill was not direct loaded." }, { status: 409 });
  }
  if (order.workflowStage !== PICK_CHECKED) {
    return NextResponse.json({ error: `This bill has moved on (${order.workflowStage}).` }, { status: 409 });
  }
  if (order.invoiceNo !== null || order.invoicedAt !== null) {
    return NextResponse.json({ error: "This bill is already invoiced — it cannot be undone." }, { status: 409 });
  }

  const res = await prisma.orders.updateMany({
    where: {
      id: orderId,
      workflowStage: PICK_CHECKED,
      isRemoved: false,
      invoiceNo: null,
      invoicedAt: null,
      directLoadedAt: { not: null },
    },
    data: { workflowStage: SUPPORT_DONE_OUTPUT, directLoadedAt: null, directLoadedById: null },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "Already changed — refresh." }, { status: 409 });
  }

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: PICK_CHECKED,
      toStage: SUPPORT_DONE_OUTPUT,
      changedById: userId,
      note: DIRECT_LOAD_UNDO_NOTE,
    },
  });

  return NextResponse.json({ ok: true, orderId });
}
