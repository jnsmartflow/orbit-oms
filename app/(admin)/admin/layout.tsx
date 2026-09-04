import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { getAllPermissionsForRoles } from "@/lib/permissions";
import { SidebarProvider } from "@/components/admin/sidebar-provider";
import { AdminLayoutClient } from "@/components/admin/admin-layout-client";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  requireSuperuser(session);

  // MERGED across every role, like the other 11 layouts and every API gate.
  // This used to call the SINGULAR getAllPermissionsForRole(session.user.role),
  // which read the PRIMARY role only — two different lookups for the same
  // question, and a landmine once ACCESS_SOURCE exists. Verified read-only
  // 2026-09-04 that nobody is affected: the guard above admits only a superuser
  // or a session whose ROLES ARRAY contains "admin", exactly one user is either
  // (u1), and for that user primary === the whole set, so both paths hit the
  // same admin short-circuit and return ALL_TRUE either way.
  const allPerms = await getAllPermissionsForRoles(session!.user.roles ?? [session!.user.role]);
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
