import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { getHideExclusion } from "@/lib/hide/visibility";
import { getISTTodayDateOnly } from "@/lib/floor/queries";
import { CUSTOMER_MISSING_IDS_SQL, CUSTOMER_MISSING_SMUS, type MissingCustomerBill } from "@/lib/tint/customer-missing";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/missing-customers — the open SMU 74/77 bills whose SAP
 * ship-to is not in the customer master. The rule is lib/tint/customer-missing.ts
 * (CUSTOMER_MISSING_IDS_SQL — open stages up to checked, effective ship-to vs
 * the master, not the flag alone); the page narrows it to the bills it shows today.
 *
 * Gate: tint_manager canView. READ-ONLY, sequential awaits (CORE §3).
 *
 * 2026-10-02: each bill also carries `billToName` and `urgentToday` (dispatch
 * target day or trip day = today IST, both @db.Date compared against
 * getISTTodayDateOnly()) for the missing-customer chip and the nudge. The
 * existing fields are unchanged.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title (2026-09-06). Reads were held back when the
  // tint WRITES converted; this closes the split. Operations User loses these —
  // he holds no tint_manager tick and both tint layouts already redirect him.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const hideExclusion = await getHideExclusion();

  // The rule — one read-only statement (ids), then the details + hide rules.
  const idRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(CUSTOMER_MISSING_IDS_SQL, CUSTOMER_MISSING_SMUS);
  const ids = idRows.map((r) => Number(r.id));

  const rows = ids.length === 0 ? [] : await prisma.orders.findMany({
    where: { AND: [{ id: { in: ids } }, hideExclusion] },
    select: {
      id: true,
      obdNumber: true,
      shipToCustomerId: true,
      shipToCustomerName: true,
      smu: true,
      orderType: true,
      obdEmailDate: true,
      dispatchTargetDate: true,
      tripDrop: { select: { trip: { select: { tripDate: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Bill-to names from the import summary (the same source the board uses),
  // one batched read.
  const obds = rows.map((r) => r.obdNumber);
  const summaries = obds.length === 0 ? [] : await prisma.import_raw_summary.findMany({
    where:  { obdNumber: { in: obds } },
    select: { obdNumber: true, billToCustomerName: true },
  });
  const billToByObd = new Map<string, string | null>();
  for (const s of summaries) if (!billToByObd.has(s.obdNumber)) billToByObd.set(s.obdNumber, s.billToCustomerName);

  const today = getISTTodayDateOnly().getTime();
  const orders: MissingCustomerBill[] = rows.map((r) => ({
    orderId: r.id,
    obdNumber: r.obdNumber,
    shipToCustomerId: r.shipToCustomerId,
    shipToCustomerName: r.shipToCustomerName,
    billToName: billToByObd.get(r.obdNumber) ?? null,
    smu: r.smu,
    orderType: r.orderType,
    obdEmailDate: r.obdEmailDate?.toISOString() ?? null,
    urgentToday:
      r.dispatchTargetDate?.getTime() === today ||
      r.tripDrop?.trip.tripDate.getTime() === today,
  }));

  return NextResponse.json({ count: orders.length, orders });
}
