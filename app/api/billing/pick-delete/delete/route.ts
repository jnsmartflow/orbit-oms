import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { checkAnyPermission } from "@/lib/permissions";
import { pickDelete } from "@/lib/billing/pick-delete";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/pick-delete/delete — body { orderId }.
 * Cancels ONE bill of a same-SO group as a duplicate (reason duplicate_bill).
 * 409 with a plain message when: already cancelled, dispatched, on a trip, in
 * the tint room (Floor's offFloorRefusal), legacy closed, a live CI, no other
 * live bill on the SO, already pick deleted, or the bill changed mid-press.
 * Write order (claim → cancel → clean-up → push) and why: lib/billing/pick-delete.ts
 * pickDelete(). Gate: billing_pick_delete canEdit. Never calls Floor/Picking routes.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_pick_delete", "canEdit"))) {
    return NextResponse.json({ error: "You do not have permission to pick delete a bill." }, { status: 403 });
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: unknown };
  const orderId = body.orderId;
  if (typeof orderId !== "number" || !Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "orderId must be a positive integer" }, { status: 400 });
  }

  const r = await pickDelete({ orderId, userId, owner: "billing", actorIsAdmin: isSuperuser(session) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, ...r.data });
}
