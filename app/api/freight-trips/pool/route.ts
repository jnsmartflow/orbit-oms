import { NextResponse } from "next/server";
import { freightGate } from "@/lib/freight-trips/gate";
import { getFreightPoolRows } from "@/lib/freight-trips/pool";
import { getRouteClubs } from "@/lib/floor/route-clubs";
import type { FloorScope } from "@/lib/floor/types";

export const dynamic = "force-dynamic";

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT / Cross"];

/**
 * GET /api/freight-trips/pool?scope=All|Local|Upcountry|IGT / Cross&q=…
 * Floor's held bills (getFloorHold — same predicate, same hide exclusion, same
 * row shape as the On hold tab) minus bills on an ACTIVE freight trip. Read-only.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const gate = await freightGate("canView");
  if (!gate.ok) return gate.response;

  const params = new URL(req.url).searchParams;
  const raw = params.get("scope") ?? "All";
  const scope: FloorScope = (SCOPES as string[]).includes(raw) ? (raw as FloorScope) : "All";
  // Rows carry routeId + stopKey (additive), and the payload carries Floor's
  // route clubs (read-only, getRouteClubs) for the screen's route cards.
  const rows = await getFreightPoolRows(scope, params.get("q") ?? undefined);
  const clubs = await getRouteClubs();
  return NextResponse.json({ scope, rows, count: rows.length, clubs });
}
