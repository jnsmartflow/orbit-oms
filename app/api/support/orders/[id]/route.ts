import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// ── GET — single order with full detail ───────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "support_queue", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const order = await prisma.orders.findUnique({
    where: { id },
    include: {
      customer:      { include: { area: true } },
      querySnapshot: true,
      batch:         true,
      statusLogs: {
        orderBy: { createdAt: "desc" },
        take:    10,
        include: { changedBy: { select: { name: true } } },
      },
      tintAssignments: {
        include: { assignedTo: { select: { name: true } } },
      },
      splits: {
        include: {
          assignedTo: { select: { id: true, name: true } },
          lineItems: {
            include: {
              rawLineItem: {
                select: {
                  skuCodeRaw:        true,
                  skuDescriptionRaw: true,
                  unitQty:           true,
                  volumeLine:        true,
                  isTinting:         true,
                },
              },
            },
          },
        },
        orderBy: { splitNumber: "asc" },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Fetch enriched line items separately
  const lineItems = await prisma.import_enriched_line_items.findMany({
    where:   { rawLineItem: { obdNumber: order.obdNumber } },
    include: { sku: { select: { skuCode: true, skuName: true } } },
  });

  return NextResponse.json({ order, lineItems });
}

// ── PATCH — update order fields ───────────────────────────────────────────────

const patchSchema = z.object({
  dispatchStatus: z.string().optional(),
  priorityLevel:  z.number().int().min(1).max(5).optional(),
  dispatchSlot:   z.string().nullable().optional(),
  note:           z.string().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "support_queue", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { dispatchStatus, priorityLevel, dispatchSlot, note } = parsed.data;
  const userId = parseInt(session!.user.id, 10);

  // ── Load current order ────────────────────────────────────────────────────
  const order = await prisma.orders.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ── Build update data + log entries ──────────────────────────────────────
  const updateData: Prisma.ordersUpdateInput = {};

  type LogEntry = {
    orderId:     number;
    fromStage:   string | null;
    toStage:     string;
    changedById: number;
    note:        string | null;
  };

  const logEntries: LogEntry[] = [];
  const logNote = note ?? null;

  if (dispatchStatus !== undefined && dispatchStatus !== order.dispatchStatus) {
    updateData.dispatchStatus = dispatchStatus || null;
    logEntries.push({
      orderId:     id,
      fromStage:   order.dispatchStatus ?? null,
      toStage:     dispatchStatus || "cleared",
      changedById: userId,
      note:        logNote,
    });
  }

  if (priorityLevel !== undefined && priorityLevel !== order.priorityLevel) {
    updateData.priorityLevel = priorityLevel;
    logEntries.push({
      orderId:     id,
      fromStage:   String(order.priorityLevel),
      toStage:     String(priorityLevel),
      changedById: userId,
      note:        logNote,
    });
  }

  if (dispatchSlot !== undefined && dispatchSlot !== order.dispatchSlot) {
    updateData.dispatchSlot = dispatchSlot || null;
    logEntries.push({
      orderId:     id,
      fromStage:   order.dispatchSlot ?? null,
      toStage:     dispatchSlot || "cleared",
      changedById: userId,
      note:        logNote,
    });
  }

  if (Object.keys(updateData).length === 0 && logEntries.length === 0) {
    return NextResponse.json({ order }); // nothing changed
  }

  // ── Write in transaction ──────────────────────────────────────────────────
  const updatedOrder = await prisma.$transaction(async (tx) => {
    // Write all log entries (INSERT-ONLY — never update these)
    for (const entry of logEntries) {
      await tx.order_status_logs.create({ data: entry });
    }

    // If setting to 'hold' → stub row in dispatch_change_queue (Phase 3 stub)
    if (dispatchStatus === "hold") {
      await tx.dispatch_change_queue.create({ data: {} });
    }

    // Update the order
    return tx.orders.update({
      where: { id },
      data:  updateData,
    });
  });

  return NextResponse.json({ order: updatedOrder });
}
