import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  splitId: z.number().int().positive(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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

    // Always reset to pending_tint_assignment.
    // Cancelling any tint_assigned split always frees qty, meaning there is
    // now unassigned qty remaining on the OBD — regardless of how many other
    // active splits exist. The Pending column card must reappear with the
    // correct remaining qty indicator.
    await tx.orders.update({
      where: { id: split.orderId },
      data:  { workflowStage: "pending_tint_assignment" },
    });
  });

  return NextResponse.json({ ok: true });
}
