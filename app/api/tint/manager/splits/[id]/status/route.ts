import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);

  const splitId = parseInt(params.id, 10);
  if (isNaN(splitId)) {
    return NextResponse.json({ error: "Invalid split ID" }, { status: 400 });
  }

  const body = (await req.json()) as {
    dispatchStatus?: string | null;
    priority?: string;
  };

  const { dispatchStatus, priority } = body;

  console.log("[split/status PATCH] body:", body);

  const updateData: Record<string, unknown> = {};

  if (dispatchStatus !== undefined) {
    if (dispatchStatus !== null) {
      const VALID_DISPATCH = ["dispatch", "hold", "waiting_for_confirmation"];
      if (!VALID_DISPATCH.includes(dispatchStatus)) {
        return NextResponse.json({ error: "Invalid dispatchStatus" }, { status: 400 });
      }
    }
    updateData.dispatchStatus = dispatchStatus;
  }

  if (priority !== undefined) {
    if (!["normal", "urgent"].includes(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }
    updateData.priorityLevel = priority === "urgent" ? 1 : 5;
  }

  console.log("[split/status PATCH] updateData:", updateData);

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const split = await prisma.order_splits.findUnique({ where: { id: splitId } });
    if (!split) {
      return NextResponse.json({ error: "Split not found" }, { status: 404 });
    }

    await prisma.order_splits.update({
      where: { id: splitId },
      data:  updateData,
    });

    await prisma.split_status_logs.create({
      data: {
        splitId,
        fromStage:   split.status,
        toStage:     split.status,
        changedById: parseInt(session!.user.id, 10),
        note:        `Tint Manager updated: ${Object.keys(updateData).join(", ")}`,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PATCH split status error:", err);
    return NextResponse.json({ error: "Failed to update split" }, { status: 500 });
  }
}
