import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: {
    customerCode?: string;
    customerName?: string;
    saveKeyword?: boolean;
    keyword?: string;
    area?: string;
    deliveryType?: string;
    route?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { customerCode, customerName } = body;
  if (!customerCode || !customerName) {
    return NextResponse.json(
      { error: "customerCode and customerName are required" },
      { status: 400 },
    );
  }

  const order = await prisma.mo_orders.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  await prisma.mo_orders.update({
    where: { id },
    data: {
      customerCode,
      customerName,
      customerMatchStatus: "exact",
      customerCandidates: null,
    },
  });

  if (body.saveKeyword && body.keyword?.trim()) {
    try {
      await prisma.mo_customer_keywords.create({
        data: {
          customerCode,
          customerName,
          keyword: body.keyword.trim().toUpperCase(),
          area: body.area || null,
          deliveryType: body.deliveryType || null,
          route: body.route || null,
        },
      });
    } catch (err) {
      console.error("[Save Customer Keyword] Failed:", err);
    }
  }

  return NextResponse.json({ customerCode, customerName, customerMatchStatus: "exact" });
}
