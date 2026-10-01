import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markAllOk } from "@/lib/billing/pick-delete";
import { checkTintAction } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

/**
 * POST /api/tint/manager/pick-delete/all-ok — body { soNumber, orderIds }.
 * Billing's All OK on a Tint Manager group (owner "tint", 2026-10-01 — plan §E):
 * the same lib function, the same 409s, plus "This SO is decided in Billing"
 * when the group is not all-74/77. Writes ONE pick_delete_decisions row.
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

  const body = (await req.json().catch(() => ({}))) as { soNumber?: unknown; orderIds?: unknown };
  if (typeof body.soNumber !== "string" || body.soNumber.trim() === "") {
    return NextResponse.json({ error: "soNumber is required" }, { status: 400 });
  }
  if (
    !Array.isArray(body.orderIds) ||
    body.orderIds.length < 2 ||
    !body.orderIds.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)
  ) {
    return NextResponse.json({ error: "orderIds must be at least two positive integers" }, { status: 400 });
  }

  const r = await markAllOk({ soNumber: body.soNumber, orderIds: body.orderIds as number[], userId, owner: "tint" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.data });
}
