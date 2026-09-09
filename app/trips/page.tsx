import type { Metadata, Viewport } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import { TripReportPage } from "@/components/trip-report/trip-report-page";

export const dynamic = "force-dynamic";

// ── Status bar ───────────────────────────────────────────────────────────────
// 🔴 THIS ROUTE'S HEADER IS A PALE MASTHEAD (#F5F3FF), SO THE STATUS BAR HAS TO
// CARRY DARK GLYPHS. app/layout.tsx sets `statusBarStyle: "black-translucent"`
// app-wide, which draws the page UNDER the status bar and paints the clock and
// battery WHITE — correct over the old solid brand-600 band, and invisible over
// the wash that replaced it on 2026-09-09. "default" makes iOS RESERVE the bar
// and paint dark instead. Same override /po and /po-v2 already carry.
//
// ⚠ themeColor lives on the VIEWPORT export, not on `metadata` — in Next 14
// `metadata.themeColor` logs "Unsupported metadata themeColor is configured in
// metadata export" and is not honoured. Next shallow-merges viewport per FIELD,
// so this overrides themeColor for THIS ROUTE ONLY and inherits the layout's
// viewportFit / width / initialScale / maximumScale / userScalable untouched.
// Android derives its icon colour from theme_color's luminance, and #F5F3FF is
// far above the threshold, so it picks dark on its own.
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

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function TripsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles       = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  const allowed = await checkAnyPermission(roles, "trip_report", "canView");
  if (!allowed) redirect("/unauthorized");

  const allPerms = await getAllPermissionsForRoles(roles);
  const navItems = buildNavItems(allPerms, primaryRole, {
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

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
      >
        <TripReportPage />
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
