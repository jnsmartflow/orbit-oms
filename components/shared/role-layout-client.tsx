"use client";

import { useRoleSidebar } from "./role-sidebar-provider";
import { RoleSidebar } from "./role-sidebar";
import type { RoleSidebarRole } from "./role-sidebar";
import type { NavItemConfig } from "@/lib/permissions";

interface RoleLayoutClientProps {
  role:         RoleSidebarRole;
  userName:     string;
  userInitials: string;
  navItems:     NavItemConfig[];
  children:     React.ReactNode;
}

export function RoleLayoutClient({
  role,
  userName,
  userInitials,
  navItems,
  children,
}: RoleLayoutClientProps) {
  const { isCollapsed } = useRoleSidebar();

  return (
    <div className="min-h-screen bg-[#f0f2f8] overflow-hidden">
      <RoleSidebar
        role={role}
        userName={userName}
        userInitials={userInitials}
        navItems={navItems}
      />
      <div
        className="transition-all duration-200 min-h-screen overflow-hidden"
        style={{
          marginLeft: isCollapsed ? "72px" : "220px",
          maxWidth:   isCollapsed ? "calc(100vw - 72px)" : "calc(100vw - 220px)",
        }}
      >
        {children}
      </div>
    </div>
  );
}