import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAllPermissionsForRole, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["operations", "admin"].includes(session.user.role)) redirect("/unauthorized");

  const allPerms     = await getAllPermissionsForRole(session.user.role);
  const navItems     = buildNavItems(allPerms, session.user.role);
  const userName     = session.user.name ?? "User";
  const userInitials = getInitials(userName);

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        role={session.user.role as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={navItems}
      >
        {children}
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
