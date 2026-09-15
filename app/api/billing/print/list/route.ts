import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getISTDayRange } from "@/lib/dates";
import {
  loadPrintTrips,
  getPrintWorkTripIds,
  getCopiedTripIds,
  byOldestSent,
  byNewestCopy,
} from "@/lib/billing/print";

export const dynamic = "force-dynamic";

/** Same shape gate as /api/billing/picking/list — a malformed day is a 400, never today. */
const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/billing/print/list — the Billing screen's Print tab (slice 9,
 * 2026-09-15).
 *
 *   pending — every trip sent to billing with copy work outstanding: never
 *             copied, or reopened by a number that arrived since. ALL DATES,
 *             oldest sent first. Includes trips not yet fully invoiced — they
 *             are work, and the tab says what they are waiting for.
 *   copied  — trips whose every number has been taken, for ONE IST day
 *             (`?date=`, default today) keyed on the latest copy. Newest first.
 *
 * The rules — held bills out, distinct numbers, never a partial set, new since
 * copy — live in lib/billing/print.ts and nowhere else.
 *
 * READ-ONLY. Gated on `billing_print` canView. Sequential awaits (CORE §3).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "billing_print", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const dateParam = new URL(req.url).searchParams.get("date");
  if (dateParam !== null && !DATE_STR_RE.test(dateParam)) {
    return NextResponse.json({ error: `Invalid date "${dateParam}" — expected YYYY-MM-DD` }, { status: 400 });
  }
  const { start, end } = getISTDayRange(dateParam ?? undefined);

  const workIds = await getPrintWorkTripIds();
  const copiedIds = await getCopiedTripIds(start, end);
  const trips = await loadPrintTrips([...workIds, ...copiedIds]);

  const pending = trips.filter((t) => t.state !== "copied").sort(byOldestSent);
  // ⚠ The day test is repeated here, not trusted from `copiedIds`: a trip in
  // `workIds` that turns out copied belongs to the day of ITS copy, which may
  // not be this one.
  const copied = trips
    .filter((t) => {
      if (t.state !== "copied" || t.billingCopiedAt === null) return false;
      const at = new Date(t.billingCopiedAt).getTime();
      return at >= start.getTime() && at < end.getTime();
    })
    .sort(byNewestCopy);

  return NextResponse.json({ pending, copied }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
