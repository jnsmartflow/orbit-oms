import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { currentIstMonth, istMonthRange, listTelephonic } from "@/lib/billing/telephonic";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/telephonic/list?month=YYYY-MM — the Telephonic tab's two
 * bands: `waiting` (ALL DATES) and `month` (settled rows added in that IST
 * month). `month` defaults to the current IST month; a malformed one is a 400,
 * never a silent fallback. READ-ONLY. All logic is in lib/billing/telephonic.ts.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // checkAnyPermission, never checkPermission — the latter reads only the
  // primary role.
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_telephonic", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const monthParam = new URL(req.url).searchParams.get("month");
  const month = monthParam ?? currentIstMonth(now);
  if (istMonthRange(month) === null) {
    return NextResponse.json(
      { error: `Invalid month "${month}" — expected YYYY-MM` },
      { status: 400 },
    );
  }

  const list = await listTelephonic(month, now);
  return NextResponse.json(list, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
