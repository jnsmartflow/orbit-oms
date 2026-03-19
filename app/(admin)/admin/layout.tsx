import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { getAllPermissionsForRole } from "@/lib/permissions";
import { SidebarProvider } from "@/components/admin/sidebar-provider";
import { AdminLayoutClient } from "@/components/admin/admin-layout-client";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const allPerms = await getAllPermissionsForRole(session!.user.role);
  const userName = session!.user.name ?? "Admin";
  const userRole = session!.user.role;

  return (
    <SidebarProvider>
      <AdminLayoutClient userName={userName} userRole={userRole} allPerms={allPerms}>
        {children}
      </AdminLayoutClient>
    </SidebarProvider>
  );
}
