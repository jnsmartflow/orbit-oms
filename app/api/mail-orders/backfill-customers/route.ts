import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractCustomerFromSubject, matchCustomer } from "@/lib/mail-orders/customer-match";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orders = await prisma.mo_orders.findMany({
    where: {
      OR: [
        { customerMatchStatus: null },
        { customerMatchStatus: "unmatched" },
      ],
    },
    select: { id: true, subject: true },
  });

  let exact = 0;
  let multiple = 0;
  let unmatched = 0;
  let errors = 0;

  for (const order of orders) {
    try {
      const extracted = extractCustomerFromSubject(order.subject);
      const match = await matchCustomer(extracted);

      await prisma.mo_orders.update({
        where: { id: order.id },
        data: {
          customerCode: match.customerCode,
          customerName: match.customerName,
          customerMatchStatus: match.customerMatchStatus,
          customerCandidates: match.customerCandidates,
        },
      });

      if (match.customerMatchStatus === "exact") exact++;
      else if (match.customerMatchStatus === "multiple") multiple++;
      else unmatched++;
    } catch (err) {
      console.error(`[Backfill] Order ${order.id} failed:`, err);
      errors++;
    }
  }

  return NextResponse.json({
    total: orders.length,
    exact,
    multiple,
    unmatched,
    errors,
  });
}
