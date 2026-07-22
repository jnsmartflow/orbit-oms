import { NextResponse } from "next/server";
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

  try {
    // buildPickingWhere() throws on a malformed/impossible date (same stance as
    // the queue: a typo'd date surfaces a clear 400, never a silently-different
    // answer). Sequential awaits only — never prisma.$transaction (CORE §3).
    const { where } = buildPickingWhere({ date: dateParam, scope: scopeParam });

    // One round trip: COUNT(*) + MAX(updatedAt) in a single aggregate.
    const agg = await prisma.orders.aggregate({
      where,
      _count: true,
      _max: { updatedAt: true },
    });

    const body = {
      count: agg._count,
      latest: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null,
      scope: scopeParam ?? "single",
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
