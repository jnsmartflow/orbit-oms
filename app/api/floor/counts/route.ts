import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { isLiveFeedOn } from "@/lib/live/feed";
import { getFloorTabCounts } from "@/lib/floor/counts";
import { getTodayIST } from "@/lib/dates";

export const dynamic = "force-dynamic";

// GET /api/floor/counts[?date=YYYY-MM-DD]
//
// LIVE FEED 7a — the lazy tabs' label numbers (lib/floor/counts.ts): On hold and
// Cancel & CI, per delivery-type scope, before the client's search and flag
// filters. `date`, when given, must be today (IST): the Cancel & CI tab is
// today-only and On hold has no date, so no other day has an answer.
//
// Gate: session (401) → floor canView (403) → the live.feed switch (OFF →
// 200 { enabled: false }, nothing read). Read-only.
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "floor", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await isLiveFeedOn())) return NextResponse.json({ enabled: false }, { headers: NO_STORE });

  const date = new URL(req.url).searchParams.get("date");
  if (date !== null && date !== getTodayIST()) {
    return NextResponse.json({ error: "counts exist for today (IST) only" }, { status: 400 });
  }

  const counts = await getFloorTabCounts();
  return NextResponse.json({ enabled: true, ...counts }, { headers: NO_STORE });
}
