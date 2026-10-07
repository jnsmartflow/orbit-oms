import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { pickDelete } from "@/lib/billing/pick-delete";
import { checkTintAction } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

/**
 * POST /api/tint/manager/pick-delete/delete — body { orderId }.
 * Billing's Pick delete on a Tint Manager group (owner "tint", 2026-10-01 —
 * plan §E): the same lib function, refusals and write order (claim → cancel →
 * clean-up → push), plus "This SO is decided in Billing" when the group is not
 * all-74/77. A twin an operator is mixing stays undeletable (owner §J-3).
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

  const body = (await req.json().catch(() => ({}))) as { orderId?: unknown };
  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "orderId must be a positive integer" }, { status: 400 });
  }

  const r = await pickDelete({ orderId, userId, owner: "tint", actorIsAdmin: isSuperuser(session) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.data });
}
