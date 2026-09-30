import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { isPickingFeedOn } from "@/lib/live/feed";
import { parsePickingSyncBody, syncPicking } from "@/lib/picking/sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/sync — the supervisor board's ONE call per live-feed glance that carried
 * changes (live feed picking 4a, 2026-09-30; plan §D.1). READ-ONLY.
 *
 * Body: { orderIds, tripIds, shownIds, tintShownIds } — every field optional (shownIds = the board
 * rows the client holds, so a bill LEAVING is re-read; tintShownIds = the Tinting section's bills).
 * Answer: { enabled, date, patches: [{ id, row | null }], waitingSkus, oilSkus,
 *           heldBack?, heldBackTrucks?, heldBackUnplanned?, pickDeleted?, tintTouched }.
 * Rows come from getPickingQueue({ onlyIds }) — the SAME builder and gate read as the full queue.
 *
 * Gates, in order: session (401) → `picking` canView (403, the queue route's gate) → the switches
 * `live.feed` AND `live.feed.picking` (absent = OFF → 200 { enabled: false }, nothing else read) →
 * the body (400). Logic and cost: lib/picking/sync.ts.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "picking", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
  if (!(await isPickingFeedOn())) return NextResponse.json({ enabled: false }, { headers: NO_STORE });

  const body = parsePickingSyncBody(await req.json().catch(() => null));
  if (typeof body === "string") return NextResponse.json({ error: body }, { status: 400 });

  const result = await syncPicking(body);
  return NextResponse.json({ enabled: true, ...result }, { headers: NO_STORE });
}
