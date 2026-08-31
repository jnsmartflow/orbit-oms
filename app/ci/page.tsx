import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import { CiShell } from "@/components/ci/ci-shell";

export const dynamic = "force-dynamic";

// /ci — Goods Return Note.
//
// ⚠ NO layout.tsx, and that is forced rather than stylistic. RoleLayoutClient
// carries `workflowTabs` / `activeTabKey` / `onTabChange` / `hideBar`, all owned
// by client state inside CiShell (the active tab, whether a bill is open). A
// server layout.tsx cannot supply them, and a layout rendering a bare
// RoleLayoutClient would permanently lock the supervisor to the default
// Home/Menu/You bar. Copies app/mrn/page.tsx, which copies app/picking/page.tsx
// — the reference server page for a role-branched module shell
// (CLAUDE_UI.md §59.4).
//
// ⚠ STEP 4a IS THE SUPERVISOR FACE ONLY. Billing's desk screen is step 5, and
// there is deliberately no role branch here yet: adding one now would mean
// writing a second face that renders nothing. Every role that holds `ci` canView
// gets the phone face today; the branch goes in with billing's screen, at which
// point it mirrors app/mrn/page.tsx's `primaryRole === "floor_supervisor"`.
//
// ⚠ NOT IN THE SIDEBAR YET. `ci` is in the PageKey union and ALL_PAGE_KEYS but
// deliberately NOT in PAGE_NAV_MAP — that is step 6, and its POSITION there is
// behaviour rather than cosmetics: MobileShell's phone Home target is
// navItems[0]?.href, so an entry inserted at index ≤ 2 would steal
// floor_supervisor's Home button from /picking. Reach this page by URL until
// then.
//
// NO first-paint data is seeded here. The New tab starts on an empty search box,
// so there is nothing to fetch before the supervisor types.

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function CiPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  // canView + admin bypass, the same shape as the MRN and picking pages.
  //
  // ⚠ The page gate and the route gates are SEPARATE ON PURPOSE: this one stops
  // the SCREEN rendering, and app/api/ci/* stop the DATA, which is reachable
  // directly by URL. Neither substitutes for the other — and the write routes
  // gate on canEdit, not canView, so a view-only holder sees this page and is
  // refused by the server the moment Next is tapped.
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canView");
    if (!allowed) redirect("/unauthorized");
  }

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
  const userInitials = getInitials(userName);

  return (
    <RoleSidebarProvider>
      <CiShell
        // `floor_supervisor` is not in the RoleSidebarRole union;
        // app/picking/page.tsx and app/mrn/page.tsx both cast here for the same
        // reason. Widening the union is a shared-component change and belongs in
        // its own commit.
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
      />
    </RoleSidebarProvider>
  );
}
