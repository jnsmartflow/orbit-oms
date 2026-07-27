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
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN, ROLES.OPERATIONS]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "support_queue", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  const order = await prisma.orders.findFirst({
    where: { id, isRemoved: false },
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
            where: { lineStatus: "active" },
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

  // Fetch enriched line items separately. `lineStatus` is deliberately NOT
  // filtered here (pre-existing behaviour — this route returns removed lines
  // too); do not add a filter without checking callers.
  const enrichedItems = await prisma.import_enriched_line_items.findMany({
    where:  { rawLineItem: { obdNumber: order.obdNumber } },
    include: {
      rawLineItem: { select: { skuCodeRaw: true, skuDescriptionRaw: true } },
    },
  });

  // Catalog resolution goes through sku_master_v2 keyed on `material` (the SAP
  // code), NOT through the enrichedLineItem.sku relation — that relation rides
  // `skuId`, which still points at the OLD sku_master and shares no id space
  // with v2, so following it would return a confidently WRONG product name.
  // Reasoning: docs/prompts/drafts/code-discovery-2026-07-19b-catalog-repoint.md
  //
  // The RESPONSE SHAPE is deliberately unchanged: `sku` stays a nested
  // { skuCode, skuName } object, null when the code doesn't resolve — exactly
  // what the old relation returned. Only the data SOURCE moved. This endpoint
  // has no known UI caller today but is reachable by URL, so its contract is
  // preserved rather than reshaped.
  //
  // No isPrimary filter — a duplicate twin is still a real SAP code.
  // Sequential await, no $transaction (CORE §3).
  const codes = Array.from(
    new Set(
      enrichedItems
        .map((e) => e.rawLineItem.skuCodeRaw)
        .filter((c): c is string => Boolean(c)),
    ),
  );
  const catalogRows =
    codes.length > 0
      ? await prisma.sku_master_v2.findMany({
          where:  { material: { in: codes } },
          select: { material: true, description: true },
        })
      : [];
  const catalogByCode = new Map(catalogRows.map((r) => [r.material, r]));

  const lineItems = enrichedItems.map((e) => {
    const cat = catalogByCode.get(e.rawLineItem.skuCodeRaw);
    return {
      ...e,
      sku: cat ? { skuCode: cat.material, skuName: cat.description } : null,
    };
  });

  return NextResponse.json({ order, lineItems });
}

// ── PATCH — update order fields ───────────────────────────────────────────────

const patchSchema = z.object({
  dispatchStatus:           z.string().optional(),
  priorityLevel:            z.number().int().min(1).max(5).optional(),
  dispatchSlot:             z.string().nullable().optional(),
  shipToOverrideCustomerId: z.number().int().positive().nullable().optional(),
  note:                     z.string().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN, ROLES.OPERATIONS]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
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

  const { dispatchStatus, priorityLevel, dispatchSlot, shipToOverrideCustomerId, note } = parsed.data;
  const userId = parseInt(session!.user.id, 10);

  // ── Load current order ────────────────────────────────────────────────────
  const order = await prisma.orders.findFirst({ where: { id, isRemoved: false } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ── Build update data + log entries ──────────────────────────────────────
  const updateData: Prisma.ordersUncheckedUpdateInput = {};

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

  if (shipToOverrideCustomerId !== undefined && shipToOverrideCustomerId !== order.shipToOverrideCustomerId) {
    updateData.shipToOverrideCustomerId = shipToOverrideCustomerId;
    updateData.shipToOverride = shipToOverrideCustomerId !== null;
    logEntries.push({
      orderId:     id,
      fromStage:   order.shipToOverrideCustomerId !== null ? String(order.shipToOverrideCustomerId) : null,
      toStage:     shipToOverrideCustomerId !== null ? String(shipToOverrideCustomerId) : "cleared",
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

    // If setting to 'hold' → record in dispatch_change_queue
    if (dispatchStatus === "hold") {
      await tx.dispatch_change_queue.create({
        data: {
          orderId: id,
          changeType: "hold",
          previousValue: order.dispatchStatus,
          newValue: "hold",
          changedById: userId,
          notes: note ?? "Placed on hold by support",
        },
      });
    }

    // Update the order
    return tx.orders.update({
      where: { id },
      data:  updateData,
    });
  });

  return NextResponse.json({ order: updatedOrder });
}
