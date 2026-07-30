import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/ship-to-search?q=… — dealer lookup for the Billing detail's
 * ship-to pencil. READ-ONLY.
 *
 * 🔴 WHY THIS EXISTS RATHER THAN REUSING /api/floor/ship-to-search.
 * Floor's search gates on the `floor` pageKey (app/api/floor/ship-to-search/
 * route.ts:23, floor/canView). Measured against production 2026-07-30:
 *   · `operations` (the pilot account) HAS floor canView — it would have worked.
 *   · `billing_operator` — Deepanshu (25) and Bankim (26), who actually do this
 *     job — have NO `floor` permission row at all.
 * Reusing Floor's route would therefore have worked for the pilot and then 403'd
 * for every real user at rollout — the worst possible failure shape, because the
 * pilot would have looked green. A billing screen must not depend on a floor
 * permission. Gate here is mail_orders/canView, the same as the billing reads.
 *
 * The QUERY is intentionally the same shape Floor's uses, so both screens
 * resolve a dealer identically; only the gate differs.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();

  // Two characters is the floor for a useful search; below that every dealer
  // matches and the response is noise.
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const rows = await prisma.delivery_point_master.findMany({
    where: {
      OR: [
        { customerName: { contains: q, mode: "insensitive" } },
        { customerCode: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      customerCode: true,
      customerName: true,
      isKeyCustomer: true,
      area: {
        select: {
          name: true,
          primaryRoute: { select: { name: true } },
          deliveryType: { select: { name: true } },
        },
      },
    },
    orderBy: { customerName: "asc" },
    take: 20,
  });

  const results = rows.map((r) => ({
    id: r.id,
    customerCode: r.customerCode,
    customerName: r.customerName,
    isKeyCustomer: r.isKeyCustomer,
    area: r.area?.name ?? null,
    route: r.area?.primaryRoute?.name ?? null,
    deliveryType: r.area?.deliveryType?.name ?? null,
  }));

  return NextResponse.json({ results });
}
