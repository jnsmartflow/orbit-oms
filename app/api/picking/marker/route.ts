import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildPickingWhere } from "@/lib/picking/queue";
import { isPickGateOn } from "@/lib/picking/visibility-gate";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

/**
 * GET /api/picking/marker — a lightweight "has the picking board changed?"
 * probe for 15s client polling. The client fetches the full queue ONLY when
 * this marker differs from the last one it saw.
 *
 * It aggregates over the SAME orders rows getPickingQueue() renders:
 * `buildPickingWhere()` (lib/picking/queue.ts) is the single shared filter, so
 * the marker and the queue can never watch different sets — a marker scoped to
 * a different set than the queue would miss updates on the floor. Same
 * scope/date params, same validation, same 400s as
 * app/api/picking/queue/route.ts.
 *
 * Marker = (count, latest, heldBack). The first two are computed in ONE
 * aggregate — no joins, no line items, no sort. `heldBack` costs a second
 * count() and is skipped entirely unless the visibility gate is on (see below):
 *   count  — COUNT(*) of picking-scoped orders; catches arrivals/departures
 *            (a bill leaving the scope drops the count).
 *   latest — MAX(orders.updatedAt); catches in-place edits. Every picking
 *            mutation bumps orders.updatedAt (@updatedAt) via a paired
 *            orders.update in assign/done/approve/unassign/release, so a state
 *            transition always moves this value. Hits orders_updatedAt_idx.
 *
 * Optional `pickerId` narrows the set to ONE picker's rows by AND-merging
 * `{ pickAssignment: { pickerId } }` into buildPickingWhere()'s where (the
 * queue filter itself is untouched). The picker "My Picks" board uses this so
 * an idle picker's phone only refreshes when HIS bills change, not on every
 * board-wide edit. A bill leaving his set (unassign / reassign-away — the
 * pick_assignments row deleted or repointed) is caught by the COUNT dropping,
 * not by that bill's own updatedAt (which is no longer in the set) — which is
 * exactly why the marker is (count, latest) and not latest alone.
 *
 * `heldBack` — how many WAITING bills the visibility gate is currently hiding.
 * Always 0 while the gate is off, and always 0 for a `pickerId` request (a
 * held-back bill is unassigned, so it belongs to no picker). The third number
 * is load-bearing for the same reason `count` is: a bill arriving already
 * hidden moves neither of the other two, because the gated predicate never
 * saw it.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate + admin bypass as app/api/picking/queue/route.ts — this route is
  // reachable directly by URL and reflects real depot data.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Param reading + validation mirror the queue route EXACTLY, so the marker
  // and the queue accept/reject identical inputs. An unrecognised scope must
  // not quietly degrade to 'single', and a `date` alongside 'openPending'
  // (which spans all dates) must be rejected, not silently dropped.
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date")?.trim() || undefined;
  const scopeParam = searchParams.get("scope")?.trim() || undefined;

  if (
    scopeParam !== undefined &&
    scopeParam !== "single" &&
    scopeParam !== "openPending"
  ) {
    return NextResponse.json(
      { error: `Invalid scope "${scopeParam}" — expected "single" or "openPending"` },
      { status: 400 },
    );
  }
  if (scopeParam === "openPending" && dateParam !== undefined) {
    return NextResponse.json(
      { error: "`date` is not accepted with scope=openPending (it spans all dates)" },
      { status: 400 },
    );
  }

  // Optional per-picker narrowing. Validate like the other params — reject a
  // malformed value with a 400 rather than silently widening back to board-wide.
  const pickerIdParam = searchParams.get("pickerId")?.trim() || undefined;
  let pickerId: number | undefined;
  if (pickerIdParam !== undefined) {
    const n = Number(pickerIdParam);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json(
        { error: `Invalid pickerId "${pickerIdParam}" — expected a positive integer` },
        { status: 400 },
      );
    }
    pickerId = n;
  }

  try {
    // buildPickingWhere() throws on a malformed/impossible date (same stance as
    // the queue: a typo'd date surfaces a clear 400, never a silently-different
    // answer). Sequential awaits only — never prisma.$transaction (CORE §3).
    // The floor visibility gate. Read from the SAME helper getPickingQueue uses
    // and passed to the SAME builder, so the marker cannot end up watching a
    // narrower set than the board renders — the failure PICKING §10 calls out
    // ("Marker ⊇ queue, never ⊂"), whose symptom is a supervisor's board that
    // silently stops refreshing.
    const gateOn = await isPickGateOn();

    const { where } = buildPickingWhere({ date: dateParam, scope: scopeParam, gateOn });

    // AND-merge the per-picker filter (Prisma ANDs top-level keys) WITHOUT
    // touching buildPickingWhere's own where — the queue stays byte-identical.
    // A to-one relation filter: only orders whose pick_assignments row has this
    // pickerId match; a bill with no assignment row (unassigned) or one pointing
    // at another picker is excluded — so a departure drops the COUNT.
    const scopedWhere: Prisma.ordersWhereInput =
      pickerId !== undefined ? { ...where, pickAssignment: { pickerId } } : where;

    // One round trip: COUNT(*) + MAX(updatedAt) in a single aggregate.
    const agg = await prisma.orders.aggregate({
      where: scopedWhere,
      _count: true,
      _max: { updatedAt: true },
    });

    // ── Held back: waiting bills the gate is hiding ───────────────────────────
    // A THIRD load-bearing number, for the same reason `count` is one. When a
    // bill is released to the floor it ENTERS the gated set, which moves both
    // `count` and `latest`; when a new bill arrives already hidden it moves
    // NEITHER, because the gated predicate never saw it. Without this figure an
    // operator's queue of un-released work would grow with nothing on any
    // screen changing.
    //
    // Built by SPREAD-AND at the call site, exactly like `pickerId` above —
    // buildPickingWhere gains no term for it. The top-level `workflowStage`
    // contradicts the OR's other two branches, so this counts waiting bills and
    // nothing else, and the second buildPickingWhere call's independent clock
    // read cannot change the answer (only the checked branch is clock-fenced,
    // and that branch cannot match here).
    //
    // ⚠ TWO SKIPS, both free:
    //   - gate OFF     → nothing is held back BY DEFINITION. Return 0 without
    //                    asking, so the poll costs exactly what it costs today.
    //   - a pickerId   → a held-back bill is waiting, so it carries no
    //                    pick_assignments row and can never be his. 0 without
    //                    asking rather than a round trip guaranteed to return 0.
    // Needs its own count(): an aggregate cannot carry two different filters.
    let heldBack = 0;
    if (gateOn && pickerId === undefined) {
      const { where: ungatedWhere } = buildPickingWhere({ date: dateParam, scope: scopeParam });
      heldBack = await prisma.orders.count({
        where: {
          ...ungatedWhere,
          workflowStage: SUPPORT_DONE_OUTPUT,
          pickVisibleAt: null,
        },
      });
    }

    const body = {
      count: agg._count,
      latest: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null,
      heldBack,
      scope: scopeParam ?? "single",
      // Echoed back so a debugger can see which question was asked (null =
      // board-wide). Not read by the client.
      pickerId: pickerId ?? null,
    };

    // No proxy or browser may serve a stale marker — freshness is the point.
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid date" },
      { status: 400 },
    );
  }
}
