import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getAllPermissionsForRole,
  getAllPermissionsForRoles,
  buildNavItems,
} from "@/lib/permissions";
import { SidebarProvider } from "@/components/admin/sidebar-provider";
import { AdminLayoutClient } from "@/components/admin/admin-layout-client";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles       = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  if (!roles.some((r) => ["admin", "ops_admin"].includes(r))) {
    redirect("/unauthorized");
  }

  // Admin path — preserve the existing AdminLayoutClient experience so admin's
  // sidebar / header at /admin/attendance is identical to every other /admin/*
  // route. Mirrors app/(admin)/admin/layout.tsx.
  if (roles.includes("admin")) {
    const allPerms = await getAllPermissionsForRole(primaryRole);
    const userName = session.user.name ?? "Admin";
    return (
      <SidebarProvider>
        <AdminLayoutClient userName={userName} userRole={primaryRole} allPerms={allPerms}>
          {children}
        </AdminLayoutClient>
      </SidebarProvider>
    );
  }

  // ops_admin path — standard RoleSidebar with permissions-driven nav.
  // Mirrors the convention in app/(tint)/tint/manager/layout.tsx etc.
  const allPerms = await getAllPermissionsForRoles(roles);
  const navItems = buildNavItems(allPerms, primaryRole, {
    attendanceTestUser: session.user.attendanceTestUser,
    rolloutStage:       session.user.rolloutStage,
  });

  const seen = new Set<string>();
  const dedupedNavItems = navItems.filter((item) => {
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
        {children}
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
