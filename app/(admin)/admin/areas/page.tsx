import { prisma } from "@/lib/prisma";
import { AreasTable } from "@/components/admin/areas-table";

export default async function AreasPage() {
  const [areas, deliveryTypes, routes] = await Promise.all([
    prisma.area_master.findMany({
      orderBy: { name: "asc" },
      include: {
        deliveryType: { select: { id: true, name: true } },
        areaRoutes: { include: { route: { select: { id: true, name: true } } } },
        _count: { select: { subAreas: true } },
      },
    }),
    prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } }),
    prisma.route_master.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <AreasTable
      initialAreas={areas.map((a) => ({
        id: a.id,
        name: a.name,
        isActive: a.isActive,
        createdAt: a.createdAt.toISOString(),
        deliveryType: a.deliveryType,
        routes: a.areaRoutes.map((ar) => ar.route),
        subAreaCount: a._count.subAreas,
      }))}
      deliveryTypes={deliveryTypes}
      routes={routes.map((r) => ({ id: r.id, name: r.name }))}
    />
  );
}
