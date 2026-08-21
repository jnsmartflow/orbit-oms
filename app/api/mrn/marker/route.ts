import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import { buildMrnSupervisorWhere } from "@/lib/mrn/queries";
import type { MrnSupervisorTab } from "@/lib/mrn/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/mrn/marker?tab=… — a lightweight "has this supervisor tab changed?"
 * probe for client polling. The phone refetches the full board ONLY when this
 * marker differs from the last one it saw. Mirrors
 * app/api/picking/marker/route.ts in shape: one aggregate, no joins, no lines,
 * no sort.
 *
 * 🔴 SUPERVISOR ONLY. THERE IS DELIBERATELY NO BILLING MARKER, AND NONE MAY BE
 * ADDED. The owner ruled explicitly that billing gets NO live sync (design §5,
 * "No live sync into billing"): while the supervisor holds an MRN, billing's
 * screen shows the lines EXACTLY as billing left them — greyed, behind the
 * amber "Locked — the supervisor is checking this truck" banner — and
 * everything lands in ONE write at End unloading.
 *
 * This is a KNOWN, INTENTIONAL divergence from /picking and /floor, which both
 * poll a 15s marker for every face. It is written here because the missing
 * billing marker looks exactly like an oversight to anyone who has just read
 * those two modules. It is not one. Adding it would be a new product decision,
 * not a bug fix — do not "align MRN to the other boards" as a consistency pass.
 *
 * Marker = (count, latest), computed in ONE aggregate:
 *   count  — COUNT(*) of the tab's MRNs. Catches DEPARTURES, and this is the
 *            half that is easy to think unnecessary. When an MRN leaves a tab
 *            (Start unloading moves it open → checking, End moves it
 *            checking → done) its updatedAt is no longer INSIDE the aggregate,
 *            so MAX(updatedAt) over the tab it left can move BACKWARDS or not
 *            move at all. Only the count reports that. Same reasoning as
 *            Picking §10 — which is exactly why the marker is (count, latest)
 *            and never latest alone.
 *   latest — MAX(mrn.updatedAt). Catches in-place edits. `mrn.updatedAt` is
 *            @updatedAt in schema.prisma, so every Prisma write to the row
 *            stamps it (the live column's DEFAULT now() covers INSERT only —
 *            the push_subscriptions landmine, CORE §13).
 *
 * The WHERE comes from buildMrnSupervisorWhere() — the SAME predicate
 * getMrnSupervisorBoard() renders that tab with — so the marker and the board
 * can never watch different sets. NEVER re-declare it here: a marker watching a
 * NARROWER set than the board silently misses updates on the floor, and nobody
 * sees it until a truck is missed (Picking §10 / Floor §10, and queries.ts's
 * own header states the obligation).
 *
 * READ-ONLY, and load-bearingly so: a write here would bump updatedAt and fire
 * a false "changed" on every polling phone, forever (CORE §3 / Picking §10).
 * Never bump a timestamp to make the marker fire.
 */

/** Duplicated from app/api/mrn/board/route.ts on purpose, so the two routes
 *  accept and reject identical values — the picking queue/marker pair does the
 *  same with `scope`. */
const SUPERVISOR_TABS = ["toCheck", "checking", "done"] as const;

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate + admin bypass as the board route and the picking routes.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(req.url);
  const tabParam = searchParams.get("tab")?.trim() || undefined;

  // `tab` is REQUIRED and validated, never coerced. There is no defensible
  // default predicate: quietly probing 'toCheck' for a phone sitting on 'done'
  // would leave that tab frozen — a stale board reporting itself as live, which
  // is worse than a 400 the caller can see.
  if (tabParam === undefined || !SUPERVISOR_TABS.includes(tabParam as never)) {
    return NextResponse.json(
      {
        error:
          tabParam === undefined
            ? '`tab` is required — expected "toCheck", "checking" or "done"'
            : `Invalid tab "${tabParam}" — expected "toCheck", "checking" or "done"`,
      },
      { status: 400 },
    );
  }
  const tab = tabParam as MrnSupervisorTab;

  // One shared IST window, the same helper the board uses (lib/dates.ts) — not
  // a second implementation. Only the 'done' tab reads it; 'toCheck' and
  // 'checking' span all dates by design (§11 OQ-6).
  const todayRange = getISTDayRange();

  // One round trip: COUNT(*) + MAX(updatedAt) in a single aggregate.
  const agg = await prisma.mrn.aggregate({
    where: buildMrnSupervisorWhere(tab, todayRange),
    _count: true,
    _max: { updatedAt: true },
  });

  // No proxy or browser may serve a stale marker — freshness is the whole point.
  return NextResponse.json(
    {
      count: agg._count,
      latest: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null,
      // Echoed back so a debugger can see which question was asked. Not read by
      // the client.
      tab,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
