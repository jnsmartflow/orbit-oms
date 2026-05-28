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

  let body: { notes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.notes !== "string" && body.notes !== null) {
    return NextResponse.json({ error: "notes must be string or null" }, { status: 400 });
  }

  if (typeof body.notes === "string" && body.notes.length > 5000) {
    return NextResponse.json({ error: "notes exceeds 5000 chars" }, { status: 400 });
  }

  const order = await prisma.mo_orders.update({
    where: { id },
    data: { notes: body.notes },
    select: { id: true, notes: true },
  });

  return NextResponse.json(order);
}
