import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PackCode } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!hasRole(session, [ROLES.TINT_OPERATOR, ROLES.ADMIN])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Step 1 — Parse params
  const id = Number(params.id);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");

  if (type !== "split" && type !== "assignment") {
    return NextResponse.json(
      { error: "type must be split or assignment" },
      { status: 400 },
    );
  }

  // Step 2 — Query tinter_issue_entries_b
  const entries = await prisma.tinter_issue_entries_b.findMany({
    where: type === "split" ? { splitId: id } : { tintAssignmentId: id },
    select: {
      id:           true,
      rawLineItemId: true,
      baseSku:      true,
      tinQty:       true,
      packCode:     true,
      YE2:          true,
      YE1:          true,
      XY1:          true,
      XR1:          true,
      WH1:          true,
      RE2:          true,
      RE1:          true,
      OR1:          true,
      NO2:          true,
      NO1:          true,
      MA1:          true,
      GR1:          true,
      BU2:          true,
      BU1:          true,
      createdAt:    true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Step 3 — Return (empty array is valid — not a 404)
  return NextResponse.json({ entries });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!hasRole(session, [ROLES.TINT_OPERATOR, ROLES.ADMIN])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entryId = parseInt(params.id, 10);
  if (isNaN(entryId)) {
    return NextResponse.json({ error: "Invalid entry id" }, { status: 400 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = parseInt(session!.user.id, 10);

  const entry = await prisma.tinter_issue_entries_b.findUnique({ where: { id: entryId } });
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  let stageOk = false;
  if (entry.splitId) {
    const split = await prisma.order_splits.findUnique({ where: { id: entry.splitId } });
    if (!split) return NextResponse.json({ error: "Split not found" }, { status: 404 });
    if (split.assignedToId !== userId && entry.submittedById !== userId) {
      return NextResponse.json({ error: "Not authorized to edit this entry" }, { status: 403 });
    }
    stageOk = ["tint_assigned", "tinting_in_progress"].includes(split.status);
  } else if (entry.tintAssignmentId) {
    const assignment = await prisma.tint_assignments.findUnique({ where: { id: entry.tintAssignmentId } });
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (assignment.assignedToId !== userId && entry.submittedById !== userId) {
      return NextResponse.json({ error: "Not authorized to edit this entry" }, { status: 403 });
    }
    stageOk = ["assigned", "tinting_in_progress"].includes(assignment.status);
  }
  if (!stageOk) {
    return NextResponse.json({ error: "Entry cannot be edited — job is already done" }, { status: 403 });
  }

  const {
    baseSku, tinQty, packCode: packCodeRaw, rawLineItemId,
    YE2, YE1, XY1, XR1, WH1, RE2, RE1, OR1, NO2, NO1, MA1, GR1, BU2, BU1,
  } = body as Record<string, unknown>;

  if (!baseSku || typeof baseSku !== "string") {
    return NextResponse.json({ error: "baseSku is required" }, { status: 400 });
  }
  if (packCodeRaw !== undefined && packCodeRaw !== null && !(packCodeRaw as string in PackCode)) {
    return NextResponse.json({ error: "Invalid packCode" }, { status: 400 });
  }

  const updated = await prisma.tinter_issue_entries_b.update({
    where: { id: entryId },
    data: {
      baseSku:       String(baseSku).trim(),
      tinQty:        Number(tinQty ?? 0),
      packCode:      (packCodeRaw ?? null) as PackCode | null,
      rawLineItemId: rawLineItemId != null ? Number(rawLineItemId) : entry.rawLineItemId,
      YE2: Number(YE2 ?? 0), YE1: Number(YE1 ?? 0), XY1: Number(XY1 ?? 0),
      XR1: Number(XR1 ?? 0), WH1: Number(WH1 ?? 0), RE2: Number(RE2 ?? 0),
      RE1: Number(RE1 ?? 0), OR1: Number(OR1 ?? 0), NO2: Number(NO2 ?? 0),
      NO1: Number(NO1 ?? 0), MA1: Number(MA1 ?? 0), GR1: Number(GR1 ?? 0),
      BU2: Number(BU2 ?? 0), BU1: Number(BU1 ?? 0),
    },
  });

  return NextResponse.json(updated);
}
