import { prisma } from "@/lib/prisma";
import { RoutesTable } from "@/components/admin/routes-table";

export default async function RoutesPage() {
  const routes = await prisma.route_master.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { areaRoutes: true } } },
  });

  return (
    <RoutesTable
      initialRoutes={routes.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: r.isActive,
        areaCount: r._count.areaRoutes,
      }))}
    />
  );
}
