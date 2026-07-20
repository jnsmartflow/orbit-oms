import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Today in IST as a UTC-midnight Date — the SAME shape and the SAME
 * derivation lib/picking/queue.ts:getISTTodayDate() uses. Deliberately
 * duplicated rather than approximated: if this route computed "today" any
 * other way, it could disagree with the queue's own zone classification
 * across the IST/UTC day boundary and 409 a bill the board is showing as
 * locked (or release one the board already shows as due).
 */
function getISTTodayDateOnly(): Date {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
}

/**
 * POST /api/picking/release — manual early release of a future-dated
 * ("upcoming") bill so it can be assigned today. Body: { orderId }.
 *
 * This does NOT touch workflowStage. The bill stays at `pending_picking`;
 * only its ZONE changes, because lib/picking/queue.ts classifies a released
 * bill as "due" regardless of its dispatch date. No new stage, no new
 * pick_assignments.status value — so chk_pick_assignments_status (the live
 * CHECK constraint invisible in schema.prisma, CLAUDE_PICKING.md §7) is not
 * involved. Same modelling call as Checked/Approved: timestamp + actor
 * columns, never a new status string.
 *
 * The automatic midnight unlock is unaffected and remains the normal path —
 * this is the override for "we need it on the truck today".
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit, not canView (2026-07-20 gate correction — see the note in
  // app/api/picking/assign/route.ts). Releasing a bill early overrides a
  // dispatch date Support set deliberately; it is a supervisor action.
  // `picker` holds canView on 'picking' so its own board renders, and must
  // NOT be able to reach this route.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Who actually performed this — the real session, never a request body
  // claim (approve/route.ts's rule). Number("") is 0 and finite, so test for
  // a real positive integer rather than Number.isFinite.
  const releasedById = Number(session.user.id);
  if (!Number.isInteger(releasedById) || releasedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: number };
  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId)) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      workflowStage: true,
      dispatchStatus: true,
      dispatchTargetDate: true,
      isRemoved: true,
      pickEarlyReleasedAt: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.isRemoved) {
    return NextResponse.json({ error: "Order has been removed." }, { status: 409 });
  }

  // Must be a bill the picking queue would actually show. Both predicates
  // mirror getPickingQueue()'s WHERE exactly — releasing something the board
  // cannot display would stamp a record nobody ever sees.
  if (order.dispatchStatus !== "dispatch") {
    return NextResponse.json({ error: "Order is not dispatch-released." }, { status: 409 });
  }
  // Only a WAITING bill can be released. Once assigned/picked/checked the
  // lock is moot and a release would be a confusing no-op record.
  if (order.workflowStage !== SUPPORT_DONE_OUTPUT) {
    return NextResponse.json({ error: "Order is not waiting to be assigned." }, { status: 409 });
  }

  // Must genuinely BE upcoming. A null or past/today date is already "due",
  // so there is nothing to unlock — refuse rather than stamp a meaningless
  // release that would then show a "released" chip on a bill that was never
  // locked.
  const today = getISTTodayDateOnly();
  if (order.dispatchTargetDate === null || order.dispatchTargetDate.getTime() <= today.getTime()) {
    return NextResponse.json({ error: "Order is not future-dated — nothing to release." }, { status: 409 });
  }

  // Idempotency / double-tap guard, same shape as approve/route.ts's 409:
  // the first successful call sets pickEarlyReleasedAt, so a retry lands
  // here before any write and cannot overwrite the original actor/time.
  if (order.pickEarlyReleasedAt !== null) {
    return NextResponse.json({ error: "Order was already released early." }, { status: 409 });
  }

  const targetIso = order.dispatchTargetDate.toISOString().slice(0, 10);

  // Sequential awaits only — never prisma.$transaction (CORE §3). Unlike
  // assign/approve there is no two-write ordering hazard here: both columns
  // land in ONE row update, so the release is atomic on its own. If the
  // audit insert below then fails, the release stands and one log line is
  // missing — the correct direction to fail (the bill is usable; the trail
  // is repairable), and the opposite of what a stage advance would risk.
  await prisma.orders.update({
    where: { id: orderId },
    data: { pickEarlyReleasedAt: new Date(), pickEarlyReleasedById: releasedById },
  });

  // Audit reuses order_status_logs with a pseudo-stage in toStage — the same
  // pattern the Hide feature uses (ORDER_HIDDEN / ORDER_UNHIDDEN,
  // CLAUDE_CORE.md §7.10). Safe because this table is INSERT-ONLY audit and
  // is never read back through stageRank(); fromStage carries the real,
  // unchanged stage so the row still says where the bill actually was.
  await prisma.order_status_logs.create({
    data: {
      orderId,
      fromStage: order.workflowStage,
      toStage: "PICK_EARLY_RELEASED",
      changedById: releasedById,
      note: `Released early for picking by user #${releasedById} (was scheduled ${targetIso})`,
    },
  });

  return NextResponse.json({ ok: true, orderId });
}
