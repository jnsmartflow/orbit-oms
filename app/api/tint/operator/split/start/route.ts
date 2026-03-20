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

  // Guard 1 — TI gate: operator must have submitted the Tinter Issue form first
  const split = await prisma.order_splits.findFirst({
    where: {
      id: Number(splitId),
      assignedToId: Number(session!.user.id),
      status: { not: "cancelled" },
    },
    select: { tiSubmitted: true },
  });

  if (!split) {
    return NextResponse.json(
      { error: "Split not found or not assigned to you" },
      { status: 404 },
    );
  }

  if (!split.tiSubmitted) {
    return NextResponse.json(
      { error: "Please submit the Tinter Issue form before starting" },
      { status: 400 },
    );
  }

  // Guard 2 — One-job rule: operator may not have two jobs in progress simultaneously
  const activeJob = await prisma.$queryRaw`
    SELECT "operatorId" FROM operator_active_job
    WHERE "operatorId" = ${Number(session!.user.id)}
    LIMIT 1
  `;

  if ((activeJob as unknown[]).length > 0) {
    return NextResponse.json(
      { error: "You already have a job in progress. Complete it first." },
      { status: 400 },
    );
  }

  try {
    // 1. Verify split ownership and stage
    const splitRow = await prisma.order_splits.findUnique({
      where: { id: splitId },
    });
    if (!splitRow) {
      return NextResponse.json({ error: "Split not found" }, { status: 404 });
    }
    if (splitRow.assignedToId !== userId) {
      return NextResponse.json({ error: "Not assigned to you" }, { status: 403 });
    }
    if (splitRow.status !== "tint_assigned") {
      return NextResponse.json({ error: "Split is not in tint_assigned stage" }, { status: 400 });
    }

    // 2a. Update order_splits
    await prisma.order_splits.update({
      where: { id: splitId },
      data: { status: "tinting_in_progress", startedAt: new Date() },
    });

    // 2b. Insert split_status_logs
    await prisma.split_status_logs.create({
      data: {
        splitId,
        fromStage:   "tint_assigned",
        toStage:     "tinting_in_progress",
        changedById: userId,
      },
    });

    // 2c. Insert tint_logs
    await prisma.tint_logs.create({
      data: {
        orderId:       splitRow.orderId,
        splitId,
        action:        "split_started",
        performedById: userId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("split/start error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
