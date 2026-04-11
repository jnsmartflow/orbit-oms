import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mergeEmailDateTime(emailDate: Date | null, emailTime: string | null): Date | null {
  if (!emailDate || !emailTime) return emailDate;
  const [h, m] = emailTime.split(":").map(Number);
  const istMinutes = h * 60 + m;
  const utcMinutes = istMinutes - 330;
  const utcH = Math.floor(((utcMinutes % 1440) + 1440) % 1440 / 60);
  const utcM = ((utcMinutes % 60) + 60) % 60;
  const dt = new Date(emailDate);
  dt.setUTCHours(utcH, utcM, 0, 0);
  if (utcMinutes < 0) dt.setUTCDate(dt.getUTCDate() - 1);
  return dt;
}

function getSlotFromTime(dateTime: Date | null, fallbackTime: string | null): { slotId: number; timeStr: string } {
  let timeStr: string;

  if (dateTime) {
    // Convert to IST
    const ist = new Date(dateTime.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const h = ist.getHours();
    const m = ist.getMinutes();
    timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } else if (fallbackTime) {
    timeStr = fallbackTime;
  } else {
    return { slotId: 4, timeStr: "null" }; // Night fallback
  }

  if (timeStr < "10:30") return { slotId: 1, timeStr };
  if (timeStr < "12:30") return { slotId: 2, timeStr };
  if (timeStr < "15:30") return { slotId: 3, timeStr };
  return { slotId: 4, timeStr };
}

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.OPERATIONS]);

  // 1. Load all active orders
  const orders = await prisma.orders.findMany({
    where: {
      workflowStage: { notIn: ["dispatched", "cancelled"] },
    },
    select: { id: true, obdNumber: true, soNumber: true, slotId: true, orderDateTime: true },
  });

  // 2. Load obdEmailDate/Time from import_raw_summary
  const obdNumbers = orders.map((o) => o.obdNumber);
  const summaries = await prisma.import_raw_summary.findMany({
    where: { obdNumber: { in: obdNumbers } },
    select: { obdNumber: true, obdEmailDate: true, obdEmailTime: true },
  });
  const summaryMap = new Map(summaries.map((s) => [s.obdNumber, s]));

  // 3. Load matching mo_orders by soNumber (for orders that have one)
  const soNumbers = orders.map((o) => o.soNumber).filter((s): s is string => Boolean(s));
  const mailOrders = soNumbers.length > 0
    ? await prisma.mo_orders.findMany({
        where: { soNumber: { in: soNumbers } },
        select: { soNumber: true, receivedAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  // Take first (most recent) per soNumber
  const moMap = new Map<string, Date>();
  for (const mo of mailOrders) {
    if (mo.soNumber && mo.receivedAt && !moMap.has(mo.soNumber)) {
      moMap.set(mo.soNumber, mo.receivedAt);
    }
  }

  // 4. Update each order
  let updated = 0;
  let moMatched = 0;
  let obdFallback = 0;

  for (const order of orders) {
    const summary = summaryMap.get(order.obdNumber);
    let orderDateTime: Date | null = null;
    let source = "none";

    // Priority 1: mail order receivedAt (via soNumber match)
    if (order.soNumber && moMap.has(order.soNumber)) {
      orderDateTime = moMap.get(order.soNumber)!;
      source = "mo";
      moMatched++;
    }
    // Priority 2: obdEmailDate + obdEmailTime
    else if (summary?.obdEmailDate) {
      orderDateTime = mergeEmailDateTime(summary.obdEmailDate, summary.obdEmailTime);
      source = "obd";
      obdFallback++;
    }

    const { slotId } = getSlotFromTime(orderDateTime, summary?.obdEmailTime ?? null);

    const needsUpdate =
      order.slotId !== slotId ||
      order.orderDateTime?.getTime() !== orderDateTime?.getTime();

    if (needsUpdate) {
      await prisma.orders.update({
        where: { id: order.id },
        data: {
          orderDateTime,
          slotId,
          originalSlotId: slotId,
        },
      });
      updated++;
    }
  }

  return NextResponse.json({
    total: orders.length,
    updated,
    unchanged: orders.length - updated,
    moMatched,
    obdFallback,
  });
}
