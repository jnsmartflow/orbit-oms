import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PackCode } from "@prisma/client";

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
    splitId,
    tintAssignmentId,
    entries,
  } = body as {
    splitId?: unknown;
    tintAssignmentId?: unknown;
    entries?: unknown;
  };

  // Validate mutual exclusivity of splitId / tintAssignmentId
  const hasSplit      = splitId !== undefined && splitId !== null;
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
    if (entry.packCode !== undefined && entry.packCode !== null &&
        !(entry.packCode as string in PackCode)) {
      return NextResponse.json({ error: "Invalid packCode in entry" }, { status: 400 });
    }
  }

  const userId = parseInt(session!.user.id, 10);

  try {
    // Step 1 — Validate the target row exists and belongs to this operator; derive orderId
    let orderId: number;

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
      orderId = split.orderId;
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
      orderId = assignment.orderId;
    }

    // Step 2 — Insert all entries into tinter_issue_entries_b
    const typedEntries = entries as Array<{
      baseSku: string;
      tinQty?: unknown;
      packCode?: unknown;
      rawLineItemId?: unknown;
      YE2?: unknown; YE1?: unknown; XY1?: unknown; XR1?: unknown;
      WH1?: unknown; RE2?: unknown; RE1?: unknown; OR1?: unknown;
      NO2?: unknown; NO1?: unknown; MA1?: unknown; GR1?: unknown;
      BU2?: unknown; BU1?: unknown;
    }>;

    await prisma.tinter_issue_entries_b.createMany({
      data: typedEntries.map((entry) => ({
        orderId,
        splitId:          hasSplit ? Number(splitId) : null,
        tintAssignmentId: hasAssignment ? Number(tintAssignmentId) : null,
        rawLineItemId:    entry.rawLineItemId !== undefined && entry.rawLineItemId !== null ? Number(entry.rawLineItemId) : null,
        submittedById:    userId,
        baseSku:          entry.baseSku.trim(),
        tinQty:           Number(entry.tinQty ?? 0),
        packCode:         (entry.packCode ?? null) as PackCode | null,
        YE2: Number(entry.YE2 ?? 0),
        YE1: Number(entry.YE1 ?? 0),
        XY1: Number(entry.XY1 ?? 0),
        XR1: Number(entry.XR1 ?? 0),
        WH1: Number(entry.WH1 ?? 0),
        RE2: Number(entry.RE2 ?? 0),
        RE1: Number(entry.RE1 ?? 0),
        OR1: Number(entry.OR1 ?? 0),
        NO2: Number(entry.NO2 ?? 0),
        NO1: Number(entry.NO1 ?? 0),
        MA1: Number(entry.MA1 ?? 0),
        GR1: Number(entry.GR1 ?? 0),
        BU2: Number(entry.BU2 ?? 0),
        BU1: Number(entry.BU1 ?? 0),
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
    console.error("[tinter-issue-b POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
