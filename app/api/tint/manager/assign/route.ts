import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const assignSchema = z.object({
  orderId:      z.number().int().positive(),
  assignedToId: z.number().int().positive(),
  note:         z.string().optional(),
});

// Recognised business-rule errors map to 400 instead of 500.
class AssignValidationError extends Error {}
const validationError = (msg: string): never => { throw new AssignValidationError(msg); };

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.OPERATION_MANAGER]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = assignSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { orderId, assignedToId, note } = parsed.data;
  const managerId = parseInt(session!.user.id, 10);

  // ── Sequential awaits (CORE §3 — no prisma.$transaction) ──────────────────
  // The previous implementation wrapped these in $transaction; Vercel
  // serverless + Supabase pooler hit timeouts. Partial-state acceptable on
  // mid-sequence failure: caller gets a 500 with which-step-failed, and
  // Vercel logs carry orderId + assignmentId for triage.

  // 1. Verify order is a tint order in an assignable stage
  const order = await prisma.orders.findFirst({
    where:  { id: orderId, isRemoved: false },
    select: {
      id:              true,
      orderType:       true,
      workflowStage:   true,
      obdNumber:       true,
      customerMissing: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  try {
    if (order.orderType !== "tint") validationError("Order is not a tint order");

    // Phase 4 (step 13d): block assignment until customer master data exists.
    // Defence-in-depth — frontend intercepts the click and chains through
    // CustomerMissingSheet, but this guard refuses direct API calls too.
    if (order.customerMissing) {
      validationError("Customer master data is missing for this order. Resolve in the Missing Customers sheet before assigning.");
    }

    if (order.workflowStage === "pending_tint_assignment") {
      // Case 1 — fresh order, no splits ever created → always allow
      // Case 2 — all splits were cancelled, stage reset to pending → always allow
    } else if (
      order.workflowStage === "tint_assigned" ||
      order.workflowStage === "tinting_in_progress"
    ) {
      const activeSplits = await prisma.order_splits.findMany({
        where:   { orderId, status: { not: "cancelled" } },
        include: { lineItems: { where: { lineStatus: "active" }, select: { rawLineItemId: true, assignedQty: true } } },
      });

      if (activeSplits.length === 0) {
        // Case 2 (old stage not yet reset) — all splits cancelled → allow
      } else {
        // Case 3 / Case 4 — has active splits, compute remaining qty
        const rawLines = await prisma.import_raw_line_items.findMany({
          where:  { obdNumber: order.obdNumber, lineStatus: "active" },
          select: { id: true, unitQty: true },
        });
        const assignedQtyByLine = new Map<number, number>();
        for (const split of activeSplits) {
          for (const item of split.lineItems) {
            assignedQtyByLine.set(
              item.rawLineItemId,
              (assignedQtyByLine.get(item.rawLineItemId) ?? 0) + item.assignedQty,
            );
          }
        }
        const remainingQty = rawLines.reduce((sum, line) => {
          const assigned = assignedQtyByLine.get(line.id) ?? 0;
          return sum + Math.max(0, line.unitQty - assigned);
        }, 0);
        if (remainingQty <= 0) {
          // Case 4 — fully assigned through splits, nothing left → block
          validationError("Order has no remaining unassigned quantity");
        }
        // Case 3 — remainingQty > 0 → allow
      }
    } else {
      // Any other stage (pending_support, dispatched, etc.) → block
      validationError("Order is not in a state that allows assignment");
    }
  } catch (err) {
    if (err instanceof AssignValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // 2. Load operator name for log note
  const operator = await prisma.users.findUnique({
    where:  { id: assignedToId },
    select: { name: true },
  });
  if (!operator) {
    return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  }

  // 3. Upsert tint_assignments row (allow re-assignment from Assigned column)
  const existing = await prisma.tint_assignments.findFirst({
    where: { orderId, status: "assigned" },
  });
  const isReassign = !!existing;

  let assignmentId: number;
  try {
    if (existing) {
      const updated = await prisma.tint_assignments.update({
        where: { id: existing.id },
        data: {
          assignedToId,
          assignedById: managerId,
          status:       "assigned",
          updatedAt:    new Date(),
        },
        select: { id: true },
      });
      assignmentId = updated.id;
    } else {
      const created = await prisma.tint_assignments.create({
        data: {
          orderId,
          assignedToId,
          assignedById: managerId,
          status:       "assigned",
        },
        select: { id: true },
      });
      assignmentId = created.id;
    }
  } catch (err) {
    console.error("[tint/manager/assign] tint_assignments write failed", {
      orderId, assignedToId, step: "tint_assignments",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to record assignment" }, { status: 500 });
  }

  // 4. Update order workflow stage + set sequenceOrder to end of operator's queue
  try {
    const maxSeq = await prisma.orders.aggregate({
      where: {
        workflowStage: "tint_assigned",
        isRemoved:     false,
        tintAssignments: {
          some: {
            assignedToId,
            status: { not: "done" },
          },
        },
      },
      _max: { sequenceOrder: true },
    });

    await prisma.orders.update({
      where: { id: orderId },
      data: {
        workflowStage: "tint_assigned",
        sequenceOrder: (maxSeq._max.sequenceOrder ?? 0) + 1,
      },
    });
  } catch (err) {
    console.error("[tint/manager/assign] orders.update failed", {
      orderId, assignmentId, step: "orders.workflowStage",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Assignment created but workflow stage update failed — please notify admin" },
      { status: 500 },
    );
  }

  // 5. INSERT tint_logs (INSERT-ONLY — never skip)
  const tintLogNote = isReassign
    ? `Re-assigned to ${operator.name}` + (note ? ` — ${note}` : "")
    : `Assigned to ${operator.name}` + (note ? ` — ${note}` : "");
  try {
    await prisma.tint_logs.create({
      data: {
        orderId,
        action:        isReassign ? "reassigned" : "assigned",
        performedById: managerId,
        note:          tintLogNote,
      },
    });
  } catch (err) {
    console.error("[tint/manager/assign] tint_logs.create failed", {
      orderId, assignmentId, step: "tint_logs",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Assignment created but audit logging failed — please notify admin" },
      { status: 500 },
    );
  }

  // 6. INSERT order_status_logs (INSERT-ONLY — never skip)
  try {
    await prisma.order_status_logs.create({
      data: {
        orderId,
        fromStage:   order.workflowStage,
        toStage:     "tint_assigned",
        changedById: managerId,
        note:        isReassign
          ? `Re-assigned to new operator: ${operator.name}`
          : tintLogNote,
      },
    });
  } catch (err) {
    console.error("[tint/manager/assign] order_status_logs.create failed", {
      orderId, assignmentId, step: "order_status_logs",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Assignment created but audit logging failed — please notify admin" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
