import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";
import { extractCustomerFromSubject, matchCustomer } from "@/lib/mail-orders/customer-match";

export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
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

  // ONE line for the whole run, same shape as the CSV importers in e757ba78.
  // Every unmatched order in the table is rewritten from one click; a row each
  // would bury the log. entityId is null because the action has no one subject.
  await logAdminAction({
    userId: parseInt(session.user.id, 10),
    entity: "mail_orders",
    entityId: null,
    action: "backfill",
    summary:
      `backfill customers: ${orders.length} unmatched order(s) re-matched — ` +
      `${exact} exact, ${multiple} multiple, ${unmatched} still unmatched, ${errors} error(s)`,
    after: {
      tool:            "backfill-customers",
      scope:           "orders with customerMatchStatus null or 'unmatched'",
      ordersProcessed: orders.length,
      exact,
      multiple,
      unmatched,
      errors,
    },
  });

  return NextResponse.json({
    total: orders.length,
    exact,
    multiple,
    unmatched,
    errors,
  });
}
