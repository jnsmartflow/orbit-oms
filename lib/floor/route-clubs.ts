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
// `floor` — one small SELECT beside the board's own reads, no new route and no
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
  return clubs.map((c) => ({
    id: c.id,
    deliveryType: c.deliveryType.name,
    name: c.name,
    sortOrder: c.sortOrder,
    members: c.members.map((m) => ({
      routeId: m.routeId,
      routeName: m.route.name.trim(),
      sortOrder: m.sortOrder,
    })),
  }));
}
