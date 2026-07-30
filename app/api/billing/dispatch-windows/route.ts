import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/dispatch-windows — the active dispatch windows, for the
 * reused Floor slot picker. READ-ONLY.
 *
 * Floor has no standalone feed for these: it embeds them in its board response
 * (`data.floor.windows`, components/floor/floor-page.tsx:514), which a billing
 * screen has no business fetching. Hence this small route — same rows, same
 * order, gated on mail_orders/canView like the rest of Billing's reads.
 *
 * Shape matches DispatchWindow in components/floor/dispatch-slot-picker.tsx so
 * the picker takes it unmodified.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const windows = await prisma.dispatch_slot_master.findMany({
    where: { isActive: true },
    select: { id: true, windowTime: true, label: true },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ windows });
}
