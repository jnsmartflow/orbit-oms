import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // canEdit — these are writes. Admin bypass is inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "mail_orders", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // Calculate stats for each group — preserve frontend's sorted order
  const groupALines = groupAIds.map((id) => order.lines.find((l) => l.id === id)!);
  const groupBLines = groupBIds.map((id) => order.lines.find((l) => l.id === id)!);
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

  // AFTER every write in the request has returned (audit RULE 2). ONE line for
  // the whole split — it is a single operator action, not the five writes it
  // decomposes into. Logged against the ORIGINAL order, which is the row the
  // operator acted on and the one a later reader will look up; the new order's
  // id is in the data. The before image is the `order` this route ALREADY read
  // for its 404 and its line validation — no second query.
  await logAdminAction({
    userId: parseInt(session.user.id, 10),
    entity: "mail_orders",
    entityId: String(order.id),
    action: "split",
    summary:
      `mail order ${order.id} (${order.customerName ?? "—"}) split into ` +
      `A: ${groupALines.length} line(s) and B: ${groupBLines.length} line(s) → new order ${orderB.id}`,
    before: { totalLines: order.totalLines, matchedLines: order.matchedLines, splitLabel: order.splitLabel },
    after: {
      orderAId:      order.id,
      orderALines:   groupALines.length,
      orderAMatched: groupAMatched,
      orderBId:      orderB.id,
      orderBLines:   groupBLines.length,
      orderBMatched: groupBMatched,
      orderBEmailEntryId: orderB.emailEntryId,
    },
  });

  return NextResponse.json({
    status: "split",
    orderA: { id: order.id, totalLines: groupALines.length, matchedLines: groupAMatched },
    orderB: { id: orderB.id, totalLines: groupBLines.length, matchedLines: groupBMatched },
  });
}
