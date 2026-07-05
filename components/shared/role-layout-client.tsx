"use client";

import { RoleSidebar } from "./role-sidebar";
import type { RoleSidebarRole } from "./role-sidebar";
import { MobileShell } from "./mobile-shell";
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
      <MobileShell
        role={role}
        navItems={navItems}
        userName={userName}
        userInitials={userInitials}
      />
      <div className="min-h-screen overflow-hidden pb-[76px] md:pb-0 md:ml-[72px] md:max-w-[calc(100vw-72px)]">
        {children}
      </div>
    </div>
  );
}
