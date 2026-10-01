import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FLOOR_REMARK_MAX } from "@/lib/floor/off-floor";
import { findActiveCiReason, listActiveCiReasons, raiseFullBillCi } from "@/lib/floor/raise-ci";
import { stopTintWork } from "@/lib/tint/stop-work";
import { checkTintAction, tintBillRefusal } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

/**
 * GET  /api/tint/manager/ci — the CI reasons the Tint Manager form offers.
 * POST /api/tint/manager/ci — raise a FULL-BILL CI on each tint bill and cancel
 * it (2026-10-01, tabs build step 3 — plan §C, §D).
 *
 * Body:     { orderIds: number[], reasonId: number, remark?: string }
 * Response: Floor's — { raised: [{ orderId, obdNumber, ciNumber }],
 *                       skipped: [{ orderId, obdNumber, reason }] },
 *           200 when at least one was raised; 422 when nothing was.
 *
 * Gate (both): tint_manager canEdit AND tint_ci canEdit — the GET mirrors
 * floor/ci's GET, which sits on the same tick as its POST.
 *
 * 🔴 THE SAME CI AS FLOOR'S — lib/floor/raise-ci.ts raiseFullBillCi, the one
 * Floor calls. The only differences, both passed in:
 *   - allowTintRoom: true — a bill an operator holds may be returned;
 *   - beforeWrite: lib/tint/stop-work.ts stopTintWork — ends the live
 *     assignment (timer frozen) and cancels live splits, run ONLY after every
 *     pre-check passed and right before the CI is created. A bill that is
 *     skipped (duplicate CI, open draft, undelivered lines) therefore keeps its
 *     operator's job untouched. A waiting bill has no assignment; its legacy
 *     splits, if any, are cancelled the same way.
 * If the stop succeeds and the CI create then fails, the bill is left at its
 * tint stage with no live job — the Stop & cancel retry state (plan §D): no
 * operator can finish it, and pressing Raise CI (or Stop & cancel) again
 * completes it.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, "ci");
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });

  const reasons = await listActiveCiReasons();
  return NextResponse.json({ reasons });
}

interface Body {
  orderIds?: unknown;
  reasonId?: unknown;
  remark?: unknown;
}

interface Raised {
  orderId: number;
  obdNumber: string;
  ciNumber: string;
}

interface Skipped {
  orderId: number;
  obdNumber: string | null;
  reason: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, "ci");
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });

  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;

  // ── Validate once — floor/ci's rules and wording ──────────────────────────
  const rawIds = body.orderIds;
  if (
    !Array.isArray(rawIds) ||
    rawIds.length === 0 ||
    !rawIds.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)
  ) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array of positive integers" }, { status: 400 });
  }
  const orderIds = Array.from(new Set(rawIds as number[]));

  const reasonId = body.reasonId;
  if (typeof reasonId !== "number" || !Number.isInteger(reasonId) || reasonId <= 0) {
    return NextResponse.json({ error: "reasonId is required and must be a positive integer" }, { status: 400 });
  }
  const reason = await findActiveCiReason(reasonId);
  if (reason === null) {
    return NextResponse.json({ error: "Unknown or inactive CI reason" }, { status: 400 });
  }

  let remark: string | null = null;
  if (body.remark !== undefined && body.remark !== null) {
    if (typeof body.remark !== "string") {
      return NextResponse.json({ error: "remark must be a string" }, { status: 400 });
    }
    const trimmed = body.remark.trim();
    if (trimmed.length > FLOOR_REMARK_MAX) {
      return NextResponse.json({ error: `remark is longer than ${FLOOR_REMARK_MAX} characters` }, { status: 400 });
    }
    remark = trimmed === "" ? null : trimmed;
  }

  const raised: Raised[] = [];
  const skipped: Skipped[] = [];

  for (const orderId of orderIds) {
    try {
      // Tint bills only — before anything else.
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { orderType: true, isRemoved: true, obdNumber: true },
      });
      const notTint = tintBillRefusal(order);
      if (notTint !== null) {
        skipped.push({ orderId, obdNumber: order?.obdNumber ?? null, reason: notTint });
        continue;
      }

      const r = await raiseFullBillCi({
        orderId,
        reason,
        remark,
        userId,
        allowTintRoom: true,
        beforeWrite: async () => {
          await stopTintWork({ orderId, managerId: userId, note: "CI raised from Tint Manager" });
        },
      });
      if (r.ok) raised.push({ orderId: r.orderId, obdNumber: r.obdNumber, ciNumber: r.ciNumber });
      else skipped.push({ orderId: r.orderId, obdNumber: r.obdNumber, reason: r.reason });
    } catch (err) {
      skipped.push({ orderId, obdNumber: null, reason: err instanceof Error ? err.message : "Unexpected error" });
    }
  }

  const status = raised.length === 0 ? 422 : 200;
  return NextResponse.json({ raised, skipped }, { status });
}
