"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Search, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON_MAP, DEFAULT_ICON } from "./role-sidebar";
import type { NavItemConfig } from "@/lib/permissions";

// Lifted out of mobile-shell.tsx (Stage 1/4, 2026-07-19) so the Menu/You
// sheets + sign-out confirm can be triggered from anywhere in the tree, not
// just the bottom bar's own buttons — e.g. a future module-native header
// (Picking) that wants "Menu"/"You" affordances without re-mounting a second
// copy of this markup. Markup, classes, z-index, and behaviour are carried
// over byte-for-byte from the pre-refactor mobile-shell.tsx; only the state
// ownership moved.

export type SheetKind = "menu" | "you" | null;

export interface MobileShellContextValue {
  sheet:       SheetKind;
  confirmOpen: boolean;
  filter:      string;
  setFilter:   (value: string) => void;
  openMenu:           () => void;
  openYou:            () => void;
  openSignoutConfirm: () => void;
  closeAll:           () => void;
}

const MobileShellContext = createContext<MobileShellContextValue | null>(null);

export function useMobileShell(): MobileShellContextValue {
  const ctx = useContext(MobileShellContext);
  if (!ctx) {
    throw new Error("useMobileShell must be used within a MobileShellProvider");
  }
  return ctx;
}

function formatRoleLabel(role: string): string {
  return role
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface MobileShellProviderProps {
  role:         string;
  navItems:     NavItemConfig[];
  userName:     string;
  userInitials: string;
  children:     React.ReactNode;
}

export function MobileShellProvider({
  role, navItems, userName, userInitials, children,
}: MobileShellProviderProps) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [filter, setFilter] = useState("");

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
    <MobileShellContext.Provider
      value={{ sheet, confirmOpen, filter, setFilter, openMenu, openYou, openSignoutConfirm, closeAll }}
    >
      {children}

      <div className="block md:hidden">
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
    </MobileShellContext.Provider>
  );
}
