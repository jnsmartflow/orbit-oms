import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { releaseBillsToFloor, type ReleaseFailure } from "@/lib/floor/release";

export const dynamic = "force-dynamic";

interface ReleaseItem {
  orderId: number;
  dispatchTargetDate: string; // YYYY-MM-DD
  dispatchWindowId: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10) === s ? dt : null;
}

// POST /api/floor/release — release one or more bills to the floor. Serves BOTH
// the left rail (bills at pending_support) and the Hold tab (bills held after
// auto-dispatch, at pending_picking) — see FLOOR_RELEASABLE_STAGES.
// Body: { releases: [{ orderId, dispatchTargetDate, dispatchWindowId }] }.
// Single = an array of one; bulk = each bill with its own suggested slot.
// Returns 422 when EVERY requested bill failed (nothing written); a partial
// success stays 200 but always carries the `failed` list so the client can
// surface it — a write that skips silently must never look like success.
//
// ═══ THE RELEASE WRITE MOVED OUT OF THIS FILE — 2026-09-10 ═══
//
// 🔴 The per-bill loop — the stage check, the single `orders.update` and the
// single `order_status_logs` row — now lives in `releaseBillsToFloor()`
// (lib/floor/release.ts). It was extracted, not rewritten: every column, the
// `fromStage`-is-the-real-prior-stage rule and the one-write contract are the
// originals, moved verbatim.
//
// WHY: `POST /api/floor/trips/[id]/release` was doing only the visibility stamp
// and NOT this write, so a bill at `pending_support` put on a trip never
// actually reached the floor (`code-discovery-2026-09-10-noslot-backlog.md §B5`).
// It now calls the same function. ONE OWNER PER BEHAVIOUR — the discipline that
// already keeps `buildPickingWhere` shared between the queue and the marker, and
// `stampPickVisibility` between this module and pick-visible.
//
// ⚠ THIS ROUTE'S BEHAVIOUR IS UNCHANGED, and one flag is what guarantees it:
// `skipAlreadyReleased` is left FALSE here. The Hold tab depends on rewriting a
// bill that is ALREADY at `pending_picking` — that is the whole reason
// `pending_picking` is in FLOOR_RELEASABLE_STAGES, and the silent-no-op bug
// FLOOR §6(b) records. Only the trip caller passes `true`.
//
// ⚠ A MID-TINT BILL IS STILL A FAILURE HERE, not a skip. The shared writer
// separates `waitingForTint` from `failed`, and this route folds it back in:
// the rail never offers a mid-tint bill a Release button, so one arriving at
// this endpoint is a malformed request, and reporting it as a quiet skip would
// hide that. The trip caller reports it as its own bucket, because there a
// mid-tint bill on a trip is an ordinary, expected state.
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // session.user.id is a numeric string (lib/auth.ts). Require a real positive
  // integer so an empty/absent id can never become changedById: 0.
  const changedById = Number(session.user.id);
  if (!Number.isInteger(changedById) || changedById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { releases?: ReleaseItem[] };
  const releases = body.releases;
  if (!Array.isArray(releases) || releases.length === 0) {
    return NextResponse.json({ error: "releases is required and must be a non-empty array" }, { status: 400 });
  }

  // Friendly audit-note window labels — one read, no per-bill query.
  const windows = await prisma.dispatch_slot_master.findMany({ select: { id: true, windowTime: true } });
  const windowTimeById = new Map(windows.map((w) => [w.id, w.windowTime]));

  const released: number[] = [];
  const failed: ReleaseFailure[] = [];

  for (const r of releases) {
    if (
      typeof r?.orderId !== "number" ||
      !Number.isInteger(r.orderId) ||
      typeof r?.dispatchWindowId !== "number" ||
      !Number.isInteger(r.dispatchWindowId) ||
      typeof r?.dispatchTargetDate !== "string"
    ) {
      failed.push({ orderId: typeof r?.orderId === "number" ? r.orderId : -1, error: "Invalid release item" });
      continue;
    }
    const date = parseDateOnly(r.dispatchTargetDate);
    if (!date) {
      failed.push({ orderId: r.orderId, error: "Invalid dispatchTargetDate" });
      continue;
    }

    // ONE bill at a time, because each carries its OWN slot — the rail's whole
    // shape (the operator confirms a suggestion per card). The shared writer
    // takes a list because the trip caller has one slot for many bills; here the
    // list is always length 1.
    const out = await releaseBillsToFloor({
      orderIds: [r.orderId],
      targetDate: date,
      windowId: r.dispatchWindowId,
      windowLabel: windowTimeById.get(r.dispatchWindowId) ?? String(r.dispatchWindowId),
      actorId: changedById,
      noteLabel: "Released to floor",
      // FALSE — see the header. The Hold tab must rewrite an already-
      // pending_picking bill, or a held bill can never leave Hold.
      skipAlreadyReleased: false,
    });

    released.push(...out.released);
    failed.push(...out.failed);
    // Folded back into `failed`, deliberately — see the header.
    for (const t of out.waitingForTint) {
      failed.push({ orderId: t.orderId, error: `Not releasable at stage ${t.workflowStage}` });
    }
  }

  // Nothing written at all → 422 so the failure cannot be read as success. A
  // partial success stays 200 but always carries `failed` for the client.
  const status = released.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ released, failed }, { status });
}
