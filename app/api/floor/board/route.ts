import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getFloorRail, getFloorBoard, getFloorPickers } from "@/lib/floor/queries";
import { getHideExclusion } from "@/lib/hide/visibility";
import type { FloorScope } from "@/lib/floor/types";

export const dynamic = "force-dynamic";

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT"];
function parseScope(v: string | null): FloorScope {
  return (SCOPES as string[]).includes(v ?? "") ? (v as FloorScope) : "All";
}

// GET /api/floor/board?scope=All|Local|Upcountry|IGT&mode=live|history&date=YYYY-MM-DD
// Returns the left rail + the floor board + counts. The delivery-type scope
// applies to BOTH feeds (design §5.2). `mode=history` requires `date`.
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
    // ONE hide read for the whole request, passed into both feeds. getFloorRail
    // and getFloorBoard each read it themselves when not given one (unchanged
    // for every other caller) — this route is the only path that calls both, so
    // it was the only one paying for two identical obd_visibility_rules reads.
    // Not a cache: still a real, fresh read on every request, just once instead
    // of twice. Also makes the two feeds share one `daysOld` cutoff instant
    // rather than two computed milliseconds apart.
    const hideExclusion = await getHideExclusion();
    const rail = await getFloorRail(scope, hideExclusion);
    const floor = await getFloorBoard({ mode, date, scope, hideExclusion });
    const pickers = await getFloorPickers();
    return NextResponse.json({ scope, rail, railCount: rail.length, floor, pickers });
  } catch (e) {
    // parseFloorDate throws on a malformed/impossible history date.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Bad request" }, { status: 400 });
  }
}
