import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

/** Notes run to 5,000 chars. The log records the shape of the change, not an
 *  essay — the live note is always readable on the order itself. */
const PREVIEW = 200;
function preview(s: string | null): string | null {
  if (s === null) return null;
  return s.length > PREVIEW ? `${s.slice(0, PREVIEW)}… (${s.length} chars)` : s;
}

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

  // ⚠ NEW read. This route wrote blind — without the previous note there is no
  // way to tell an added note from an edited one, or to spot the case that
  // matters most, a note being CLEARED.
  const before = await prisma.mo_orders.findUnique({
    where: { id },
    select: { notes: true },
  });

  const order = await prisma.mo_orders.update({
    where: { id },
    data: { notes: body.notes },
    select: { id: true, notes: true },
  });

  // AFTER the update returns (audit RULE 2). A save that changes nothing writes
  // no line — the notes box PATCHes on blur whether or not it was touched.
  if (before && before.notes !== order.notes) {
    const verb =
      !before.notes ? "added" : !order.notes ? "cleared" : "edited";
    await logAdminAction({
      userId: parseInt(session.user.id, 10),
      entity: "mail_orders",
      entityId: String(id),
      action: "update",
      summary: `note ${verb} on mail order ${id}`,
      before: { notes: preview(before.notes) },
      after:  { notes: preview(order.notes) },
    });
  }

  return NextResponse.json(order);
}
