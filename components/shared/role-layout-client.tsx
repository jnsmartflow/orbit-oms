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
      <div className="min-h-screen overflow-hidden md:ml-[72px] md:max-w-[calc(100vw-72px)]">
        {children}
      </div>
    </div>
  );
}
