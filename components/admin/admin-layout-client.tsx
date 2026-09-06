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
      {/*
        🔴 THE OFFSET IS A BREAKPOINT DECISION, NOT A STATE DECISION.
        This used to be `style={{ marginLeft: isCollapsed ? "72px" : "240px" }}`
        — an inline style, which cannot carry a media query, so the page body
        was pushed 72-240px right at EVERY width. Below md the sidebar it makes
        room for is not even rendered (`hidden md:flex`, admin-sidebar.tsx), so
        on a phone the content sat off-screen to the right.

        The value now travels as a CSS custom property and the offset is applied
        by responsive classes:
          - below md : ml-0, and --admin-rail is never read
          - md and up: ml-[var(--admin-rail)] — 72px collapsed, 240px expanded,
                       byte-for-byte the same two numbers as before
        Because the breakpoint decides, the provider's first paint (always
        `isCollapsed === false`, hydrated from localStorage in an effect) cannot
        flash a wrong offset on a phone — there is no offset there to be wrong.

        The top offset is the same bug one axis over. The mobile bar is
        `fixed top-0 h-[52px] z-50` and therefore OUT OF FLOW: it reserves no
        space, so AdminHeader rendered underneath it and h-screen pushed the
        last 52px of content off the bottom. pt-[52px] below md gives it back;
        md:pt-0 leaves the desktop untouched.

        Untouched by this change: the mobile bar, the drawer, the scrim, the
        mobileOpen state and sidebar-provider.tsx.
      */}
      <div
        className="h-screen flex flex-col overflow-hidden transition-all duration-200 ml-0 pt-[52px] md:ml-[var(--admin-rail)] md:pt-0"
        style={{ "--admin-rail": isCollapsed ? "72px" : "240px" } as React.CSSProperties}
      >
        <AdminHeader userName={userName} userRole={userRole} />
        <main className="flex-1 overflow-y-auto p-5 scrollbar-hide" style={{ background: "var(--bg)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
