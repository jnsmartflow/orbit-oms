import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";

export const dynamic = "force-dynamic";

export default async function ImportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT]);

  const userName = session!.user.name ?? "User";
  const userRole = session!.user.role;

  // Support role sees both Import + Support Queue links so they can navigate back
  const links =
    userRole === ROLES.SUPPORT
      ? [
          { label: "Support Queue", href: "/support" },
          { label: "Import Orders", href: "/import"  },
        ]
      : [
          { label: "Import Orders", href: "/import" },
        ];

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        userName={userName}
        userRole={userRole}
        links={links}
        maxWidth="max-w-6xl"
      >
        {children}
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
