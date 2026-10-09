// lib/trip-sheet/shell-context.ts
//
// The RoleLayoutClient props the /trip-sheets pages hand their client screens —
// the same build-and-dedupe every inline-shell page does (app/trips/page.tsx,
// app/picking/page.tsx). Kept here so the two pages cannot drift.
//
// ⚠ Why the pages mount the shell themselves and there is NO
// app/trip-sheets/layout.tsx: a layout would wrap /trip-sheets/[id]/sheet, the
// A4 print page, in the sidebar and phone bar (CLAUDE_TRIP_REPORT §8).
//
// SERVER-ONLY.

import type { Session } from "next-auth";
import { buildNavItems, getAllPermissionsForRoles, type NavItemConfig } from "@/lib/permissions";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

export interface TripSheetShellProps {
  role: RoleSidebarRole;
  userName: string;
  userInitials: string;
  navItems: NavItemConfig[];
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export async function getTripSheetShellProps(user: Session["user"]): Promise<TripSheetShellProps> {
  const roles = user.roles ?? [user.role];
  const allPerms = await getAllPermissionsForRoles(roles);
  const navItems = buildNavItems(allPerms, user.role, {
    attendanceTestUser: user.attendanceTestUser,
    rolloutStage: user.rolloutStage,
  });
  const seen = new Set<string>();
  const deduped = navItems.filter((item) => {
    if (seen.has(item.pageKey)) return false;
    seen.add(item.pageKey);
    return true;
  });
  const userName = user.name ?? "User";
  return { role: user.role as RoleSidebarRole, userName, userInitials: getInitials(userName), navItems: deduped };
}
