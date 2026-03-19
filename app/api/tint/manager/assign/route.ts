import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const assignSchema = z.object({
  orderId:      z.number().int().positive(),
  assignedToId: z.number().int().positive(),
  note:         z.string().optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canEdit");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const parsed = assignSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { orderId, assignedToId, note } = parsed.data;
  const managerId = parseInt(session!.user.id, 10);

  await prisma.$transaction(async (tx) => {
    // 1. Verify order is a tint order
    const order = await tx.orders.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order not found");
    if (order.orderType !== "tint") throw new Error("Order is not a tint order");

    // 2. Load operator name for log note
    const operator = await tx.users.findUnique({
      where:  { id: assignedToId },
      select: { name: true },
    });
    if (!operator) throw new Error("Operator not found");

    const logNote =
      `Assigned to ${operator.name}` + (note ? ` — ${note}` : "");

    // 3. Create tint_assignments row
    await tx.tint_assignments.create({
      data: {
        orderId,
        assignedToId,
        assignedById: managerId,
        status:       "assigned",
      },
    });

    // 4. Update order workflow stage
    await tx.orders.update({
      where: { id: orderId },
      data:  { workflowStage: "pending_tint_assignment" },
    });

    // 5. INSERT tint_logs (INSERT-ONLY — never skip)
    await tx.tint_logs.create({
      data: {
        orderId,
        action:        "assigned",
        performedById: managerId,
        note:          note ?? null,
      },
    });

    // 6. INSERT order_status_logs (INSERT-ONLY — never skip)
    await tx.order_status_logs.create({
      data: {
        orderId,
        fromStage:   order.workflowStage,
        toStage:     "pending_tint_assignment",
        changedById: managerId,
        note:        logNote,
      },
    });
  });

  return NextResponse.json({ success: true });
}
