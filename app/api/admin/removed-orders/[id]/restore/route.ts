import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Body schema — remark optional (free-form audit note, trimmed <= 500 chars).
const restoreSchema = z.object({
  remark: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // ── Auth: Admin only ────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  // ── Validate params + body ──────────────────────────────────────────────────
  const orderId = parseInt(params.id, 10);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid order id" }, { status: 400 });
  }

  // Body is optional — if missing/invalid JSON, treat as empty object.
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = restoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const remarkTrimmed = parsed.data.remark?.trim() ?? "";
  if (remarkTrimmed.length > 500) {
    return NextResponse.json({ ok: false, error: "Remark too long after trim" }, { status: 400 });
  }

  const userId = parseInt(session.user.id, 10);

  // ── 1. Load order + challan summary ─────────────────────────────────────────
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    select: {
      id:            true,
      isRemoved:     true,
      removalReason: true,
      challan:       { select: { id: true, isVoided: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }
  if (!order.isRemoved) {
    return NextResponse.json({ ok: false, error: "Not removed" }, { status: 409 });
  }

  // ── 2. Restore the order — keep removal* fields for audit trail ─────────────
  // Sequential awaits — no prisma.$transaction (CORE §3).
  await prisma.orders.update({
    where: { id: orderId },
    data: {
      isRemoved:    false,
      restoredAt:   new Date(),
      restoredById: userId,
    },
  });

  // ── 3. Conditionally un-void the linked challan ─────────────────────────────
  // Keep voidReason / voidRemark for audit trail; clear only the active flags.
  if (order.challan && order.challan.isVoided) {
    await prisma.delivery_challans.update({
      where: { id: order.challan.id },
      data: {
        isVoided: false,
        voidedAt: null,
      },
    });
  }

  // ── 4. Audit log (INSERT-ONLY) ──────────────────────────────────────────────
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage:   "OBD_REMOVED",
      toStage:     "OBD_RESTORED",
      changedById: userId,
      note:        remarkTrimmed.length > 0 ? remarkTrimmed : "Restored by admin",
    },
  });

  return NextResponse.json({
    ok:               true,
    orderId,
    challanRestored:  !!order.challan,
  });
}
