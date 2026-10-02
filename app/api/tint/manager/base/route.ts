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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ?date=YYYY-MM-DD (2026-10-02, history) — Floor's history for that IST day ∩
// Base bills (lib/tint/base-feed.ts). Without it the response is unchanged.
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const dateParam = new URL(req.url).searchParams.get("date");
  const rows = await getTintBaseRows(dateParam !== null && DATE_RE.test(dateParam) ? dateParam : undefined);
  return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
