import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { undoDecision } from "@/lib/billing/pick-delete";
import { checkTintAction } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

/**
 * POST /api/tint/manager/pick-delete/undo — body { decisionId }.
 * Billing's Undo on a Tint Manager decision (owner "tint", 2026-10-01 — plan
 * §E): the same lib function and restore rule (a bill deleted while waiting for
 * tint goes back to pending_tint_assignment), plus "This SO is decided in
 * Billing" for a decision on a group that is not all-74/77.
 * Gate: tint_manager canEdit AND tint_pick_delete canEdit.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, "pick-delete");
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { decisionId?: unknown };
  const decisionId = body.decisionId;
  if (typeof decisionId !== "number" || !Number.isInteger(decisionId) || decisionId <= 0) {
    return NextResponse.json({ error: "decisionId must be a positive integer" }, { status: 400 });
  }

  const r = await undoDecision({ decisionId, userId, owner: "tint" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.data });
}
