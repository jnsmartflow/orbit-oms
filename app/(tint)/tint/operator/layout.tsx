import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";

export const dynamic = "force-dynamic";

export default async function TintOperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR]);

  const userName = session!.user.name ?? "User";
  const userRole = session!.user.role;

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        userName={userName}
        userRole={userRole}
        links={[
          { label: "My Tint Jobs", href: "/tint/operator" },
        ]}
        maxWidth="max-w-4xl"
      >
        {children}
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
