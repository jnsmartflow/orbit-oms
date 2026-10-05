import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getISTDayRange } from "@/lib/dates";
import {
  loadPrintTrips,
  getPrintWorkTripIds,
  getDoneTripIds,
  byOldestSent,
  byNewestDone,
} from "@/lib/billing/print";

export const dynamic = "force-dynamic";

/** Same shape gate as /api/billing/picking/list — a malformed day is a 400, never today. */
const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/billing/print/list — the Billing screen's Print tab (slice 9,
 * 2026-09-15; Print v2 2026-10-05).
 *
 *   pending — every trip sent to billing with copy work outstanding: Done not
 *             pressed, or reopened by a non-held bill not yet copied (never a
 *             dispatched done trip). ALL DATES, oldest sent first. Includes trips
 *             still being picked — they are work, and each bill says its state.
 *   copied  — trips billing pressed Done on, for ONE IST day (`?date=`, default
 *             today) keyed on trips.billingDoneAt. Newest first. (The key stays
 *             `copied` on the wire; the screen calls the section "Done today".)
 *
 * The rules — held bills out, OBD numbers per bill, ready = picking Done per
 * Floor, review on a confirmed finding, partial copies allowed, Done is a press —
 * live in lib/billing/print.ts and nowhere else.
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
  const doneIds = await getDoneTripIds(start, end);
  const trips = await loadPrintTrips([...workIds, ...doneIds]);

  const pending = trips.filter((t) => t.state !== "done").sort(byOldestSent);
  // ⚠ The day test is repeated here, not trusted from `doneIds`: a done trip
  // belongs to the day of ITS Done press, and a reopened one is in `pending`.
  const copied = trips
    .filter((t) => {
      if (t.state !== "done" || t.billingDoneAt === null) return false;
      const at = new Date(t.billingDoneAt).getTime();
      return at >= start.getTime() && at < end.getTime();
    })
    .sort(byNewestDone);

  return NextResponse.json({ pending, copied }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
