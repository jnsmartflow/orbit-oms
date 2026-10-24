import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";
import {
  nextTintSequenceOrder,
  planTintAssign,
  tintAssignLogNote,
  writeTintAssignLog,
  writeTintAssignmentRow,
} from "@/lib/tint/assign";

export const dynamic = "force-dynamic";

const assignSchema = z.object({
  orderId:      z.number().int().positive(),
  assignedToId: z.number().int().positive(),
  note:         z.string().optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). Resolves against the caller's
  // own user_page_access row; both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

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
  // 1b–3a. The bill rules, the operator and the re-assign lookup — READS ONLY,
  // moved verbatim into lib/tint/assign.ts (2026-10-24) so the manual tint pull
  // assigns by the same checks. Same 400 / 404 bodies as before.
  const plan = await planTintAssign(order, assignedToId);
  if (!plan.ok) {
    return NextResponse.json({ error: plan.error }, { status: plan.status });
  }
  const isReassign = plan.existingAssignmentId !== null;

  // 3. Upsert tint_assignments row (allow re-assignment from Assigned column)
  let assignmentId: number;
  try {
    assignmentId = await writeTintAssignmentRow({
      orderId, assignedToId, managerId, existingAssignmentId: plan.existingAssignmentId,
    });
  } catch (err) {
    console.error("[tint/manager/assign] tint_assignments write failed", {
      orderId, assignedToId, step: "tint_assignments",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to record assignment" }, { status: 500 });
  }

  // 4. Update order workflow stage + set sequenceOrder to end of operator's queue
  // (the tail read is lib/tint/assign.ts nextTintSequenceOrder — its note says
  // why the predicate reads only live rows).
  try {
    const sequenceOrder = await nextTintSequenceOrder(assignedToId);

    await prisma.orders.update({
      where: { id: orderId },
      data: {
        workflowStage: "tint_assigned",
        sequenceOrder,
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
  const tintLogNote = tintAssignLogNote(isReassign, plan.operatorName, note);
  try {
    await writeTintAssignLog({ orderId, managerId, isReassign, note: tintLogNote });
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
          ? `Re-assigned to new operator: ${plan.operatorName}`
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
