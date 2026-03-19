import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission, getPagePermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { RoutesTable } from "@/components/admin/routes-table";

export const dynamic = "force-dynamic";

export default async function SupportRoutesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const canView = await checkPermission(session.user.role, "routes_areas", "canView");
  if (!canView) redirect("/unauthorized");
  const perms = await getPagePermissions(session.user.role, "routes_areas");

  const routes = await prisma.route_master.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { areaRoutes: true } } },
  });

  return (
    <RoutesTable
      initialRoutes={routes.map((r) => ({
        id:          r.id,
        name:        r.name,
        description: r.description,
        isActive:    r.isActive,
        areaCount:   r._count.areaRoutes,
      }))}
      canEdit={perms.canEdit}
      canImport={perms.canImport}
    />
  );
}
