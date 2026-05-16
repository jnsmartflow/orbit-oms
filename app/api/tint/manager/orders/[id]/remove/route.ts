import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// Body schema — reason fixed enum, remark required (trimmed 1..500 chars).
const removeSchema = z.object({
  reason: z.enum(["CUSTOMER_CANCELLED", "WRONG_ORDER"]),
  remark: z.string().min(1).max(500),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Permission gate: Admin OR canView on the tint_manager page.
  // Page access = full action authority on that page (OrbitOMS locked model).
  // Excludes any role without TM page access (operations, tint_operator, etc.
  // unless they have been granted canView on tint_manager).
  const isAdmin = session.user.role === "admin";
  if (!isAdmin) {
    const roles = session.user.roles ?? [session.user.role];
    const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
    }
  }

  // ── Validate params + body ──────────────────────────────────────────────────
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

  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { reason } = parsed.data;
  const remarkTrimmed = parsed.data.remark.trim();
  if (remarkTrimmed.length < 1 || remarkTrimmed.length > 500) {
    return NextResponse.json({ ok: false, error: "Remark must be 1..500 chars after trim" }, { status: 400 });
  }

  const userId = parseInt(session.user.id, 10);

  // ── 1. Load order + challan summary ─────────────────────────────────────────
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    select: {
      id:            true,
      obdNumber:     true,
      workflowStage: true,
      isRemoved:     true,
      challan:       { select: { id: true, isVoided: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }
  if (order.isRemoved) {
    return NextResponse.json({ ok: false, error: "Already removed" }, { status: 409 });
  }
  if (order.workflowStage !== "pending_tint_assignment") {
    return NextResponse.json(
      { ok: false, error: "Cannot remove after assignment", stage: order.workflowStage },
      { status: 409 },
    );
  }

  const fromStage = order.workflowStage;
  const now = new Date();

  // ── 2. Soft-remove the order ────────────────────────────────────────────────
  // Sequential awaits — no prisma.$transaction (CORE §3).
  await prisma.orders.update({
    where: { id: orderId },
    data: {
      isRemoved:     true,
      removalReason: reason,
      removalRemark: remarkTrimmed,
      removedAt:     now,
      removedById:   userId,
    },
  });

  // ── 3. Conditionally void the linked challan ────────────────────────────────
  if (order.challan && !order.challan.isVoided) {
    await prisma.delivery_challans.update({
      where: { id: order.challan.id },
      data: {
        isVoided:   true,
        voidReason: reason,
        voidRemark: remarkTrimmed,
        voidedAt:   now,
      },
    });
  }

  // ── 4. Audit log (INSERT-ONLY) ──────────────────────────────────────────────
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage,
      toStage:     "OBD_REMOVED",
      changedById: userId,
      note:        `Reason: ${reason} · Remark: ${remarkTrimmed}`,
    },
  });

  return NextResponse.json({
    ok:            true,
    orderId,
    challanVoided: !!order.challan,
  });
}
