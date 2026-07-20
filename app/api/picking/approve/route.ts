import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PICK_DONE, PICK_CHECKED } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/approve — supervisor approves a checked bill. Single-order,
 * same shape as app/api/picking/done/route.ts. Body: { orderId } only — unlike
 * done/route.ts there is no pickerId to verify ownership against; checkedById
 * is always the real logged-in supervisor (session.user.id), never trusted
 * from the request body. See docs/prompts/drafts/code-discovery-2026-07-17-picking-stage2.md.
 */
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

  // Who actually performed this — the real session, never a request body claim.
  const checkedById = Number(session.user.id);
  if (!Number.isInteger(checkedById) || checkedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: number };

  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId)) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: { id: true, workflowStage: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Stops a double-tap (or a retried request) from writing twice: the first
  // successful call advances workflowStage to PICK_CHECKED, so a second call
  // finds it no longer PICK_DONE and 409s here, before either write below
  // ever runs — same guard shape as done/route.ts's own 409.
  if (order.workflowStage !== PICK_DONE) {
    return NextResponse.json({ error: "Order is not picked." }, { status: 409 });
  }

  // FIRST write — stamp the assignment checked. Order matters, same
  // reasoning as done/route.ts: if the SECOND write (below) fails, the bill
  // is still PICK_DONE and this row just has a checkedAt/checkedById with no
  // matching stage yet — a fixable inconsistency, not a lost bill. Reversed,
  // a failed second write would advance the order to PICK_CHECKED with no
  // record of who/when checked it — worse, and harder to notice.
  await prisma.pick_assignments.update({
    where: { orderId },
    data: { checkedAt: new Date(), checkedById },
  });

  // SECOND write — advance the stage.
  try {
    await prisma.orders.update({
      where: { id: orderId },
      data: { workflowStage: PICK_CHECKED },
    });
  } catch (err) {
    // Best-effort rollback of the first write — never prisma.$transaction (CORE §3).
    await prisma.pick_assignments
      .update({ where: { orderId }, data: { checkedAt: null, checkedById: null } })
      .catch(() => {});
    return NextResponse.json(
      { error: "Failed to update order stage. The check was rolled back." },
      { status: 500 },
    );
  }

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: PICK_DONE,
      toStage: PICK_CHECKED,
      changedById: checkedById,
      note: `Approved by supervisor #${checkedById}`,
    },
  });

  return NextResponse.json({ ok: true, orderId });
}
