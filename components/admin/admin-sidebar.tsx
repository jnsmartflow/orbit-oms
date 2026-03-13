"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/admin" },
  { label: "System Config", href: "/admin/system-config" },
  { label: "Dispatch Cutoffs", href: "/admin/dispatch-cutoffs" },
  { label: "Users", href: "/admin/users" },
  { label: "Roles", href: "/admin/roles" },
  { label: "Delivery Types", href: "/admin/delivery-types" },
  { label: "Routes", href: "/admin/routes" },
  { label: "Areas", href: "/admin/areas" },
  { label: "Sub-areas", href: "/admin/sub-areas" },
  { label: "Sales Officers", href: "/admin/sales-officers" },
  { label: "Customers", href: "/admin/customers" },
  { label: "SKUs", href: "/admin/skus" },
  { label: "Vehicles", href: "/admin/vehicles" },
] as const;

interface AdminSidebarProps {
  userName: string;
  userRole: string;
}

export function AdminSidebar({ userName, userRole }: AdminSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navContent = (
    <nav className="flex flex-col gap-0.5 px-3 py-4">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-white/10 text-white"
                : "text-slate-400 hover:bg-white/5 hover:text-white"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-[#111] min-h-screen">
        <div className="px-5 py-5 border-b border-white/10">
          <span className="text-white font-bold text-lg tracking-tight">
            Orbit OMS
          </span>
          <p className="text-xs text-slate-500 mt-0.5">Admin Panel</p>
        </div>
        {navContent}
      </aside>

      {/* ── Mobile hamburger button ──────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 z-50 flex items-center gap-3 h-14 px-4 bg-[#111] w-full border-b border-white/10">
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/10"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <span className="text-white font-bold text-base">Orbit OMS</span>
      </div>

      {/* ── Mobile drawer ───────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <aside className="w-60 bg-[#111] flex flex-col pt-14">
            {navContent}
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
