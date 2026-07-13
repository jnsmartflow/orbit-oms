import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT, PICK_ASSIGNED } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

interface FailedBill {
  orderId: number;
  error: string;
}

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
  // positive integer so an empty/absent id can never become assignedById: 0.
  // This is the SUPERVISOR doing the assigning — never the picker.
  const assignedById = Number(session.user.id);
  if (!Number.isInteger(assignedById) || assignedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderIds?: number[]; pickerId?: number };

  const orderIds = body.orderIds;
  if (!Array.isArray(orderIds) || orderIds.length === 0 || !orderIds.every((id) => typeof id === "number" && Number.isInteger(id))) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array of integers" }, { status: 400 });
  }

  const pickerId = body.pickerId;
  if (typeof pickerId !== "number" || !Number.isInteger(pickerId)) {
    return NextResponse.json({ error: "pickerId is required" }, { status: 400 });
  }

  // pickerId must resolve to a REAL, ACTIVE picker-role user — reuse the
  // exact query shape from app/api/warehouse/pickers/route.ts. Checked
  // BEFORE touching any bill: a bad picker must fail the whole batch, not
  // strand some bills assigned to a nonexistent/inactive picker.
  const picker = await prisma.users.findFirst({
    where: { id: pickerId, role: { name: "picker" }, isActive: true },
    select: { id: true },
  });
  if (!picker) {
    return NextResponse.json({ error: "pickerId does not resolve to an active picker" }, { status: 400 });
  }

  // Each bill runs its own fully sequential pair of writes — never
  // prisma.$transaction, neither across bills nor across the two writes
  // within one bill (CORE §3). A bill that fails at any step is recorded
  // in `failed` and the loop continues to the next bill; bills already
  // written stay written. The queue is a live read, so a failed bill simply
  // reappears as unassigned on the next fetch — no reconciliation needed.
  let assigned = 0;
  const failed: FailedBill[] = [];

  for (const orderId of orderIds) {
    try {
      // a. Fetch the order.
      const order = await prisma.orders.findFirst({
        where: { id: orderId },
        select: { id: true, workflowStage: true },
      });
      if (!order) {
        failed.push({ orderId, error: "Order not found" });
        continue;
      }

      // b. Must still be sitting unassigned in the picking queue. Guards
      // double-clicks and stale screens.
      if (order.workflowStage !== SUPPORT_DONE_OUTPUT) {
        failed.push({ orderId, error: "Order is not in the picking queue." });
        continue;
      }

      // c. Must not already have an assignment row.
      const existing = await prisma.pick_assignments.findUnique({ where: { orderId } });
      if (existing) {
        failed.push({ orderId, error: "Already assigned." });
        continue;
      }

      // d. FIRST write — create the pick_assignments row. Order is not
      // negotiable: if the SECOND write (e, below) fails, a record exists
      // here and the order is still SUPPORT_DONE_OUTPUT — still in the
      // queue, still mutable, and re-assigning just retries. Reversed, a
      // failed second write would leave a 'pick_assigned' order with NO
      // record of who or when — a ghost, vanished from the queue, locked
      // against Support, no undo path. Never reverse this order.
      const assignment = await prisma.pick_assignments.create({
        data: {
          orderId,
          pickerId,
          assignedById,
          sequence: 0,
          status: "assigned",
          notes: "test",
          // pickedAt intentionally left NULL — the bill is assigned, not
          // picked. pick_done is a later stage and will set it.
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
        failed.push({ orderId, error: "Failed to update order stage. The assignment was rolled back." });
        continue;
      }

      // f. Audit log — mirrors app/api/support/orders/[id]/dispatch/route.ts's
      // fromStage/toStage/changedById/note shape.
      await prisma.order_status_logs.create({
        data: {
          orderId,
          fromStage: SUPPORT_DONE_OUTPUT,
          toStage: PICK_ASSIGNED,
          changedById: assignedById,
          note: `Batch-assigned to picker #${pickerId} (test) — pick_assignments #${assignment.id}`,
        },
      });

      assigned++;
    } catch (err) {
      // Catch-all so one bill's unexpected throw (e.g. a transient DB error
      // on the initial fetch) can never abort the rest of the batch.
      failed.push({ orderId, error: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  return NextResponse.json({ assigned, failed });
}
