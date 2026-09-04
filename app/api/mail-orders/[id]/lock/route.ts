import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";

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

  // AFTER the update returns (audit RULE 2). Logged unconditionally, with no
  // before-image read: a lock toggle is a deliberate one-click ACTION, so the
  // click is the audit-worthy event even when it lands on the value already
  // there. That is the opposite of the permissions grid, which re-posts ~78
  // rows on every save and therefore has to diff — here there is no such noise
  // to suppress, and a read to detect an idempotent click is not worth a query.
  await logAdminAction({
    userId: parseInt(session.user.id, 10),
    entity: "mail_orders",
    entityId: String(id),
    action: "update",
    summary: `mail order ${id} ${order.isLocked ? "locked" : "unlocked"}`,
    after: { isLocked: order.isLocked },
  });

  return NextResponse.json(order);
}
