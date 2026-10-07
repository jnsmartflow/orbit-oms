import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { challanCancelRefusal, releaseChallanOnCancel } from "@/lib/challan-orders/cancel-guard";
import { isSuperuser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkTintAction } from "@/lib/tint/manager-bill";

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

  // Permission gate: Admin OR canEdit on the tint_manager page.
  //
  // ⚠ CORRECTED 2026-09-06. This comment used to read "Page access = full action
  // authority on that page (OrbitOMS locked model)" and the check below asked for
  // canView. THAT MODEL WAS RETIRED ON 2026-09-04: access is now one row per
  // (person, page) in user_page_access, and canView and canEdit are separate
  // ticks an admin sets independently on /admin/access (CORE §5).
  //
  // Under the old model the claim was self-consistent — a role either had the
  // page or it did not. Under per-user ticks it is false, and it was load-bearing:
  // this route soft-removes an OBD from the board and voids its challan, so a
  // single view-only tick would have handed that to a bystander. The two holder
  // sets happened to be identical on 2026-09-06, so no live grant was affected.
  //
  // + tint_cancel canEdit (2026-10-01, Tint Manager tabs build step 2 — plan §B):
  // Remove OBD is one of the four buttons on the tint_cancel tick, beside
  // tint_manager canEdit — lib/tint/manager-bill.ts checkTintAction("remove").
  // Same 403 shape as before ({ ok: false, error }).
  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, "remove");
  if (refused !== null) {
    return NextResponse.json({ ok: false, error: refused }, { status: 403 });
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
      isChallanOrder: true,
      challan:       { select: { id: true, isVoided: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }
  if (order.isRemoved) {
    return NextResponse.json({ ok: false, error: "Already removed" }, { status: 409 });
  }
  // A challan (ORB) order: admin only (S5-4, 2026-10-07) — lib/challan-orders/cancel-guard.ts.
  // (An ORB order is non-tint and never reaches pending_tint_assignment, so the
  // stage rule below refuses it anyway; this states the S5-4 rule where it applies.)
  const challanRefusal = challanCancelRefusal(order.isChallanOrder, isSuperuser(session));
  if (challanRefusal !== null) {
    return NextResponse.json({ ok: false, error: challanRefusal }, { status: 403 });
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
  // S5-3 + S6-4 — a removed ORB order frees its SOs and returns its linked bills to the floor —
  // ORB orders only; the bill being cancelled here keeps its one update + one log.
  if (order.isChallanOrder) await releaseChallanOnCancel(orderId, userId);

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
