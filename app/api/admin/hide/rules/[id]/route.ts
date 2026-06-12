import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Hide rule by id — admin-only PATCH / DELETE for obd_visibility_rules.
// Same V1 validation as the collection route (only conditionTag 'HOLD').
// ─────────────────────────────────────────────────────────────────────────────

const VALID_CONDITION_TYPES = ["tag", "daysOld"];
const SUPPORTED_TAGS = ["HOLD"]; // URGENT / MISSING_CUSTOMER deferred (V1).

// PATCH — partial update; validate any provided field.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  const ruleId = parseInt(params.id, 10);
  if (!Number.isFinite(ruleId) || ruleId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid rule id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    ruleName,
    conditionType,
    conditionTag,
    conditionDaysGt,
    isActive,
  } = (body ?? {}) as {
    ruleName?: unknown;
    conditionType?: unknown;
    conditionTag?: unknown;
    conditionDaysGt?: unknown;
    isActive?: unknown;
  };

  // ── Load existing (404 if missing). Needed to resolve the effective
  //    conditionType when validating a tag/days change in isolation. ──────────
  const existing = await prisma.obd_visibility_rules.findUnique({ where: { id: ruleId } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Rule not found" }, { status: 404 });
  }

  const data: Prisma.obd_visibility_rulesUpdateInput = {};

  if (ruleName !== undefined) {
    if (typeof ruleName !== "string" || ruleName.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "ruleName must be non-empty" }, { status: 400 });
    }
    data.ruleName = ruleName.trim();
  }

  if (conditionType !== undefined) {
    if (typeof conditionType !== "string" || !VALID_CONDITION_TYPES.includes(conditionType)) {
      return NextResponse.json({ ok: false, error: "conditionType must be 'tag' or 'daysOld'" }, { status: 400 });
    }
    data.conditionType = conditionType;
  }

  // Effective type after this patch (provided value or existing).
  const effectiveType =
    typeof conditionType === "string" ? conditionType : existing.conditionType;

  if (conditionTag !== undefined) {
    if (effectiveType === "tag") {
      if (typeof conditionTag !== "string" || !SUPPORTED_TAGS.includes(conditionTag)) {
        return NextResponse.json({ ok: false, error: "conditionTag must be 'HOLD'" }, { status: 400 });
      }
      data.conditionTag = conditionTag;
    } else {
      // Allow explicit clear when not a tag rule.
      if (conditionTag !== null) {
        return NextResponse.json({ ok: false, error: "conditionTag only valid for tag rules" }, { status: 400 });
      }
      data.conditionTag = null;
    }
  }

  if (conditionDaysGt !== undefined) {
    if (effectiveType === "daysOld") {
      if (typeof conditionDaysGt !== "number" || !Number.isInteger(conditionDaysGt) || conditionDaysGt < 1) {
        return NextResponse.json({ ok: false, error: "conditionDaysGt must be an integer ≥ 1" }, { status: 400 });
      }
      data.conditionDaysGt = conditionDaysGt;
    } else {
      if (conditionDaysGt !== null) {
        return NextResponse.json({ ok: false, error: "conditionDaysGt only valid for daysOld rules" }, { status: 400 });
      }
      data.conditionDaysGt = null;
    }
  }

  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") {
      return NextResponse.json({ ok: false, error: "isActive must be boolean" }, { status: 400 });
    }
    data.isActive = isActive;
  }

  const userId = parseInt(session.user.id, 10);
  data.updatedById = userId;
  data.updatedAt = new Date();

  const rule = await prisma.obd_visibility_rules.update({
    where: { id: ruleId },
    data,
  });

  return NextResponse.json({ ok: true, rule });
}

// DELETE — hard-delete the rule (safe: removing a rule un-hides its orders).
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  const ruleId = parseInt(params.id, 10);
  if (!Number.isFinite(ruleId) || ruleId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid rule id" }, { status: 400 });
  }

  const existing = await prisma.obd_visibility_rules.findUnique({ where: { id: ruleId } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Rule not found" }, { status: 404 });
  }

  await prisma.obd_visibility_rules.delete({ where: { id: ruleId } });

  return NextResponse.json({ ok: true });
}
