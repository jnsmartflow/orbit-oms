import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!hasRole(session, [ROLES.TINT_OPERATOR, ROLES.ADMIN])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    orderId,
    splitId,
    tintAssignmentId,
    entries,
  } = body as {
    orderId?: unknown;
    splitId?: unknown;
    tintAssignmentId?: unknown;
    entries?: unknown;
  };

  // Validate orderId
  if (typeof orderId !== "number") {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // Validate mutual exclusivity of splitId / tintAssignmentId
  const hasSplit = splitId !== undefined && splitId !== null;
  const hasAssignment = tintAssignmentId !== undefined && tintAssignmentId !== null;

  if (!hasSplit && !hasAssignment) {
    return NextResponse.json(
      { error: "Either splitId or tintAssignmentId is required" },
      { status: 400 },
    );
  }
  if (hasSplit && hasAssignment) {
    return NextResponse.json(
      { error: "Provide either splitId or tintAssignmentId, not both" },
      { status: 400 },
    );
  }

  // Validate entries
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json(
      { error: "At least one entry is required" },
      { status: 400 },
    );
  }

  for (const entry of entries as Array<Record<string, unknown>>) {
    if (!entry.baseSku || typeof entry.baseSku !== "string" || entry.baseSku.trim() === "") {
      return NextResponse.json(
        { error: "baseSku is required for all entries" },
        { status: 400 },
      );
    }
  }

  const userId = parseInt(session!.user.id, 10);

  try {
    // Step 1 — Validate the target row exists and belongs to this operator
    if (hasSplit) {
      const split = await prisma.order_splits.findFirst({
        where: { id: Number(splitId), assignedToId: userId },
      });
      if (!split) {
        return NextResponse.json(
          { error: "Split not found or not assigned to you" },
          { status: 404 },
        );
      }
    } else {
      const assignment = await prisma.tint_assignments.findFirst({
        where: { id: Number(tintAssignmentId), assignedToId: userId },
      });
      if (!assignment) {
        return NextResponse.json(
          { error: "Assignment not found or not assigned to you" },
          { status: 404 },
        );
      }
    }

    // Step 2 — Insert all entries into tinter_issue_entries
    const typedEntries = entries as Array<{
      baseSku: string;
      tinQty?: unknown;
      YOX?: unknown; LFY?: unknown; GRN?: unknown; TBL?: unknown; WHT?: unknown;
      MAG?: unknown; FFR?: unknown; BLK?: unknown; OXR?: unknown; HEY?: unknown;
      HER?: unknown; COB?: unknown; COG?: unknown;
    }>;

    await prisma.tinter_issue_entries.createMany({
      data: typedEntries.map((entry) => ({
        orderId:           Number(orderId),
        splitId:           hasSplit ? Number(splitId) : null,
        tintAssignmentId:  hasAssignment ? Number(tintAssignmentId) : null,
        submittedById:     userId,
        baseSku:           entry.baseSku.trim(),
        tinQty:            Number(entry.tinQty ?? 0),
        YOX:               Number(entry.YOX ?? 0),
        LFY:               Number(entry.LFY ?? 0),
        GRN:               Number(entry.GRN ?? 0),
        TBL:               Number(entry.TBL ?? 0),
        WHT:               Number(entry.WHT ?? 0),
        MAG:               Number(entry.MAG ?? 0),
        FFR:               Number(entry.FFR ?? 0),
        BLK:               Number(entry.BLK ?? 0),
        OXR:               Number(entry.OXR ?? 0),
        HEY:               Number(entry.HEY ?? 0),
        HER:               Number(entry.HER ?? 0),
        COB:               Number(entry.COB ?? 0),
        COG:               Number(entry.COG ?? 0),
      })),
    });

    // Step 3 — Set tiSubmitted = true on the parent row
    if (hasSplit) {
      await prisma.order_splits.update({
        where: { id: Number(splitId) },
        data:  { tiSubmitted: true },
      });
    } else {
      await prisma.tint_assignments.update({
        where: { id: Number(tintAssignmentId) },
        data:  { tiSubmitted: true },
      });
    }

    // Step 4 — Return response
    return NextResponse.json({ success: typedEntries.length }, { status: 200 });
  } catch (err) {
    console.error("[tinter-issue POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
