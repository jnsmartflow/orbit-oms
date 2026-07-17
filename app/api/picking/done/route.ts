import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PICK_ASSIGNED, PICK_DONE } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/done — picker marks a bill done. Single-order, mirrors
 * app/api/picking/unassign/route.ts's shape (one bill, not a batch like
 * assign/route.ts — Mark Done fires from the detail screen for one bill).
 *
 * Body: { orderId, pickerId }. `pickerId` is NEVER trusted as an identity
 * claim by itself — it's checked below against the order's real
 * pick_assignments.pickerId. The admin/operations "view as picker" test
 * hook (app/picking/page.tsx) means the caller (session.user.id) is
 * routinely NOT the picker the bill belongs to; the coarse permission gate
 * plus this ownership check are what stop "mark someone else's bill done"
 * without a role_permissions grant or a client-trusted identity. See
 * docs/prompts/drafts/code-discovery-2026-07-17-picking-stage2.md.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate as every other picking route — admin bypass, else canView on
  // 'picking'. picker/floor_supervisor still have zero grants (unchanged);
  // today only admin/operations can ever reach this route at all.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Who actually performed this — the real session, never the request
  // body's pickerId. Mirrors assign/route.ts's assignedById vs pickerId
  // split: pickerId is WHO the bill is for, changedById is WHO clicked.
  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: number; pickerId?: number };

  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId)) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const pickerId = body.pickerId;
  if (typeof pickerId !== "number" || !Number.isInteger(pickerId)) {
    return NextResponse.json({ error: "pickerId is required" }, { status: 400 });
  }

  // pickerId must resolve to a real, active picker-role user — same check
  // assign/route.ts runs before touching any bill.
  const picker = await prisma.users.findFirst({
    where: { id: pickerId, role: { name: "picker" }, isActive: true },
    select: { id: true },
  });
  if (!picker) {
    return NextResponse.json({ error: "pickerId does not resolve to an active picker" }, { status: 400 });
  }

  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: { id: true, workflowStage: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Stops a double-tap (or a retried request) from writing twice: the first
  // successful call advances workflowStage to PICK_DONE, so a second call
  // finds it no longer PICK_ASSIGNED and 409s here, before either write
  // below ever runs — same guard shape as unassign/route.ts's own 409.
  if (order.workflowStage !== PICK_ASSIGNED) {
    return NextResponse.json({ error: "Order is not assigned." }, { status: 409 });
  }

  // Ownership check — the real guard behind the test hook (see file-top
  // comment). A picker (or an admin/ops session acting as one) can only
  // mark done a bill actually assigned to that picker.
  const assignment = await prisma.pick_assignments.findUnique({
    where: { orderId },
    select: { pickerId: true },
  });
  if (!assignment || assignment.pickerId !== pickerId) {
    return NextResponse.json({ error: "This bill is not assigned to that picker." }, { status: 409 });
  }

  // FIRST write — mark the assignment picked. Order matters, same reasoning
  // as assign/route.ts: if the SECOND write (below) fails, the bill is
  // still PICK_ASSIGNED and this row just says status="picked" with no
  // matching stage yet — a fixable inconsistency, not a lost bill.
  // Reversed, a failed second write would advance the order to PICK_DONE
  // with no record of when it was picked — worse, and harder to notice.
  await prisma.pick_assignments.update({
    where: { orderId },
    data: { status: "picked", pickedAt: new Date() },
  });

  // SECOND write — advance the stage.
  try {
    await prisma.orders.update({
      where: { id: orderId },
      data: { workflowStage: PICK_DONE },
    });
  } catch (err) {
    // Best-effort rollback of the first write — never prisma.$transaction (CORE §3).
    await prisma.pick_assignments
      .update({ where: { orderId }, data: { status: "assigned", pickedAt: null } })
      .catch(() => {});
    return NextResponse.json(
      { error: "Failed to update order stage. The pick was rolled back." },
      { status: 500 },
    );
  }

  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: PICK_ASSIGNED,
      toStage: PICK_DONE,
      changedById,
      note: `Marked done by picker #${pickerId}`,
    },
  });

  return NextResponse.json({ ok: true, orderId });
}
