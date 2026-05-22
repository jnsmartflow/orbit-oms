import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// ── Body schema ──────────────────────────────────────────────────────────────

const PAUSE_REASONS = [
  "lunch_break",
  "shift_end",
  "machine_breakdown",
  "material_shortage",
  "urgent_priority",
] as const;

const progressItemSchema = z.object({
  skuId:   z.number().int().positive(),
  doneQty: z.number().int().min(0),
});

const pauseSchema = z.object({
  assignmentId: z.number().int().positive(),
  reason:       z.enum(PAUSE_REASONS),
  remark:       z.string().max(500).optional(),
  progress:     z.array(progressItemSchema),
});

// Per-job + concurrent caps (locked by spec).
const MAX_PAUSE_COUNT_PER_JOB = 3;
const MAX_CONCURRENT_FOR_OPERATOR = 4; // in_progress + paused combined

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

  // Permission gate: tint_operator canView (locked OrbitOMS model — page
  // access = full action authority on that page). Admin short-circuits.
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
  const parsed = pauseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { assignmentId, reason, progress } = parsed.data;
  const remarkTrimmed = parsed.data.remark?.trim() ?? "";
  if (remarkTrimmed.length > 500) {
    return NextResponse.json({ ok: false, error: "Remark too long after trim" }, { status: 400 });
  }

  // ── 1. Load assignment + parent order ──────────────────────────────────────
  // tint_assignments.skipEventId is BigInt; we use { select } so it doesn't
  // leak into intermediate state (and we never echo it in the response).
  const asg = await prisma.tint_assignments.findFirst({
    where: {
      id:     assignmentId,
      status: { in: ["assigned", "tinting_in_progress", "paused"] },
    },
    select: {
      id:                 true,
      orderId:            true,
      splitId:            true,
      assignedToId:       true,
      status:             true,
      startedAt:          true,
      lastPausedAt:       true,
      pauseCount:         true,
      accumulatedMinutes: true,
      order: { select: { id: true, obdNumber: true, workflowStage: true } },
    },
  });
  if (!asg) {
    return NextResponse.json({ ok: false, error: "Assignment not found" }, { status: 404 });
  }
  // Whole-OBD only per Phase 4 scope (matches Phase 3a skip).
  if (asg.splitId !== null) {
    return NextResponse.json(
      { ok: false, error: "Split jobs cannot be paused via this route" },
      { status: 400 },
    );
  }
  if (asg.assignedToId !== userId) {
    return NextResponse.json({ ok: false, error: "Not your job" }, { status: 403 });
  }
  // Schema status value is "tinting_in_progress" — spec wording "in_progress"
  // is loose; the canonical value is the longer string.
  if (asg.status !== "tinting_in_progress") {
    return NextResponse.json(
      { ok: false, error: "Only in-progress jobs can be paused", status: asg.status },
      { status: 409 },
    );
  }
  if (!asg.startedAt) {
    return NextResponse.json(
      { ok: false, error: "Cannot pause: assignment has no startedAt" },
      { status: 409 },
    );
  }

  // ── 2. Per-job cap ─────────────────────────────────────────────────────────
  if (asg.pauseCount >= MAX_PAUSE_COUNT_PER_JOB) {
    return NextResponse.json(
      { ok: false, error: `Pause limit reached (${MAX_PAUSE_COUNT_PER_JOB}× per job)` },
      { status: 409 },
    );
  }

  // ── 3. Concurrent-cap defensive check ──────────────────────────────────────
  // Operator should never have more than 1 in-progress + 3 paused = 4 total.
  // The current job already counts (it's in-progress); after this pause, the
  // total stays the same. Reject if state appears corrupted.
  const concurrentCount = await prisma.tint_assignments.count({
    where: {
      assignedToId: userId,
      status:       { in: ["tinting_in_progress", "paused"] },
    },
  });
  if (concurrentCount > MAX_CONCURRENT_FOR_OPERATOR) {
    return NextResponse.json(
      { ok: false, error: "Concurrent job cap exceeded — please refresh and retry" },
      { status: 409 },
    );
  }

  // ── 4. Validate progress against the tinting lines ─────────────────────────
  // Whole-OBD: lines come from import_raw_line_items by obdNumber + isTinting.
  const tintingLines = await prisma.import_raw_line_items.findMany({
    where: {
      obdNumber:  asg.order.obdNumber,
      isTinting:  true,
      lineStatus: "active",
    },
    select: { id: true, unitQty: true, skuCodeRaw: true },
  });

  const progressMap = new Map<number, number>();
  for (const p of progress) progressMap.set(p.skuId, p.doneQty);

  // Coverage check — progress must include an entry for every tinting line.
  const missing = tintingLines.filter((l) => !progressMap.has(l.id));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok:        false,
        error:     "Progress must cover every tinting line",
        missingSkuIds: missing.map((l) => l.id),
      },
      { status: 400 },
    );
  }
  // Range check — 0 ≤ doneQty ≤ unitQty for each line.
  for (const line of tintingLines) {
    const done = progressMap.get(line.id)!;
    if (done < 0 || done > line.unitQty) {
      return NextResponse.json(
        {
          ok:    false,
          error: `Invalid doneQty for line ${line.id}: 0..${line.unitQty} allowed, got ${done}`,
        },
        { status: 400 },
      );
    }
  }

  // ── 5. Compute elapsedMinutes for this run ─────────────────────────────────
  const now = new Date();
  const baseline =
    asg.lastPausedAt && asg.lastPausedAt.getTime() > asg.startedAt.getTime()
      ? asg.lastPausedAt
      : asg.startedAt;
  const elapsedMs = now.getTime() - baseline.getTime();
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60000));
  const newAccumulated = asg.accumulatedMinutes + elapsedMinutes;
  const newPauseCount  = asg.pauseCount + 1;

  // Snapshot of the canonical progress shape persisted as jsonb. Stored on
  // both tint_pause_events.progressSnapshot (per-event audit) and
  // tint_assignments.currentProgress (latest, resume seeds from this).
  const progressSnapshot = {
    items: progress.map((p) => ({ skuId: p.skuId, doneQty: p.doneQty })),
    capturedAt: now.toISOString(),
  };

  // ── 6. Create pause event ──────────────────────────────────────────────────
  // Schema field names: operatorId (not pausedById), pauseReason, pauseRemark,
  // progressSnapshot, elapsedMinutesAtPause.
  const event = await prisma.tint_pause_events.create({
    data: {
      orderId:               asg.orderId,
      assignmentId:          asg.id,
      operatorId:            userId,
      pausedAt:              now,
      pauseReason:           reason,
      // tinterType + outOfStockColours are Phase-1 schema columns reserved for
      // the (yet unused) "out-of-stock" pause variant. Not in the Phase 4a
      // body contract — set to null/empty.
      tinterType:            null,
      outOfStockColours:     [],
      pauseRemark:           remarkTrimmed.length > 0 ? remarkTrimmed : null,
      progressSnapshot:      progressSnapshot,
      elapsedMinutesAtPause: elapsedMinutes,
    },
    select: { id: true },
  });

  // ── 7. Update assignment ───────────────────────────────────────────────────
  await prisma.tint_assignments.update({
    where: { id: asg.id },
    data: {
      status:             "paused",
      lastPausedAt:       now,
      pauseCount:         newPauseCount,
      accumulatedMinutes: newAccumulated,
      currentProgress:    progressSnapshot,
    },
  });

  // ── 8. Audit log (INSERT-ONLY) ─────────────────────────────────────────────
  const fromStage = asg.order.workflowStage;
  const noteParts: string[] = [
    `Reason: ${reason}`,
    `Pause #${newPauseCount}`,
    `Elapsed: ${elapsedMinutes}m`,
  ];
  if (remarkTrimmed.length > 0) noteParts.push(`Remark: ${remarkTrimmed}`);
  await prisma.order_status_logs.create({
    data: {
      orderId:     asg.orderId,
      fromStage,
      toStage:     "OPERATOR_PAUSE",
      changedById: userId,
      note:        noteParts.join(" · "),
    },
  });

  // BigInt → Number for the response (tint_pause_events.id is bigserial).
  return NextResponse.json({
    ok:             true,
    pauseEventId:   Number(event.id),
    newPauseCount,
  });
}
