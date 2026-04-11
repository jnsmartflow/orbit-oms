import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CHALLAN_SMU_VALUES = ["Retail Offtake", "Decorative Projects"];

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.OPERATIONS]);

  // Find all orders that should have challans but don't
  const orders = await prisma.orders.findMany({
    where: {
      workflowStage: { notIn: ["cancelled"] },
      challan: null, // no delivery_challans record
    },
    select: {
      id: true,
      obdNumber: true,
      orderDateTime: true,
      smu: true,
    },
  });

  // Also check SMU from import_raw_summary (orders.smu may be null for older records)
  const obdNumbers = orders.map((o) => o.obdNumber);
  const summaries = await prisma.import_raw_summary.findMany({
    where: { obdNumber: { in: obdNumbers } },
    select: { obdNumber: true, smu: true },
  });
  const smuMap = new Map(summaries.map((s) => [s.obdNumber, s.smu]));

  // Filter to challan-eligible orders
  const eligible = orders
    .filter((o) => {
      const smu = o.smu ?? smuMap.get(o.obdNumber) ?? "";
      return CHALLAN_SMU_VALUES.includes(smu);
    })
    .sort((a, b) => {
      const tA = a.orderDateTime ? new Date(a.orderDateTime).getTime() : 0;
      const tB = b.orderDateTime ? new Date(b.orderDateTime).getTime() : 0;
      return tA - tB;
    });

  if (eligible.length === 0) {
    return NextResponse.json({ total: orders.length, created: 0, message: "No eligible orders without challans" });
  }

  // Get current max challan number
  const lastChallan = await prisma.delivery_challans.findFirst({
    orderBy: { id: "desc" },
    select: { challanNumber: true },
  });

  let nextSeq = 1;
  if (lastChallan?.challanNumber) {
    const parts = lastChallan.challanNumber.split("-");
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) nextSeq = lastNum + 1;
  }

  const year = new Date().getFullYear();
  let created = 0;

  for (const order of eligible) {
    try {
      const challanNumber = `CHN-${year}-${String(nextSeq).padStart(5, "0")}`;
      await prisma.delivery_challans.create({
        data: {
          orderId: order.id,
          challanNumber,
        },
      });
      nextSeq++;
      created++;
    } catch (err) {
      // Skip duplicates (unique constraint on orderId)
      console.error(`[fix-challans] Failed for order ${order.id}:`, err);
    }
  }

  return NextResponse.json({
    totalOrders: orders.length,
    eligible: eligible.length,
    created,
  });
}
