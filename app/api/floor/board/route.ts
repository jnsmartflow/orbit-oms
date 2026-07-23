import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getFloorRail, getFloorBoard } from "@/lib/floor/queries";
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
    const rail = await getFloorRail(scope);
    const floor = await getFloorBoard({ mode, date, scope });
    return NextResponse.json({ scope, rail, railCount: rail.length, floor });
  } catch (e) {
    // parseFloorDate throws on a malformed/impossible history date.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Bad request" }, { status: 400 });
  }
}
