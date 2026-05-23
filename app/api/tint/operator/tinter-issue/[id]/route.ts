import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PackCode } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!hasRole(session, [ROLES.TINT_OPERATOR, ROLES.ADMIN, ROLES.OPERATIONS])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Step 1 — Parse params
  const id = Number(params.id);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { searchParams } = new URL(_req.url);
  const type = searchParams.get("type");

  if (type !== "split" && type !== "assignment") {
    return NextResponse.json(
      { error: "type must be split or assignment" },
      { status: 400 },
    );
  }

  // Step 2 — Query tinter_issue_entries
  const entries = await prisma.tinter_issue_entries.findMany({
    where: type === "split" ? { splitId: id } : { tintAssignmentId: id },
    select: {
      id:           true,
      rawLineItemId: true,
      packCode:     true,
      baseSku:      true,
      tinQty:       true,
      // Phase 4 (step 13) — round-trip Sampling Library linkage so the
      // operator screen's "Linked sampling" card survives reload.
      samplingNo:   true,
      shadeName:    true,
      YOX:          true,
      LFY:          true,
      GRN:          true,
      TBL:          true,
      WHT:          true,
      MAG:          true,
      FFR:          true,
      BLK:          true,
      OXR:          true,
      HEY:          true,
      HER:          true,
      COB:          true,
      COG:          true,
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
  if (!hasRole(session, [ROLES.TINT_OPERATOR, ROLES.ADMIN, ROLES.OPERATIONS])) {
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
  const isOpsOrAdmin = ["operations", "admin"].includes(session!.user.role ?? "");

  const entry = await prisma.tinter_issue_entries.findUnique({ where: { id: entryId } });
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  let stageOk = false;
  if (entry.splitId) {
    const split = await prisma.order_splits.findUnique({ where: { id: entry.splitId } });
    if (!split) return NextResponse.json({ error: "Split not found" }, { status: 404 });
    if (!isOpsOrAdmin && split.assignedToId !== userId && entry.submittedById !== userId) {
      return NextResponse.json({ error: "Not authorized to edit this entry" }, { status: 403 });
    }
    stageOk = ["tint_assigned", "tinting_in_progress"].includes(split.status);
  } else if (entry.tintAssignmentId) {
    const assignment = await prisma.tint_assignments.findUnique({ where: { id: entry.tintAssignmentId } });
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (!isOpsOrAdmin && assignment.assignedToId !== userId && entry.submittedById !== userId) {
      return NextResponse.json({ error: "Not authorized to edit this entry" }, { status: 403 });
    }
    stageOk = ["assigned", "tinting_in_progress"].includes(assignment.status);
  }
  if (!stageOk) {
    return NextResponse.json({ error: "Entry cannot be edited — job is already done" }, { status: 403 });
  }

  const {
    baseSku, tinQty, packCode: packCodeRaw, rawLineItemId,
    samplingNo: samplingNoRaw, shadeName: shadeNameRaw,
    YOX, LFY, GRN, TBL, WHT, MAG, FFR, BLK, OXR, HEY, HER, COB, COG,
  } = body as Record<string, unknown>;

  if (!baseSku || typeof baseSku !== "string") {
    return NextResponse.json({ error: "baseSku is required" }, { status: 400 });
  }
  if (packCodeRaw !== undefined && packCodeRaw !== null && !(packCodeRaw as string in PackCode)) {
    return NextResponse.json({ error: "Invalid packCode" }, { status: 400 });
  }

  // Phase 4: samplingNo + shadeName accepted; behaviour:
  //   - new samplingNo provided & matches existing TI row's samplingNo
  //     → treat as Scenario 3 mid-edit, update the sampling_recipes variant
  //       pigments (last-saved-wins).
  //   - samplingNo provided AND differs from current → just rewrite TI row's
  //     samplingNo + shadeName; do NOT touch sampling_recipes on old or new.
  //   - samplingNo omitted from body → leave TI row's samplingNo unchanged.
  let nextSamplingNo: string | null | undefined = undefined;
  if (samplingNoRaw !== undefined) {
    if (samplingNoRaw === null) {
      nextSamplingNo = null;
    } else if (typeof samplingNoRaw === "string" && samplingNoRaw.trim() !== "") {
      const candidate = samplingNoRaw.trim();
      const parent = await prisma.sampling_register.findUnique({
        where:  { samplingNo: candidate },
        select: { samplingNo: true },
      });
      if (!parent) {
        return NextResponse.json({ error: `Sampling number ${candidate} not found` }, { status: 400 });
      }
      nextSamplingNo = candidate;
    } else {
      return NextResponse.json({ error: "Invalid samplingNo" }, { status: 400 });
    }
  }

  let nextShadeName: string | null | undefined = undefined;
  if (shadeNameRaw !== undefined) {
    if (shadeNameRaw === null) {
      nextShadeName = null;
    } else if (typeof shadeNameRaw === "string") {
      const trimmed = shadeNameRaw.trim();
      nextShadeName = trimmed === "" ? null : trimmed;
    } else {
      return NextResponse.json({ error: "Invalid shadeName" }, { status: 400 });
    }
  }

  const finalSamplingNo = nextSamplingNo !== undefined ? nextSamplingNo : entry.samplingNo;
  const finalPackCode   = (packCodeRaw ?? entry.packCode) as PackCode | null;
  const finalBaseSku    = String(baseSku).trim();
  const pigments = {
    YOX: Number(YOX ?? 0), LFY: Number(LFY ?? 0), GRN: Number(GRN ?? 0),
    TBL: Number(TBL ?? 0), WHT: Number(WHT ?? 0), MAG: Number(MAG ?? 0),
    FFR: Number(FFR ?? 0), BLK: Number(BLK ?? 0), OXR: Number(OXR ?? 0),
    HEY: Number(HEY ?? 0), HER: Number(HER ?? 0), COB: Number(COB ?? 0),
    COG: Number(COG ?? 0),
  };

  // Scenario 3 mid-edit: same samplingNo as before AND we have a packCode →
  // update the matching sampling_recipes variant's pigment values.
  if (
    finalSamplingNo !== null
    && finalSamplingNo === entry.samplingNo
    && finalPackCode !== null
  ) {
    const variant = await prisma.sampling_recipes.findUnique({
      where:  { samplingNo_skuCode_packCode: { samplingNo: finalSamplingNo, skuCode: finalBaseSku, packCode: finalPackCode } },
      select: { id: true },
    });
    if (variant) {
      await prisma.sampling_recipes.update({
        where: { id: variant.id },
        data:  pigments,
      });
    }
  }

  const updated = await prisma.tinter_issue_entries.update({
    where: { id: entryId },
    data: {
      baseSku:       finalBaseSku,
      tinQty:        Number(tinQty ?? 0),
      packCode:      finalPackCode,
      rawLineItemId: rawLineItemId != null ? Number(rawLineItemId) : entry.rawLineItemId,
      ...(nextSamplingNo !== undefined ? { samplingNo: nextSamplingNo } : {}),
      ...(nextShadeName  !== undefined ? { shadeName:  nextShadeName  } : {}),
      ...pigments,
    },
  });

  return NextResponse.json(updated);
}
