import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const body = await req.json() as { rows: Record<string, string>[] };
  const rows = body.rows ?? [];

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, failed: 0, errors: [] });
  }

  const [deliveryTypes, routes] = await Promise.all([
    prisma.delivery_type_master.findMany({ select: { id: true, name: true } }),
    prisma.route_master.findMany({ select: { id: true, name: true } }),
  ]);
  const dtMap    = new Map(deliveryTypes.map((d) => [d.name.toLowerCase(), d.id]));
  const routeMap = new Map(routes.map((r) => [r.name.toLowerCase(), r.id]));

  const errors: { row: number; reason: string }[] = [];
  const data: { name: string; deliveryTypeId: number; primaryRouteId: number | null; isActive: boolean }[] = [];

  rows.forEach((r, i) => {
    const name         = r.name?.trim();
    const dtName       = r.deliverytype?.trim();
    const routeName    = r.primaryroute?.trim();
    const dtId         = dtMap.get(dtName?.toLowerCase() ?? "");
    const primaryRouteId = routeName ? (routeMap.get(routeName.toLowerCase()) ?? null) : null;

    if (!name)  { errors.push({ row: i + 2, reason: "Name is required." }); return; }
    if (!dtId)  { errors.push({ row: i + 2, reason: `Delivery type "${dtName}" not found.` }); return; }
    if (routeName && primaryRouteId === null) {
      errors.push({ row: i + 2, reason: `Route "${routeName}" not found.` }); return;
    }

    data.push({ name, deliveryTypeId: dtId, primaryRouteId: primaryRouteId ?? null, isActive: true });
  });

  const result = await prisma.area_master.createMany({
    data,
    skipDuplicates: true,
  });

  const imported = result.count;
  const skipped  = data.length - imported;

  return NextResponse.json({ imported, skipped, failed: errors.length, errors });
}
