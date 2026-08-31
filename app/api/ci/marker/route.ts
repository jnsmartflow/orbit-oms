import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import { assertCiDate, buildCiBillingWhere } from "@/lib/ci/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/ci/marker[?date=YYYY-MM-DD] — a lightweight "has billing's rail
 * changed?" probe for client polling. The desk refetches the full board ONLY
 * when this marker differs from the last one it saw. Mirrors
 * app/api/mrn/marker/route.ts in shape: one aggregate, no joins, no lines, no
 * sort.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 BILLING POLLS. THE SUPERVISOR DOES NOT. THERE IS NO SUPERVISOR MARKER,
 *    AND NONE MAY BE ADDED WITHOUT A PRODUCT DECISION.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the MIRROR IMAGE of MRN, and the asymmetry is deliberate in both
 * modules (spec §10). MRN's marker is SUPERVISOR-only, because there billing
 * raises the work and the supervisor is the one waiting. CI runs the other way:
 * the floor supervisor CREATES the return on his phone, so he has nothing to
 * wait for — he is the event. The billing desk is the side sitting with a screen
 * open, waiting for someone else to act.
 *
 * Written down because the missing supervisor marker looks exactly like an
 * oversight to anyone who has just read MRN, /picking or /floor, all three of
 * which poll their supervisor face. It is not one. Adding a supervisor marker
 * here would be a new product decision, not a bug fix — do not "align CI to the
 * other boards" as a consistency pass.
 *
 * Marker = (count, latest), computed in ONE aggregate:
 *   count  — COUNT(*) over the day's rail. Catches DEPARTURES, and this is the
 *            half that is easy to think unnecessary. When a CI leaves the day's
 *            set (voided, or its submittedAt moved), MAX(updatedAt) over what
 *            remains can move BACKWARDS or not move at all. Only the count
 *            reports that. Same reasoning as Picking §10 and the MRN marker —
 *            which is exactly why it is (count, latest) and never latest alone.
 *   latest — MAX(ci_returns.updatedAt). Catches in-place edits, including the
 *            close. `updatedAt` is `@updatedAt` in schema.prisma, so every
 *            Prisma write to the row stamps it (the live column's DEFAULT now()
 *            covers INSERT only — the push_subscriptions landmine, CORE §13).
 *
 * 🔴 THE WHERE COMES FROM buildCiBillingWhere() — the SAME predicate
 * getCiBillingBoard() renders that day with. NEVER re-declare it here: a marker
 * watching a NARROWER set than the board silently misses updates on the desk,
 * and nobody sees it until a CI sits unclosed. Wider is harmless (a few extra
 * refetches); narrower is a bug that hides itself.
 *
 * 🔴 READ-ONLY, AND LOAD-BEARINGLY SO. A write here would bump `updatedAt` and
 * fire a false "changed" on every polling desk, forever (CORE §3 / Picking §10).
 * Never bump a timestamp to make the marker fire.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date")?.trim() || undefined;

  // Optional, but validated when present — a typo must never quietly probe a
  // different day than the rail is showing, which would leave the desk frozen
  // while reporting itself live.
  let iso: string | undefined;
  try {
    iso = dateParam === undefined ? undefined : assertCiDate(dateParam);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid date" },
      { status: 400 },
    );
  }

  const range = getISTDayRange(iso);

  // ONE round trip: COUNT(*) + MAX(updatedAt) in a single aggregate.
  const agg = await prisma.ci_returns.aggregate({
    where: buildCiBillingWhere(range),
    _count: true,
    _max: { updatedAt: true },
  });

  // No proxy or browser may serve a stale marker — freshness is the whole point.
  return NextResponse.json(
    {
      count: agg._count,
      latest: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
