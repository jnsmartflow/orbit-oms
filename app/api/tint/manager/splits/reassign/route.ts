import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  splitId:      z.number().int().positive(),
  assignedToId: z.number().int().positive(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { splitId, assignedToId } = parsed.data;
  const managerId = parseInt(session!.user.id, 10);

  // Load split
  const split = await prisma.order_splits.findUnique({ where: { id: splitId } });
  if (!split) {
    return NextResponse.json({ error: "Split not found" }, { status: 404 });
  }
  if (split.status !== "tint_assigned") {
    return NextResponse.json(
      { error: "Only splits in tint_assigned status can be re-assigned" },
      { status: 409 },
    );
  }

  // Verify new operator exists
  const operator = await prisma.users.findUnique({ where: { id: assignedToId } });
  if (!operator) {
    return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  }

  const updatedSplit = await prisma.$transaction(async (tx) => {
    // Audit log
    await tx.split_status_logs.create({
      data: {
        splitId,
        fromStage:   "tint_assigned",
        toStage:     "tint_assigned",
        changedById: managerId,
        note:        `Re-assigned from operator ${split.assignedToId ?? "?"} to ${assignedToId}`,
      },
    });

    // Tint log
    await tx.tint_logs.create({
      data: {
        orderId:       split.orderId,
        splitId,
        action:        "split_reassigned",
        performedById: managerId,
        note:          `Re-assigned to operator ${assignedToId}`,
      },
    });

    return tx.order_splits.update({
      where: { id: splitId },
      data:  { assignedToId },
    });
  });

  return NextResponse.json({ split: updatedSplit });
}
