import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { getHideExclusion } from "@/lib/hide/visibility";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { getBaseOperatorId } from "@/lib/tint/base-operator";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/marker — a lightweight "has the tint board changed?"
 * probe. Mirrors app/api/floor/marker/route.ts exactly in shape: one aggregate,
 * no joins, no line items, no sort.
 *
 *   count  — COUNT(*) of orders on the Tint Manager board (arrivals and
 *            departures move it)
 *   latest — the later of MAX(orders.updatedAt) over that set (in-place edits
 *            move it) and, since 2026-09-30, MAX(updatedAt) of tint_assignments /
 *            order_splits / delivery_challans (child writes that never touch
 *            `orders` — see the extra statement below).
 *
 * Consumed by lib/hooks/use-picking-marker's `url` param, the same way Floor
 * watches its own set — so the poll, the refetch trigger and the connection
 * strip all run off ONE probe.
 *
 * READ-ONLY: there is no `orders.update` anywhere in this file. Never add one —
 * this marker and every other board's key on MAX(orders.updatedAt), so a write
 * here would fire a false "changed" on all of them (CORE §3, PICKING §10,
 * FLOOR §10).
 *
 * ── Predicate, and the one place it differs from Floor ───────────────────────
 * Floor gets to share ONE `floorLiveBaseWhere` between its board and its marker,
 * which is what stops the two drifting. The Tint Manager board cannot do that:
 * app/api/tint/manager/orders/route.ts renders SIX separate queries (pending
 * orders, completed-today orders, active splits, completed splits, completed
 * assignments, slots) and has no single `orders` WHERE to lend. So this is a
 * deliberate UNION APPROXIMATION of those feeds, and the drift risk is real and
 * named rather than pretended away:
 *
 *   arm 1 — the three open tint stages (Sets A / C: Pending, Assigned,
 *           In Progress). Matches the board's Set A `workflowStage: { in: [...] }`
 *           exactly.
 *   arm 2 — whole-OBD completions today (Set E): a tint_assignments row at
 *           `tinting_done` with `completedAt` in today. A finished bill leaves
 *           the tint stages entirely (done/route.ts writes `pending_support` or
 *           `pending_picking`), so arm 1 cannot see it and the Completed column
 *           would never refresh without this.
 *   arm 3 — split completions today (Set D), on `order_splits`. Same reason:
 *           a split finishing is a visible board change whose parent order sits
 *           outside arm 1.
 *
 *   arm 4 — HELD tint bills in ANY stage (2026-10-01, tabs build step 9): the
 *           Hold tab (/api/tint/manager/hold) lists a bill held and then
 *           finished (pending_support + hold), which arm 1 no longer sees.
 *   arm 5 — tint bills CANCELLED with an orders write today: the CI tab
 *           (/api/tint/manager/cancelled) is a today-only list, and a bill that
 *           left arm 1 by being cancelled must still move the marker for later
 *           edits that day. Same startOfToday as the board (below).
 *
 * And four more stamps in the GREATEST statement (step 9), each a tab's own
 * source: tint bills' ci_returns (the CI tab), pick_delete_decisions (the Pick
 * delete tab + popup), and the "Base — No Tint" placeholder's TI entries
 * (tinter_issue_entries / _b createdAt — the TI tab; a TI edit does not change
 * what is owed, and those tables carry no updatedAt).
 *
 * ⚠ If any of those feeds gains or loses a stage, THIS predicate must move
 * with it, or the board will stop refreshing on a change it displays.
 *
 * ⚠ `startOfToday` is deliberately computed the SAME (server-local, not IST) way
 * as the board's, in app/api/tint/manager/orders/route.ts. That expression is
 * arguably wrong — on Vercel the server runs UTC, so "today" starts at 05:30 IST
 * rather than midnight — but it is PRE-EXISTING and out of scope here. Copying it
 * verbatim keeps the marker and the board on one boundary; "fixing" it in only
 * one of the two would put them 5.5 hours apart and make the Completed column
 * refresh at the wrong moment. Fix both together or neither.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). Reads were held back when the
  // tint WRITES converted; this closes the split. Operations User loses these —
  // he holds no tint_manager tick and both tint layouts already redirect him.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const now          = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  // Sequential await, never $transaction (CORE §3). The hide-exclusion is
  // AND-merged exactly as the board's six queries merge it, so a hidden OBD
  // cannot move a marker for a row nobody can see.
  const hideExclusion = await getHideExclusion();

  // The "Base — No Tint" placeholder. Excluded from both completion arms below
  // so the marker stays a faithful approximation of the board's six feeds —
  // CLAUDE_TINT.md §1.9's rule is that if a feed gains or loses a stage this
  // predicate must move with it, and Set E just did.
  const baseOperatorId = await getBaseOperatorId();

  const agg = await prisma.orders.aggregate({
    where: {
      AND: [
        {
          orderType: "tint",
          isRemoved: false,
          OR: [
            {
              workflowStage: {
                in: ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"],
              },
            },
            {
              // Arm 2 — whole-OBD completions. Mirrors Set E in
              // manager/orders/route.ts, INCLUDING its placeholder exclusion:
              // a "Base — No Tint" bypass no longer shows on the board, so it
              // must not move the marker either or the board would refetch on a
              // change it does not display.
              tintAssignments: {
                some: {
                  status:      TINT_STATUS_DONE,
                  completedAt: { gte: startOfToday },
                  ...(baseOperatorId !== null ? { assignedToId: { not: baseOperatorId } } : {}),
                },
              },
            },
            {
              // Arm 3 — split completions. The same exclusion is applied for
              // symmetry, but note it can never match anything today: the
              // bypass writes whole-OBD `tint_assignments` rows only, and
              // POST /api/tint/manager/splits/create has had no caller since
              // the 2026-09-05/06 board rebuild (CLAUDE_TINT.md §1.11), so no
              // split can be raised against the placeholder at all.
              splits: {
                some: {
                  status:      TINT_STATUS_DONE,
                  completedAt: { gte: startOfToday },
                  ...(baseOperatorId !== null ? { assignedToId: { not: baseOperatorId } } : {}),
                },
              },
            },
            // Arm 4 — the Hold tab: a held tint bill in any stage, including
            // one that finished tinting and is parked at pending_support.
            { dispatchStatus: "hold" },
            // Arm 5 — the CI tab: a tint bill cancelled (or edited after its
            // cancel) today. Same startOfToday as the board — do not "fix" one.
            { workflowStage: "cancelled", updatedAt: { gte: startOfToday } },
          ],
        },
        hideExclusion,
      ],
    },
    _count: true,
    _max: { updatedAt: true },
  });

  // Widened 2026-09-30 (plan §C1), replacing the Manager's blind 60s refetch.
  // A pause/resume, a split start/status/reassign, a TI entry and a challan
  // save/void write tint_assignments / order_splits / delivery_challans but NOT
  // `orders`, so the aggregate above never moved for them. `@updatedAt` sets
  // each table's stamp on every write. Deliberately unfiltered: any row there is
  // tint work, and a rare false "changed" costs one board reload — what the blind
  // tick paid every 60s. 3 tiny seq scans (~1 ms). Folded into `latest`, so the
  // response shape — and lib/hooks/use-picking-marker — are unchanged.
  //
  // Step 9 (2026-10-01) adds four terms to the SAME single statement:
  //   · tint bills' CIs — ci_returns joined to orderType 'tint' only, so
  //     billing's CI churn on other bills never reloads this board;
  //   · pick_delete_decisions — low volume, unfiltered (a Billing decision
  //     costs one reload);
  //   · the placeholder's TI rows — createdAt (no updatedAt on those tables),
  //     restricted to "Base — No Tint" assignments so an operator's ordinary TI
  //     save does not fire. Skipped entirely when the placeholder is missing.
  // Parameterised fragments only (Prisma.sql / Prisma.empty), never string
  // building. Still READ-ONLY.
  const baseTiTerms = baseOperatorId !== null
    ? Prisma.sql`,
      (SELECT max(e."createdAt") FROM tinter_issue_entries e
        WHERE e."tintAssignmentId" IN (SELECT id FROM tint_assignments WHERE "assignedToId" = ${baseOperatorId})),
      (SELECT max(e."createdAt") FROM tinter_issue_entries_b e
        WHERE e."tintAssignmentId" IN (SELECT id FROM tint_assignments WHERE "assignedToId" = ${baseOperatorId}))`
    : Prisma.empty;
  const childRows = await prisma.$queryRaw<{ m: Date | null }[]>`
    SELECT GREATEST(
      (SELECT max("updatedAt") FROM tint_assignments),
      (SELECT max("updatedAt") FROM order_splits),
      (SELECT max("updatedAt") FROM delivery_challans),
      (SELECT max(c."updatedAt") FROM ci_returns c
         JOIN orders o ON o.id = c."orderId" AND o."orderType" = 'tint'),
      (SELECT max("updatedAt") FROM pick_delete_decisions)${baseTiTerms}) AS m`;
  const latest = laterOf(agg._max.updatedAt, childRows[0]?.m ?? null);

  return NextResponse.json(
    { count: agg._count, latest: latest ? latest.toISOString() : null },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

/** The later of two nullable stamps (GREATEST ignores NULLs; so does this). */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
