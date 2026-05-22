import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// ── Body schema ──────────────────────────────────────────────────────────────

const resumeSchema = z.object({
  assignmentId: z.number().int().positive(),
});

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ ok: false, error: "Invalid session user" }, { status: 401 });
  }

  // Permission gate: tint_operator canView. Admin short-circuits.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "tint_operator", "canView");
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
    }
  }

  // ── Validate body ──────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = resumeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { assignmentId } = parsed.data;

  // ── 1. Load assignment + parent order ──────────────────────────────────────
  const asg = await prisma.tint_assignments.findFirst({
    where: {
      id:     assignmentId,
      status: { in: ["assigned", "tinting_in_progress", "paused"] },
    },
    select: {
      id:           true,
      orderId:      true,
      splitId:      true,
      assignedToId: true,
      status:       true,
      order: { select: { workflowStage: true } },
    },
  });
  if (!asg) {
    return NextResponse.json({ ok: false, error: "Assignment not found" }, { status: 404 });
  }
  if (asg.splitId !== null) {
    return NextResponse.json(
      { ok: false, error: "Split jobs cannot be resumed via this route" },
      { status: 400 },
    );
  }
  if (asg.assignedToId !== userId) {
    return NextResponse.json({ ok: false, error: "Not your job" }, { status: 403 });
  }
  if (asg.status !== "paused") {
    return NextResponse.json(
      { ok: false, error: "Only paused jobs can be resumed", status: asg.status },
      { status: 409 },
    );
  }

  // ── 2. Defensive: operator must have zero in-progress assignments ──────────
  // The UI should already block, but check in depth: a Resume call while a
  // different job is in-progress would create dual-active state.
  const inProgressCount = await prisma.tint_assignments.count({
    where: {
      assignedToId: userId,
      status:       "tinting_in_progress",
    },
  });
  if (inProgressCount > 0) {
    return NextResponse.json(
      { ok: false, error: "Cannot resume — another job is in progress" },
      { status: 409 },
    );
  }

  // ── 3. Find the latest pause event for this assignment ────────────────────
  // The pause event row gets resumedAt + resumedById written on resume.
  const latestPause = await prisma.tint_pause_events.findFirst({
    where:   { assignmentId: asg.id, resumedAt: null },
    orderBy: { pausedAt: "desc" },
    select:  { id: true },
  });
  if (!latestPause) {
    // Shouldn't happen — if status='paused' there should be an open pause event.
    return NextResponse.json(
      { ok: false, error: "No open pause event found for this assignment" },
      { status: 409 },
    );
  }

  const now = new Date();

  // ── 4. Update assignment ───────────────────────────────────────────────────
  // Reset startedAt to now (new "run" baseline). Null out lastPausedAt.
  // accumulatedMinutes is preserved (the frozen total carries forward).
  // currentProgress is preserved (resume re-seeds the operator's view).
  await prisma.tint_assignments.update({
    where: { id: asg.id },
    data: {
      status:       "tinting_in_progress",
      startedAt:    now,
      lastPausedAt: null,
    },
  });

  // ── 5. Close out the pause event ───────────────────────────────────────────
  await prisma.tint_pause_events.update({
    where: { id: latestPause.id },
    data: {
      resumedAt:   now,
      resumedById: userId,
    },
  });

  // ── 6. Audit log (INSERT-ONLY) ─────────────────────────────────────────────
  await prisma.order_status_logs.create({
    data: {
      orderId:     asg.orderId,
      fromStage:   asg.order.workflowStage,
      toStage:     "OPERATOR_RESUME",
      changedById: userId,
      note:        "Resumed",
    },
  });

  return NextResponse.json({ ok: true });
}
