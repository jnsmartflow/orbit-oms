import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { PRINT_COPY_KINDS, copyTripBills, type PrintCopyKind } from "@/lib/billing/print";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/print/trip/[id]/copy — record a Copy on the Print tab
 * (slice 9, 2026-09-15; Billing Print v2, 2026-10-05).
 *
 * Body: `{ orderIds: number[], kind: "bulk" | "single" | "review" }` — the bills
 * whose OBD numbers the client just put on the clipboard.
 *   bulk   — "Copy N OBDs": every READY bill of the trip.
 *   single — "Copy this one" on a ready bill's panel (one bill).
 *   review — "Mark done" on a bill with a confirmed pick finding (one bill).
 * The server re-derives each bill's state and records only if every one is
 * still what the kind needs (lib/billing/print.ts copyTripBills); otherwise 409
 * and nothing is written. A bill someone else copied first is skipped and
 * counted in `alreadyCopied`.
 *
 * 🔴 WRITES trip_bill_copies, trips.billingCopiedAt / billingCopiedById and one
 * `bills_copied` activity row — NEVER AN ORDER ROW.
 *
 * Copy OBD on a review bill and Copy again on a copied one are clipboard-only
 * and never reach this route.
 *
 * Gated on `billing_print` canEdit. Sequential awaits (CORE §3).
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "billing_print", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = Number(params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderIds?: unknown; kind?: unknown };
  if (
    !Array.isArray(body.orderIds) ||
    body.orderIds.length === 0 ||
    !body.orderIds.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)
  ) {
    return NextResponse.json({ error: "orderIds must be a non-empty list of positive integers" }, { status: 400 });
  }
  if (typeof body.kind !== "string" || !(PRINT_COPY_KINDS as readonly string[]).includes(body.kind)) {
    return NextResponse.json({ error: `kind must be one of ${PRINT_COPY_KINDS.join(", ")}` }, { status: 400 });
  }

  const outcome = await copyTripBills({
    tripId,
    orderIds: body.orderIds as number[],
    kind: body.kind as PrintCopyKind,
    actorId,
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  return NextResponse.json({
    tripNumber: outcome.tripNumber,
    recorded: outcome.recorded,
    alreadyCopied: outcome.alreadyCopied,
    obdNumbers: outcome.obdNumbers,
    billingCopiedAt: outcome.billingCopiedAt,
  });
}
