import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Manual un-hide (Feature A) — admin-only. Clears the manual-hide fields and
// audit-logs the action. Mirrors the hide route. Sequential awaits, no $transaction.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  const orderId = parseInt(params.id, 10);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid order id" }, { status: 400 });
  }

  const userId = parseInt(session.user.id, 10);

  // ── Load order (404 if missing). Capture current stage for the audit log. ──
  const order = await prisma.orders.findUnique({
    where:  { id: orderId },
    select: { id: true, workflowStage: true },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const fromStage = order.workflowStage;

  // ── Update then log — sequential awaits (CORE §3). ─────────────────────────
  await prisma.orders.update({
    where: { id: orderId },
    data: {
      isHidden:     false,
      hiddenById:   null,
      hiddenReason: null,
      hiddenAt:     null,
    },
  });

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage,
      toStage:     "ORDER_UNHIDDEN",
      changedById: userId,
      note:        "Manual un-hide",
    },
  });

  return NextResponse.json({ ok: true });
}
