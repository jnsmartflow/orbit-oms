import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Permission gate (locked OrbitOMS model): Admin OR canView on the
  // tint_manager page key. Same gate as Remove OBD.
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

  // ── 1. Load order — NO isRemoved filter. Skip history must remain visible
  //       on removed orders so admins can audit prior to / during restore.
  const order = await prisma.orders.findFirst({
    where: { id: orderId },
    select: { id: true, obdNumber: true, isRemoved: true },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  // ── 2. Fetch all skip events for this order ────────────────────────────────
  const events = await prisma.tint_skip_events.findMany({
    where:   { orderId },
    orderBy: { skippedAt: "desc" },
    select: {
      id:                true,
      skippedAt:         true,
      reason:            true,
      tinterType:        true,
      outOfStockColours: true,
      remark:            true,
      skippedBy:         { select: { id: true, name: true } },
      assignment:        { select: { id: true } },
    },
  });

  // Normalise BigInt + Date for JSON. The tint_skip_events.id column is
  // bigserial in Postgres — Prisma returns BigInt which JSON.stringify rejects.
  const eventsOut = events.map((e) => ({
    id:                Number(e.id),
    skippedAt:         e.skippedAt.toISOString(),
    reason:            e.reason,
    tinterType:        e.tinterType,
    outOfStockColours: e.outOfStockColours,
    remark:            e.remark,
    skippedBy:         e.skippedBy,
    assignment:        { id: e.assignment.id },
  }));

  return NextResponse.json({
    ok:    true,
    order: {
      id:        order.id,
      obdNumber: order.obdNumber,
      isRemoved: order.isRemoved,
    },
    total:  eventsOut.length,
    events: eventsOut,
  });
}
