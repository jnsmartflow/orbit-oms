import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTintWorkloadMarker } from "@/lib/picking/tint-workload";

export const dynamic = "force-dynamic";

/**
 * GET /api/picking/tint-workload/marker — "has the tint room changed?".
 *
 * The same shape `/api/picking/marker` and `/api/floor/marker` use, so
 * `lib/hooks/use-picking-marker.ts` can be pointed here through its `url` param
 * with nothing new to learn: a cheap probe whose value the client compares, and
 * a real refetch only when it moves.
 *
 * ⚠ `latest` IS THE FIELD THE HOOK ACTUALLY COMPARES — it carries the LATER of
 * the two clocks. `latestOrder` and `latestAssignment` ride along for a human
 * reading the response and are ignored by the client. Renaming `latest` away, or
 * splitting it back into two fields, silently disables this marker: the hook
 * compares `count`/`latest` and nothing else.
 *
 * 🔴 IT WATCHES TWO TABLES, AND THE SECOND ONE IS THE POINT.
 * `latestAssignment` is MAX(`tint_assignments.updatedAt`) over the bills still in
 * the room, beside `latestOrder`'s MAX(`orders.updatedAt`) and a count. PAUSE AND
 * RESUME WRITE ONLY THE ASSIGNMENT ROW — `app/api/tint/operator/pause/route.ts`
 * and `resume/route.ts` contain zero `orders.update` calls — so a marker built on
 * `orders` alone can never fire for a pause, and "paused · 18 min so far" is one
 * of the four states this section exists to show.
 *
 * ⚠ `/api/tint/manager/marker` HAS THAT EXACT GAP. It was read while this was
 * written and deliberately not copied; its own board misses a pause for the same
 * reason. Fixing it is that module's call, not this route's.
 *
 * 🔴 IT ADDS NOTHING TO THE PICKING MARKER. `/api/picking/marker`,
 * `buildPickingWhere` and `lib/picking/queue.ts` are untouched by this work, so
 * the Assign list, the Assign badge and the held-back band cannot move (PICKING
 * §10 — "Marker ⊇ queue, never ⊂" is about that pair and this is a separate
 * pair). A second marker instance on one screen is safe: the hook keeps all its
 * state in per-instance refs.
 *
 * Gate and reasoning are the feed route's, one level up. SELECT-only, two
 * aggregates, sequential awaits, never $transaction (CORE §3) — and no
 * `orders.update` anywhere near it.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marker = await getTintWorkloadMarker();

  // No proxy or browser may serve a stale marker — freshness is the point.
  return NextResponse.json(marker, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
