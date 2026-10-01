import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getOrderDetail } from "@/lib/floor/order-detail";

export const dynamic = "force-dynamic";

// GET /api/floor/order/[orderId] — the whole detail payload for one bill (design
// §10): header + Details groups + Items + Activity, in ONE call. Read-only.
//
// Since 2026-10-01 (Tint Manager tabs build step 7) the payload is built by
// lib/floor/order-detail.ts getOrderDetail — moved there verbatim, shared with
// app/api/tint/manager/order/[orderId]. This route keeps its gate and the
// `{ detail }` / 404 response, unchanged.

export async function GET(
  _req: Request,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  const detail = await getOrderDetail(orderId);
  if (!detail) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  return NextResponse.json({ detail });
}
