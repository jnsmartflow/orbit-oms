import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PermissionsManager } from "@/components/admin/permissions-manager";

export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const perms = await prisma.role_permissions.findMany({
    orderBy: [{ roleSlug: "asc" }, { pageKey: "asc" }],
  });

  return <PermissionsManager initialPerms={perms} />;
}
