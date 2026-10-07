import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { checkAnyPermission } from "@/lib/permissions";
import { cancelLinkedObd } from "@/lib/challan-orders/linked-cancel";
import { deskCancelRequiresNote, isDeskCancelReason } from "@/lib/floor/desk-cancel-reasons";
import { FLOOR_REMARK_MAX } from "@/lib/floor/off-floor";

export const dynamic = "force-dynamic";

/**
 * POST /api/challan-orders/linked-obds/[orderId]/cancel — cancel a SAP bill linked to a
 * challan (Challan orders slice 6, 2026-10-07; owner S6-3, S6-7). ADMIN ONLY — the
 * slice-5 guard's owner (lib/challan-orders/cancel-guard.ts), isSuperuser(session).
 * Body { reasonKey, remark } — the desk cancel reasons. Writes: the bill → cancelled,
 * one log, its link back to 'waiting' (lib/challan-orders/linked-cancel.ts).
 * Gate: challan_orders canView (the screen it is pressed from) + admin.
 */
export async function POST(req: Request, { params }: { params: { orderId: string } }): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "challan_orders", "canView"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid session user id" }, { status: 500 });
  }
  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid order id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { reasonKey?: unknown; remark?: unknown };
  if (!isDeskCancelReason(body.reasonKey)) {
    return NextResponse.json({ ok: false, error: "A cancel reason is required" }, { status: 400 });
  }
  const remark = typeof body.remark === "string" && body.remark.trim() !== "" ? body.remark.trim() : null;
  if (remark !== null && remark.length > FLOOR_REMARK_MAX) {
    return NextResponse.json({ ok: false, error: `remark is longer than ${FLOOR_REMARK_MAX} characters` }, { status: 400 });
  }
  if (deskCancelRequiresNote(body.reasonKey) && remark === null) {
    return NextResponse.json({ ok: false, error: "A remark is required when the reason is Other" }, { status: 400 });
  }
  const r = await cancelLinkedObd({ orderId, actorId, actorIsAdmin: isSuperuser(session), reason: body.reasonKey, remark });
  if (r.ok) return NextResponse.json(r);
  return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
}
