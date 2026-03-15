"use client";

import { useRoleSidebar } from "./role-sidebar-provider";
import { RoleSidebar } from "./role-sidebar";
import type { RoleNavLink } from "./role-sidebar";

interface RoleLayoutClientProps {
  userName:  string;
  userRole:  string;
  links:     RoleNavLink[];
  maxWidth?: string;
  children:  React.ReactNode;
}

export function RoleLayoutClient({
  userName,
  userRole,
  links,
  maxWidth = "max-w-7xl",
  children,
}: RoleLayoutClientProps) {
  const { isCollapsed } = useRoleSidebar();

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <RoleSidebar userName={userName} userRole={userRole} links={links} />
      <div
        className="transition-all duration-200"
        style={{ marginLeft: isCollapsed ? "72px" : "240px" }}
      >
        <main className={`${maxWidth} mx-auto px-6 py-8`}>{children}</main>
      </div>
    </div>
  );
}
