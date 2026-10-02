import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTintBaseRows } from "@/lib/tint/base-feed";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/base — the Tint Manager's Base tab (2026-10-01,
 * code-discovery-2026-10-01-tint-manager-base-tab.md §A/§H step 3, §I).
 *
 * Every NON-tint bill with SMU 74 / 77 that Floor's live board shows right now
 * (lib/floor/queries.ts getFloorBoard, narrowed — lib/tint/base-feed.ts), minus
 * trip bills that joined their trip before today (owner decision 8).
 *
 * Response: { rows: FloorBoardRow[] } — Floor's row shape unchanged; the client
 * derives the status pill with Floor's rowStatus() and always heldBack=false
 * (owner decision 6).
 *
 * Gate: tint_manager canView (owner decision 4 — no tab tick of its own).
 * READ-ONLY.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const rows = await getTintBaseRows();
  return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
