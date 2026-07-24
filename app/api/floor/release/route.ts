import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SUPPORT_DONE_OUTPUT } from "@/lib/workflow-stages";
import { FLOOR_RELEASABLE_STAGES } from "@/lib/floor/release-stages";

export const dynamic = "force-dynamic";

interface ReleaseItem {
  orderId: number;
  dispatchTargetDate: string; // YYYY-MM-DD
  dispatchWindowId: number;
}
interface Failed {
  orderId: number;
  error: string;
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
  const failed: Failed[] = [];

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

    const order = await prisma.orders.findUnique({
      where: { id: r.orderId },
      select: { workflowStage: true, isRemoved: true },
    });
    if (!order || order.isRemoved) {
      failed.push({ orderId: r.orderId, error: "Order not found" });
      continue;
    }
    // Releasable from the rail (pending_support: a non-tint bill or a tint bill
    // whose splits are all done) OR from Hold (pending_picking: auto-dispatched
    // then held). Floor's own explicit list, NOT Support's supportMayEdit — see
    // lib/floor/release-stages.ts. A mid-tint bill (tint_assigned /
    // tinting_in_progress) is absent, so it can never be released to a rack with
    // no shade (design §6.3).
    if (!FLOOR_RELEASABLE_STAGES.includes(order.workflowStage)) {
      failed.push({ orderId: r.orderId, error: `Not releasable at stage ${order.workflowStage}` });
      continue;
    }

    // ONE orders.update per bill — a second write would fire a false "changed"
    // on every board's updatedAt marker (CLAUDE_PICKING §10 / CORE §3).
    // dispatchSlotSource="manual" protects the operator's chosen slot from a
    // later re-enrichment overwriting it (the dispatch engine skips "manual").
    await prisma.orders.update({
      where: { id: r.orderId },
      data: {
        dispatchTargetDate: date,
        dispatchWindowId: r.dispatchWindowId,
        dispatchStatus: "dispatch",
        workflowStage: SUPPORT_DONE_OUTPUT,
        dispatchSlotSource: "manual",
      },
    });

    const winLabel = windowTimeById.get(r.dispatchWindowId) ?? String(r.dispatchWindowId);
    await prisma.order_status_logs.create({
      data: {
        orderId: r.orderId,
        // The real prior stage — pending_support (rail) or pending_picking
        // (held-from-floor). Hardcoding "pending_support" here would mislabel a
        // Hold-tab release's audit trail.
        fromStage: order.workflowStage,
        toStage: SUPPORT_DONE_OUTPUT,
        changedById,
        note: `Released to floor · ${r.dispatchTargetDate} ${winLabel}`,
      },
    });

    released.push(r.orderId);
  }

  // Nothing written at all → 422 so the failure cannot be read as success. A
  // partial success stays 200 but always carries `failed` for the client.
  const status = released.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ released, failed }, { status });
}
