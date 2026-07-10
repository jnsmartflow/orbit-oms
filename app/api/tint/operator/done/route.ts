import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import {
  getIstUsageDate,
  writeUsageLogsForAssignment,
} from "../_lib/usage-log-writer";

export const dynamic = "force-dynamic";

// Phase 4f — body extended to capture the final per-SKU progress snapshot.
// Validation mirrors /api/tint/operator/pause exactly: relaxed range
// 0 ≤ doneQty ≤ unitQty per line, coverage required for every tinting line.
const progressItemSchema = z.object({
  skuId:   z.number().int().positive(),
  doneQty: z.number().int().min(0),
});

const bodySchema = z.object({
  orderId:  z.number().int().positive(),
  progress: z.array(progressItemSchema),
});


export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR, ROLES.OPERATIONS]);
  const userRoles = session!.user.roles ?? [session!.user.role];
  const isAdminOrOps = userRoles.includes("admin") || userRoles.includes(ROLES.OPERATIONS);
  if (!isAdminOrOps) {
    const allowed = await checkAnyPermission(userRoles, "tint_operator", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { orderId, progress } = parsed.data;
  const userId = parseInt(session!.user.id, 10);
  const isOpsOrAdmin = ["operations", "admin"].includes(session!.user.role ?? "");

  try {
    // 1. Load order — verify stage
    const order = await prisma.orders.findFirst({ where: { id: orderId, isRemoved: false } })
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }
    if (order.workflowStage !== "tinting_in_progress") {
      return NextResponse.json({ error: "Order is not currently in tinting" }, { status: 409 })
    }

    // 2. Verify active assignment
    const activeAssignment = await prisma.tint_assignments.findFirst({
      where: {
        orderId,
        ...(isOpsOrAdmin ? {} : { assignedToId: userId }),
        status:       "tinting_in_progress",
      },
    })
    if (!activeAssignment) {
      return NextResponse.json({ error: "No active assignment found for this order" }, { status: 403 })
    }

    // TI completion gate — all isTinting lines must have at least one TI entry.
    // Phase 4f — also pulls unitQty so the progress array can be range-checked
    // below in the same pass (no extra query).
    const isTintingRawLines = await prisma.import_raw_line_items.findMany({
      where: { obdNumber: order.obdNumber, isTinting: true, lineStatus: "active" },
      select: { id: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true },
    });
    if (isTintingRawLines.length > 0) {
      const [entriesA, entriesB] = await Promise.all([
        prisma.tinter_issue_entries.findMany({
          where: { tintAssignmentId: activeAssignment.id, rawLineItemId: { not: null } },
          select: { rawLineItemId: true },
        }),
        prisma.tinter_issue_entries_b.findMany({
          where: { tintAssignmentId: activeAssignment.id, rawLineItemId: { not: null } },
          select: { rawLineItemId: true },
        }),
      ]);
      const covered = new Set<number>([
        ...entriesA.map(e => e.rawLineItemId!),
        ...entriesB.map(e => e.rawLineItemId!),
      ]);
      const missingLines = isTintingRawLines
        .filter(l => !covered.has(l.id))
        .map(l => ({ rawLineItemId: l.id, skuCodeRaw: l.skuCodeRaw, skuDescriptionRaw: l.skuDescriptionRaw }));
      if (missingLines.length > 0) {
        return NextResponse.json({
          error:        "TI incomplete",
          message:      "Tinter Issue entries are missing for some SKU lines. Please complete all entries before marking done.",
          missingLines,
        }, { status: 400 });
      }
    }

    // Phase 4f — validate the progress array against the tinting lines.
    // Mirrors the pause-route pattern (Phase 4a lines 149-187): coverage
    // required for every tinting line, range check 0 ≤ doneQty ≤ unitQty.
    const progressMap = new Map<number, number>();
    for (const p of progress) progressMap.set(p.skuId, p.doneQty);
    const missingProgress = isTintingRawLines.filter((l) => !progressMap.has(l.id));
    if (missingProgress.length > 0) {
      return NextResponse.json(
        {
          error:         "Progress must cover every tinting line",
          missingSkuIds: missingProgress.map((l) => l.id),
        },
        { status: 400 },
      );
    }
    for (const line of isTintingRawLines) {
      const done = progressMap.get(line.id)!;
      if (done < 0 || done > line.unitQty) {
        return NextResponse.json(
          {
            error: `Invalid doneQty for line ${line.id}: 0..${line.unitQty} allowed, got ${done}`,
          },
          { status: 400 },
        );
      }
    }

    // Phase 4f — finalise tinting-time math. Mirrors the pause-route elapsed
    // calc: the final run starts at lastPausedAt (if any) or startedAt. Since
    // we're transitioning from tinting_in_progress (not paused), lastPausedAt
    // is normally null here; the ?? falls through to startedAt.
    const now = new Date();
    const baseline = activeAssignment.lastPausedAt && activeAssignment.startedAt
      && activeAssignment.lastPausedAt.getTime() > activeAssignment.startedAt.getTime()
      ? activeAssignment.lastPausedAt
      : activeAssignment.startedAt;
    const finalRunMinutes = baseline
      ? Math.max(0, Math.floor((now.getTime() - baseline.getTime()) / 60000))
      : 0;
    const newAccumulated = activeAssignment.accumulatedMinutes + finalRunMinutes;

    // Final progress snapshot — same jsonb shape as pause-route writes.
    const progressSnapshot = {
      items:      progress.map((p) => ({ skuId: p.skuId, doneQty: p.doneQty })),
      capturedAt: now.toISOString(),
    };

    // 3. Update tint_assignments.
    // On done, accumulatedMinutes is finalised as the canonical total
    // tinting minutes (including all paused intervals). currentProgress
    // is overwritten with the final per-SKU snapshot.
    await prisma.tint_assignments.update({
      where: { id: activeAssignment.id },
      data:  {
        status:             "tinting_done",
        completedAt:        now,
        accumulatedMinutes: newAccumulated,
        currentProgress:    progressSnapshot,
      },
    })

    // 4. Update order stage + assign dispatch slot based on completion time
    const completionSlotId = (() => {
      const now = new Date();
      const istStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      const ist = new Date(istStr);
      const h = ist.getHours();
      const m = ist.getMinutes();
      const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      if (t < "10:30") return 1;
      if (t < "12:30") return 2;
      if (t < "15:30") return 3;
      return 4;
    })();

    const hasPresetSlot = order.dispatchWindowId != null && order.dispatchTargetDate != null;

    await prisma.orders.update({
      where: { id: orderId },
      data: hasPresetSlot
        ? {
            workflowStage: SUPPORT_DONE_OUTPUT,
            dispatchStatus: "dispatch",
            slotId: completionSlotId,
            originalSlotId: completionSlotId,
          }
        : {
            workflowStage: "pending_support",
            slotId: completionSlotId,
            originalSlotId: completionSlotId,
          },
    })

    // 5. INSERT tint_logs
    await prisma.tint_logs.create({
      data: {
        orderId,
        action:        "completed",
        performedById: userId,
      },
    })

    // 6. INSERT order_status_logs
    await prisma.order_status_logs.create({
      data: {
        orderId,
        fromStage:   "tinting_in_progress",
        toStage:     hasPresetSlot ? SUPPORT_DONE_OUTPUT : "pending_support",
        changedById: userId,
        note:        hasPresetSlot
          ? "Auto-dispatched on tint completion (operator pre-set slot)"
          : "Tinting completed — moved to support queue",
      },
    })

    // 7. Phase 4 — write sampling_usage_log rows for every TI under this
    //    assignment (TINTER + ACOTONE) + bump sampling_recipes.usageCount.
    //    Failures here MUST NOT fail Mark Done — the helper per-rows the
    //    try/catch and only returns counters. Mark Done's primary state
    //    transitions are already committed above.
    const usageLogResult = await writeUsageLogsForAssignment({
      tintAssignmentId:   activeAssignment.id,
      obdNumber:          order.obdNumber,
      shipToCustomerName: order.shipToCustomerName,
      operatorId:         userId,
      usageDate:          getIstUsageDate(),
      // Resolved ship-to delivery-point id (orders.customerId →
      // delivery_point_master.id) so the log row carries siteId. Nullable;
      // the writer falls back to sampling_register.siteId when null.
      siteId:             order.customerId,
    });

    return NextResponse.json({
      success: true,
      usageLogRows:    usageLogResult.written,
      usageLogSkipped: usageLogResult.skipped, // intentional skips (samplingNo=null)
      usageLogFailed:  usageLogResult.failed,  // unexpected per-row throws
    })
  } catch (err) {
    console.error("done error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
