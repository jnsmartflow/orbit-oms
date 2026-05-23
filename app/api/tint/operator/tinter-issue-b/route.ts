import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PackCode, Prisma } from "@prisma/client";
import {
  getIstYearPrefix,
  resolveSamplingForEntry,
} from "../_lib/sampling-resolution";

export const dynamic = "force-dynamic";

const ACOTONE_PIGMENT_CODES = [
  "YE2", "YE1", "XY1", "XR1", "WH1", "RE2", "RE1", "OR1",
  "NO2", "NO1", "MA1", "GR1", "BU2", "BU1",
] as const;
type AcotonePigment = (typeof ACOTONE_PIGMENT_CODES)[number];

interface EntryResult {
  tiEntryId:           number;
  allocatedSamplingNo: string;
  isNewSampling:       boolean;
  isNewVariant:        boolean;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!hasRole(session, [ROLES.TINT_OPERATOR, ROLES.ADMIN, ROLES.OPERATIONS])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { splitId, tintAssignmentId, entries } = body as {
    splitId?:          unknown;
    tintAssignmentId?: unknown;
    entries?:          unknown;
  };

  const hasSplit      = splitId !== undefined && splitId !== null;
  const hasAssignment = tintAssignmentId !== undefined && tintAssignmentId !== null;

  if (!hasSplit && !hasAssignment) {
    return NextResponse.json({ error: "Either splitId or tintAssignmentId is required" }, { status: 400 });
  }
  if (hasSplit && hasAssignment) {
    return NextResponse.json({ error: "Provide either splitId or tintAssignmentId, not both" }, { status: 400 });
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: "At least one entry is required" }, { status: 400 });
  }

  // ── Pre-flight validation (no DB writes yet) ──────────────────────────────
  const typedEntries = entries as Array<Record<string, unknown>>;
  for (let i = 0; i < typedEntries.length; i++) {
    const entry = typedEntries[i];
    if (typeof entry.baseSku !== "string" || entry.baseSku.trim() === "") {
      return NextResponse.json({ error: `entry[${i}]: baseSku is required` }, { status: 400 });
    }
    if (!entry.packCode || typeof entry.packCode !== "string" || !(entry.packCode in PackCode)) {
      return NextResponse.json({ error: `entry[${i}]: packCode is required and must be a valid PackCode enum value` }, { status: 400 });
    }
    const sn = typeof entry.samplingNo === "string" && entry.samplingNo.trim() !== "" ? entry.samplingNo.trim() : null;
    const shn = typeof entry.shadeName === "string" && entry.shadeName.trim() !== "" ? entry.shadeName.trim() : null;
    if (sn === null && shn === null) {
      return NextResponse.json(
        { error: `entry[${i}]: pick an existing sampling number or enter a new shade name` },
        { status: 400 },
      );
    }
  }

  const userId = parseInt(session!.user.id, 10);
  const isOpsOrAdmin = ["operations", "admin"].includes(session!.user.role ?? "");

  try {
    // Step 1 — resolve orderId from split or assignment (ownership-gated)
    let orderId: number;
    if (hasSplit) {
      const split = await prisma.order_splits.findFirst({
        where: { id: Number(splitId), ...(isOpsOrAdmin ? {} : { assignedToId: userId }) },
      });
      if (!split) return NextResponse.json({ error: "Split not found or not assigned to you" }, { status: 404 });
      orderId = split.orderId;
    } else {
      const assignment = await prisma.tint_assignments.findFirst({
        where: { id: Number(tintAssignmentId), ...(isOpsOrAdmin ? {} : { assignedToId: userId }) },
      });
      if (!assignment) return NextResponse.json({ error: "Assignment not found or not assigned to you" }, { status: 404 });
      orderId = assignment.orderId;
    }

    // Step 2 — load order for siteId + obdNumber
    const order = await prisma.orders.findUnique({
      where:  { id: orderId },
      select: { obdNumber: true, customerId: true },
    });
    const siteId = order?.customerId ?? null;

    // Step 3 — best-effort dealer name lookup (only used when allocating new
    // sampling rows in Scenario 1).
    let dealerNameRaw: string | null = null;
    if (order?.obdNumber) {
      const summary = await prisma.import_raw_summary.findFirst({
        where:  { obdNumber: order.obdNumber },
        select: { billToCustomerName: true },
      });
      dealerNameRaw = summary?.billToCustomerName ?? null;
    }

    const yearPrefix = getIstYearPrefix();
    const results: EntryResult[] = [];

    // Step 4 — per-entry routing + writes (sequential)
    for (const entry of typedEntries) {
      const baseSku  = (entry.baseSku as string).trim();
      const packCode = entry.packCode as PackCode;
      const tinQty   = Number(entry.tinQty ?? 0);
      const rawLineItemId = entry.rawLineItemId != null ? Number(entry.rawLineItemId) : null;

      const bodySamplingNo = typeof entry.samplingNo === "string" && entry.samplingNo.trim() !== ""
        ? entry.samplingNo.trim() : null;
      const bodyShadeName = typeof entry.shadeName === "string" && entry.shadeName.trim() !== ""
        ? entry.shadeName.trim() : null;

      const pigments = {} as Record<AcotonePigment, number>;
      for (const code of ACOTONE_PIGMENT_CODES) {
        pigments[code] = Number(entry[code] ?? 0);
      }

      let resolution;
      try {
        resolution = await resolveSamplingForEntry({
          tinterType: "ACOTONE",
          bodySamplingNo,
          bodyShadeName,
          baseSku,
          packCode,
          userId,
          siteId,
          dealerName: dealerNameRaw,
          yearPrefix,
          pigments,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("Sampling number ") && msg.endsWith(" not found")) {
          return NextResponse.json({ error: msg }, { status: 400 });
        }
        throw err;
      }

      const ti = await prisma.tinter_issue_entries_b.create({
        data: {
          orderId,
          splitId:          hasSplit ? Number(splitId) : null,
          tintAssignmentId: hasAssignment ? Number(tintAssignmentId) : null,
          rawLineItemId,
          submittedById:    userId,
          baseSku,
          tinQty:           new Prisma.Decimal(tinQty),
          packCode,
          samplingNo:       resolution.resolvedSamplingNo,
          shadeName:        resolution.resolvedShadeName,
          ...pigments,
        },
      });

      results.push({
        tiEntryId:           ti.id,
        allocatedSamplingNo: resolution.resolvedSamplingNo,
        isNewSampling:       resolution.isNewSampling,
        isNewVariant:        resolution.isNewVariant,
      });
    }

    // Step 5 — mark parent submitted
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

    return NextResponse.json({ success: results.length, entries: results }, { status: 200 });
  } catch (err) {
    console.error("[tinter-issue-b POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
