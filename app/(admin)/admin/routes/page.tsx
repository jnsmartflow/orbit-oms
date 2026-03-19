import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { RoutesTable } from "@/components/admin/routes-table";

export const dynamic = 'force-dynamic';

export default async function RoutesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") {
    const allowed = await checkPermission(session.user.role, "routes_areas", "canView");
    if (!allowed) redirect("/unauthorized");
  }

  const routes = await prisma.route_master.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { areaRoutes: true } } },
  });

  return (
    <RoutesTable
      initialRoutes={routes.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        areaCount: r._count.areaRoutes,
      }))}
    />
  );
}
