import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  dispatchStatus: z.string().optional(),
  priorityLevel:  z.number().int().min(1).max(5).optional(),
  dispatchSlot:   z.string().nullable().optional(),
  note:           z.string().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN, ROLES.OPERATIONS]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "support_queue", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid split ID" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { dispatchStatus, priorityLevel, dispatchSlot, note } = parsed.data;
  const userId = parseInt(session!.user.id, 10);

  // 1. Load split
  const split = await prisma.order_splits.findUnique({ where: { id } });
  if (!split) {
    return NextResponse.json({ error: "Split not found" }, { status: 404 });
  }

  // 2. Build update data + log entries
  const updateData: Prisma.order_splitsUpdateInput = {};

  type LogEntry = {
    splitId:     number;
    fromStage:   string | null;
    toStage:     string;
    changedById: number;
    note:        string | null;
  };

  const logEntries: LogEntry[] = [];
  const logNote = note ?? null;

  if (dispatchStatus !== undefined && dispatchStatus !== split.dispatchStatus) {
    updateData.dispatchStatus = dispatchStatus || null;
    logEntries.push({
      splitId:     id,
      fromStage:   split.dispatchStatus ?? null,
      toStage:     dispatchStatus || "cleared",
      changedById: userId,
      note:        logNote,
    });
  }

  if (priorityLevel !== undefined && priorityLevel !== split.priorityLevel) {
    updateData.priorityLevel = priorityLevel;
    logEntries.push({
      splitId:     id,
      fromStage:   String(split.priorityLevel),
      toStage:     String(priorityLevel),
      changedById: userId,
      note:        logNote,
    });
  }

  if (dispatchSlot !== undefined && dispatchSlot !== split.dispatchSlot) {
    updateData.dispatchSlot = dispatchSlot || null;
    logEntries.push({
      splitId:     id,
      fromStage:   split.dispatchSlot ?? null,
      toStage:     dispatchSlot || "cleared",
      changedById: userId,
      note:        logNote,
    });
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ split }); // nothing changed
  }

  // 3. Write in transaction — INSERT split_status_logs then update split
  const updatedSplit = await prisma.$transaction(async (tx) => {
    for (const entry of logEntries) {
      await tx.split_status_logs.create({ data: entry });
    }
    return tx.order_splits.update({ where: { id }, data: updateData });
  });

  return NextResponse.json({ split: updatedSplit });
}
