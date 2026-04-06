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
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  let body: { isLocked?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.isLocked !== "boolean") {
    return NextResponse.json({ error: "isLocked must be boolean" }, { status: 400 });
  }

  const order = await prisma.mo_orders.update({
    where: { id },
    data: { isLocked: body.isLocked },
    select: { id: true, isLocked: true },
  });

  return NextResponse.json(order);
}
