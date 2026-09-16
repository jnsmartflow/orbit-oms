import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function ImportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles       = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  // ONE RULE (owner, 2026-09-16): the Import OBDs tick (import_obd canImport)
  // decides who may open this page, exactly as it decides who may import
  // (POST /api/import/obd) and who sees the Import button. No job-title list.
  // All held roles, never the primary alone; admin / superuser bypass comes
  // from the resolver.
  const allowed = await checkAnyPermission(roles, "import_obd", "canImport");
  if (!allowed) redirect("/unauthorized");

  const allPerms     = await getAllPermissionsForRoles(roles);
  const navItems     = buildNavItems(allPerms, undefined, {
    attendanceTestUser: session!.user.attendanceTestUser,
    rolloutStage:       session!.user.rolloutStage,
  });

  const seen = new Set<string>();
  const dedupedNavItems = navItems.filter(item => {
    if (seen.has(item.pageKey)) return false;
    seen.add(item.pageKey);
    return true;
  });

  const userName     = session!.user.name ?? "User";
  const userInitials = getInitials(userName);

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
      >
        {children}
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
