import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { searchShipTo } from "@/lib/floor/ship-to";
import { checkTintAction } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

// GET /api/tint/manager/ship-to-search?q=... — the customer lookup for the
// Tint Manager's "Change ship-to" picker (2026-10-01, tabs build step 2).
// READ-ONLY. Response: a BARE ARRAY of { id, customerName, area }, Floor's shape.
//
// 🔴 GATED ON THE WRITE'S OWN TICK — tint_manager canEdit AND tint_ship_to
// canEdit, never narrower than the write it feeds. A companion GET narrower
// than its write broke manual tint entry for a day (CLAUDE_TINT §13.2). The
// query is lib/floor/ship-to.ts searchShipTo — the one Floor's search runs.
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const refused = await checkTintAction(roles, "ship-to");
  if (refused !== null) return NextResponse.json({ error: refused }, { status: 403 });

  const { searchParams } = new URL(req.url);
  return NextResponse.json(await searchShipTo(searchParams.get("q")));
}
