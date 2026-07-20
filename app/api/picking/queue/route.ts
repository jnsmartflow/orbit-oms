import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getPickingQueue } from "@/lib/picking/queue";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Page-level gating alone is not enough — this route is reachable directly
  // by URL and returns real depot data. Same check + admin bypass shape as
  // app/picking/page.tsx (mirrors app/trips/page.tsx's pattern).
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Same param-reading convention as app/api/support/orders/route.ts:
  // trim, empty string treated as absent (falls through to today in queue.ts).
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date")?.trim() || undefined;
  const scopeParam = searchParams.get("scope")?.trim() || undefined;

  // Validate rather than coerce, matching queue.ts's own stance on a malformed
  // `date` (it THROWS instead of falling back to today, so a scripted caller
  // gets a clear 400 instead of a silently-different answer). An unrecognised
  // scope must not quietly degrade to 'single' — that would hand a mobile
  // caller a one-day payload while it renders an all-dates board.
  if (scopeParam !== undefined && scopeParam !== "single" && scopeParam !== "openPending") {
    return NextResponse.json(
      { error: `Invalid scope "${scopeParam}" — expected "single" or "openPending"` },
      { status: 400 },
    );
  }
  // Contradictory request: 'openPending' spans all dates, so a `date` would be
  // silently ignored. Same reasoning as above — reject, don't quietly drop it.
  if (scopeParam === "openPending" && dateParam !== undefined) {
    return NextResponse.json(
      { error: "`date` is not accepted with scope=openPending (it spans all dates)" },
      { status: 400 },
    );
  }

  try {
    const result = await getPickingQueue({ date: dateParam, scope: scopeParam });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid date" },
      { status: 400 },
    );
  }
}
