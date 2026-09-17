import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems, canViewAnyReport } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { TintManagerAccessProvider } from "@/components/tint/manager/tint-manager-access-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function TintManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles       = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) redirect("/unauthorized");

  const allPerms = await getAllPermissionsForRoles(roles);
  const navItems = buildNavItems(allPerms, primaryRole, {
    attendanceTestUser: session.user.attendanceTestUser,
    rolloutStage:       session.user.rolloutStage,
  });

  // Job-panel tabs (2026-09-17). Read off the SAME `allPerms` map — no second
  // query. Admin / superuser are all-true inside getAllPermissionsForRoles;
  // everyone else needs the matching canView tick. Absent row reads as false.
  const canPanelItems    = allPerms["tint_panel_items"]?.canView    ?? false;
  const canPanelDetails  = allPerms["tint_panel_details"]?.canView  ?? false;
  const canPanelActivity = allPerms["tint_panel_activity"]?.canView ?? false;
  // Header "Reports" pill (2026-09-17): any report tick — the hub's own rule.
  const canReports       = canViewAnyReport(allPerms);

  const seen = new Set<string>();
  const dedupedNavItems = navItems.filter(item => {
    if (seen.has(item.pageKey)) return false;
    seen.add(item.pageKey);
    return true;
  });

  const userName     = session.user.name ?? "User";
  const userInitials = getInitials(userName);

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
      >
        <TintManagerAccessProvider
          canPanelItems={canPanelItems}
          canPanelDetails={canPanelDetails}
          canPanelActivity={canPanelActivity}
          canReports={canReports}
        >
          {children}
        </TintManagerAccessProvider>
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
