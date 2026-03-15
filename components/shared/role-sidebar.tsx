"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  Upload, Headphones, Palette, Brush, LayoutDashboard, Circle,
} from "lucide-react";
import { useRoleSidebar } from "./role-sidebar-provider";

export interface RoleNavLink {
  label: string;
  href:  string;
}

function getNavIcon(href: string, size = 18) {
  if (href.includes("/import"))        return <Upload          size={size} />;
  if (href.includes("/support"))       return <Headphones      size={size} />;
  if (href.includes("/tint/manager"))  return <Palette         size={size} />;
  if (href.includes("/tint/operator")) return <Brush           size={size} />;
  if (href.includes("/admin"))         return <LayoutDashboard size={size} />;
  return <Circle size={size} />;
}

interface RoleSidebarProps {
  userName: string;
  userRole: string;
  links:    RoleNavLink[];
}

export function RoleSidebar({ userName, userRole, links }: RoleSidebarProps) {
  const pathname              = usePathname();
  const { isCollapsed, toggle } = useRoleSidebar();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  // ── Expanded nav ───────────────────────────────────────────────────────────

  const expandedNav = (
    <nav className="flex flex-col py-3 overflow-y-auto flex-1 scrollbar-hide">
      <div className="flex flex-col">
        {links.map((link) => {
          const active = isActive(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-2.5 mx-2 my-[1px] py-[7px] px-3 rounded-md transition-colors text-[13px]",
                active ? "font-semibold" : "font-normal hover:bg-[#f7f8fa]"
              )}
              style={active ? {
                background:  "#eef2ff",
                color:       "var(--navy)",
                borderLeft:  "3px solid var(--navy)",
                paddingLeft: "9px",
              } : {
                color:      "var(--text-2)",
                borderLeft: "3px solid transparent",
              }}
            >
              <span className="shrink-0">{getNavIcon(link.href, 16)}</span>
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );

  // ── Collapsed nav (icons only + tooltips) ─────────────────────────────────

  const collapsedNav = (
    <nav className="flex flex-col py-3 overflow-y-auto flex-1 scrollbar-hide">
      <div className="flex flex-col items-center gap-0.5">
        {links.map((link) => {
          const active = isActive(link.href);
          return (
            <div key={link.href} className="relative group w-full flex justify-center">
              <Link
                href={link.href}
                className={cn(
                  "flex items-center justify-center h-9 w-9 rounded-md transition-colors",
                  active ? "bg-[#eef2ff]" : "hover:bg-[#f7f8fa]"
                )}
                style={{ color: active ? "var(--navy)" : "var(--text-2)" }}
                title={link.label}
              >
                {getNavIcon(link.href, 20)}
              </Link>
              {/* Tooltip */}
              <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-[200] hidden group-hover:block">
                <div className="bg-[#1a237e] text-white text-xs px-2 py-1 rounded-md whitespace-nowrap shadow-lg">
                  {link.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );

  return (
    <aside
      className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-50 flex-col transition-all duration-200"
      style={{
        width:       isCollapsed ? "72px" : "240px",
        background:  "var(--white)",
        borderRight: "1px solid var(--border)",
      }}
    >
      {/* Brand header — clicking "O" toggles collapse */}
      <div
        className="flex items-center shrink-0"
        style={{ height: "48px", background: "var(--navy)", padding: isCollapsed ? "0" : "0 12px" }}
      >
        {isCollapsed ? (
          <div className="w-full flex items-center justify-center">
            <button
              onClick={toggle}
              className="w-11 h-11 bg-[#1a237e] rounded-lg flex items-center justify-center text-white font-bold text-lg cursor-pointer hover:bg-[#283593] transition-colors flex-shrink-0"
              title="Expand menu"
            >
              O
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <button
              onClick={toggle}
              className="w-10 h-10 bg-[#1a237e] rounded-lg flex items-center justify-center text-white font-bold text-lg cursor-pointer hover:bg-[#283593] transition-colors flex-shrink-0"
              title="Collapse menu"
            >
              O
            </button>
            <span className="text-white font-semibold text-sm tracking-tight whitespace-nowrap">
              Orbit OMS
            </span>
          </div>
        )}
      </div>

      {isCollapsed ? collapsedNav : expandedNav}

      {/* User info + sign out — hidden when collapsed */}
      {!isCollapsed && (
        <div
          className="shrink-0 px-4 py-3 flex flex-col gap-2"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <span style={{ fontSize: "12px", color: "var(--text-2)" }}>
            <span style={{ fontWeight: 600, color: "var(--text)" }}>{userName}</span>
            {" · "}
            <span style={{ color: "var(--muted)" }}>{userRole}</span>
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full rounded-md transition-colors text-left"
            style={{
              padding:    "4px 10px",
              fontSize:   "12px",
              fontWeight: 500,
              color:      "var(--text-2)",
              background: "var(--white)",
              border:     "1px solid var(--border)",
              cursor:     "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--white)")}
          >
            Sign out
          </button>
        </div>
      )}

      {/* Collapsed: sign-out icon button */}
      {isCollapsed && (
        <div
          className="shrink-0 flex justify-center py-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div className="relative group">
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center justify-center h-9 w-9 rounded-md hover:bg-[#f7f8fa] transition-colors"
              style={{ color: "var(--text-2)" }}
              title="Sign out"
            >
              {/* Simple exit icon using CSS */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M10 5l3 3-3 3M13 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-[200] hidden group-hover:block">
              <div className="bg-[#1a237e] text-white text-xs px-2 py-1 rounded-md whitespace-nowrap shadow-lg">
                Sign out
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
