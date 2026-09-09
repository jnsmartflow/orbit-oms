"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  ClipboardList, Layers, User, Zap, Upload,
  Truck, Warehouse, Users, Package, MapPin, FileText, Palette, BarChart2, LayoutDashboard, Mail,
  FlaskConical, Route, PackageCheck, Container, Undo2, LayoutGrid,
} from "lucide-react";
import { useRoleSidebar } from "./role-sidebar-provider";
import type { NavItemConfig } from "@/lib/permissions";
import { OrbitWordmark } from "./orbit-wordmark";

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
  | "ops_admin"
  | "billing_operator"
  | "operation_manager";

export interface RoleSidebarProps {
  role:         RoleSidebarRole;
  userName:     string;
  userInitials: string;
  navItems:     NavItemConfig[];
}

// ── Icon map ──────────────────────────────────────────────────────────────────

export const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  operations_tinting:       Layers,
  operations_tint_operator: Zap,
  picking:             PackageCheck,
  // Floor Control (added 2026-09-06 for the admin app switcher). `floor` had NO
  // entry here and fell through to DEFAULT_ICON — the generic `User` glyph — in
  // this sidebar and in the mobile Menu sheet, wherever somebody holds the
  // `floor` tick. Adding a key cannot change what any other row renders: all
  // three read sites are `ICON_MAP[item.pageKey] ?? DEFAULT_ICON`, so this only
  // replaces a fallback. LayoutGrid is the board metaphor — Floor Control is a
  // rail + panes desk screen — and collides with nothing already in this map.
  floor:               LayoutGrid,
  import_obd:          Upload,
  tint_manager:        Layers,
  tint_operator:       Zap,
  customers:           Users,
  skus:                Package,
  routes_areas:        MapPin,
  vehicles:            Truck,
  trip_report:         Route,
  delivery_challans:   FileText,
  sampling_library:    FlaskConical,
  shade_master:        Palette,
  ti_report:           BarChart2,
  mail_orders:         Mail,
  // MRN (2026-08-20). `Container` reads as inbound freight while staying in
  // the truck family. ⚠ `Truck` itself is NOT available — it is already the
  // `vehicles` icon, and an admin sees both entries in the same sidebar and
  // the same Menu sheet, so reusing it would make two rows indistinguishable.
  mrn:                 Container,
  // CI — Goods Return Note (2026-09-01). `Undo2` is the RETURN arrow: CI is
  // MRN running backwards, stock going out and coming back.
  // ⚠ NOT `Container` — that is MRN's, and the two modules are adjacent in the
  // sidebar and in the Menu sheet, so a shared icon would make the two rows
  // indistinguishable at a glance. Same rule that kept `Truck` off MRN because
  // `vehicles` already had it.
  ci:                  Undo2,
};

export const DEFAULT_ICON = User;

const ROLE_LABELS: Record<RoleSidebarRole, string> = {
  support:        "Support Team",
  tint_manager:   "Tint Manager",
  tint_operator:  "Tint Operator",
  import:         "Import",
  support_import: "Support Team",
  planning:       "Planning Board",
  warehouse:      "Warehouse",
  operations:     "Operations",
  ops_admin:      "Operations Admin",
  billing_operator: "Billing Operator",
  operation_manager: "Operation Manager",
};

// ── Desktop-only nav suppression ──────────────────────────────────────────────

// Page keys hidden from the DESKTOP sidebar ONLY. This is a render-layer
// filter, NOT a permission change: the page stays granted, reachable and
// unchanged in role_permissions.
//
// The phone Menu sheet (mobile-shell-context.tsx:96) and the bottom bar's Home
// target (mobile-shell.tsx:61) read the SAME navItems array from
// role-layout-client.tsx and are deliberately untouched — Home resolves to
// navItems[0], which IS Picking for floor_supervisor and picker, so this list
// must never be applied to the shared array.
//
// picking — the desktop face of /picking was retired 2026-07-28
// (archive/2026-07-picking-desktop/). The board is phone-only; the floor team
// works on Android. A desk operator who needs a board uses /floor. /picking is
// still the login landing for floor_supervisor and picker (lib/rbac.ts:38-39).
const DESKTOP_HIDDEN_PAGE_KEYS = new Set(["picking"]);

// ── Component ─────────────────────────────────────────────────────────────────

export function RoleSidebar({ role, userName, userInitials, navItems }: RoleSidebarProps) {
  const pathname              = usePathname();
  const { isExpanded, expand, collapse } = useRoleSidebar();

  const roleLabel = ROLE_LABELS[role];

  // Applied here and nowhere else — see DESKTOP_HIDDEN_PAGE_KEYS above.
  const visibleNavItems = navItems.filter((item) => !DESKTOP_HIDDEN_PAGE_KEYS.has(item.pageKey));

  function isActive(href: string) {
    return pathname === href;
  }

  // ── Expanded nav ────────────────────────────────────────────────────────────

  const expandedNav = (
    <nav className="flex flex-col py-2 overflow-y-auto flex-1 scrollbar-hide">
      <div className="flex flex-col">
        {visibleNavItems.map((item) => {
          const Icon   = ICON_MAP[item.pageKey] ?? DEFAULT_ICON;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
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
    </nav>
  );

  // ── Collapsed nav (icons + tooltips) ────────────────────────────────────────

  const collapsedNav = (
    <nav className="flex flex-col py-2 overflow-y-auto flex-1 scrollbar-hide items-center">
      {visibleNavItems.map((item) => {
        const Icon   = ICON_MAP[item.pageKey] ?? DEFAULT_ICON;
        const active = isActive(item.href);
        return (
          <div key={item.href} className="relative group w-full flex justify-center mb-0.5">
            <Link
              href={item.href}
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
    </nav>
  );

  return (
    <aside
      onMouseEnter={expand}
      onMouseLeave={collapse}
      className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-50 flex-col bg-white transition-all duration-200"
      style={{
        width:       isExpanded ? "220px" : "72px",
        borderLeft:  "3px solid #7C3AED",
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
        {/* The wordmark IS the logo — there is no symbol and, on the desk rail,
            no tile either. A violet tile here would be a second brand object beside
            the active-nav bar; the word on white carries it alone. 14px collapsed
            fits the 72px rail (42px wide + 15px either side), so the rail does NOT
            widen. */}
        <OrbitWordmark
          height={isExpanded ? 19 : 14}
          className="text-brand-800 flex-shrink-0"
        />
        {/* NOTHING SITS BESIDE THE WORDMARK. Not the name — the wordmark is the
            name — and not the role either. `roleLabel` still renders at :245, under
            the user's own name in the block at the foot of the rail, which is where
            "who you are" belongs; printing it twice made the brand row answer a
            question the user block already answers. */}
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
          className="w-8 h-8 rounded-full bg-ink-50 text-ink-600 border border-ink-100 flex items-center justify-center text-[11px] font-bold flex-shrink-0 hover:bg-ink-100 transition-colors"
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
              className="text-[10px] text-ink-500 hover:text-ink-700 font-medium mt-0.5 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
