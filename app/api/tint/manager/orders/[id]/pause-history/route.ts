import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Permission gate (locked OrbitOMS model): Admin OR canView on tint_manager.
  const isAdmin = session.user.role === "admin";
  if (!isAdmin) {
    const roles = session.user.roles ?? [session.user.role];
    const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
    }
  }

  // ── Validate id ────────────────────────────────────────────────────────────
  const orderId = parseInt(params.id, 10);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid order id" }, { status: 400 });
  }

  // ── 1. Load order — NO isRemoved filter. Pause history must remain visible
  //       on soft-removed orders for admin audit + restore flows.
  const order = await prisma.orders.findFirst({
    where:  { id: orderId },
    select: { id: true, obdNumber: true, isRemoved: true },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  // ── 1b. Phase 4e — build the skuLookup map for per-event progress
  //        rendering in the modal. Single query against
  //        import_raw_line_items by obdNumber.
  //
  // Field mapping note: import_raw_line_items does not carry a `shadeName`
  // column. We surface skuDescriptionRaw as shadeName (matches the Phase
  // 4c PauseJobModal precedent in the operator UI) and unitQty as
  // assignedQty (whole-OBD jobs: each line's full unitQty is assigned).
  const rawLines = await prisma.import_raw_line_items.findMany({
    where:  { obdNumber: order.obdNumber, lineStatus: "active" },
    select: { id: true, skuCodeRaw: true, skuDescriptionRaw: true, unitQty: true, isTinting: true },
  });
  const skuLookup: Record<number, { skuCode: string; shadeName: string; assignedQty: number }> = {};
  for (const li of rawLines) {
    skuLookup[li.id] = {
      skuCode:     li.skuCodeRaw,
      shadeName:   li.skuDescriptionRaw ?? li.skuCodeRaw,
      assignedQty: li.unitQty,
    };
  }

  // ── 2. Fetch all pause events for this order, oldest first (chronological).
  // tint_pause_events.id is BigInt — destructure-and-omit at the map level
  // before returning to keep JSON.stringify clean (Phase 3e pattern).
  const eventsRaw = await prisma.tint_pause_events.findMany({
    where:   { orderId },
    orderBy: { pausedAt: "asc" },
    select: {
      id:                    true,
      assignmentId:          true,
      pausedAt:              true,
      pauseReason:           true,
      pauseRemark:           true,
      progressSnapshot:      true,
      elapsedMinutesAtPause: true,
      resumedAt:             true,
      resumeRemark:          true,
      operator:  { select: { id: true, name: true } },
      resumedBy: { select: { id: true, name: true } },
    },
  });

  // Map onto the external DTO. The internal schema names (pauseReason,
  // pauseRemark, progressSnapshot, operator) are translated back to the
  // spec's external names (reason, remark, progress, pausedBy). BigInt id
  // is converted to Number; Dates to ISO strings.
  const events = eventsRaw.map((e) => ({
    id:               Number(e.id),
    assignmentId:     e.assignmentId,
    pausedAt:         e.pausedAt.toISOString(),
    reason:           e.pauseReason,
    remark:           e.pauseRemark,
    progress:         e.progressSnapshot,
    elapsedMinutes:   e.elapsedMinutesAtPause,
    resumedAt:        e.resumedAt?.toISOString() ?? null,
    resumeRemark:     e.resumeRemark,
    pausedBy:         e.operator,
    resumedBy:        e.resumedBy,
  }));

  return NextResponse.json({
    ok:    true,
    order: {
      id:        order.id,
      obdNumber: order.obdNumber,
      isRemoved: order.isRemoved,
    },
    total:  events.length,
    events,
    skuLookup,
  });
}
