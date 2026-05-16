import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

// ── Body schema ──────────────────────────────────────────────────────────────

const REASON_VALUES = [
  "TINTER_FINISHED",
  "MACHINE_BREAKDOWN",
  "MATERIAL_SHORTAGE",
  "OTHER",
] as const;

const skipSchema = z.object({
  assignmentId:      z.number().int().positive(),
  reason:            z.enum(REASON_VALUES),
  tinterType:        z.enum(["TINTER", "ACOTONE"]).optional(),
  outOfStockColours: z.array(z.string()).optional(),
  remark:            z.string().max(500).optional(),
});

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  // session.user.id is a string (per lib/auth.ts user.id.toString()).
  // tint_assignments.assignedToId is Int — convert.
  const userId = parseInt(session.user.id, 10);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ ok: false, error: "Invalid session user" }, { status: 401 });
  }

  // ── Validate body ───────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = skipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { assignmentId, reason } = parsed.data;
  const tinterType        = parsed.data.tinterType;
  const outOfStockColours = parsed.data.outOfStockColours ?? [];
  const remarkTrimmed     = parsed.data.remark?.trim() ?? "";

  // Conditional validation tied to reason.
  if (reason === "TINTER_FINISHED") {
    if (!tinterType) {
      return NextResponse.json(
        { ok: false, error: "Tinter type is required when reason is TINTER_FINISHED" },
        { status: 400 },
      );
    }
    if (outOfStockColours.length < 1) {
      return NextResponse.json(
        { ok: false, error: "At least one colour is required when reason is TINTER_FINISHED" },
        { status: 400 },
      );
    }
  }
  if (remarkTrimmed.length > 500) {
    return NextResponse.json({ ok: false, error: "Remark too long after trim" }, { status: 400 });
  }

  // ── 1. Load assignment + parent order.sequenceOrder ─────────────────────────
  // Sequential awaits — no prisma.$transaction (CORE §3).
  // tint_assignments has no sequenceOrder column; we order via the related
  // orders.sequenceOrder per CLAUDE_TINT.md §1.8.
  const asg = await prisma.tint_assignments.findUnique({
    where: { id: assignmentId },
    select: {
      id:           true,
      orderId:      true,
      splitId:      true,
      assignedToId: true,
      status:       true,
      startedAt:    true,
      order: {
        select: { id: true, workflowStage: true, sequenceOrder: true },
      },
    },
  });

  if (!asg) {
    return NextResponse.json({ ok: false, error: "Assignment not found" }, { status: 404 });
  }
  if (asg.splitId !== null) {
    // Skip API is whole-OBD only. Split jobs would need /split/skip — not yet built.
    return NextResponse.json(
      { ok: false, error: "Split jobs cannot be skipped via this route" },
      { status: 400 },
    );
  }
  if (asg.assignedToId !== userId) {
    return NextResponse.json({ ok: false, error: "Not your job" }, { status: 403 });
  }
  if (asg.status !== "assigned") {
    return NextResponse.json(
      { ok: false, error: "Only assigned jobs can be skipped", status: asg.status },
      { status: 409 },
    );
  }
  if (asg.startedAt !== null) {
    return NextResponse.json(
      { ok: false, error: "Cannot skip a started job" },
      { status: 409 },
    );
  }

  // ── 2. Top-of-queue check against whole-OBD assignments ────────────────────
  const topAsg = await prisma.tint_assignments.findFirst({
    where: {
      assignedToId: userId,
      status:       "assigned",
      splitId:      null, // whole-OBD only
    },
    orderBy: { order: { sequenceOrder: "asc" } },
    select:  { id: true },
  });
  if (!topAsg || topAsg.id !== asg.id) {
    return NextResponse.json(
      { ok: false, error: "Only the top job in your queue can be skipped" },
      { status: 409 },
    );
  }

  // ── 2b. Cross-check against the operator's split queue ─────────────────────
  // If a split job at the operator has an earlier sequenceOrder than this
  // whole-OBD assignment, the literal top of queue is the split, not this asg.
  // Active split statuses per schema default + my-orders route:
  // "tint_assigned" and "tinting_in_progress".
  const topSplit = await prisma.order_splits.findFirst({
    where: {
      assignedToId: userId,
      status:       { in: ["tint_assigned", "tinting_in_progress"] },
    },
    orderBy: { order: { sequenceOrder: "asc" } },
    select: {
      id:    true,
      order: { select: { sequenceOrder: true } },
    },
  });
  const asgSeq = asg.order?.sequenceOrder ?? Number.MAX_SAFE_INTEGER;
  if (topSplit && (topSplit.order?.sequenceOrder ?? 0) <= asgSeq) {
    return NextResponse.json(
      { ok: false, error: "Top of queue is a split job, cannot skip this assignment" },
      { status: 409 },
    );
  }

  // ── 3. Capture fromStage for audit ─────────────────────────────────────────
  const fromStage = asg.order?.workflowStage ?? null;
  if (!fromStage) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  // ── 4. Insert skip event ───────────────────────────────────────────────────
  const event = await prisma.tint_skip_events.create({
    data: {
      orderId:           asg.orderId,
      assignmentId:      asg.id,
      skippedById:       userId,
      reason,
      tinterType:        reason === "TINTER_FINISHED" ? (tinterType ?? null) : null,
      outOfStockColours: reason === "TINTER_FINISHED" ? outOfStockColours : [],
      remark:            remarkTrimmed.length > 0 ? remarkTrimmed : null,
    },
    select: { id: true },
  });

  // ── 5. Update assignment ───────────────────────────────────────────────────
  await prisma.tint_assignments.update({
    where: { id: asg.id },
    data: {
      status:      "skipped",
      skippedAt:   new Date(),
      skipEventId: event.id,
    },
  });

  // ── 6. Reset order workflowStage back to pending_tint_assignment ───────────
  await prisma.orders.update({
    where: { id: asg.orderId },
    data:  { workflowStage: "pending_tint_assignment" },
  });

  // ── 7. Audit log (INSERT-ONLY) ─────────────────────────────────────────────
  const detailSuffix =
    reason === "TINTER_FINISHED" && tinterType
      ? ` · Type: ${tinterType} · Colours: ${outOfStockColours.join(", ")}`
      : "";
  const remarkSuffix = remarkTrimmed.length > 0 ? ` · Remark: ${remarkTrimmed}` : "";
  await prisma.order_status_logs.create({
    data: {
      orderId:     asg.orderId,
      fromStage,
      toStage:     "OPERATOR_SKIP",
      changedById: userId,
      note:        `Reason: ${reason}${detailSuffix}${remarkSuffix}`,
    },
  });

  // BigInt → Number for JSON response (skip event id is a bigserial PK; the
  // raw BigInt is not JSON-serialisable).
  return NextResponse.json({
    ok:           true,
    assignmentId: asg.id,
    orderId:      asg.orderId,
    skipEventId:  Number(event.id),
  });
}
