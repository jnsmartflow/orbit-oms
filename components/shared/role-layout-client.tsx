"use client";

import { RoleSidebar } from "./role-sidebar";
import type { RoleSidebarRole } from "./role-sidebar";
import { MobileShell } from "./mobile-shell";
import { MobileShellProvider } from "./mobile-shell-context";
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
      {/* Provider mounts the Menu/You sheets + sign-out confirm once, globally,
          for this subtree (Stage 1/4, 2026-07-19) — MobileShell's own bottom
          bar and any future descendant (e.g. a module-native header) both
          reach them via useMobileShell() instead of each owning a copy. */}
      <MobileShellProvider role={role} navItems={navItems} userName={userName} userInitials={userInitials}>
        <RoleSidebar
          role={role}
          userName={userName}
          userInitials={userInitials}
          navItems={navItems}
        />
        <MobileShell navItems={navItems} />
        <div className="min-h-screen overflow-hidden pb-[76px] md:pb-0 md:ml-[72px] md:max-w-[calc(100vw-72px)]">
          {children}
        </div>
      </MobileShellProvider>
    </div>
  );
}
