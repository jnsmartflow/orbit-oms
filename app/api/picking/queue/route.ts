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

  try {
    const result = await getPickingQueue(dateParam);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid date" },
      { status: 400 },
    );
  }
}
