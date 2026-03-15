import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";

export const dynamic = "force-dynamic";

export default async function SupportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  requireRole(session, [ROLES.SUPPORT, ROLES.ADMIN]);

  const userName = session!.user.name ?? "User";
  const userRole = session!.user.role;

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        userName={userName}
        userRole={userRole}
        links={[
          { label: "Support Queue", href: "/support" },
          { label: "Import Orders", href: "/import"  },
        ]}
        maxWidth="max-w-7xl"
      >
        {children}
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
