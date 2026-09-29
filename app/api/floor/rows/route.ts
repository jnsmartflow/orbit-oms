import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { isLiveFeedOn } from "@/lib/live/feed";
import { FLOOR_ROWS_MAX_IDS, getFloorRowsByIds } from "@/lib/floor/rows";

export const dynamic = "force-dynamic";

// POST /api/floor/rows  { ids: number[] (≤ 300) }
//
// LIVE FEED 7a — the rows for the order ids GET /api/live/changes named. Built by
// the SAME feed functions as the full load (lib/floor/rows.ts), so a patched row
// cannot differ from a full load. Answer:
//   { enabled: true, date, rows: [{ id, tab: 'board'|'hold'|'cancelled'|null, row }],
//     soFlags, tripIds, pickers }
// tab null / row null = the bill has left Floor.
//
// Gate: session (401) → floor canView (403) → the live.feed switch (OFF →
// 200 { enabled: false }, nothing read). Read-only; sequential awaits.
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "floor", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await isLiveFeedOn())) return NextResponse.json({ enabled: false }, { headers: NO_STORE });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON: { ids: number[] }" }, { status: 400 });
  }
  const ids = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n) && (n as number) > 0)) {
    return NextResponse.json({ error: "ids must be an array of positive integers" }, { status: 400 });
  }
  if (ids.length > FLOOR_ROWS_MAX_IDS) {
    return NextResponse.json(
      { error: `at most ${FLOOR_ROWS_MAX_IDS} ids per call — more changes than that means a full load` },
      { status: 400 },
    );
  }

  const result = await getFloorRowsByIds(ids as number[]);
  return NextResponse.json({ enabled: true, ...result }, { headers: NO_STORE });
}
