// Floor Control — ROUTE CLUBS, the read (2026-09-19).
//
// A club is a set of routes that share one truck on a light day; the By route
// view draws each as one card. The rows live in route_clubs /
// route_club_members (sql/2026-09-19-route-clubs.sql, seeded by
// sql/2026-09-19-route-clubs-local.sql). This is their only reader.
//
// ⚠ CONFIG, NOT BOARD DATA. Nothing here depends on the day, the scope or the
// hide rules, so it is read whole and every delivery type is returned; the
// client picks the tab's clubs. It rides GET /api/floor/board as a sibling of
// `floor` — two small SELECTs beside the board's own reads, no new route and no
// new poll.
//
// Sequential awaits, never prisma.$transaction (CORE §3). READ-ONLY.

import { prisma } from "@/lib/prisma";
import type { FloorRouteClub } from "./types";

/**
 * Every club, in card order: delivery type name, then the club's `sortOrder`;
 * members main first. The order is the contract — the cards render in it and
 * never re-sort (owner: "Order never changes").
 */
export async function getRouteClubs(): Promise<FloorRouteClub[]> {
  const clubs = await prisma.route_clubs.findMany({
    select: {
      id: true,
      name: true,
      sortOrder: true,
      deliveryType: { select: { name: true } },
      members: {
        select: { routeId: true, sortOrder: true, route: { select: { name: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ deliveryType: { name: "asc" } }, { sortOrder: "asc" }],
  });

  // ── THE REACH: which delivery types each member route's AREAS are in ──────
  //
  // 🔴 A ROW'S DELIVERY TYPE AND ITS ROUTE BOTH COME FROM ITS AREA
  // (lib/floor/queries.ts: `area.deliveryType`, `area.primaryRoute`). So a
  // route with no area of the club's type can NEVER put a bill on that type's
  // tab — Kamrej (all 10 areas Upcountry) in the Local "Varachha + Kamrej" club
  // is the case, and the owner's decision (2026-09-19) is that the Local card
  // shows its bills anyway.
  //
  // ⚠ ONLY THAT CASE REACHES. A member that has ANY area of the club's type
  // takes its bills from the club's own tab and nothing else — Adajan has 11
  // Upcountry areas, and pulling those into the Local Adajan line would change
  // what Adajan shows, which the owner ruled out ("It must not change what any
  // other route shows"). And a route whose areas span two OTHER types has no
  // single tab to reach into, so it does not reach (null) rather than guess.
  //
  // Every area counts, active or not: the board does not filter areas on
  // `isActive` when it derives a row's type, so neither does this.
  const routeIds = Array.from(new Set(clubs.flatMap((c) => c.members.map((m) => m.routeId))));
  const areas =
    routeIds.length > 0
      ? await prisma.area_master.findMany({
          where: { primaryRouteId: { in: routeIds } },
          select: { primaryRouteId: true, deliveryType: { select: { name: true } } },
        })
      : [];
  const typesByRoute = new Map<number, Set<string>>();
  for (const a of areas) {
    if (a.primaryRouteId === null) continue;
    const set = typesByRoute.get(a.primaryRouteId) ?? new Set<string>();
    set.add(a.deliveryType.name);
    typesByRoute.set(a.primaryRouteId, set);
  }
  const reachFor = (routeId: number, clubType: string): string | null => {
    const types = typesByRoute.get(routeId);
    if (!types || types.has(clubType) || types.size !== 1) return null;
    return Array.from(types)[0];
  };

  return clubs.map((c) => ({
    id: c.id,
    deliveryType: c.deliveryType.name,
    name: c.name,
    sortOrder: c.sortOrder,
    members: c.members.map((m) => ({
      routeId: m.routeId,
      routeName: m.route.name.trim(),
      sortOrder: m.sortOrder,
      reachFrom: reachFor(m.routeId, c.deliveryType.name),
    })),
  }));
}
