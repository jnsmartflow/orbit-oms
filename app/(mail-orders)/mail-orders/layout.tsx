import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { isBillingV2Enabled } from "@/lib/billing/flag";
import { BillingV2Provider } from "@/components/billing/billing-v2-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function MailOrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles       = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
    if (!allowed) redirect("/unauthorized");
  }

  const allPerms     = await getAllPermissionsForRoles(roles);
  const navItems     = buildNavItems(allPerms, primaryRole, {
    attendanceTestUser: session.user.attendanceTestUser,
    rolloutStage:       session.user.rolloutStage,
  });

  const seen = new Set<string>();
  const dedupedNavItems = navItems.filter(item => {
    if (seen.has(item.pageKey)) return false;
    seen.add(item.pageKey);
    return true;
  });

  const userName     = session.user.name ?? "User";
  const userInitials = getInitials(userName);

  // Billing v2 rollout (Phase 0) — global stage (billing_settings.rolloutStage)
  // AND the per-user opt-in, read FRESH each load (never cached onto the JWT;
  // see lib/billing/flag.ts for why). Read ONCE here and branched from, so the
  // whole module has a single gate rather than a check per screen.
  // `session.user.id` is a string, so Number(...) + the helper's own
  // Number.isFinite guard — the same shape app/picking/page.tsx uses. No extra
  // fetch: the session is already resolved above. Fails closed, so this cannot
  // break the page.
  const billingV2 = await isBillingV2Enabled(Number(session.user.id));

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
      >
        {/* One server-side flag read, couriered to the client tree. Nothing
            below re-fetches it, and page.tsx keeps its bare <ComponentName />
            shape (CORE §3). */}
        <BillingV2Provider enabled={billingV2}>{children}</BillingV2Provider>
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
