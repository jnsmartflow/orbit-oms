import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Normalize subject text for learned customer matching */
function normalizeSubject(subject: string): string {
  let s = subject.trim();
  s = s.replace(/^(?:(?:fw|fwd|re)\s*:\s*)+/i, "").trim();
  s = s.replace(/^urgent\s+/i, "").trim();
  if (/^order\s*:/i.test(s)) {
    s = s.replace(/^order\s*:\s*/i, "").trim();
  } else if (/^order\s+for\s+/i.test(s)) {
    s = s.replace(/^order\s+for\s+/i, "").trim();
  } else if (/^order-\d+\s*/i.test(s)) {
    s = s.replace(/^order-\d+\s*/i, "").trim();
  } else if (/^order\s+-\s*/i.test(s)) {
    s = s.replace(/^order\s+-\s*/i, "").trim();
  } else if (/^order\s+/i.test(s)) {
    s = s.replace(/^order\s+/i, "").trim();
  }
  s = s.replace(/\s*-\s*order$/i, "").trim();
  s = s.replace(/\.+$/, "").trim();
  // Strip customer codes (leading/trailing digits)
  s = s.replace(/^\d{4,}\s+/, "").trim();
  s = s.replace(/\s+\d{4,}$/, "").trim();
  s = s.replace(/\s*\(\d{4,}\)\s*/, " ").trim();
  s = s.toUpperCase().replace(/\s{2,}/g, " ").trim();
  return s;
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const operatorId = parseInt(session.user.id, 10);
  if (isNaN(operatorId)) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const body = await req.json();
  const { orderId, customerCode } = body as {
    orderId?: number;
    customerCode?: string;
  };

  if (!orderId || !customerCode) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Fetch order to get subject
  const order = await prisma.mo_orders.findUnique({
    where: { id: orderId },
    select: { subject: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const normalizedText = normalizeSubject(order.subject);

  if (normalizedText.length < 3) {
    return NextResponse.json({ status: "skipped", reason: "text too short" });
  }

  // Check for existing row
  const existing = await prisma.mo_learned_customers.findFirst({
    where: { normalizedText, customerCode },
  });

  if (existing) {
    // Parse operators array, add if not present
    let operators: number[] = [];
    try { operators = JSON.parse(existing.operators); } catch {}
    if (!operators.includes(operatorId)) {
      operators.push(operatorId);
    }

    await prisma.mo_learned_customers.update({
      where: { id: existing.id },
      data: {
        hitCount: existing.hitCount + 1,
        operators: JSON.stringify(operators),
        lastConfirmedAt: new Date(),
      },
    });

    console.log(
      `[Learn Customer] Updated: "${normalizedText}" → ${customerCode} (hit=${existing.hitCount + 1}, ops=${operators.length})`,
    );

    return NextResponse.json({ status: "learned", hitCount: existing.hitCount + 1 });
  }

  // Create new row
  await prisma.mo_learned_customers.create({
    data: {
      normalizedText,
      customerCode,
      hitCount: 1,
      operators: JSON.stringify([operatorId]),
    },
  });

  console.log(
    `[Learn Customer] Created: "${normalizedText}" → ${customerCode} (hit=1, op=${operatorId})`,
  );

  return NextResponse.json({ status: "learned", hitCount: 1 });
}
