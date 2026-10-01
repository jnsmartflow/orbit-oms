import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getPickDeleteBillLines } from "@/lib/billing/pick-delete";
import { tintBillRefusal } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/pick-delete/bill/[orderId] — one bill's active lines,
 * SAP batch splits merged per SKU, for the Tint Manager's Pick delete (2026-10-01,
 * plan §E). Billing's route and shape, the same lib function. TINT BILLS ONLY —
 * anything else is a 404, so this gate cannot be used to read other desks' bills.
 * READ-ONLY. Gate: tint_manager canView AND tint_pick_delete canView.
 */
export async function GET(_req: Request, { params }: { params: { orderId: string } }): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (
    !(await checkAnyPermission(roles, "tint_manager", "canView")) ||
    !(await checkAnyPermission(roles, "tint_pick_delete", "canView"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }
  const order = await prisma.orders.findUnique({ where: { id: orderId }, select: { orderType: true, isRemoved: true } });
  if (tintBillRefusal(order) !== null) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

  const bill = await getPickDeleteBillLines(orderId);
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  return NextResponse.json(bill, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
