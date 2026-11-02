import type { Metadata, Viewport } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import { StockCountShell } from "@/components/stock-audit/count-shell";

export const dynamic = "force-dynamic";

// ── Status bar ───────────────────────────────────────────────────────────────
// Copied from app/ci/page.tsx: this screen's header is the pale masthead
// (#F5F3FF, CLAUDE_UI §59.8), so the status bar must carry DARK glyphs.
// "default" makes iOS reserve the bar and paint dark; themeColor lives on the
// VIEWPORT export (Next 14 ignores metadata.themeColor).
export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    title: "Orbit",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#F5F3FF",
};

// /stock-count — the counter's phone screen (stock audit, phase 1).
//
// ⚠ NO layout.tsx, for the CI reason: RoleLayoutClient's workflowTabs /
// activeTabKey / onTabChange / hideBar are CLIENT state inside StockCountShell,
// which a server layout cannot supply.
//
// Gate: stock_audit_count canView (admin / superuser arms via
// checkAnyPermission). Open counting: holding the key is enough to count in THE
// open audit (at most one is open); with none open the screen says "No audit is
// open right now". The page gate stops the
// SCREEN; app/api/stock-count/* stop the DATA. Neither replaces the other.
//
// ONE face at every width, never branched on role or viewport: ≥768px the
// same screen sits in a centred 480px column with the sidebar beside it.

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function StockCountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  const allowed = await checkAnyPermission(roles, "stock_audit_count", "canView");
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
      <StockCountShell
        // Same cast app/ci/page.tsx and app/mrn/page.tsx make: not every
        // primary role is in the RoleSidebarRole union.
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={getInitials(userName)}
        navItems={dedupedNavItems}
      />
    </RoleSidebarProvider>
  );
}
