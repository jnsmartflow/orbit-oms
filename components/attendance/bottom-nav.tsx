"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CalendarDays } from "lucide-react";

interface NavTab {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  matches: (pathname: string) => boolean;
}

// Q5: Profile tab hidden in v1. Two-tab grid keeps the door open
// to add Profile later without restructuring callers.
const TABS: NavTab[] = [
  {
    href: "/attendance",
    label: "Today",
    Icon: Home,
    // Today stays active during the check-in / check-out flows since
    // those screens are part of the daily action, not separate sections.
    matches: (p) =>
      p === "/attendance" ||
      p === "/attendance/check-in" ||
      p === "/attendance/check-out",
  },
  {
    href: "/attendance/history",
    label: "History",
    Icon: CalendarDays,
    matches: (p) => p.startsWith("/attendance/history"),
  },
];

export function BottomNav() {
  const pathname = usePathname() ?? "/attendance";

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-[480px] mx-auto h-20 grid grid-cols-2">
        {TABS.map(({ href, label, Icon, matches }) => {
          const active = matches(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-1 transition-colors ${
                active ? "text-teal-600" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
