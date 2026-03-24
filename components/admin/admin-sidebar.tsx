"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Menu, X,
  LayoutDashboard, Settings2, Users, ShieldCheck, Shield,
  Truck, Clock, CalendarClock, Map, MapPin, Layers,
  Tag, Palette, Package,
  Building2, UserCheck, ContactRound, Store,
  Upload, ClipboardList, Paintbrush, Briefcase,
} from "lucide-react";
import { useSidebar } from "./sidebar-provider";
import type { PagePermissions } from "@/lib/permissions";

// ── Navigation structure ─────────────────────────────────────────────────────

interface NavItem {
  label:    string;
  href:     string;
  pageKey?: string;   // if set: show to admin OR if allPerms[pageKey]?.canView; if absent: admin-only
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin" },
    ],
  },
  {
    label: "Master Data",
    items: [
      { label: "System Config",       href: "/admin/system-config" },
      { label: "Users",               href: "/admin/users" },
      { label: "Permissions",         href: "/admin/permissions" },
      { label: "Roles",               href: "/admin/roles" },
      { label: "Delivery Types",      href: "/admin/delivery-types" },
      { label: "Slot Master",         href: "/admin/slots" },
      { label: "Slot Rules",          href: "/admin/slot-rules" },
      { label: "Routes",              href: "/admin/routes",    pageKey: "routes_areas" },
      { label: "Areas",               href: "/admin/areas",     pageKey: "routes_areas" },
      { label: "Sub-areas",           href: "/admin/sub-areas" },
      { label: "Product Categories",  href: "/admin/product-categories" },
      { label: "Product Names",       href: "/admin/product-names" },
      { label: "Base Colours",        href: "/admin/base-colours" },
      { label: "SKUs",                href: "/admin/skus",      pageKey: "skus" },
      { label: "Transporters",        href: "/admin/transporters" },
      { label: "Vehicles",            href: "/admin/vehicles",  pageKey: "vehicles" },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Sales Officers", href: "/admin/sales-officers" },
      { label: "SO Groups",      href: "/admin/so-groups" },
      { label: "Contact Roles",  href: "/admin/contact-roles" },
      { label: "Customers",      href: "/admin/customers",     pageKey: "customers" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Import Orders", href: "/admin/import" },
      { label: "Support Queue", href: "/admin/support" },
      { label: "Tint Manager",  href: "/admin/tint-manager" },
      { label: "Shade Master",  href: "/tint/shades" },
    ],
  },
];

// ── Icon map ─────────────────────────────────────────────────────────────────

type NavIcon = React.ComponentType<{ className?: string }>;

const ICONS: Record<string, NavIcon> = {
  "Dashboard":           LayoutDashboard,
  "System Config":       Settings2,
  "Users":               Users,
  "Permissions":         Shield,
  "Roles":               ShieldCheck,
  "Delivery Types":      Truck,
  "Slot Master":         Clock,
  "Slot Rules":          CalendarClock,
  "Routes":              MapPin,
  "Areas":               Map,
  "Sub-areas":           Layers,
  "Product Categories":  Tag,
  "Product Names":       Layers,
  "Base Colours":        Palette,
  "SKUs":                Package,
  "Transporters":        Building2,
  "Vehicles":            Truck,
  "SO Groups":           Briefcase,
  "Sales Officers":      UserCheck,
  "Contact Roles":       ContactRound,
  "Customers":           Store,
  "Import Orders":       Upload,
  "Support Queue":       ClipboardList,
  "Tint Manager":        Palette,
  "Shade Master":        Palette,
  "My Tint Jobs":        Paintbrush,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminSidebarProps {
  userName: string;
  userRole: string;
  allPerms: Record<string, PagePermissions>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminSidebar({ userName, userRole, allPerms }: AdminSidebarProps) {
  const pathname                    = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isCollapsed, toggle }     = useSidebar();

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(href + "/");
  }

  function visibleItems(items: NavItem[]) {
    return items.filter((item) => {
      if (item.pageKey) {
        return userRole === "admin" || allPerms[item.pageKey]?.canView === true;
      }
      return userRole === "admin";
    });
  }

  // ── Expanded nav ────────────────────────────────────────────────────────────

  const expandedNav = (
    <nav className="flex flex-col py-2 overflow-y-auto flex-1 scrollbar-hide">
      {NAV_SECTIONS.map((section) => {
        const items = visibleItems(section.items);
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 px-4 pt-4 pb-1 select-none">
              {section.label}
            </p>
            <div className="flex flex-col">
              {items.map((item) => {
                const Icon   = ICONS[item.label] ?? LayoutDashboard;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 mx-2 my-[1px] py-2 rounded-lg text-[12.5px] transition-colors",
                      active
                        ? "bg-[#e8eaf6] text-[#1a237e] font-semibold pl-[10px] border-l-2 border-[#1a237e]"
                        : "font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 pl-3"
                    )}
                  >
                    <Icon className="h-[15px] w-[15px] shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  // ── Collapsed nav (icons only + tooltips) ───────────────────────────────────

  const collapsedNav = (
    <nav className="flex flex-col py-2 overflow-y-auto flex-1 scrollbar-hide items-center">
      {NAV_SECTIONS.map((section, si) => {
        const items = visibleItems(section.items);
        if (items.length === 0) return null;
        return (
          <div key={section.label} className={cn("w-full flex flex-col items-center", si > 0 && "mt-1")}>
            {si > 0 && <div className="w-8 border-t border-[#e2e5f1] my-2" />}
            {items.map((item) => {
              const Icon   = ICONS[item.label] ?? LayoutDashboard;
              const active = isActive(item.href);
              return (
                <div key={item.href} className="relative group w-full flex justify-center mb-0.5">
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center justify-center h-9 w-9 rounded-lg transition-colors",
                      active
                        ? "bg-[#e8eaf6] text-[#1a237e]"
                        : "text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                    )}
                    title={item.label}
                  >
                    <Icon className="h-[17px] w-[17px]" />
                  </Link>
                  {/* Tooltip */}
                  <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-[200] hidden group-hover:block">
                    <div className="bg-[#1a237e] text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap shadow-lg">
                      {item.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  // ── Shared sidebar shell ────────────────────────────────────────────────────

  const sidebarContent = (collapsed: boolean) => (
    <>
      {/* Brand / logo block */}
      <div
        className={cn(
          "flex items-center shrink-0 border-b border-[#e2e5f1]",
          collapsed ? "justify-center px-0 h-[52px]" : "gap-2.5 px-4 h-[52px]"
        )}
      >
        <button
          onClick={toggle}
          className="w-9 h-9 bg-[#1a237e] rounded-xl flex items-center justify-center text-white font-extrabold text-[14px] cursor-pointer hover:bg-[#283593] transition-colors flex-shrink-0"
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          O
        </button>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-gray-900 leading-tight">Orbit OMS</p>
            <p className="text-[10px] text-gray-400 leading-tight">Admin Panel</p>
          </div>
        )}
      </div>

      {collapsed ? collapsedNav : expandedNav}

      {/* User block at bottom */}
      <div
        className={cn(
          "shrink-0 border-t border-[#e2e5f1]",
          collapsed ? "flex justify-center py-3" : "flex items-center gap-2.5 px-4 py-3"
        )}
      >
        <div className="w-8 h-8 rounded-full bg-[#1a237e] text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
          {getInitials(userName)}
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-gray-800 truncate">{userName}</p>
            <p className="text-[10px] text-gray-400 truncate">{userRole}</p>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* ── Desktop sidebar — fixed left ───────────────────────────────────── */}
      <aside
        className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-50 flex-col bg-white shadow-sm transition-all duration-200"
        style={{
          width:       isCollapsed ? "72px" : "240px",
          borderRight: "1px solid #e2e5f1",
        }}
      >
        {sidebarContent(isCollapsed)}
      </aside>

      {/* ── Mobile top bar ─────────────────────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 z-50 flex items-center gap-3 px-4 w-full h-[52px] bg-white border-b border-[#e2e5f1] shadow-sm">
        <button
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-600"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 bg-[#1a237e] rounded-lg flex items-center justify-center text-white font-extrabold text-[12px]">O</span>
          <span className="font-bold text-[14px] text-gray-900">Orbit OMS</span>
        </div>
      </div>

      {/* ── Mobile drawer ──────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <aside
            className="w-60 flex flex-col overflow-hidden bg-white shadow-sm"
            style={{ paddingTop: "52px", borderRight: "1px solid #e2e5f1" }}
          >
            {expandedNav}
          </aside>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
