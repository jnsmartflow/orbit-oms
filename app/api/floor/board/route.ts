import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getFloorBoard, getFloorPickers } from "@/lib/floor/queries";
import { getHideExclusion } from "@/lib/hide/visibility";
import { getRouteClubs } from "@/lib/floor/route-clubs";
import type { FloorScope } from "@/lib/floor/types";

export const dynamic = "force-dynamic";

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT"];
function parseScope(v: string | null): FloorScope {
  return (SCOPES as string[]).includes(v ?? "") ? (v as FloorScope) : "All";
}

// GET /api/floor/board?scope=All|Local|Upcountry|IGT&mode=live|history&date=YYYY-MM-DD
// Returns the floor board + the picker roster. `mode=history` requires `date`.
//
// 🔴 THE `rail` FEED IS GONE (2026-09-13) AND THE ARM THAT FED IT IS NOT.
// This used to also call `getFloorRail` and return `rail` + `railCount`. Nothing
// had rendered them since 2026-09-10, when the trip desk replaced the board:
// `TripDesk` is never passed a rail prop and FloorRail / RailCard / TintStrip
// were imported by no live file. It cost 772 ms and 25 of the call's 84
// statements — about 28% of the whole board request — on a page that is
// latency-bound rather than query-bound.
//
// ⚠ `floorUnslottedWhere` IS UNTOUCHED. It is BOTH the old rail's predicate AND
// arm 2 of `floorBoardWhere`, and only the first use is gone: those bills are
// still on the board, as rows, exactly as before. Removing the FETCH is not
// removing the ARM, and conflating the two would drop five live bills off the
// screen. Verified by row count either side of the change, not by reading.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const scope = parseScope(url.searchParams.get("scope"));
  const mode = url.searchParams.get("mode") === "history" ? "history" : "live";
  const date = url.searchParams.get("date") ?? undefined;

  try {
    // Sequential awaits only — never prisma.$transaction (CORE §3).
    //
    // ONE hide read for the whole request. It was shared between two feeds until
    // the rail went; `getFloorBoard` reads it itself when not given one, so the
    // explicit read is kept rather than dropped — it is the same single query
    // either way, and it stays the seam a future second feed would hang off.
    const hideExclusion = await getHideExclusion();
    const floor = await getFloorBoard({ mode, date, scope, hideExclusion });
    const pickers = await getFloorPickers();
    // The By route cards' clubs (2026-09-19) — config, every delivery type,
    // one small read. ADDITIVE: a reader that ignores it is unaffected.
    const routeClubs = await getRouteClubs();
    return NextResponse.json({ scope, floor, pickers, routeClubs });
  } catch (e) {
    // parseFloorDate throws on a malformed/impossible history date.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Bad request" }, { status: 400 });
  }
}
