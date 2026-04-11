"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  ClipboardList, Layers, User, Zap, Upload,
  Truck, Warehouse, Users, Package, MapPin, FileText, Palette, BarChart2, LayoutDashboard, Mail,
} from "lucide-react";
import { useRoleSidebar } from "./role-sidebar-provider";
import type { NavItemConfig } from "@/lib/permissions";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RoleSidebarRole =
  | "support"
  | "tint_manager"
  | "tint_operator"
  | "import"
  | "support_import"
  | "planning"
  | "warehouse"
  | "operations"
  | "billing_operator";

export interface RoleSidebarProps {
  role:         RoleSidebarRole;
  userName:     string;
  userInitials: string;
  navItems:     NavItemConfig[];
}

// ── Icon map ──────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  operations_support:   ClipboardList,
  operations_tinting:       Layers,
  operations_tint_operator: Zap,
  operations_dispatch:      LayoutDashboard,
  operations_warehouse: Warehouse,
  import_obd:          Upload,
  support_queue:       ClipboardList,
  planning_board:      LayoutDashboard,
  tint_manager:        Layers,
  tint_operator:       Zap,
  dispatcher:          Truck,
  warehouse:           Warehouse,
  customers:           Users,
  skus:                Package,
  routes_areas:        MapPin,
  vehicles:            Truck,
  delivery_challans:   FileText,
  shade_master:        Palette,
  ti_report:           BarChart2,
  mail_orders:         Mail,
};

const DEFAULT_ICON = User;

const ROLE_LABELS: Record<RoleSidebarRole, string> = {
  support:        "Support Team",
  tint_manager:   "Tint Manager",
  tint_operator:  "Tint Operator",
  import:         "Import",
  support_import: "Support Team",
  planning:       "Planning Board",
  warehouse:      "Warehouse",
  operations:     "Operations",
  billing_operator: "Billing Operator",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function RoleSidebar({ role, userName, userInitials, navItems }: RoleSidebarProps) {
  const pathname              = usePathname();
  const { isExpanded, expand, collapse } = useRoleSidebar();

  const roleLabel = ROLE_LABELS[role];

  function isActive(href: string) {
    return pathname === href;
  }

  // ── Expanded nav ────────────────────────────────────────────────────────────

  const expandedNav = (
    <nav className="flex flex-col py-2 overflow-y-auto flex-1 scrollbar-hide">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 pt-4 pb-1 select-none">
        {roleLabel}
      </p>
      <div className="flex flex-col">
        {navItems.map((item) => {
          const Icon   = ICON_MAP[item.pageKey] ?? DEFAULT_ICON;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 mx-2 my-[1px] py-2 rounded-lg text-[12.5px] transition-colors",
                active
                  ? "bg-teal-50 text-teal-700 font-semibold pl-[10px] border-l-2 border-teal-600"
                  : "font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 pl-3"
              )}
            >
              <Icon className="h-[15px] w-[15px] shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );

  // ── Collapsed nav (icons + tooltips) ────────────────────────────────────────

  const collapsedNav = (
    <nav className="flex flex-col py-2 overflow-y-auto flex-1 scrollbar-hide items-center">
      {navItems.map((item) => {
        const Icon   = ICON_MAP[item.pageKey] ?? DEFAULT_ICON;
        const active = isActive(item.href);
        return (
          <div key={item.href} className="relative group w-full flex justify-center mb-0.5">
            <Link
              href={item.href}
              className={cn(
                "flex items-center justify-center h-9 w-9 rounded-lg transition-colors",
                active
                  ? "bg-teal-50 text-teal-600"
                  : "text-gray-400 hover:bg-gray-50 hover:text-gray-700"
              )}
              title={item.label}
            >
              <Icon className="h-[17px] w-[17px]" />
            </Link>
            {/* Tooltip */}
            <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-[200] hidden group-hover:block">
              <div className="bg-gray-900 text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap shadow-lg">
                {item.label}
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <aside
      onMouseEnter={expand}
      onMouseLeave={collapse}
      className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-50 flex-col bg-white transition-all duration-200"
      style={{
        width:       isExpanded ? "220px" : "72px",
        borderLeft:  "3px solid #0d9488",
        borderRight: "1px solid #e5e7eb",
        boxShadow:   isExpanded ? "4px 0 16px rgba(0,0,0,0.06)" : "none",
      }}
    >
      {/* Brand block */}
      <div
        className={cn(
          "flex items-center shrink-0 border-b border-gray-200",
          !isExpanded ? "justify-center px-0 h-[52px]" : "gap-2.5 px-4 h-[52px]",
        )}
      >
        <div
          className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center text-white font-extrabold text-[14px] hover:bg-teal-700 transition-colors flex-shrink-0"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6"/>
            <circle cx="11" cy="11" r="2.2" fill="white"/>
            <circle cx="18" cy="11" r="2" fill="white"/>
          </svg>
        </div>
        {isExpanded && (
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-gray-900 leading-tight">Orbit OMS</p>
            <p className="text-[10px] text-gray-400 leading-tight">{roleLabel}</p>
          </div>
        )}
      </div>

      {!isExpanded ? collapsedNav : expandedNav}

      {/* User block */}
      <div
        className={cn(
          "shrink-0 border-t border-gray-200",
          !isExpanded
            ? "flex justify-center py-3"
            : "flex items-center gap-2.5 px-4 py-3",
        )}
      >
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0 hover:bg-teal-700 transition-colors"
          title="Sign out"
        >
          {userInitials}
        </button>
        {isExpanded && (
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-gray-800 truncate">{userName}</p>
            <p className="text-[10px] text-gray-400 truncate">{roleLabel}</p>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-[10px] text-red-500 hover:text-red-700 font-medium mt-0.5 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
