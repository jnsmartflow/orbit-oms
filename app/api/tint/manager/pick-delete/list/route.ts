import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { currentIstMonth } from "@/lib/billing/telephonic-so";
import { istMonthRange } from "@/lib/billing/telephonic";
import { listPickDelete } from "@/lib/billing/pick-delete";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/pick-delete/list?month=YYYY-MM — the Tint Manager's
 * Pick delete: the open same-SO groups whose EVERY bill is SMU 74/77 (owner
 * "tint", 2026-10-01 — plan §E) and this desk's decided list for the IST month.
 * Billing's route, shape and month rule exactly; the same lib function with
 * owner "tint". READ-ONLY.
 * Gate: tint_manager canView AND tint_pick_delete canView.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (
    !(await checkAnyPermission(roles, "tint_manager", "canView")) ||
    !(await checkAnyPermission(roles, "tint_pick_delete", "canView"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const monthParam = new URL(req.url).searchParams.get("month");
  const month = monthParam ?? currentIstMonth(new Date());
  if (istMonthRange(month) === null) {
    return NextResponse.json({ error: `Invalid month "${month}" — expected YYYY-MM` }, { status: 400 });
  }

  const list = await listPickDelete(month, "tint");
  return NextResponse.json(list, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
