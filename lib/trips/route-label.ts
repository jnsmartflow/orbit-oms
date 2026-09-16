// lib/trips/route-label.ts
//
// THE ONE ROUTE-LABEL RULE (2026-09-16). "Adajan +2" — the route the most of
// something runs on, plus a count of the others.
//
// 🔴 ONE IMPLEMENTATION, TWO CALLERS, BY DESIGN. The rail card's label is
// computed server-side from a trip's STOPS (lib/trips/queries.ts); the pool's
// add hint and the "Same route" line are computed client-side from the SELECTED
// BILLS (components/floor/floor-page.tsx). The owner's rule is that those two
// can never disagree, so the ranking lives here — PURE, no Prisma, importable
// from a client component — and both sides call it.
//
// THE RULE (owner, unchanged from the area label it was extracted from):
//   - only items that carry something count (a stop with no bill does not)
//   - blank names are skipped
//   - PLACEHOLDER routes are skipped: they name nothing, so they must never win
//     and must never count into "+N"
//   - the name with the MOST items wins; a tie goes to the one reached FIRST
//   - every other distinct name becomes "+N"
//   - null when nothing is left to name, and the screen says "No route"

/**
 * route_master rows that NAME NOTHING (owner): id 20 "No Route" and id 25
 * "TEST R". HAND (23), Transport (22) and IGT / CROSS (18) are NOT placeholders
 * — they say how the load moves, and the team named them.
 *
 * 🔴 BY ID, NOT BY TEXT. `trip_drops.routeName` and `orders.route` are name
 * SNAPSHOTS with no route id, so these ids are resolved to their current names
 * server-side and the resolved set is what callers match against
 * (lib/trips/queries.ts, and the trips feed hands the same set to the client).
 * route_master.name is unique, so no real route can be caught by it; a renamed
 * placeholder stops matching and SHOWS, which fails towards showing.
 */
export const PLACEHOLDER_ROUTE_IDS: readonly number[] = [20, 25];

/** One thing being ranked: a trip's stop, or a selected bill. */
export interface RouteRankItem {
  /** The route name snapshot, or null. */
  name: string | null;
  /** Visit order for a stop, row order for a bill — only used to break a tie. */
  order: number;
  /** Does it carry a bill? Always true for a bill; a stop may be empty. */
  hasBills: boolean;
}

export interface RouteRank {
  name: string;
  others: number;
}

/** The winning name and how many other distinct names there are, or null. */
export function rankRouteName(
  items: readonly RouteRankItem[],
  placeholderNames: ReadonlySet<string> = new Set(),
): RouteRank | null {
  const byName = new Map<string, { count: number; firstOrder: number }>();
  for (const item of items) {
    if (!item.hasBills) continue;
    const name = item.name?.trim();
    if (!name || placeholderNames.has(name)) continue;
    const cur = byName.get(name);
    if (cur) {
      cur.count += 1;
      cur.firstOrder = Math.min(cur.firstOrder, item.order);
    } else {
      byName.set(name, { count: 1, firstOrder: item.order });
    }
  }
  if (byName.size === 0) return null;
  const ranked = Array.from(byName.entries()).sort(
    (a, b) => b[1].count - a[1].count || a[1].firstOrder - b[1].firstOrder,
  );
  return { name: ranked[0][0], others: ranked.length - 1 };
}

/** "Adajan" or "Adajan +2" — the printed form, in one place. */
export function formatRouteLabel(rank: RouteRank | null): string | null {
  if (rank === null) return null;
  return rank.others > 0 ? `${rank.name} +${rank.others}` : rank.name;
}
