"use client";

import { AdminSidebar } from "./admin-sidebar";
import { AdminHeader } from "./admin-header";
import { useSidebar } from "./sidebar-provider";
import type { PagePermissions } from "@/lib/permissions";

interface AdminLayoutClientProps {
  userName: string;
  userRole: string;
  allPerms: Record<string, PagePermissions>;
  children: React.ReactNode;
}

export function AdminLayoutClient({ userName, userRole, allPerms, children }: AdminLayoutClientProps) {
  const { isCollapsed } = useSidebar();

  return (
    <div style={{ background: "var(--bg)" }}>
      <AdminSidebar userName={userName} userRole={userRole} allPerms={allPerms} />
      <div
        className="h-screen flex flex-col overflow-hidden transition-all duration-200"
        style={{ marginLeft: isCollapsed ? "72px" : "240px" }}
      >
        <AdminHeader userName={userName} userRole={userRole} />
        <main className="flex-1 overflow-y-auto p-5 scrollbar-hide" style={{ background: "var(--bg)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
