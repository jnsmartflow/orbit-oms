import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { searchShipTo } from "@/lib/floor/ship-to";

export const dynamic = "force-dynamic";

// GET /api/floor/ship-to-search?q=... — customer lookup for the detail panel's
// "Change ship-to" picker (CLAUDE_FLOOR.md §4.4). READ-ONLY: no writes anywhere.
//
// Support retirement step 2/8. Copied verbatim from
// app/api/support/ship-to-search/route.ts EXCEPT the auth gate, which now uses
// the floor pageKey (matching app/api/floor/board/route.ts) instead of Support's
// role list. Support's own route is untouched and still serves /support.
//
// The response is a BARE ARRAY, not an object — the caller
// (components/floor/detail-panel.tsx) reads it as ShipToResult[]. Do not wrap it.
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // The query lives in lib/floor/ship-to.ts searchShipTo since 2026-10-01 —
  // shared with the Tint Manager's search route. Same rule, same bare array.
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await searchShipTo(searchParams.get("q")));
}
