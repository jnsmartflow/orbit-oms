"use client";

import { AdminSidebar } from "./admin-sidebar";
import { AdminHeader } from "./admin-header";
import { useSidebar } from "./sidebar-provider";
import type { NavItemConfig, PagePermissions } from "@/lib/permissions";

interface AdminLayoutClientProps {
  userName: string;
  userRole: string;
  /**
   * `isSuperuser(session)` from `lib/rbac.ts`, resolved in the server layout.
   * Passed straight through to AdminSidebar, which uses it to decide menu
   * visibility — the same question `requireSuperuser` asks at the door.
   */
  isSuperuser: boolean;
  allPerms: Record<string, PagePermissions>;
  /**
   * The nine app-switcher destinations, resolved from PAGE_NAV_MAP in the
   * server layout — that module is server-only, so the list cannot be built
   * here. `{ pageKey, label, href }` only; the icon is looked up client-side
   * from ICON_MAP, because a React component cannot cross the prop boundary.
   */
  switcherItems: NavItemConfig[];
  children: React.ReactNode;
}

export function AdminLayoutClient({ userName, userRole, isSuperuser, allPerms, switcherItems, children }: AdminLayoutClientProps) {
  const { isCollapsed } = useSidebar();

  return (
    <div style={{ background: "var(--bg)" }}>
      <AdminSidebar userName={userName} userRole={userRole} isSuperuser={isSuperuser} allPerms={allPerms} switcherItems={switcherItems} />
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
