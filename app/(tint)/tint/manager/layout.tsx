import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";

export const dynamic = "force-dynamic";

export default async function TintManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);

  const userName = session!.user.name ?? "User";
  const userRole = session!.user.role;

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        userName={userName}
        userRole={userRole}
        links={[
          { label: "Tint Manager", href: "/tint/manager" },
        ]}
        maxWidth="max-w-7xl"
      >
        {children}
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
