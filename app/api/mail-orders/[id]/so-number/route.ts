import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
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

  // canEdit — these are writes. Admin bypass is inside checkAnyPermission.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "mail_orders", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
