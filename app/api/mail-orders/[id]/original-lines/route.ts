import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orderId = parseInt(params.id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  // Fetch this order to get split info
  const order = await prisma.mo_orders.findUnique({
    where: { id: orderId },
    select: { id: true, splitFromId: true, splitLabel: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!order.splitLabel) {
    return NextResponse.json({ error: "Order is not split" }, { status: 400 });
  }

  // Find both sibling order IDs
  let siblingIds: number[];

  if (order.splitLabel === "A") {
    // This is Group A — find Group B (splitFromId = this order's id)
    const groupB = await prisma.mo_orders.findFirst({
      where: { splitFromId: order.id },
      select: { id: true },
    });
    siblingIds = groupB ? [order.id, groupB.id] : [order.id];
  } else {
    // This is Group B — splitFromId points to Group A
    siblingIds = order.splitFromId
      ? [order.splitFromId, order.id]
      : [order.id];
  }

  // Fetch ALL lines from both orders
  const allLines = await prisma.mo_order_lines.findMany({
    where: { moOrderId: { in: siblingIds } },
    orderBy: { originalLineNumber: "asc" },
    select: {
      id: true,
      moOrderId: true,
      lineNumber: true,
      originalLineNumber: true,
      rawText: true,
      packCode: true,
      quantity: true,
      productName: true,
      baseColour: true,
      skuCode: true,
      skuDescription: true,
      refSkuCode: true,
      matchStatus: true,
    },
  });

  // Tag each line with its group label
  const result = allLines.map((line) => ({
    ...line,
    groupLabel: line.moOrderId === siblingIds[0] ? "A" : "B",
  }));

  return NextResponse.json({ lines: result, totalLines: result.length });
}
