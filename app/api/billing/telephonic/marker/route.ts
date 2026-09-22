import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTelephonicMarker } from "@/lib/billing/telephonic";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/telephonic/marker — the cheap "has the Telephonic tab
 * changed?" probe: { count, latest, matchCount, skipReasonCount, signature }.
 * `signature` carries the two counts in the field the shared marker hook
 * compares, so the client refetches when ANY of the four moves. Its sets are
 * supersets of the list's (see getTelephonicMarker). READ-ONLY — never add a
 * write here.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_telephonic", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marker = await getTelephonicMarker(new Date());
  return NextResponse.json(marker, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
