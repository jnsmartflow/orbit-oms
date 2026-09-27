import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { currentIstMonth } from "@/lib/billing/telephonic-so";
import { istMonthRange } from "@/lib/billing/telephonic";
import { listPickDelete } from "@/lib/billing/pick-delete";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/pick-delete/list?month=YYYY-MM — the Pick delete tab: the open
 * same-SO groups billing can act on (getActionableGroups — at least one bill
 * passes pickDeleteCheck; ALL DATES, oldest first) and the History list for the IST
 * month (newest first). `month` defaults to the current IST month; a malformed
 * one is a 400. READ-ONLY. Gate: billing_pick_delete canView. Logic:
 * lib/billing/pick-delete.ts.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // checkAnyPermission, never checkPermission — the latter reads only the primary role.
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_pick_delete", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const monthParam = new URL(req.url).searchParams.get("month");
  const month = monthParam ?? currentIstMonth(new Date());
  if (istMonthRange(month) === null) {
    return NextResponse.json({ error: `Invalid month "${month}" — expected YYYY-MM` }, { status: 400 });
  }

  const list = await listPickDelete(month);
  return NextResponse.json(list, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
