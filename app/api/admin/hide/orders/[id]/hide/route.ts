import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Manual one-off hide (Feature A) — admin-only. Mirrors the OBD-remove route:
// load order → update → write order_status_logs. Sequential awaits, no $transaction.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: Request,
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { reason } = (body ?? {}) as { reason?: unknown };
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "reason is required" }, { status: 400 });
  }
  const reasonTrimmed = reason.trim();

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
  const now = new Date();

  // ── Update then log — sequential awaits (CORE §3). ─────────────────────────
  await prisma.orders.update({
    where: { id: orderId },
    data: {
      isHidden:     true,
      hiddenById:   userId,
      hiddenReason: reasonTrimmed,
      hiddenAt:     now,
    },
  });

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage,
      toStage:     "ORDER_HIDDEN",
      changedById: userId,
      note:        `Reason: ${reasonTrimmed}`,
    },
  });

  return NextResponse.json({ ok: true });
}
