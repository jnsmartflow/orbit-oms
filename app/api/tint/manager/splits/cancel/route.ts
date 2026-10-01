import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  splitId: z.number().int().positive(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). Resolves against the caller's
  // own user_page_access row; both superuser arms live inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { splitId } = parsed.data;
  const managerId = parseInt(session!.user.id, 10);

  // Load split
  const split = await prisma.order_splits.findUnique({ where: { id: splitId } });
  if (!split) {
    return NextResponse.json({ error: "Split not found" }, { status: 404 });
  }
  if (split.status === "tinting_in_progress" || split.status === "tinting_done") {
    return NextResponse.json(
      { error: "Cannot cancel a split that is in progress or already done" },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    // INSERT-ONLY audit logs — never delete these
    await tx.split_status_logs.create({
      data: {
        splitId,
        fromStage:   split.status,
        toStage:     "cancelled",
        changedById: managerId,
        note:        `Split #${split.splitNumber} cancelled`,
      },
    });

    await tx.tint_logs.create({
      data: {
        orderId:       split.orderId,
        splitId,
        action:        "split_cancelled",
        performedById: managerId,
        note:          `Split #${split.splitNumber} cancelled`,
      },
    });

    // Delete split line items — frees up qty allocation for future splits
    // (These are not audit records — deletion is permitted)
    await tx.split_line_items.deleteMany({ where: { splitId } });

    // Mark split as cancelled — do NOT delete the row; tint_logs/split_status_logs
    // still hold FK references to it that must not be broken
    await tx.order_splits.update({
      where: { id: splitId },
      data:  { status: "cancelled", sequenceOrder: 0 },
    });

    // Reset to pending_tint_assignment — ONLY while the parent is still in the
    // tint stages. Cancelling a tint_assigned split frees qty, so a parent that
    // is still being tinted has unassigned qty again and must reappear on the
    // rail with the correct remaining-qty indicator.
    //
    // 🔴 GUARDED 2026-10-01 (Tint Manager tabs build step 3, plan §D). This used
    // to write unconditionally, with no order_status_logs row — so cancelling a
    // leftover split on a bill Floor (or the Tint Manager) had CANCELLED put the
    // bill silently back on the rail, un-cancelled with no trace. A parent
    // anywhere else (cancelled, finished, on the floor) is left exactly where it
    // is; only the split is cancelled.
    // ⚠ This route's $transaction is pre-existing and deliberately deferred
    // (CLAUDE_TINT §1.8, ROADMAP) — not changed here.
    const parent = await tx.orders.findUnique({
      where:  { id: split.orderId },
      select: { workflowStage: true },
    });
    if (
      parent !== null &&
      ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"].includes(parent.workflowStage)
    ) {
      await tx.orders.update({
        where: { id: split.orderId },
        data:  { workflowStage: "pending_tint_assignment" },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
