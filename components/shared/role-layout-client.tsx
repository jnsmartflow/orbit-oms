"use client";

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
  return (
    <div className="min-h-screen bg-white overflow-hidden">
      <RoleSidebar
        role={role}
        userName={userName}
        userInitials={userInitials}
        navItems={navItems}
      />
      <div
        className="min-h-screen overflow-hidden"
        style={{
          marginLeft: "72px",
          maxWidth:   "calc(100vw - 72px)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
