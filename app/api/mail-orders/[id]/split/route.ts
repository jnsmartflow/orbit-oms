import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(
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

  // Parse body — frontend sends pre-computed line groups
  let body: { groups: [number[], number[]] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const [groupAIds, groupBIds] = body.groups;
  if (!Array.isArray(groupAIds) || !Array.isArray(groupBIds) ||
      groupAIds.length === 0 || groupBIds.length === 0) {
    return NextResponse.json({ error: "Invalid groups" }, { status: 400 });
  }

  // Fetch original order with lines
  const order = await prisma.mo_orders.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status === "punched") {
    return NextResponse.json({ error: "Cannot split a punched order" }, { status: 400 });
  }

  if (order.splitLabel) {
    return NextResponse.json({ error: "Order is already split" }, { status: 400 });
  }

  // Validate all line IDs belong to this order
  const orderLineIds = new Set(order.lines.map((l) => l.id));
  const allRequestedIds = [...groupAIds, ...groupBIds];
  for (const lineId of allRequestedIds) {
    if (!orderLineIds.has(lineId)) {
      return NextResponse.json({ error: `Line ${lineId} does not belong to this order` }, { status: 400 });
    }
  }

  // Validate no duplicates
  const allIdsSet = new Set(allRequestedIds);
  if (allIdsSet.size !== allRequestedIds.length) {
    return NextResponse.json({ error: "Duplicate line IDs" }, { status: 400 });
  }

  // Validate all lines accounted for
  if (allIdsSet.size !== order.lines.length) {
    return NextResponse.json({ error: "Not all lines accounted for" }, { status: 400 });
  }

  // Calculate stats for each group
  const groupAIdSet = new Set(groupAIds);
  const groupBIdSet = new Set(groupBIds);
  const groupALines = order.lines.filter((l) => groupAIdSet.has(l.id));
  const groupBLines = order.lines.filter((l) => groupBIdSet.has(l.id));
  const groupAMatched = groupALines.filter((l) => l.matchStatus === "matched").length;
  const groupBMatched = groupBLines.filter((l) => l.matchStatus === "matched").length;

  // Create Group B order
  const orderB = await prisma.mo_orders.create({
    data: {
      soName: order.soName,
      soEmail: order.soEmail,
      receivedAt: order.receivedAt,
      subject: order.subject,
      customerName: order.customerName,
      customerCode: order.customerCode,
      customerMatchStatus: order.customerMatchStatus,
      customerCandidates: order.customerCandidates,
      deliveryRemarks: order.deliveryRemarks,
      remarks: order.remarks,
      billRemarks: order.billRemarks,
      dispatchStatus: order.dispatchStatus,
      dispatchPriority: order.dispatchPriority,
      shipToOverride: order.shipToOverride,
      slotToOverride: order.slotToOverride,
      emailEntryId: `${order.emailEntryId}__B`,
      status: "pending",
      totalLines: groupBLines.length,
      matchedLines: groupBMatched,
      splitFromId: order.id,
      splitLabel: "B",
    },
  });

  // Update original to be Group A
  await prisma.mo_orders.update({
    where: { id: order.id },
    data: {
      splitLabel: "A",
      totalLines: groupALines.length,
      matchedLines: groupAMatched,
    },
  });

  // Reassign Group B lines
  await prisma.mo_order_lines.updateMany({
    where: { id: { in: groupBIds } },
    data: { moOrderId: orderB.id },
  });

  // Re-number lines sequentially — Group A
  for (let i = 0; i < groupALines.length; i++) {
    await prisma.mo_order_lines.update({
      where: { id: groupALines[i].id },
      data: { lineNumber: i + 1 },
    });
  }

  // Re-number lines sequentially — Group B
  for (let i = 0; i < groupBLines.length; i++) {
    await prisma.mo_order_lines.update({
      where: { id: groupBLines[i].id },
      data: { lineNumber: i + 1 },
    });
  }

  return NextResponse.json({
    status: "split",
    orderA: { id: order.id, totalLines: groupALines.length, matchedLines: groupAMatched },
    orderB: { id: orderB.id, totalLines: groupBLines.length, matchedLines: groupBMatched },
  });
}
