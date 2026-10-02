import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getFloorCancelled } from "@/lib/floor/queries";
import { BASE_BILL_WHERE } from "@/lib/tint/manager-bill";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/cancelled — today's cancelled and CI'd TINT bills, for
 * the Tint Manager's CI tab (2026-10-01, tabs build step 7 — plan §A/§C).
 *
 * Floor's Cancel & CI feed exactly (lib/floor/queries.ts getFloorCancelled —
 * today's CIs on cancelled bills, today's cancels still cancelled; reason,
 * remark, CI number and status, source, by, when), with extraWhere
 * { orderType: "tint" }. A row with a ciNumber carries a LIVE CI (the feed reads
 * only non-voided, non-draft CIs), so the tab offers no Restore on it — the
 * restore route refuses it anyway. READ-ONLY.
 *
 * Since 2026-10-01 the set is tint ∪ BASE bills (non-tint SMU 74/77, owner §I
 * decision 3): a Base bill's CI shows here too. Restore stays tint-only (the
 * restore route refuses a Base bill; the tab draws no Restore on one).
 *
 * Gate: tint_manager canView AND (tint_ci OR tint_cancel) canView.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ?date=YYYY-MM-DD (2026-10-02, history): the same feed for that IST day —
// getFloorCancelled's optional date. Without it the response is unchanged.
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  const host = await checkAnyPermission(roles, "tint_manager", "canView");
  const ci = host && (await checkAnyPermission(roles, "tint_ci", "canView"));
  const cancel = host && !ci && (await checkAnyPermission(roles, "tint_cancel", "canView"));
  if (!host || !(ci || cancel)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dateParam = new URL(req.url).searchParams.get("date");
  const date = dateParam !== null && DATE_RE.test(dateParam) ? dateParam : undefined;
  const rows = await getFloorCancelled("All", undefined, undefined, { OR: [{ orderType: "tint" }, BASE_BILL_WHERE] }, date);
  return NextResponse.json({ rows, count: rows.length }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
