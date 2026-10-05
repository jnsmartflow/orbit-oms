import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { isBillingFeedOn } from "@/lib/live/feed";
import { parseSyncBody } from "@/lib/billing/sync-rule";
import { billingSync } from "@/lib/billing/sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/sync — Billing's ONE call per live-feed glance that carried changes
 * (live feed billing 2b-i, 2026-09-30; plan §D). READ-ONLY.
 *
 * Body: { orderIds, tripIds, soTagChanged, mailOrderIds,
 *         shown: { pickingIds, printTripIds, printOrderIds, telephonicOrderIds, pickDeleteIds } } — every field
 * optional. `shown` = the ids the client currently holds for each arm, so a row LEAVING a list is
 * seen even though its current state no longer matches.
 *
 * Answer: { enabled, touched: { picking, print, telephonic, pickDelete, mailOrders },
 *           counts: { …only the touched arms } }.
 *
 * Gates, in order:
 *   1. session (401);
 *   2. `mail_orders` canView (403) — the page gate of /mail-orders, where Billing lives;
 *   3. the switches: `live.feed` AND `live.feed.billing` (absent = OFF) → 200 { enabled: false },
 *      nothing else read;
 *   4. the body (400);
 *   5. per arm, EXACTLY its marker route's gate — canView on billing_picking / billing_print /
 *      billing_telephonic / billing_pick_delete; mail orders = the route gate above. An arm the
 *      caller may not see is never read and always answers touched=false with no count.
 * Logic and cost: lib/billing/sync.ts.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "mail_orders", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
  if (!(await isBillingFeedOn())) return NextResponse.json({ enabled: false }, { headers: NO_STORE });

  const body = parseSyncBody(await req.json().catch(() => null));
  if (typeof body === "string") return NextResponse.json({ error: body }, { status: 400 });

  // Sequential, never Promise.all over the pool (CORE §3 spirit; the access notebook makes these free).
  const arms = {
    picking: await checkAnyPermission(roles, "billing_picking", "canView"),
    print: await checkAnyPermission(roles, "billing_print", "canView"),
    telephonic: await checkAnyPermission(roles, "billing_telephonic", "canView"),
    pickDelete: await checkAnyPermission(roles, "billing_pick_delete", "canView"),
    mailOrders: true,
  };

  const result = await billingSync(body, arms);
  return NextResponse.json({ enabled: true, ...result }, { headers: NO_STORE });
}
