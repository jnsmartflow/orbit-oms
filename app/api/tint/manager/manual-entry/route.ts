import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { applyManualPull, PULL_REASON_CODES, type PullReasonCode } from "@/lib/tint/manual-pull";

export const dynamic = "force-dynamic";

/**
 * POST /api/tint/manager/manual-entry — "+ Add to Tint": pull a bill into
 * tinting by hand.
 *
 * Body: { orderId, lineIds, reasonCode, reasonNotes?, confirmCancelPick?,
 * operatorId?, markSample? }.
 *
 * THIN since 2026-10-24 (Add to Tint server build): every check and every
 * write is lib/tint/manual-pull.ts applyManualPull — its header has the write
 * order. This route validates the body shape and maps the result to a status.
 *
 * 409 PICK_CONFIRM_REQUIRED — the bill is in a picker's hands (or picked, or
 * checked) and the body did not carry `confirmCancelPick: true`: the modal must
 * show the warning first. Also what a modal opened before a picker took the
 * bill gets.
 */

type BodyErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "INVALID_REASON"
  | "REASON_NOTES_REQUIRED"
  | "INTERNAL_ERROR";

function err(code: BodyErrorCode, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, errorCode: code, message }, { status });
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return err("UNAUTHORIZED", "Unauthorized", 401);

  // Per-user tick, not a job title (2026-09-06). The old gate was the NARROW
  // [TINT_MANAGER, ADMIN] — every other manager route also named OPERATIONS and
  // OPERATION_MANAGER. Converting deliberately widens this to everyone holding
  // tint_manager/canEdit, which adds Prakash (operation_manager). Owner decision,
  // taken on gate report section 3 — do not re-narrow it. No new tick for the
  // pick-cancel, the operator or the Sample mark (owner, 2026-10-24).
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canEdit");
  if (!allowed) return err("FORBIDDEN", "Permission denied", 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("BAD_REQUEST", "Invalid JSON body", 400);
  }
  if (!body || typeof body !== "object") {
    return err("BAD_REQUEST", "Body must be an object", 400);
  }

  const { orderId, lineIds, reasonCode, reasonNotes, confirmCancelPick, operatorId, markSample } = body as {
    orderId?: unknown;
    lineIds?: unknown;
    reasonCode?: unknown;
    reasonNotes?: unknown;
    confirmCancelPick?: unknown;
    operatorId?: unknown;
    markSample?: unknown;
  };

  if (!isPositiveInt(orderId)) {
    return err("BAD_REQUEST", "orderId must be a positive integer", 400);
  }
  if (!Array.isArray(lineIds) || lineIds.length < 1 || !lineIds.every(isPositiveInt)) {
    return err("BAD_REQUEST", "lineIds must be a non-empty array of positive integers", 400);
  }
  if (typeof reasonCode !== "string" || !PULL_REASON_CODES.includes(reasonCode as PullReasonCode)) {
    return err("INVALID_REASON", `reasonCode must be one of: ${PULL_REASON_CODES.join(", ")}`, 400);
  }
  if (reasonNotes !== undefined && reasonNotes !== null && typeof reasonNotes !== "string") {
    return err("BAD_REQUEST", "reasonNotes must be a string when provided", 400);
  }
  const trimmedNotes = typeof reasonNotes === "string" ? reasonNotes.trim() : "";
  if (reasonCode === "other" && trimmedNotes.length === 0) {
    return err("REASON_NOTES_REQUIRED", "reasonNotes is required when reasonCode is 'other'", 400);
  }
  if (confirmCancelPick !== undefined && typeof confirmCancelPick !== "boolean") {
    return err("BAD_REQUEST", "confirmCancelPick must be a boolean when provided", 400);
  }
  if (operatorId !== undefined && operatorId !== null && !isPositiveInt(operatorId)) {
    return err("BAD_REQUEST", "operatorId must be a positive integer when provided", 400);
  }
  if (markSample !== undefined && typeof markSample !== "boolean") {
    return err("BAD_REQUEST", "markSample must be a boolean when provided", 400);
  }

  const actorId = parseInt(session.user.id, 10);
  if (isNaN(actorId)) return err("INTERNAL_ERROR", "Invalid session user id", 500);

  const result = await applyManualPull({
    orderId,
    lineIds: lineIds as number[],
    reasonCode: reasonCode as PullReasonCode,
    reasonNotes: trimmedNotes.length > 0 ? trimmedNotes : null,
    confirmCancelPick: confirmCancelPick === true,
    operatorId: isPositiveInt(operatorId) ? operatorId : null,
    markSample: markSample === true,
    actorId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errorCode: result.errorCode, message: result.message },
      { status: result.status },
    );
  }
  return NextResponse.json(result);
}
