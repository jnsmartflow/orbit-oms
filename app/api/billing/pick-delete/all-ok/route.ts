import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { markAllOk } from "@/lib/billing/pick-delete";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/pick-delete/all-ok — body { soNumber, orderIds }.
 * Keeps every bill of a same-SO group. The server re-reads the live group: a
 * different set is 409 "Group changed — refresh"; a double press (the partial
 * unique pick_delete_decisions_all_ok_live_key) is 409 "Already marked All OK".
 * Writes ONE pick_delete_decisions row (kind all_ok, ids sorted). No order row
 * is touched. Gate: billing_pick_delete canEdit.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_pick_delete", "canEdit"))) {
    return NextResponse.json({ error: "You do not have permission to decide same-SO groups." }, { status: 403 });
  }
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

  const r = await markAllOk({ soNumber: body.soNumber, orderIds: body.orderIds as number[], userId });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.data });
}
