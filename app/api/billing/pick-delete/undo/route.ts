import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { undoDecision } from "@/lib/billing/pick-delete";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/pick-delete/undo — body { decisionId }.
 * All OK → stamped undone (the flag returns). Pick delete → the bill is restored
 * if it is still cancelled (pending_tint_assignment + null status when it was
 * deleted while waiting for tint; pending_picking + 'dispatch' otherwise), then
 * stamped undone; refused (409) while the bill carries a live CI. Already
 * undone → 409. Gate: billing_pick_delete canEdit.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_pick_delete", "canEdit"))) {
    return NextResponse.json({ error: "You do not have permission to undo a same-SO decision." }, { status: 403 });
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { decisionId?: unknown };
  const decisionId = body.decisionId;
  if (typeof decisionId !== "number" || !Number.isInteger(decisionId) || decisionId <= 0) {
    return NextResponse.json({ error: "decisionId must be a positive integer" }, { status: 400 });
  }

  const r = await undoDecision({ decisionId, userId });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.data });
}
