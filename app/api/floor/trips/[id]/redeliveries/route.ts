import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import {
  addRedeliveries,
  isRedeliveryReason,
  removeRedeliveries,
  searchForRedelivery,
} from "@/lib/trips/redelivery";

export const dynamic = "force-dynamic";

/**
 * /api/floor/trips/[id]/redeliveries — TRIP RE-DELIVERIES (2026-10-03, Schema
 * v27.53). Plan: docs/prompts/drafts/web-update-2026-10-03-trip-redelivery.md
 * rev 5. Logic: lib/trips/redelivery.ts.
 *
 *   GET  ?q=<one full OBD / SO / invoice>               floor canView
 *        → { q, trip: { id, tripNumber }, bills: RedeliveryCandidate[] }
 *   POST { action: "add", orderIds, reason, note?, confirmedReturn? }   floor canEdit
 *        → { added: [{ id, orderId, obdNumber, attemptNo }], failed: [{ orderId, error }] }
 *   POST { action: "remove", redeliveryIds }                            floor canEdit
 *        → { removed: number[], failed: [{ redeliveryId, error }] }
 *
 * Same contract as /api/floor/trips/[id]/bills: 400 bad input, 404 no trip,
 * 409 trip refuses, 200 with `failed[]` on a partial, 422 when nothing was
 * achieved. 🔴 NO `orders` WRITE AND NO order_status_logs ROW on any path.
 * Sequential awaits, never prisma.$transaction (CORE §3).
 */

/** Same ceiling as billing mark-done — a press, not a batch job. */
const MAX_IDS = 200;
/** Free text on a re-delivery; the floor CI remark carries the same bound. */
const NOTE_MAX = 500;

function tripIdOf(params: { id: string }): number | null {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function intList(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDS) return null;
  if (!value.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)) return null;
  return Array.from(new Set(value as number[]));
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "floor", "canView"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tripId = tripIdOf(params);
  if (tripId === null) return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const out = await searchForRedelivery(tripId, q);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ q: out.q, trip: out.trip, bills: out.bills });
}

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "floor", "canEdit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The real session user, for the row and the activity log. Never a body claim.
  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const tripId = tripIdOf(params);
  if (tripId === null) return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null || typeof body !== "object") {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (body.action === "add") {
    const orderIds = intList(body.orderIds);
    if (orderIds === null) {
      return NextResponse.json(
        { error: `orderIds is required: 1–${MAX_IDS} positive integers` },
        { status: 400 },
      );
    }
    if (!isRedeliveryReason(body.reason)) {
      return NextResponse.json({ error: 'reason must be "site_closed" or "wrong_dispatch"' }, { status: 400 });
    }
    let note: string | null = null;
    if (body.note !== undefined && body.note !== null) {
      if (typeof body.note !== "string") return NextResponse.json({ error: "note must be a string" }, { status: 400 });
      const trimmed = body.note.trim();
      if (trimmed.length > NOTE_MAX) {
        return NextResponse.json({ error: `note is at most ${NOTE_MAX} characters` }, { status: 400 });
      }
      note = trimmed === "" ? null : trimmed;
    }
    if (body.confirmedReturn !== undefined && typeof body.confirmedReturn !== "boolean") {
      return NextResponse.json({ error: "confirmedReturn must be true or false" }, { status: 400 });
    }

    const out = await addRedeliveries(
      tripId,
      { orderIds, reason: body.reason, note, confirmedReturn: body.confirmedReturn === true },
      actorId,
    );
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    const status = out.added.length === 0 && out.failed.length > 0 ? 422 : 200;
    return NextResponse.json({ added: out.added, failed: out.failed }, { status });
  }

  if (body.action === "remove") {
    const redeliveryIds = intList(body.redeliveryIds);
    if (redeliveryIds === null) {
      return NextResponse.json(
        { error: `redeliveryIds is required: 1–${MAX_IDS} positive integers` },
        { status: 400 },
      );
    }
    const out = await removeRedeliveries(tripId, { redeliveryIds }, actorId);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    const status = out.removed.length === 0 && out.failed.length > 0 ? 422 : 200;
    return NextResponse.json({ removed: out.removed, failed: out.failed }, { status });
  }

  return NextResponse.json({ error: 'action is required and must be "add" or "remove"' }, { status: 400 });
}
