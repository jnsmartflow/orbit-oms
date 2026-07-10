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

  // Same gate as app/api/picking/queue/route.ts — admin bypass, else
  // canView on 'picking'. This is a write, so page-level gating alone would
  // not be enough even if it existed; mirror the read route's check exactly.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // session.user.id is a string (see lib/auth.ts: `id: user.id.toString()`).
  // Convert explicitly and refuse to write a garbage id. Number.isFinite
  // alone is not enough — Number("") is 0, which is finite; require a real
  // positive integer so an empty/absent id can never become pickerId: 0.
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

  // b. Must still be sitting unassigned in the picking queue. Guards
  // double-clicks and stale screens.
  if (order.workflowStage !== SUPPORT_DONE_OUTPUT) {
    return NextResponse.json(
      { error: "Order is not in the picking queue." },
      { status: 409 },
    );
  }

  // c. Must not already have an assignment row.
  const existing = await prisma.pick_assignments.findUnique({ where: { orderId } });
  if (existing) {
    return NextResponse.json({ error: "Already assigned." }, { status: 409 });
  }

  // d. FIRST write — create the pick_assignments row. Sequential awaits only
  // (CORE §3). Order is not negotiable: if the SECOND write (e, below) fails,
  // a record exists here and the order is still SUPPORT_DONE_OUTPUT — still
  // in the queue, still mutable, and clicking Assign again just retries.
  // Reversed, a failed second write would leave a 'pick_assigned' order with
  // NO record of who or when — a ghost, vanished from the queue, locked
  // against Support, no undo path. Never reverse this order.
  const assignment = await prisma.pick_assignments.create({
    data: {
      orderId,
      pickerId: userId,
      assignedById: userId,
      sequence: 0,
      status: "assigned",
      notes: "test",
      // pickedAt intentionally left NULL — the bill is assigned, not picked.
      // pick_done is a later stage and will set it.
    },
  });

  // e. SECOND write — advance the stage.
  try {
    await prisma.orders.update({
      where: { id: orderId },
      data: { workflowStage: PICK_ASSIGNED },
    });
  } catch (err) {
    // Best-effort cleanup — do not leave the row created in (d) orphaned.
    await prisma.pick_assignments.delete({ where: { orderId } }).catch(() => {});
    return NextResponse.json(
      {
        error: "Failed to update order stage. The assignment was rolled back — please try again.",
      },
      { status: 500 },
    );
  }

  // f. Audit log — mirrors app/api/support/orders/[id]/dispatch/route.ts's
  // fromStage/toStage/changedById/note shape.
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: SUPPORT_DONE_OUTPUT,
      toStage: PICK_ASSIGNED,
      changedById: userId,
      note: `Assigned to picker (test) — pick_assignments #${assignment.id}`,
    },
  });

  return NextResponse.json({ ok: true, orderId });
}
