"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Home, LayoutGrid, User, Search, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON_MAP, DEFAULT_ICON } from "./role-sidebar";
import type { NavItemConfig } from "@/lib/permissions";

// Single source of truth for "how much space does the fixed bottom nav
// below actually take up" — every bottom-pinned sheet or CTA anywhere in
// the app MUST reserve at least this much, or it renders (partially)
// behind the nav. Missed three times before this constant existed
// (FilterBottomSheet, the Assign-to-picker sheet, both detail-screen
// CTAs) because the figure was hand-copied as a literal "76px" in each
// consumer instead of read from one place. 76px is an empirical figure
// for the <nav> below (icon h-6/w-6 + gap-1 + text-[11px] + py-2 padding,
// ~58px content, rounded up) — NOT computed from its classes, so if that
// JSX's sizing ever changes, this constant must be updated to match by
// hand. env(safe-area-inset-bottom) is added on top for the iOS home-
// indicator gesture bar, separate from the nav's own already-included
// safe-area padding below.
export const MOBILE_NAV_CLEARANCE = "calc(76px + env(safe-area-inset-bottom, 0px))";

interface MobileShellProps {
  role:         string;
  navItems:     NavItemConfig[];
  userName:     string;
  userInitials: string;
}

type SheetKind = "menu" | "you" | null;

function formatRoleLabel(role: string): string {
  return role
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function MobileShell({ role, navItems, userName, userInitials }: MobileShellProps) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const homeHref = navItems[0]?.href ?? "/";
  const isHomeActive = pathname === homeHref;
  const sheetOpen = sheet !== null || confirmOpen;

  function closeAll() {
    setSheet(null);
    setConfirmOpen(false);
  }

  function openMenu() {
    setFilter("");
    setSheet("menu");
  }

  function openYou() {
    setSheet("you");
  }

  function openSignoutConfirm() {
    setSheet(null);
    setConfirmOpen(true);
  }

  const filteredNavItems = navItems.filter((item) =>
    item.label.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <div className="block md:hidden">
      {/* Bottom tab bar — 3 fixed anchors, identical for every role */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex bg-white border-t border-gray-200"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Link
          href={homeHref}
          onClick={closeAll}
          className={cn(
            "flex-1 flex flex-col items-center gap-1 py-2 text-[11px] font-semibold",
            isHomeActive ? "text-teal-700" : "text-gray-400"
          )}
        >
          <Home className="h-6 w-6" />
          Home
        </Link>
        <button
          type="button"
          onClick={openMenu}
          className="flex-1 flex flex-col items-center gap-1 py-2 text-[11px] font-semibold text-gray-400"
        >
          <LayoutGrid className="h-6 w-6" />
          Menu
        </button>
        <button
          type="button"
          onClick={openYou}
          className="flex-1 flex flex-col items-center gap-1 py-2 text-[11px] font-semibold text-gray-400"
        >
          <User className="h-6 w-6" />
          You
        </button>
      </nav>

      {/* Scrim — closes whatever sheet/dialog is open */}
      <div
        onClick={closeAll}
        className={cn(
          "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200",
          sheetOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />

      {/* MENU sheet — every page the user can view */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-[60] flex max-h-[82%] flex-col rounded-t-[22px] bg-white transition-transform duration-200 ease-out",
          sheet === "menu" ? "translate-y-0" : "translate-y-full"
        )}
      >
        <div className="mx-auto mt-2 h-1 w-9 flex-shrink-0 rounded-full bg-gray-300" />
        <h2 className="flex-shrink-0 px-5 pt-2.5 pb-1.5 text-[12px] font-semibold uppercase tracking-wider text-gray-400">
          All pages
        </h2>
        <div className="mx-4 mb-1.5 flex flex-shrink-0 items-center gap-2 rounded-[11px] border border-gray-200 bg-[#f9fafb] px-3 py-2.5">
          <Search size={17} className="text-gray-400 shrink-0" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a page…"
            className="flex-1 bg-transparent border-none outline-none text-[16px] text-gray-900 placeholder:text-gray-400"
          />
        </div>
        <div className="overflow-y-auto px-3 pb-[calc(14px+env(safe-area-inset-bottom))] pt-0.5">
          {filteredNavItems.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-gray-400">No page found</p>
          ) : (
            filteredNavItems.map((item) => {
              const Icon = ICON_MAP[item.pageKey] ?? DEFAULT_ICON;
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeAll}
                  className={cn(
                    "flex items-center gap-3.5 rounded-[11px] border-l-2 px-3 py-3.5 text-[15px]",
                    active
                      ? "bg-teal-50 text-teal-700 font-semibold border-l-teal-600"
                      : "text-gray-700 border-l-transparent"
                  )}
                >
                  <Icon className={cn("h-[21px] w-[21px] shrink-0", active ? "text-teal-600" : "text-gray-400")} />
                  {item.label}
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* YOU sheet — identity + sign out */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-[22px] bg-white transition-transform duration-200 ease-out",
          sheet === "you" ? "translate-y-0" : "translate-y-full"
        )}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-gray-300" />
        <div className="flex items-center gap-3 px-5 pt-2.5 pb-3.5">
          <div className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-full bg-teal-600 text-[17px] font-bold text-white">
            {userInitials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-bold text-gray-900">{userName}</p>
            <p className="truncate text-[12px] text-gray-500 mt-0.5">{formatRoleLabel(role)}</p>
          </div>
        </div>
        <div className="mx-5 h-px bg-gray-100" />
        <div className="px-3 pt-1 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={openSignoutConfirm}
            className="flex w-full items-center gap-3.5 rounded-[11px] px-3 py-3.5 text-[15px] font-medium text-red-600"
          >
            <LogOut className="h-[21px] w-[21px]" />
            Sign out
          </button>
        </div>
      </div>

      {/* Sign-out confirm dialog */}
      <div
        className={cn(
          "fixed left-6 right-6 top-1/2 z-[70] -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl transition-all duration-150",
          confirmOpen ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"
        )}
      >
        <h3 className="mb-1.5 text-[17px] font-bold text-gray-900">Sign out?</h3>
        <p className="mb-4 text-[13px] leading-relaxed text-gray-500">
          You&apos;ll need to sign in again with your email or mobile number.
        </p>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={closeAll}
            className="flex-1 rounded-xl bg-gray-100 py-3 text-[14px] font-semibold text-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex-1 rounded-xl bg-red-600 py-3 text-[14px] font-semibold text-white"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
