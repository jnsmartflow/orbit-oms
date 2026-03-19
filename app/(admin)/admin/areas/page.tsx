import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AreasTable } from "@/components/admin/areas-table";

export const dynamic = 'force-dynamic';

export default async function AreasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") {
    const allowed = await checkPermission(session.user.role, "routes_areas", "canView");
    if (!allowed) redirect("/unauthorized");
  }

  const [areas, deliveryTypes, routes] = await Promise.all([
    prisma.area_master.findMany({
      orderBy: { name: "asc" },
      include: {
        deliveryType:  { select: { id: true, name: true } },
        primaryRoute:  { select: { id: true, name: true } },
        areaRoutes:    { include: { route: { select: { id: true, name: true } } } },
        _count:        { select: { subAreas: true } },
      },
    }),
    prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } }),
    prisma.route_master.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <AreasTable
      initialAreas={areas.map((a) => ({
        id:           a.id,
        name:         a.name,
        isActive:     a.isActive,
        createdAt:    a.createdAt.toISOString(),
        deliveryType: a.deliveryType,
        primaryRoute: a.primaryRoute,
        routes:       a.areaRoutes.map((ar) => ar.route),
        subAreaCount: a._count.subAreas,
      }))}
      deliveryTypes={deliveryTypes}
      routes={routes.map((r) => ({ id: r.id, name: r.name }))}
    />
  );
}
