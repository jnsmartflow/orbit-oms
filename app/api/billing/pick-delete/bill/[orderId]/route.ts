import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getPickDeleteBillLines } from "@/lib/billing/pick-delete";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/pick-delete/bill/[orderId] — the active lines of one bill,
 * SAP batch splits merged per SKU (lib/picking/group-lines.ts), for the tab's
 * always-open lines table and its first-punch comparison. Base read as GET
 * /api/billing/picking/order/[orderId],
 * under THIS tab's own gate (billing_pick_delete canView) so a Pick delete user
 * never needs billing_picking. No findings, no pending fact. READ-ONLY.
 */
export async function GET(_req: Request, { params }: { params: { orderId: string } }): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_pick_delete", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }
  const bill = await getPickDeleteBillLines(orderId);
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  return NextResponse.json(bill, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
