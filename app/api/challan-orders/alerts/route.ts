import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { loadChallanAlerts } from "@/lib/challan-orders/alerts";

export const dynamic = "force-dynamic";

/**
 * GET /api/challan-orders/alerts — the red challan alerts (Challan orders slice 6,
 * 2026-10-07; S6-1 / S6-2 / S6-6): DOUBLE_DISPATCH, DEALER_MISMATCH, CATCH_FAILED.
 * READ-ONLY, computed live (lib/challan-orders/alerts.ts).
 *
 * Gate: challan_orders canView OR floor canView — the alerts must reach the Floor desk
 * (S6-2, S6-6) even when that person holds no challan tick. Acting on one (Retry, Link
 * anyway, Unlink) is challan_orders canEdit, on its own route.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  const allowed =
    (await checkAnyPermission(roles, "challan_orders", "canView")) ||
    (await checkAnyPermission(roles, "floor", "canView"));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const alerts = await loadChallanAlerts();
  return NextResponse.json({ alerts }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
