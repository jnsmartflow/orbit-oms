import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewShipTo } from "@/lib/ship-to/access";

export const dynamic = "force-dynamic";

/**
 * GET /api/ship-to/areas — the Area dropdown of the shared ship-to modal's
 * Type name tab (free-text ship-to P1, 2026-10-19). READ-ONLY.
 *
 * Active area_master rows: `{ areas: [{ id, name, deliveryType, route }] }`,
 * by name. `route` is the area's primary route.
 *
 * 🔴 ITS OWN ROUTE, NOT /api/admin/areas OR /api/tint/manager/ship-to/options:
 * both gate on customers canEdit, which neither billing_operator nor a floor
 * supervisor holds. Gate here: mail_orders canView OR floor canView
 * (lib/ship-to/access.ts) — the two desks that open the modal.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  if (!(await canViewShipTo(roles))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await prisma.area_master.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      deliveryType: { select: { name: true } },
      primaryRoute: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    areas: rows.map((a) => ({
      id: a.id,
      name: a.name,
      deliveryType: a.deliveryType?.name ?? null,
      route: a.primaryRoute?.name ?? null,
    })),
  });
}
