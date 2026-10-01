import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getOrderDetail } from "@/lib/floor/order-detail";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/order/[orderId] — one TINT bill's detail payload for the
 * Tint Manager's detail panel (2026-10-01, tabs build step 7 — plan §A/§C).
 *
 * The SAME payload Floor's panel reads (lib/floor/order-detail.ts getOrderDetail
 * — one owner), under the Tint Manager's own gate so a tint manager never needs
 * the `floor` tick. Tint bills only: anything else is a 404, so this gate cannot
 * be used to read other desks' bills. READ-ONLY.
 *
 * Gate: tint_manager canView. The panel's TABS keep their own per-user ticks
 * (tint_panel_items / _details / _activity, CLAUDE_TINT §1.2) — a tab without
 * its tick is never mounted, so it never asks for what it would show.
 */
export async function GET(
  _req: Request,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  const detail = await getOrderDetail(orderId);
  if (!detail || detail.orderType !== "tint") {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({ detail }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
