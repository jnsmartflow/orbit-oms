import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderId: z.number().int().positive(),
});


export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR, ROLES.OPERATIONS]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_operator", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { orderId } = parsed.data;
  const userId = parseInt(session!.user.id, 10);
  const isOpsOrAdmin = ["operations", "admin"].includes(session!.user.role ?? "");

  try {
    // 1. Load order — verify stage
    const order = await prisma.orders.findUnique({ where: { id: orderId } })
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }
    if (order.workflowStage !== "tinting_in_progress") {
      return NextResponse.json({ error: "Order is not currently in tinting" }, { status: 409 })
    }

    // 2. Verify active assignment
    const activeAssignment = await prisma.tint_assignments.findFirst({
      where: {
        orderId,
        ...(isOpsOrAdmin ? {} : { assignedToId: userId }),
        status:       "tinting_in_progress",
      },
    })
    if (!activeAssignment) {
      return NextResponse.json({ error: "No active assignment found for this order" }, { status: 403 })
    }

    // TI completion gate — all isTinting lines must have at least one TI entry
    const isTintingRawLines = await prisma.import_raw_line_items.findMany({
      where: { obdNumber: order.obdNumber, isTinting: true },
      select: { id: true, skuCodeRaw: true, skuDescriptionRaw: true },
    });
    if (isTintingRawLines.length > 0) {
      const [entriesA, entriesB] = await Promise.all([
        prisma.tinter_issue_entries.findMany({
          where: { tintAssignmentId: activeAssignment.id, rawLineItemId: { not: null } },
          select: { rawLineItemId: true },
        }),
        prisma.tinter_issue_entries_b.findMany({
          where: { tintAssignmentId: activeAssignment.id, rawLineItemId: { not: null } },
          select: { rawLineItemId: true },
        }),
      ]);
      const covered = new Set<number>([
        ...entriesA.map(e => e.rawLineItemId!),
        ...entriesB.map(e => e.rawLineItemId!),
      ]);
      const missingLines = isTintingRawLines
        .filter(l => !covered.has(l.id))
        .map(l => ({ rawLineItemId: l.id, skuCodeRaw: l.skuCodeRaw, skuDescriptionRaw: l.skuDescriptionRaw }));
      if (missingLines.length > 0) {
        return NextResponse.json({
          error:        "TI incomplete",
          message:      "Tinter Issue entries are missing for some SKU lines. Please complete all entries before marking done.",
          missingLines,
        }, { status: 400 });
      }
    }

    // 3. Update tint_assignments
    await prisma.tint_assignments.update({
      where: { id: activeAssignment.id },
      data:  { status: "tinting_done", completedAt: new Date() },
    })

    // 4. Update order stage
    await prisma.orders.update({
      where: { id: orderId },
      data:  { workflowStage: "pending_support" },
    })

    // 5. INSERT tint_logs
    await prisma.tint_logs.create({
      data: {
        orderId,
        action:        "completed",
        performedById: userId,
      },
    })

    // 6. INSERT order_status_logs
    await prisma.order_status_logs.create({
      data: {
        orderId,
        fromStage:   "tinting_in_progress",
        toStage:     "pending_support",
        changedById: userId,
        note:        "Tinting completed — moved to support queue",
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("done error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
