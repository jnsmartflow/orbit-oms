import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { TINT_ASSIGNMENT_ACTIVE_STATUSES } from "@/lib/tint/assignment-status";

export const dynamic = "force-dynamic";

const reorderSchema = z.object({
  type:      z.enum(["order", "split"]),
  id:        z.number().int().positive(),
  direction: z.enum(["up", "down"]),
});

export async function PATCH(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.OPERATION_MANAGER]);

  const parsed = reorderSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { type, id, direction } = parsed.data;

  try {
    if (type === "order") {
      // Find the target order's CURRENT operator.
      //
      // `status: { not: "done" }` here matched every row ever written — "done"
      // is not a value this system produces (lib/tint/assignment-status.ts).
      // An OBD that was assigned, skipped, then re-assigned carries TWO rows,
      // and an unordered findFirst over "everything" could hand back the
      // skipped one — reordering inside the wrong operator's queue.
      // Narrowed to the live statuses, and ordered newest-first so the result
      // is deterministic even if a stale live row ever coexists.
      const targetAssignment = await prisma.tint_assignments.findFirst({
        where:   { orderId: id, status: { in: [...TINT_ASSIGNMENT_ACTIVE_STATUSES] } },
        orderBy: { createdAt: "desc" },
        select:  { assignedToId: true },
      });
      if (!targetAssignment) {
        return NextResponse.json({ error: "No active assignment for this order" }, { status: 404 });
      }

      // Fetch only orders assigned to the same operator. Same predicate fix as
      // above: a dead `skipped` row pointing at operator A used to drag that
      // OBD into A's queue list long after B had taken it over.
      const list = await prisma.orders.findMany({
        where: {
          workflowStage: "tint_assigned",
          isRemoved: false,
          tintAssignments: {
            some: {
              assignedToId: targetAssignment.assignedToId,
              status: { in: [...TINT_ASSIGNMENT_ACTIVE_STATUSES] },
            },
          },
        },
        orderBy: [{ sequenceOrder: "asc" }, { createdAt: "asc" }],
        select:  { id: true, sequenceOrder: true },
      });

      const idx = list.findIndex((o) => o.id === id);
      if (idx === -1) {
        return NextResponse.json({ error: "Order not found in Assigned column" }, { status: 404 });
      }

      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= list.length) {
        return NextResponse.json({ success: true }); // already at boundary — no-op
      }

      const itemA = list[idx];
      const itemB = list[swapIdx];
      const seqA  = itemA.sequenceOrder;
      const seqB  = itemB.sequenceOrder;

      // If both have the same sequenceOrder (initial state), assign distinct values
      const newSeqA = seqA === seqB ? (direction === "up" ? seqB - 1 : seqB + 1) : seqB;
      const newSeqB = seqA === seqB ? seqA : seqA;

      // Sequential awaits — never prisma.$transaction (CORE §3: Vercel
      // serverless + the Supabase pooler time out on interactive transactions).
      // Values are computed BEFORE either write, so the pair is order-independent
      // and there is no read-between-writes to race.
      //
      // Partial-failure shape: if the second update throws, A holds B's slot and
      // B is unchanged, so two rows can share a sequenceOrder. That is the same
      // state a freshly-assigned queue is already in (the column defaults to 0),
      // the list query's `orderBy: [sequenceOrder, createdAt]` still sorts it,
      // and the tie-break above resolves it on the next move. No repair needed.
      await prisma.orders.update({ where: { id: itemA.id }, data: { sequenceOrder: newSeqA } });
      await prisma.orders.update({ where: { id: itemB.id }, data: { sequenceOrder: newSeqB } });

    } else {
      // Find the target split's operator
      const targetSplit = await prisma.order_splits.findUnique({
        where:  { id },
        select: { assignedToId: true },
      });
      if (!targetSplit?.assignedToId) {
        return NextResponse.json({ error: "Split not found or not assigned" }, { status: 404 });
      }

      // Fetch only splits assigned to the same operator
      const list = await prisma.order_splits.findMany({
        where: {
          status: "tint_assigned",
          assignedToId: targetSplit.assignedToId,
        },
        orderBy: [{ sequenceOrder: "asc" }, { createdAt: "asc" }],
        select:  { id: true, sequenceOrder: true },
      });

      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) {
        return NextResponse.json({ error: "Split not found in Assigned column" }, { status: 404 });
      }

      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= list.length) {
        return NextResponse.json({ success: true }); // already at boundary — no-op
      }

      const itemA = list[idx];
      const itemB = list[swapIdx];
      const seqA  = itemA.sequenceOrder;
      const seqB  = itemB.sequenceOrder;

      const newSeqA = seqA === seqB ? (direction === "up" ? seqB - 1 : seqB + 1) : seqB;
      const newSeqB = seqA === seqB ? seqA : seqA;

      // Sequential awaits, same reasoning as the order branch above (CORE §3).
      await prisma.order_splits.update({ where: { id: itemA.id }, data: { sequenceOrder: newSeqA } });
      await prisma.order_splits.update({ where: { id: itemB.id }, data: { sequenceOrder: newSeqB } });
    }

    return NextResponse.json({ success: true });

  } catch (err) {
    console.error("[tint/manager/reorder] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reorder failed" },
      { status: 500 },
    );
  }
}
