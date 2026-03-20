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

class NotAssignedError extends Error {
  constructor() { super("NOT_ASSIGNED"); }
}
class WrongStageError extends Error {
  constructor() { super("WRONG_STAGE"); }
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "tint_operator", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { splitId } = parsed.data;
  const userId = parseInt(session!.user.id, 10);

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Load split — verify ownership and stage
      const split = await tx.order_splits.findUnique({ where: { id: splitId } });
      if (!split) throw new Error("Split not found");
      if (split.assignedToId !== userId) throw new NotAssignedError();
      if (split.status !== "tinting_in_progress") throw new WrongStageError();

      const now = new Date();

      // 2a. Update order_splits: mark tinting_done
      await tx.order_splits.update({
        where: { id: splitId },
        data:  { status: "tinting_done", completedAt: now },
      });

      // 2b. INSERT split_status_logs: tinting_in_progress → tinting_done
      await tx.split_status_logs.create({
        data: {
          splitId,
          fromStage:   "tinting_in_progress",
          toStage:     "tinting_done",
          changedById: userId,
          note:        "Operator completed tinting",
        },
      });

      // 2c. INSERT tint_logs: split_done
      await tx.tint_logs.create({
        data: {
          orderId:       split.orderId,
          splitId,
          action:        "split_done",
          performedById: userId,
          note:          "Split completed",
        },
      });
    });
  } catch (err) {
    if (err instanceof NotAssignedError) {
      return NextResponse.json({ error: "Not assigned to this split" }, { status: 403 });
    }
    if (err instanceof WrongStageError) {
      return NextResponse.json({ error: "Split is not in tinting_in_progress stage" }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to complete split" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
