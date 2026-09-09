"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Menu, X,
  LayoutDashboard, Settings2, Users, ShieldCheck, Shield,
  Truck, Clock, CalendarClock, Map, MapPin, Layers,
  Tag, Palette, Package,
  Building2, UserCheck, ContactRound, Store,
  Upload, ClipboardCheck, CalendarCheck, Paintbrush, Briefcase,
  EyeOff, Trash2, Grid3x3, ChevronRight,
} from "lucide-react";
import { useSidebar } from "./sidebar-provider";
// ICON_MAP is keyed by PAGE KEY and is the shared map the operational sidebar
// and the mobile Menu sheet already read. The switcher uses it rather than the
// label-keyed ICONS below, so the app does not grow a FOURTH icon map.
import { ICON_MAP, DEFAULT_ICON } from "@/components/shared/role-sidebar";
import type { NavItemConfig, PagePermissions } from "@/lib/permissions";
import { OrbitWordmark } from "@/components/shared/orbit-wordmark";

// ── Navigation structure ─────────────────────────────────────────────────────

interface NavItem {
  label:    string;
  href:     string;
  pageKey?: string;   // if set: show to admin OR if allPerms[pageKey]?.canView; if absent: admin-only
  icon?:    React.ComponentType<{ className?: string }>; // optional override; falls back to ICONS[label]
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// 🔴 REBUILT 2026-09-06 — 20 items in 5 groups, from 28 in 6.
// Design: docs/mockups/admin/admin-redesign_2.html Screen 1, agreed 2026-08-28
// (docs/prompts/drafts/web-update-2026-08-28-admin-redesign.md §3). The rule the
// grouping follows: ADMIN IS FOR USER CREATION, MASTER DATA, WHO-SEES-WHAT AND
// SETTINGS. Operational boards do not belong here.
//
// 🔴 NOTHING WAS DELETED. Eight items left THIS ARRAY and nothing else — no
// page.tsx, no route.ts, no API handler, no permission row, no page key. Every
// one of the eight screens is still live and still reachable by typing its
// address; the build route table was checked after the edit. Retirement is a
// separate job with its own gate (archive/RETIREMENT-PLAYBOOK.md) and is NOT
// what this was.
//
//   Permissions          /admin/permissions   ⚠ URL-only now, and it is the
//                        ACCESS_SOURCE='role' ROLLBACK EDITOR — the only UI
//                        that writes role_permissions (CLAUDE_CORE.md §5/§13).
//                        Its requireSuperuser gate is untouched. Do not
//                        "finish the job" by deleting it.
//   SKUs                 /admin/skus          ⚠ carried pageKey 'skus'. The KEY
//                        is untouched and still gates the screen and its API.
//   Product Categories   /admin/product-categories  ┐ the dead sku_master
//   Product Names        /admin/product-names       ├ family (CORE §7.1.c);
//   Base Colours         /admin/base-colours        ┘ they retire with it.
//   Import Orders        /admin/import        ┐ operational. Canonical
//   Tint Manager         /admin/tint-manager  ├ addresses are /import,
//   Shade Master         /tint/shades         ┘ /tint/manager, /tint/shades.
//
// ⚠ An admin now has NO LINK OUT of the admin frame. The app switcher that
// closes that gap is step 6 and is deliberately not built here.
//
// Arithmetic, checked against the brief: 28 − 8 removed + 1 added
// (Removed Orders) − 1 moved to the footer (My Attendance) = 20.
const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin" },
    ],
  },
  {
    label: "People & Access",
    items: [
      { label: "Users",       href: "/admin/users" },
      // Per-user page access (2026-09-04, step 3 of the role→user conversion).
      // Keyless by construction: visibleItems() shows it to a superuser alone —
      // the same gate every other keyless item here uses.
      { label: "Access",      href: "/admin/access", icon: ShieldCheck },
      // Relabelled from "Roles" 2026-09-06. SAME href, same read-only
      // role_master screen. ⚠ ICONS is keyed on the LABEL, so the map key was
      // renamed in the same edit — see the note above ICONS.
      { label: "Job Titles",  href: "/admin/roles" },
      // CalendarCheck distinguishes the admin all-users view from the personal
      // "My Attendance" footer link (which uses ClipboardCheck).
      { label: "Attendance",  href: "/admin/attendance", icon: CalendarCheck },
    ],
  },
  {
    label: "Customers",
    items: [
      { label: "Customers",      href: "/admin/customers",      pageKey: "customers" },
      { label: "Sales Officers", href: "/admin/sales-officers" },
      { label: "SO Groups",      href: "/admin/so-groups" },
      { label: "Contact Roles",  href: "/admin/contact-roles" },
    ],
  },
  {
    label: "Depot Master",
    items: [
      { label: "Routes",         href: "/admin/routes",    pageKey: "routes_areas" },
      { label: "Areas",          href: "/admin/areas",     pageKey: "routes_areas" },
      { label: "Sub-areas",      href: "/admin/sub-areas" },
      { label: "Delivery Types", href: "/admin/delivery-types" },
      { label: "Slot Master",    href: "/admin/slots" },
      { label: "Slot Rules",     href: "/admin/slot-rules" },
      { label: "Transporters",   href: "/admin/transporters" },
      { label: "Vehicles",       href: "/admin/vehicles",  pageKey: "vehicles" },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "System Config",  href: "/admin/system-config" },
      // pageKey "settings_hide" → a superuser sees it (ALL_TRUE), gated for
      // everyone else.
      { label: "Hide",           href: "/admin/settings/hide", pageKey: "settings_hide" },
      // NEW TO THE MENU 2026-09-06. The page has been live since v27.x and
      // NOTHING linked to it — its own comment said "Direct URL only". 47 live
      // removed orders at the time of the edit.
      { label: "Removed Orders", href: "/admin/removed-orders" },
    ],
  },
];

// ── Footer link ──────────────────────────────────────────────────────────────
//
// My Attendance is the one row here that is NOT admin surface — it is the
// admin's own attendance page. It left the old "Personal" group 2026-09-06 so
// that all five groups are admin subject matter, and it renders BELOW the
// name/avatar block instead. It is NOT in NAV_SECTIONS and must not be added
// back to it — one row, one place.
//
// It is still gated exactly as it was: keyless, so superuser-only, applied by
// hand below because it does not pass through visibleItems().
const FOOTER_LINK: NavItem = {
  label: "My Attendance",
  href:  "/attendance",
  icon:  ClipboardCheck,
};

// ── Icon map ─────────────────────────────────────────────────────────────────

type NavIcon = React.ComponentType<{ className?: string }>;

// 🔴 THIS MAP IS KEYED ON THE LABEL STRING, NOT THE PAGE KEY.
// So RELABELLING AN ITEM SILENTLY ORPHANS ITS ICON — the lookup at the two
// render sites is `item.icon ?? ICONS[item.label] ?? LayoutDashboard`, and the
// third arm is a generic fallback that looks deliberate on screen. Rename the
// key in the SAME edit as the label, or add an explicit `icon:` on the item.
//
// 2026-09-06: "Roles" → "Job Titles" was renamed here for exactly that reason.
// Its glyph also changed, ShieldCheck → Tag, because "Access" directly above it
// carries an explicit ShieldCheck and two identical glyphs one row apart are
// indistinguishable in the collapsed rail — the same rule role-sidebar.tsx
// applies to MRN vs CI. Tag is apt on its own terms: CORE §5 calls a job title
// "a LABEL and a starting template", and Tag was freed when Product Categories
// left the menu.
//
// The eight items that left the menu KEPT their entries below. They are inert —
// nothing renders them — and they are cheap to leave, so step 6 can put any of
// them back without re-deriving a glyph.
const ICONS: Record<string, NavIcon> = {
  "Dashboard":           LayoutDashboard,
  "System Config":       Settings2,
  "Users":               Users,
  "Permissions":         Shield,          // orphaned 2026-09-06 (left the menu)
  "Job Titles":          Tag,             // was "Roles": ShieldCheck — see above
  "Removed Orders":      Trash2,          // new to the menu 2026-09-06
  "Delivery Types":      Truck,
  "Slot Master":         Clock,
  "Slot Rules":          CalendarClock,
  "Routes":              MapPin,
  "Areas":               Map,
  "Sub-areas":           Layers,
  "Product Categories":  Tag,             // orphaned 2026-09-06 (left the menu)
  "Product Names":       Layers,          // orphaned 2026-09-06 (left the menu)
  "Base Colours":        Palette,         // orphaned 2026-09-06 (left the menu)
  "SKUs":                Package,         // orphaned 2026-09-06 (left the menu)
  "Transporters":        Building2,
  "Vehicles":            Truck,
  "SO Groups":           Briefcase,
  "Sales Officers":      UserCheck,
  "Contact Roles":       ContactRound,
  "Customers":           Store,
  "Import Orders":       Upload,          // orphaned 2026-09-06 (left the menu)
  "Tint Manager":        Palette,         // orphaned 2026-09-06 (left the menu)
  "Shade Master":        Palette,         // orphaned 2026-09-06 (left the menu)
  "My Tint Jobs":        Paintbrush,      // orphaned long before this — no such item
  // The admin Attendance row carries an explicit CalendarCheck and the footer
  // link carries an explicit ClipboardCheck, so this entry is consulted by
  // neither. Kept for the same reason as the eight above.
  "Attendance":          ClipboardCheck,
  "Hide":                EyeOff,
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
  /**
   * Resolved by `isSuperuser(session)` in the SERVER layout that mounts this
   * component — `lib/rbac.ts`, the same helper `requireSuperuser` calls. Passed
   * as a prop rather than read here: this is a client component with no
   * session, and a prop keeps it pure with nothing to go stale.
   */
  isSuperuser: boolean;
  allPerms: Record<string, PagePermissions>;
  /**
   * The nine app-switcher destinations, resolved from PAGE_NAV_MAP in the
   * server layout (lib/admin/app-switcher.ts). Labels and hrefs come from the
   * map so the app calls a place one name everywhere; the list is curated by
   * page key and is deliberately NOT permission-filtered.
   */
  switcherItems: NavItemConfig[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminSidebar({ userName, userRole, isSuperuser, allPerms, switcherItems }: AdminSidebarProps) {
  const pathname                    = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef                 = useRef<HTMLDivElement | null>(null);
  const { isCollapsed, toggle }     = useSidebar();

  // Close the switcher on an outside click or Escape. Bound only while it is
  // open, so the sidebar adds no global listeners in its resting state.
  useEffect(() => {
    if (!switcherOpen) return;
    function onDown(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSwitcherOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [switcherOpen]);

  // Any navigation closes it — the popover outlives the click that follows a
  // link, because the sidebar itself does not unmount on a route change.
  useEffect(() => { setSwitcherOpen(false); }, [pathname]);

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(href + "/");
  }

  // THE MENU NOW ASKS THE SAME QUESTION AS THE DOOR (2026-09-06).
  // Both tests below used to read `userRole === "admin"` — the SINGULAR primary
  // job title — while the door that admits anyone to /admin has asked
  // `requireSuperuser(session)` since 2026-09-04. Two different questions about
  // the same person: a superuser who did not ALSO hold `admin` as their primary
  // role passed the door and then saw 6 of 28 items, because the 22 keyless
  // ones hung off a check the door no longer makes.
  //
  // `isSuperuser` here is the prop, resolved by `isSuperuser(session)` in the
  // server layout — `lib/rbac.ts`, the exact function `requireSuperuser` wraps
  // (flag OR the MERGED role set, never the primary alone). Same function, same
  // session, so the set of people this menu admits now equals the set the door
  // admits, by construction rather than by coincidence.
  //
  // The `||` branch is UNCHANGED — a keyed item is still shown to anyone
  // holding that page's canView tick, superuser or not.
  function visibleItems(items: NavItem[]) {
    return items.filter((item) => {
      if (item.pageKey) {
        return isSuperuser || allPerms[item.pageKey]?.canView === true;
      }
      return isSuperuser;
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
                const Icon   = item.icon ?? ICONS[item.label] ?? LayoutDashboard;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 mx-2 my-[1px] py-2 rounded-lg text-[12.5px] transition-colors",
                      active
                        ? "bg-brand-50 text-brand-700 font-semibold pl-[10px] border-l-2 border-brand-600"
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
            {si > 0 && <div className="w-8 border-t border-gray-200 my-2" />}
            {items.map((item) => {
              const Icon   = item.icon ?? ICONS[item.label] ?? LayoutDashboard;
              const active = isActive(item.href);
              return (
                <div key={item.href} className="relative group w-full flex justify-center mb-0.5">
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center justify-center h-9 w-9 rounded-lg transition-colors",
                      active
                        ? "bg-brand-50 text-brand-600"
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
          </div>
        );
      })}
    </nav>
  );

  // ── Footer link (My Attendance) ─────────────────────────────────────────────
  //
  // Rendered BELOW the name/avatar block, outside NAV_SECTIONS. Same two faces
  // as the nav above it — full row when expanded, icon + tooltip when collapsed
  // — so it does not read as a different kind of control.
  //
  // Gated by hand on `isSuperuser`, which is exactly what visibleItems() would
  // do with it: it is keyless, and it was keyless in the old "Personal" group
  // too, so who sees it has not changed.
  const footerNav = (collapsed: boolean) => {
    if (!isSuperuser) return null;
    const Icon   = FOOTER_LINK.icon ?? ICONS[FOOTER_LINK.label] ?? LayoutDashboard;
    const active = isActive(FOOTER_LINK.href);
    if (collapsed) {
      return (
        <div className="shrink-0 border-t border-gray-200 flex justify-center py-2">
          <div className="relative group flex justify-center">
            <Link
              href={FOOTER_LINK.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center justify-center h-9 w-9 rounded-lg transition-colors",
                active
                  ? "bg-brand-50 text-brand-600"
                  : "text-gray-400 hover:bg-gray-50 hover:text-gray-700"
              )}
              title={FOOTER_LINK.label}
            >
              <Icon className="h-[17px] w-[17px]" />
            </Link>
            {/* Tooltip */}
            <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-[200] hidden group-hover:block">
              <div className="bg-gray-900 text-white text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap shadow-lg">
                {FOOTER_LINK.label}
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="shrink-0 border-t border-gray-200 py-1.5">
        <Link
          href={FOOTER_LINK.href}
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-2.5 mx-2 my-[1px] py-2 rounded-lg text-[12.5px] transition-colors",
            active
              ? "bg-brand-50 text-brand-700 font-semibold pl-[10px] border-l-2 border-brand-600"
              : "font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 pl-3"
          )}
        >
          <Icon className="h-[15px] w-[15px] shrink-0" />
          {FOOTER_LINK.label}
        </Link>
      </div>
    );
  };

  // ── App switcher ────────────────────────────────────────────────────────────
  //
  // The way OUT of the admin frame. Before 0fc145bb the operational items sat in
  // the menu itself; once they left, an admin had nothing but the browser back
  // button. Nine curated destinations — see lib/admin/app-switcher.ts for the
  // list and for why it is NOT permission-filtered.
  //
  // Opens UPWARD, because it sits at the very bottom of the sidebar. Collapsed,
  // it becomes a single icon button and the panel opens to the RIGHT of the
  // rail, matching how the collapsed nav's tooltips already behave.
  const appSwitcher = (collapsed: boolean) => {
    if (!isSuperuser || switcherItems.length === 0) return null;
    return (
      <div ref={switcherRef} className="shrink-0 relative border-t border-gray-200 py-2">
        <button
          type="button"
          onClick={() => setSwitcherOpen((o) => !o)}
          aria-expanded={switcherOpen}
          aria-haspopup="menu"
          title={collapsed ? "Open Orbit" : undefined}
          className={cn(
            "flex items-center rounded-lg border transition-colors",
            collapsed
              ? "mx-auto h-9 w-9 justify-center"
              : "mx-3 gap-2 px-2.5 py-2 w-[calc(100%-24px)] text-[12px] font-semibold",
            switcherOpen
              ? "bg-gray-50 border-gray-300 text-gray-900"
              : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
          )}
        >
          <Grid3x3 className={cn("shrink-0 text-brand-600", collapsed ? "h-[17px] w-[17px]" : "h-[15px] w-[15px]")} />
          {!collapsed && (
            <>
              Open Orbit
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-gray-400 shrink-0" />
            </>
          )}
        </button>

        {switcherOpen && (
          <div
            role="menu"
            className={cn(
              "absolute z-[220] rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden",
              // Upward in both faces. Expanded: aligned to the rail. Collapsed:
              // pushed clear of the 72px rail so it does not sit under it.
              collapsed
                ? "bottom-2 left-full ml-2 w-52"
                : "bottom-full mb-1 left-3 right-3"
            )}
          >
            {switcherItems.map((item) => {
              // Keyed by PAGE KEY against the shared map — not by label.
              const Icon = ICON_MAP[item.pageKey] ?? DEFAULT_ICON;
              return (
                <Link
                  key={item.pageKey}
                  href={item.href}
                  role="menuitem"
                  onClick={() => { setSwitcherOpen(false); setMobileOpen(false); }}
                  className="flex items-center gap-2.5 px-3 py-[7px] text-[12px] text-gray-600 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  <Icon className="h-[14px] w-[14px] shrink-0 text-gray-400" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Shared sidebar shell ────────────────────────────────────────────────────

  const sidebarContent = (collapsed: boolean) => (
    <>
      {/* Brand / logo block */}
      <div
        className={cn(
          "flex items-center shrink-0 border-b border-gray-200",
          collapsed ? "justify-center px-0 h-[52px]" : "gap-2.5 px-4 h-[52px]"
        )}
      >
        {/* Wordmark only on the desk rail (no tile) — and it is STILL the collapse
            toggle, so it keeps the button, the title and the hover. */}
        <button
          onClick={toggle}
          className="flex items-center justify-center cursor-pointer flex-shrink-0 text-brand-800 hover:text-brand-600 transition-colors"
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          <OrbitWordmark height={collapsed ? 14 : 19} />
        </button>
        {/* Nothing beside the wordmark here either. "Admin Panel" was a caption on
            a mark that is already the name; the nav below and the app switcher at
            the foot both say which app you are in, and the user block prints
            `userRole`. */}
      </div>

      {collapsed ? collapsedNav : expandedNav}

      {/* User block at bottom */}
      <div
        className={cn(
          "shrink-0 border-t border-gray-200",
          collapsed ? "flex justify-center py-3" : "flex items-center gap-2.5 px-4 py-3"
        )}
      >
        <div className="w-8 h-8 rounded-full bg-ink-900 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
          {getInitials(userName)}
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-gray-800 truncate">{userName}</p>
            <p className="text-[10px] text-gray-400 truncate">{userRole}</p>
          </div>
        )}
      </div>

      {/* Footer link, then the way out — per the Screen 1 design */}
      {footerNav(collapsed)}
      {appSwitcher(collapsed)}
    </>
  );

  return (
    <>
      {/* ── Desktop sidebar — fixed left ───────────────────────────────────── */}
      <aside
        className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-50 flex-col bg-white shadow-sm transition-all duration-200"
        style={{
          width:       isCollapsed ? "72px" : "240px",
          borderLeft:  "3px solid #7C3AED",
          borderRight: "1px solid #e5e7eb",
        }}
      >
        {sidebarContent(isCollapsed)}
      </aside>

      {/* ── Mobile top bar ─────────────────────────────────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 z-50 flex items-center gap-3 px-4 w-full h-[52px] bg-white border-b border-gray-200 shadow-sm"
        style={{ borderLeft: "3px solid #7C3AED" }}
      >
        <button
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-600"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
            <OrbitWordmark height={11} className="text-white" />
          </span>
        </div>
      </div>

      {/* ── Mobile drawer ──────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <aside
            className="w-60 flex flex-col overflow-hidden bg-white shadow-sm"
            style={{ paddingTop: "52px", borderLeft: "3px solid #7C3AED", borderRight: "1px solid #e5e7eb" }}
          >
            {expandedNav}
            {/* ⚠ The drawer renders expandedNav ONLY — it has no identity block.
                My Attendance used to reach a phone through NAV_SECTIONS; since
                it moved to the footer 2026-09-06 it has to be rendered here by
                hand, or the drawer would silently lose the row. The switcher is
                here for the same reason, and a phone needs the way out more
                than a desktop does. ⚠ The aside is overflow-hidden, so the
                upward popover is clipped if it is ever taller than the drawer;
                nine rows at ~29px fit inside any phone viewport today. */}
            {footerNav(false)}
            {appSwitcher(false)}
          </aside>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  );
}
