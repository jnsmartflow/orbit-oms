import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { parseBillLookupTerm } from "@/lib/trips/find-bill";
import { getFloorSearchHits } from "@/lib/floor/search-hits";

export const dynamic = "force-dynamic";

/**
 * GET /api/floor/search?q= — WHICH FLOOR TAB IS THIS BILL ON. (2026-10-06, owner.)
 * READ-ONLY: no write of any kind on this path.
 *
 * The Floor search box filters the rows already loaded, and Hold / Cancel & CI
 * may not even be loaded under the live feed. For ONE full number the page asks
 * here, then switches to the bill's tab and highlights its row.
 *
 * 🔴 A NEW ROUTE, NOT A WIDER /api/floor/trips/lookup. That route answers "which
 * TRIP", grouped by trip, bills on trips only — and it is the trip module's.
 * This one answers per BILL, for every tab. Both share ONE matching rule,
 * lib/trips/find-bill.ts: whole-number OBD / SO / invoice, isRemoved = false,
 * admin hide rules applied — so a removed or hidden bill is "no match" here
 * exactly as it is there. No suffix matching, no date limit, at most 50 bills.
 *
 * Target precedence (FloorSearchTarget, lib/floor/types.ts):
 *   cancel_ci > hold > tinting > trip > floor
 * A cancelled bill that was on a trip goes to Cancel & CI.
 *
 * Gate: floor canView, the same as the board and the lookup. Sequential awaits,
 * never prisma.$transaction (CORE §3).
 */


export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const term = parseBillLookupTerm(new URL(req.url).searchParams.get("q") ?? "");
  if (term === null) {
    return NextResponse.json({ error: "q must be one full OBD, SO or invoice number" }, { status: 400 });
  }

  // The hits — lib/floor/search-hits.ts (moved out unchanged, 2026-10-26).
  return NextResponse.json({ q: term.q, hits: await getFloorSearchHits(term) });
}
