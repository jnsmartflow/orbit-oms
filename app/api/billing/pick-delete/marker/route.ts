import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getPickDeleteMarker } from "@/lib/billing/pick-delete";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/pick-delete/marker — the pill's probe: `{ count, latest }`,
 * the two fields usePickingMarker reads (CLAUDE_PICKING §10). count = the shown
 * groups (the list's own rule, one SQL statement since 2026-09-30 —
 * lib/billing/pick-delete.ts getPickDeleteMarker); latest = the later of
 * MAX(pick_delete_decisions.updatedAt) and
 * MAX(orders.updatedAt) over the open groups' bills. READ-ONLY.
 * Gate: billing_pick_delete canView.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_pick_delete", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const marker = await getPickDeleteMarker();
  return NextResponse.json(marker, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
