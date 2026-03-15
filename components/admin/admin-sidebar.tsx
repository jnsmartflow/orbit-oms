"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Menu, X,
  LayoutDashboard, Settings, Users, Shield,
  Truck, Clock, CalendarClock, Map, MapPin, Pin,
  Tag, Layers, Palette, Package,
  Building2, Car,
  Briefcase, UserCheck, ContactRound, Store,
  Upload, ClipboardList, Paintbrush,
} from "lucide-react";
import { useSidebar } from "./sidebar-provider";

// ── Navigation structure ─────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href:  string;
  roles?: string[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "System",
    items: [
      { label: "Dashboard",     href: "/admin" },
      { label: "System Config", href: "/admin/system-config" },
      { label: "Users",         href: "/admin/users" },
      { label: "Roles",         href: "/admin/roles" },
    ],
  },
  {
    label: "Slots & Delivery",
    items: [
      { label: "Delivery Types", href: "/admin/delivery-types" },
      { label: "Slot Master",    href: "/admin/slots" },
      { label: "Slot Rules",     href: "/admin/slot-rules" },
      { label: "Routes",         href: "/admin/routes" },
      { label: "Areas",          href: "/admin/areas" },
      { label: "Sub-areas",      href: "/admin/sub-areas" },
    ],
  },
  {
    label: "Products",
    items: [
      { label: "Product Categories", href: "/admin/product-categories" },
      { label: "Product Names",      href: "/admin/product-names" },
      { label: "Base Colours",       href: "/admin/base-colours" },
      { label: "SKUs",               href: "/admin/skus" },
    ],
  },
  {
    label: "Fleet",
    items: [
      { label: "Transporters", href: "/admin/transporters" },
      { label: "Vehicles",     href: "/admin/vehicles" },
    ],
  },
  {
    label: "People & Customers",
    items: [
      { label: "Sales Officers", href: "/admin/sales-officers" },
      { label: "SO Groups",      href: "/admin/so-groups" },
      { label: "Contact Roles",  href: "/admin/contact-roles" },
      { label: "Customers",      href: "/admin/customers" },
    ],
  },
  // ── Phase 2 Operations ──────────────────────────────────────────────────────
  {
    label: "Operations",
    items: [
      {
        label: "Import Orders",
        href:  "/admin/import",
        roles: ["admin"],
      },
      {
        label: "Support Queue",
        href:  "/admin/support",
        roles: ["admin"],
      },
      {
        label: "Tint Manager",
        href:  "/admin/tint-manager",
        roles: ["admin"],
      },
    ],
  },
];

// ── Icon map ─────────────────────────────────────────────────────────────────

type NavIcon = React.ComponentType<{ className?: string }>;

const ICONS: Record<string, NavIcon> = {
  "Dashboard":           LayoutDashboard,
  "System Config":       Settings,
  "Users":               Users,
  "Roles":               Shield,
  "Delivery Types":      Truck,
  "Slot Master":         Clock,
  "Slot Rules":          CalendarClock,
  "Routes":              Map,
  "Areas":               MapPin,
  "Sub-areas":           Pin,
  "Product Categories":  Tag,
  "Product Names":       Layers,
  "Base Colours":        Palette,
  "SKUs":                Package,
  "Transporters":        Building2,
  "Vehicles":            Car,
  "SO Groups":           Briefcase,
  "Sales Officers":      UserCheck,
  "Contact Roles":       ContactRound,
  "Customers":           Store,
  // Phase 2
  "Import Orders":       Upload,
  "Support Queue":       ClipboardList,
  "Tint Manager":        Palette,
  "My Tint Jobs":        Paintbrush,
};

// ── Types ────────────────────────────────────────────────────────────────────

interface AdminSidebarProps {
  userName: string;
  userRole: string;
}

// ── Component ────────────────────────────────────────────────────────────────

// ── Phase 2 section label — shown as a divider ──────────────────────────────
const PHASE2_SECTION = "Operations";

export function AdminSidebar({ userName: _userName, userRole }: AdminSidebarProps) {
  const pathname             = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isCollapsed, toggle }     = useSidebar();

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(href + "/");
  }

  function visibleItems(items: NavItem[]) {
    return items.filter((item) => !item.roles || item.roles.includes(userRole));
  }

  // ── Expanded nav ───────────────────────────────────────────────────────────

  const expandedNav = (
    <nav className="flex flex-col py-3 overflow-y-auto flex-1 scrollbar-hide">
      {NAV_SECTIONS.map((section, si) => {
        const items = visibleItems(section.items);
        if (items.length === 0) return null;
        const isPhase2 = section.label === PHASE2_SECTION;
        return (
          <div key={section.label} className={si > 0 ? "mt-2" : ""}>
            {isPhase2 && (
              <div className="mx-4 mt-3 mb-1 border-t border-[#e5e7eb]" />
            )}
            <p
              className="px-4 pt-3 pb-1 select-none uppercase font-semibold"
              style={{ fontSize: "10px", color: "var(--muted)", letterSpacing: "0.5px" }}
            >
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
                    <Icon className="h-4 w-4 shrink-0" />
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

  // ── Collapsed nav (icons only + tooltips) ─────────────────────────────────

  const collapsedNav = (
    <nav className="flex flex-col py-3 overflow-y-auto flex-1 scrollbar-hide">
      {NAV_SECTIONS.map((section, si) => {
        const items = visibleItems(section.items);
        if (items.length === 0) return null;
        const isPhase2 = section.label === PHASE2_SECTION;
        return (
          <div key={section.label} className={si > 0 ? "mt-3" : ""}>
            {/* Section divider in place of label */}
            {si > 0 && (
              <div className="mx-3 mb-1 border-t border-[#e5e7eb]" />
            )}
            <div className="flex flex-col items-center gap-0.5">
              {items.map((item) => {
                const Icon   = ICONS[item.label] ?? LayoutDashboard;
                const active = isActive(item.href);
                return (
                  <div key={item.href} className="relative group w-full flex justify-center">
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center justify-center h-9 w-9 rounded-md transition-colors",
                        active ? "bg-[#eef2ff]" : "hover:bg-[#f7f8fa]"
                      )}
                      style={{ color: active ? "var(--navy)" : "var(--text-2)" }}
                      title={item.label}
                    >
                      <Icon className="h-5 w-5" />
                    </Link>
                    {/* Tooltip */}
                    <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-[200] hidden group-hover:block">
                      <div className="bg-[#1a237e] text-white text-xs px-2 py-1 rounded-md whitespace-nowrap shadow-lg">
                        {item.label}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* ── Desktop sidebar — fixed left ──────────────────────────────────── */}
      <aside
        className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-50 flex-col transition-all duration-200"
        style={{
          width:       isCollapsed ? "72px" : "240px",
          background:  "var(--white)",
          borderRight: "1px solid var(--border)",
        }}
      >
        {/* Brand — "O" button toggles sidebar */}
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
              <span className="text-white font-semibold text-sm tracking-tight whitespace-nowrap">Orbit OMS</span>
            </div>
          )}
        </div>

        {isCollapsed ? collapsedNav : expandedNav}
      </aside>

      {/* ── Mobile top bar ────────────────────────────────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 z-50 flex items-center gap-3 px-4 w-full"
        style={{ height: "48px", background: "var(--navy)", borderBottom: "1px solid var(--navy-mid)" }}
      >
        <button
          className="flex items-center justify-center w-8 h-8 rounded"
          style={{ background: "rgba(255,255,255,0.1)", color: "white" }}
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
        <span className="text-white font-bold text-sm tracking-tight">Orbit OMS</span>
      </div>

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <aside
            className="w-60 flex flex-col overflow-y-auto"
            style={{
              background:  "var(--white)",
              paddingTop:  "48px",
              borderRight: "1px solid var(--border)",
            }}
          >
            {expandedNav}
          </aside>
          <div
            className="flex-1 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}
    </>
  );
}
