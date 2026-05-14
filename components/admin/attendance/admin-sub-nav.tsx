"use client";

import Link from "next/link";

export type AdminSubNavTab = "dashboard" | "ot-pending" | "settings" | "ot-audit";

interface AdminSubNavProps {
  active: AdminSubNavTab;
  otPendingCount?: number;
}

interface TabSpec {
  id: AdminSubNavTab;
  label: string;
  href: string;
}

const TABS: TabSpec[] = [
  { id: "dashboard", label: "Dashboard", href: "/admin/attendance" },
  { id: "ot-pending", label: "OT Pending", href: "/admin/attendance/ot-pending" },
  { id: "settings", label: "Settings", href: "/admin/attendance/settings" },
  { id: "ot-audit", label: "OT Audit", href: "/admin/attendance/ot-audit" },
];

export function AdminSubNav({ active, otPendingCount }: AdminSubNavProps) {
  return (
    <div className="bg-white border-b border-gray-200">
      <nav
        aria-label="Attendance admin"
        className="flex items-end gap-1 px-4 h-11 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          const showBadge =
            tab.id === "ot-pending" &&
            otPendingCount !== undefined &&
            otPendingCount > 0;
          const baseClass =
            "shrink-0 px-3 py-2.5 text-[13px] inline-flex items-center";
          const stateClass = isActive
            ? "font-semibold text-teal-600 border-b-2 border-teal-600 -mb-px"
            : "font-medium text-gray-500 hover:text-gray-900";
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`${baseClass} ${stateClass}`}
            >
              {tab.label}
              {showBadge && (
                <span className="ml-1.5 bg-teal-50 text-teal-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums">
                  {otPendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
