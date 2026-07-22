import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildPickingWhere } from "@/lib/picking/queue";

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
 * Marker = (count, latest), computed in ONE aggregate — no joins, no line
 * items, no sort:
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
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate + admin bypass as app/api/picking/queue/route.ts — this route is
  // reachable directly by URL and reflects real depot data.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
    scopeParam !== "openPending" &&
    scopeParam !== "rolling"
  ) {
    return NextResponse.json(
      { error: `Invalid scope "${scopeParam}" — expected "single", "openPending", or "rolling"` },
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
    const { where } = buildPickingWhere({ date: dateParam, scope: scopeParam });

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

    const body = {
      count: agg._count,
      latest: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null,
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
