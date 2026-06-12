import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Hide rules (Feature A bulk) — admin-only CRUD for obd_visibility_rules.
//
// V1 supports exactly two condition kinds:
//   - conditionType 'tag'     + conditionTag 'HOLD'  (URGENT/MISSING_CUSTOMER deferred)
//   - conditionType 'daysOld' + conditionDaysGt ≥ 1
// ─────────────────────────────────────────────────────────────────────────────

const VALID_CONDITION_TYPES = ["tag", "daysOld"];
const SUPPORTED_TAGS = ["HOLD"]; // URGENT / MISSING_CUSTOMER deferred (V1).

// GET — return all rules, oldest first.
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  const rules = await prisma.obd_visibility_rules.findMany({
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ ok: true, rules });
}

// POST — create a rule.
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
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
  } = (body ?? {}) as {
    ruleName?: unknown;
    conditionType?: unknown;
    conditionTag?: unknown;
    conditionDaysGt?: unknown;
  };

  // ── Validate ──────────────────────────────────────────────────────────────
  if (typeof ruleName !== "string" || ruleName.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "ruleName is required" }, { status: 400 });
  }
  if (typeof conditionType !== "string" || !VALID_CONDITION_TYPES.includes(conditionType)) {
    return NextResponse.json({ ok: false, error: "conditionType must be 'tag' or 'daysOld'" }, { status: 400 });
  }

  let tagValue: string | null = null;
  let daysValue: number | null = null;

  if (conditionType === "tag") {
    if (typeof conditionTag !== "string" || !SUPPORTED_TAGS.includes(conditionTag)) {
      return NextResponse.json({ ok: false, error: "conditionTag must be 'HOLD'" }, { status: 400 });
    }
    tagValue = conditionTag;
  } else {
    // daysOld
    if (typeof conditionDaysGt !== "number" || !Number.isInteger(conditionDaysGt) || conditionDaysGt < 1) {
      return NextResponse.json({ ok: false, error: "conditionDaysGt must be an integer ≥ 1" }, { status: 400 });
    }
    daysValue = conditionDaysGt;
  }

  const userId = parseInt(session.user.id, 10);

  const rule = await prisma.obd_visibility_rules.create({
    data: {
      ruleName:        ruleName.trim(),
      conditionType,
      conditionTag:    tagValue,
      conditionDaysGt: daysValue,
      isActive:        true,
      createdById:     userId,
    },
  });

  return NextResponse.json({ ok: true, rule });
}
