import { auth } from "@/lib/auth";
import { isSuperuser, requireSuperuser } from "@/lib/rbac";
import { getAllPermissionsForRoles } from "@/lib/permissions";
import { appSwitcherItems } from "@/lib/admin/app-switcher";
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

  // The SAME predicate the guard on line 15 just ran. The sidebar's menu filter
  // used to test `userRole === "admin"` — the singular primary job title — which
  // is not the question this door asks, so a flag-only superuser was admitted
  // here and then shown 6 of 28 items. Resolved once, server-side, and threaded
  // down as a prop (2026-09-06). Local name avoids shadowing the import.
  const superuser = isSuperuser(session);

  // The nine switcher destinations, resolved from PAGE_NAV_MAP here because
  // that module is server-only (it imports prisma and auth). Deliberately NOT
  // filtered through allPerms — see lib/admin/app-switcher.ts for why.
  const switcherItems = appSwitcherItems();

  return (
    <SidebarProvider>
      <AdminLayoutClient userName={userName} userRole={userRole} isSuperuser={superuser} allPerms={allPerms} switcherItems={switcherItems}>
        {children}
      </AdminLayoutClient>
    </SidebarProvider>
  );
}
