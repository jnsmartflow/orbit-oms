import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  rawLineItemId: z.number().int().positive(),
  assignedQty:   z.number().int().positive(),
});

const splitInputSchema = z.object({
  assignedToId: z.number().int().positive(),
  note:         z.string().optional(),
  lines:        z.array(lineSchema).min(1),
});

const createSplitsSchema = z.object({
  orderId: z.number().int().positive(),
  splits:  z.array(splitInputSchema).min(1),
});

// ── articleTag aggregation — same logic as OBD import confirm ─────────────────

function buildArticleTag(
  lines: Array<{
    article:     number | null;
    unitQty:     number;
    articleTag:  string | null;
    assignedQty: number;
  }>,
): string | null {
  const typeOrder = ["Drum", "Bag", "Carton", "Tin"];
  const tagTotals: Record<string, number> = {};

  for (const l of lines) {
    if (!l.articleTag || l.unitQty <= 0) continue;
    const parts = l.articleTag.split(" ");
    if (parts.length < 2) continue;
    const lineArticle = parseInt(parts[0], 10);
    const type        = parts.slice(1).join(" ");
    if (isNaN(lineArticle) || !type) continue;
    // Scale proportionally to assignedQty
    const scaled = Math.round((lineArticle * l.assignedQty) / l.unitQty);
    if (scaled > 0) {
      tagTotals[type] = (tagTotals[type] ?? 0) + scaled;
    }
  }

  const result = typeOrder
    .filter((t) => (tagTotals[t] ?? 0) > 0)
    .map((t) => `${tagTotals[t]} ${t}`)
    .join(", ");

  return result || null;
}

// ── POST /api/tint/manager/splits/create ──────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = createSplitsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { orderId, splits: splitInputs } = parsed.data;
  const managerId = parseInt(session!.user.id, 10);

  // ── STEP 1: Load and validate the order ────────────────────────────────────
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.orderType !== "tint") {
    return NextResponse.json({ error: "Not a tint order" }, { status: 400 });
  }

  // ── STEP 2: Load all raw line items for this OBD ───────────────────────────
  const rawLineItems = await prisma.import_raw_line_items.findMany({
    where:  { obdNumber: order.obdNumber },
    select: { id: true, unitQty: true, volumeLine: true, article: true, articleTag: true, isTinting: true },
  });
  const rawLineMap = new Map(rawLineItems.map((l) => [l.id, l]));

  // ── STEP 3: Load existing split assignments for this order ─────────────────
  const existingSplitItems = await prisma.split_line_items.findMany({
    where:  { split: { orderId } },
    select: { rawLineItemId: true, assignedQty: true },
  });
  const existingAssignedMap = new Map<number, number>();
  for (const item of existingSplitItems) {
    existingAssignedMap.set(
      item.rawLineItemId,
      (existingAssignedMap.get(item.rawLineItemId) ?? 0) + item.assignedQty,
    );
  }

  // ── STEP 4: Validate all lines across all splits in this request ───────────
  // Accumulate requested qty per line across all splits in one pass
  const requestedQtyMap = new Map<number, number>();
  for (const split of splitInputs) {
    for (const line of split.lines) {
      requestedQtyMap.set(
        line.rawLineItemId,
        (requestedQtyMap.get(line.rawLineItemId) ?? 0) + line.assignedQty,
      );
    }
  }

  for (const [rawLineItemId, requestedQty] of Array.from(requestedQtyMap.entries())) {
    const rawLine = rawLineMap.get(rawLineItemId);
    if (!rawLine) {
      return NextResponse.json(
        { error: `Line ${rawLineItemId} does not belong to this OBD` },
        { status: 400 },
      );
    }
    const alreadyAssigned = existingAssignedMap.get(rawLineItemId) ?? 0;
    const available       = rawLine.unitQty - alreadyAssigned;
    if (requestedQty > available) {
      return NextResponse.json(
        {
          error: `Line ${rawLineItemId} exceeds available qty. Available: ${available}, Requested: ${requestedQty}`,
        },
        { status: 400 },
      );
    }
  }

  // ── STEP 5: Preload operator names for log notes ───────────────────────────
  const operatorIds = Array.from(new Set(splitInputs.map((s) => s.assignedToId)));
  const operators   = await prisma.users.findMany({
    where:  { id: { in: operatorIds } },
    select: { id: true, name: true },
  });
  const operatorNameMap = new Map(operators.map((o) => [o.id, o.name]));

  // ── STEP 6: Single transaction — create all splits ─────────────────────────
  const createdSplits = await prisma.$transaction(async (tx) => {
    const existingSplitCount = await tx.order_splits.count({
      where: { orderId, status: { not: "cancelled" } },
    });
    const results = [];

    for (let i = 0; i < splitInputs.length; i++) {
      const splitInput   = splitInputs[i];
      const splitNumber  = existingSplitCount + i + 1;
      const operatorName = operatorNameMap.get(splitInput.assignedToId) ?? `User ${splitInput.assignedToId}`;

      // Compute totalQty
      const totalQty = splitInput.lines.reduce((sum, l) => sum + l.assignedQty, 0);

      // Compute totalVolume — proportional share of each line's volume
      let totalVolume = 0;
      for (const l of splitInput.lines) {
        const raw = rawLineMap.get(l.rawLineItemId)!;
        if (raw.volumeLine != null && raw.unitQty > 0) {
          totalVolume += (l.assignedQty / raw.unitQty) * raw.volumeLine;
        }
      }

      // Compute articleTag — scale each line's article proportionally
      const articleTagInput = splitInput.lines.map((l) => {
        const raw = rawLineMap.get(l.rawLineItemId)!;
        return {
          article:     raw.article,
          unitQty:     raw.unitQty,
          articleTag:  raw.articleTag,
          assignedQty: l.assignedQty,
        };
      });
      const articleTag = buildArticleTag(articleTagInput);

      // 5a. Create order_splits row
      const newSplit = await tx.order_splits.create({
        data: {
          orderId,
          splitNumber,
          assignedToId: splitInput.assignedToId,
          assignedById: managerId,
          status:       "tint_assigned",
          totalQty,
          totalVolume:  totalVolume > 0 ? totalVolume : null,
          articleTag,
          note:         splitInput.note ?? null,
        },
      });

      // 5b. Create split_line_items
      await tx.split_line_items.createMany({
        data: splitInput.lines.map((l) => ({
          splitId:      newSplit.id,
          rawLineItemId: l.rawLineItemId,
          assignedQty:  l.assignedQty,
        })),
      });

      // 5c. INSERT split_status_logs (INSERT-ONLY)
      await tx.split_status_logs.create({
        data: {
          splitId:     newSplit.id,
          fromStage:   null,
          toStage:     "tint_assigned",
          changedById: managerId,
          note:        "Split created and assigned",
        },
      });

      // 5d. INSERT tint_logs (INSERT-ONLY)
      await tx.tint_logs.create({
        data: {
          orderId,
          splitId:       newSplit.id,
          action:        "split_created",
          performedById: managerId,
          note:          `Split #${splitNumber} created and assigned to ${operatorName}`,
        },
      });

      results.push({
        id:           newSplit.id,
        splitNumber:  newSplit.splitNumber,
        assignedToId: newSplit.assignedToId,
        totalQty:     newSplit.totalQty,
        status:       newSplit.status,
      });
    }

    // 5e. Advance workflowStage only when every tinting line is fully assigned.
    // If any tinting line still has remaining qty, the OBD stays at
    // pending_tint_assignment so the Pending column card (and its split
    // status indicator) remains visible to the manager.
    if (order.workflowStage === "pending_tint_assignment") {
      const isFullyAssigned = rawLineItems
        .filter((l) => l.isTinting)
        .every((line) => {
          const existing   = existingAssignedMap.get(line.id) ?? 0;
          const requested  = requestedQtyMap.get(line.id)    ?? 0;
          return (existing + requested) >= line.unitQty;
        });

      if (isFullyAssigned) {
        await tx.orders.update({
          where: { id: orderId },
          data:  { workflowStage: "tinting_in_progress" },
        });
      }
    }

    return results;
  });

  return NextResponse.json({
    success:       true,
    splitsCreated: createdSplits.length,
    splits:        createdSplits,
  });
}
