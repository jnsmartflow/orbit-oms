"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { triggerCsvExport } from "./export-button";

export type WorkflowTab = "dashboard" | "ot-pending" | null;

interface AttendancePageHeaderProps {
  activeTab: WorkflowTab;
  otPendingCount?: number;
  showWorkflowSwitcher?: boolean; // default true
  // Pass a string with " · " separator for breadcrumb rendering (used on
  // Settings: "Attendance · Settings" → first part gray, second part bold).
  titleOverride?: string;
  // Strip 2 contents — left/right layout owned by the caller.
  children: ReactNode;
}

// Two-strip header per docs/mockups/attendance/admin-redesign.html.
// Replaces admin-sub-nav.tsx + the per-page UniversalHeader chrome.
export function AttendancePageHeader({
  activeTab,
  otPendingCount,
  showWorkflowSwitcher = true,
  titleOverride,
  children,
}: AttendancePageHeaderProps) {
  return (
    <>
      {/* Strip 1 — title + switcher + Reports + clock */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-4 min-w-0">
          <Title text={titleOverride ?? "Attendance"} />
          {showWorkflowSwitcher && (
            <WorkflowSwitcher
              activeTab={activeTab}
              otPendingCount={otPendingCount}
            />
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ReportsDropdown />
          <Clock />
        </div>
      </div>

      {/* Strip 2 — caller-supplied filter / context row */}
      <div className="h-12 flex items-center justify-between px-6 border-b border-gray-200 bg-white">
        {children}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Title — supports a single label or "Attendance · Settings" breadcrumb
// ────────────────────────────────────────────────────────────────────────

function Title({ text }: { text: string }) {
  const parts = text.split(" · ");
  if (parts.length < 2) {
    return (
      <span className="font-semibold text-base text-gray-900 truncate">
        {text}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      {parts.map((p, i) => (
        <span key={`${p}-${i}`} className="flex items-center gap-2">
          {i > 0 && (
            <span className="text-gray-300" aria-hidden>
              ·
            </span>
          )}
          <span
            className={`font-semibold text-base truncate ${
              i === parts.length - 1 ? "text-gray-900" : "text-gray-500"
            }`}
          >
            {p}
          </span>
        </span>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Workflow switcher — Dashboard ⇆ OT Pending pill segments
// ────────────────────────────────────────────────────────────────────────

interface SwitcherProps {
  activeTab: WorkflowTab;
  otPendingCount: number | undefined;
}

function WorkflowSwitcher({ activeTab, otPendingCount }: SwitcherProps) {
  return (
    <div className="inline-flex items-center bg-gray-100 rounded-md p-0.5">
      <SwitcherTab
        href="/admin/attendance"
        label="Dashboard"
        active={activeTab === "dashboard"}
      />
      <SwitcherTab
        href="/admin/attendance/ot-pending"
        label="OT Pending"
        active={activeTab === "ot-pending"}
        badge={
          otPendingCount !== undefined && otPendingCount > 0
            ? otPendingCount
            : undefined
        }
      />
    </div>
  );
}

function SwitcherTab({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  const baseClass = "px-3 py-1 text-xs inline-flex items-center gap-1.5";
  const stateClass = active
    ? "font-medium text-gray-900 bg-white rounded shadow-sm"
    : "text-gray-600 hover:text-gray-900";
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${baseClass} ${stateClass}`}
    >
      {label}
      {badge !== undefined && (
        <span className="bg-red-50 text-red-700 text-[10px] font-medium px-1.5 rounded-full tabular-nums">
          {badge}
        </span>
      )}
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Clock — HH:MM IST, ticks every 60s
// ────────────────────────────────────────────────────────────────────────

const istClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function Clock() {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    function tick() {
      setTime(istClockFormatter.format(new Date()));
    }
    tick();
    // 30s interval — covers minute boundaries within ~30s without
    // running every second.
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span
      suppressHydrationWarning
      className="text-xs text-gray-400 tabular-nums"
      style={{ letterSpacing: "0.5px" }}
    >
      {time}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Reports dropdown — hand-rolled (shadcn DropdownMenu not installed)
// ────────────────────────────────────────────────────────────────────────

function ReportsDropdown() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs ${
          open
            ? "border border-gray-300 bg-gray-50 text-gray-900"
            : "border border-gray-200 bg-white text-gray-900 hover:bg-gray-50"
        }`}
      >
        Reports
        <span className="text-[9px] text-gray-400 ml-1" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1 z-30 w-60 bg-white border border-gray-200 rounded-md shadow-lg py-1.5"
        >
          <DropdownSection label="View reports">
            <DropdownLink
              href="/admin/attendance/ot-audit"
              onClose={() => setOpen(false)}
            >
              OT Audit
            </DropdownLink>
            <DropdownItemDisabled>Late report</DropdownItemDisabled>
            <DropdownItemDisabled>Monthly summary</DropdownItemDisabled>
          </DropdownSection>
          <DropdownDivider />
          <DropdownSection label="Quick export">
            <DropdownButton
              onClick={() => {
                // No date arg — export endpoint defaults to istDateString()
                // server-side, so the CSV always covers today's IST roster
                // regardless of where the browser or server thinks "today"
                // is. See route.ts parseAndClampDate(null, today).
                triggerCsvExport();
                setOpen(false);
              }}
            >
              Today&apos;s roster (CSV)
            </DropdownButton>
            <DropdownItemDisabled>Date range export</DropdownItemDisabled>
          </DropdownSection>
        </div>
      )}
    </div>
  );
}

function DropdownSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="py-1">
      <p className="px-3 pb-1 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
        {label}
      </p>
      {children}
    </div>
  );
}

function DropdownDivider() {
  return <div className="my-1 border-t border-gray-100" />;
}

function DropdownLink({
  href,
  children,
  onClose,
}: {
  href: string;
  children: ReactNode;
  onClose(): void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClose}
      className="block px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-gray-900"
    >
      {children}
    </Link>
  );
}

function DropdownButton({
  onClick,
  children,
}: {
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full text-left px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-gray-900"
    >
      {children}
    </button>
  );
}

function DropdownItemDisabled({ children }: { children: ReactNode }) {
  return (
    <div
      role="menuitem"
      aria-disabled
      className="flex items-center justify-between px-3 py-1.5 text-[13px] text-gray-300 cursor-not-allowed"
    >
      <span>{children}</span>
      <span className="text-[9px] uppercase tracking-wider text-gray-300 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">
        soon
      </span>
    </div>
  );
}
