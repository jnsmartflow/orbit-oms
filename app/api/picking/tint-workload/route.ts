import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getTintWorkload } from "@/lib/picking/tint-workload";

export const dynamic = "force-dynamic";

/**
 * GET /api/picking/tint-workload — what the tint room is holding, for the
 * supervisor's Picking tab.
 *
 * READ-ONLY, and read-only is the whole design: the supervisor cannot act on a
 * tint bill, and a bill becomes assignable only when the tint room finishes it
 * and a done route advances its stage. There is no write counterpart to this
 * route and there must not be one.
 *
 * 🔴 GATED ON `picking` canView, NOT on a tint key. It is the only tick the
 * whole floor team shares — all 5 active floor supervisors and all 11 active
 * pickers hold it (SELECT-verified 2026-09-17), and NOT ONE of them holds
 * `tint_manager`, `tint_operator` or `floor`. The two existing feeds that carry
 * this data are gated on those keys, which is why neither could be reused:
 * `/api/tint/manager/orders` would have meant granting the floor the Tint
 * Manager board and its writes, and `/api/floor/board` the desk screen.
 *
 * ⚠ A PICKER CAN CALL THIS, and that is accepted rather than overlooked. The
 * payload is the same names, bills, litres and drums his own board already shows
 * him, with no cost, no customer contact and no money in it; the Tinting SECTION
 * is not rendered on his face at all (his shell has no Picking tab —
 * components/picking/picking-mobile-shell.tsx's PICKER_TAB_KEYS). Narrowing this
 * to supervisors would need a new tick that nobody holds yet, which is a
 * permissions decision, not a route detail.
 *
 * The payload's shape, the state vocabulary and every rule behind them live in
 * lib/picking/tint-workload.ts. Sequential awaits, no $transaction (CORE §3).
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const workload = await getTintWorkload();

  // The clock is in the payload: `minutes` and `waitingHours` are computed
  // server-side, so a stale cached copy would age silently.
  return NextResponse.json(workload, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
