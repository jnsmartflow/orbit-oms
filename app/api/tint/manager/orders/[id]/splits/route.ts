import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). Reads were held back when the
  // tint WRITES converted; this closes the split. Operations User loses these —
  // he holds no tint_manager tick and both tint layouts already redirect him.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const orderId = parseInt(params.id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  try {
    const order = await prisma.orders.findFirst({
      where: { id: orderId, isRemoved: false },
      select: {
        id:       true,
        obdNumber: true,
        customer: { select: { customerName: true } },
        splits: {
          orderBy: { splitNumber: "asc" },
          select: {
            id:             true,
            splitNumber:    true,
            status:         true,
            dispatchStatus: true,
            priorityLevel:  true,
            totalQty:       true,
            totalVolume:    true,
            articleTag:     true,
            createdAt:      true,
            startedAt:      true,
            completedAt:    true,
            assignedTo:     { select: { name: true } },
            lineItems: {
              where: { lineStatus: "active" },
              select: {
                rawLineItemId: true,
                assignedQty:   true,
                rawLineItem: {
                  select: {
                    skuCodeRaw:        true,
                    skuDescriptionRaw: true,
                    volumeLine:        true,
                    isTinting:         true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({ order });
  } catch (err) {
    console.error("[tint/manager/orders/[id]/splits] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
