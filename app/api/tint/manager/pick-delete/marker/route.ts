import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getPickDeleteMarker } from "@/lib/billing/pick-delete";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/pick-delete/marker — `{ count, latest }` over the Tint
 * Manager's groups only (owner "tint", 2026-10-01 — plan §E). The count is what
 * will drive the Tint Manager's blocking popup (build step 8), exactly as
 * Billing's marker drives Billing's. READ-ONLY.
 * Gate: tint_manager canView AND tint_pick_delete canView.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (
    !(await checkAnyPermission(roles, "tint_manager", "canView")) ||
    !(await checkAnyPermission(roles, "tint_pick_delete", "canView"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const marker = await getPickDeleteMarker("tint");
  return NextResponse.json(marker, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
