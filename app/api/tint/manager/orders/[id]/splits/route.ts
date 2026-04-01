import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS]);

  const orderId = parseInt(params.id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  try {
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
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
