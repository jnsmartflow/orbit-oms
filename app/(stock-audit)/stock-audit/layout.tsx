import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

export const dynamic = "force-dynamic";

// /stock-audit — the stock audit DESK (phase 1: physical count, no book stock).
// Same shell as app/(freight)/freight-trips/layout.tsx, gated on the
// `stock_audit_manage` page key (canView). NOT `stock_audit_count` — that is
// the counter's phone screen at /stock-count.

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function StockAuditLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  const allowed = await checkAnyPermission(roles, "stock_audit_manage", "canView");
  if (!allowed) redirect("/unauthorized");

  const allPerms = await getAllPermissionsForRoles(roles);
  const navItems = buildNavItems(allPerms, primaryRole, {
    attendanceTestUser: session.user.attendanceTestUser,
    rolloutStage: session.user.rolloutStage,
  });
  const seen = new Set<string>();
  const dedupedNavItems = navItems.filter((item) => {
    if (seen.has(item.pageKey)) return false;
    seen.add(item.pageKey);
    return true;
  });

  const userName = session.user.name ?? "User";
  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={getInitials(userName)}
        navItems={dedupedNavItems}
      >
        {children}
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
