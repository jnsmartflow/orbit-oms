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

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS]);
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

  console.log("ASSIGN API HIT", { orderId, assignedToId });

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Verify order is a tint order in an assignable stage
      const order = await tx.orders.findUnique({ where: { id: orderId } });
      if (!order) throw new Error("Order not found");
      if (order.orderType !== "tint") throw new Error("Order is not a tint order");

      // Validate the order is pending-column-eligible — four explicit cases:
      if (order.workflowStage === "pending_tint_assignment") {
        // Case 1 — fresh order, no splits ever created → always allow
        // Case 2 — all splits were cancelled, stage reset to pending → always allow
        // (No further checks needed)
      } else if (
        order.workflowStage === "tint_assigned" ||
        order.workflowStage === "tinting_in_progress"
      ) {
        const activeSplits = await tx.order_splits.findMany({
          where:   { orderId, status: { not: "cancelled" } },
          include: { lineItems: { select: { rawLineItemId: true, assignedQty: true } } },
        });

        if (activeSplits.length === 0) {
          // Case 2 (old stage not yet reset) — all splits cancelled → allow
        } else {
          // Case 3 / Case 4 — has active splits, compute remaining qty
          const rawLines = await tx.import_raw_line_items.findMany({
            where:  { obdNumber: order.obdNumber },
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
            throw new Error("Order has no remaining unassigned quantity");
          }
          // Case 3 — remainingQty > 0 → allow
        }
      } else {
        // Any other stage (pending_support, dispatched, etc.) → block
        throw new Error("Order is not in a state that allows assignment");
      }

      // 2. Load operator name for log note
      const operator = await tx.users.findUnique({
        where:  { id: assignedToId },
        select: { name: true },
      });
      if (!operator) throw new Error("Operator not found");

      console.log("BEFORE tint_assignments upsert/create");
      // 3. Upsert tint_assignments row (allow re-assignment from Assigned column)
      const existing = await tx.tint_assignments.findFirst({
        where: { orderId, status: "assigned" },
      });

      const isReassign = !!existing;

      if (existing) {
        await tx.tint_assignments.update({
          where: { id: existing.id },
          data: {
            assignedToId,
            assignedById: managerId,
            status:       "assigned",
            updatedAt:    new Date(),
          },
        });
      } else {
        await tx.tint_assignments.create({
          data: {
            orderId,
            assignedToId,
            assignedById: managerId,
            status:       "assigned",
          },
        });
      }

      console.log("BEFORE orders.update workflowStage");
      // 4. Update order workflow stage + set sequenceOrder to end of operator's queue
      const maxSeq = await tx.orders.aggregate({
        where: {
          workflowStage: "tint_assigned",
          tintAssignments: {
            some: {
              assignedToId,
              status: { not: "done" },
            },
          },
        },
        _max: { sequenceOrder: true },
      });

      await tx.orders.update({
        where: { id: orderId },
        data: {
          workflowStage: "tint_assigned",
          sequenceOrder: (maxSeq._max.sequenceOrder ?? 0) + 1,
        },
      });

      // 5. INSERT tint_logs (INSERT-ONLY — never skip)
      const tintLogNote = isReassign
        ? `Re-assigned to ${operator.name}` + (note ? ` — ${note}` : "")
        : `Assigned to ${operator.name}` + (note ? ` — ${note}` : "");

      await tx.tint_logs.create({
        data: {
          orderId,
          action:        isReassign ? "reassigned" : "assigned",
          performedById: managerId,
          note:          tintLogNote,
        },
      });

      console.log("BEFORE order_status_logs create");
      // 6. INSERT order_status_logs (INSERT-ONLY — never skip)
      await tx.order_status_logs.create({
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
      console.log("ASSIGN COMPLETE");
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assignment failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
