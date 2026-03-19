"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, ChevronRight } from "lucide-react";

// ── Page name from pathname ───────────────────────────────────────────────────

function getPageName(pathname: string): string {
  if (pathname === "/admin") return "Dashboard";
  const segment = pathname.split("/").filter(Boolean).pop() ?? "";
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Live clock ────────────────────────────────────────────────────────────────

function LiveTime() {
  const [time, setTime] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  });

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    };
    // Align to next minute boundary
    const ms = (60 - new Date().getSeconds()) * 1000;
    const timeout = setTimeout(() => {
      tick();
      const interval = setInterval(tick, 60_000);
      return () => clearInterval(interval);
    }, ms);
    return () => clearTimeout(timeout);
  }, []);

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <span className="font-mono text-[11px] text-gray-400 bg-gray-50 border border-gray-200 px-3 py-1 rounded-md whitespace-nowrap">
      {today} · {time}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AdminHeaderProps {
  userName: string;
  userRole: string;
}

export function AdminHeader({ userName: _userName, userRole: _userRole }: AdminHeaderProps) {
  const pathname = usePathname();
  const pageName = getPageName(pathname);

  return (
    <header className="shrink-0 flex items-center justify-between px-5 bg-white border-b border-[#e2e5f1] shadow-sm"
      style={{ height: "52px" }}
    >
      {/* Left: breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[12px]">
        <span className="text-gray-400 font-medium">Admin</span>
        <ChevronRight className="h-3 w-3 text-gray-300" />
        <span className="text-gray-700 font-semibold">{pageName}</span>
      </nav>

      {/* Right: time + sign-out */}
      <div className="flex items-center gap-3">
        <LiveTime />
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-red-600 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>
    </header>
  );
}
