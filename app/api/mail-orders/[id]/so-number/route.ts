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

  let body: { soNumber?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const soNumber = body.soNumber?.trim() ?? "";
  if (!/^\d{10}$/.test(soNumber)) {
    return NextResponse.json(
      { error: "SO Number must be exactly 10 digits" },
      { status: 400 },
    );
  }

  const order = await prisma.mo_orders.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const userId = parseInt(session.user.id, 10);

  await prisma.mo_orders.update({
    where: { id },
    data: {
      soNumber,
      status: "punched",
      punchedAt: new Date(),
      punchedById: userId,
    },
  });

  return NextResponse.json({ success: true, soNumber, status: "punched" });
}
