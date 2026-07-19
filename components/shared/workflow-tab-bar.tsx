"use client";

import { cn } from "@/lib/utils";

// Stage 2/4 (2026-07-19), restyled Stage 4/4 — a generic "supply your own
// tabs" bottom bar, for modules that want workflow tabs (Assign/Check/Done-
// style) in place of the default Home/Menu/You bar. Only used by Picking
// today (mobile-shell.tsx only renders this when a caller explicitly passes
// a non-empty `workflowTabs` prop — every other page still gets the default
// bar below, untouched by this file).
//
// Stage 4/4: restyled to the SAME icon-on-top layout as mobile-shell.tsx's
// default <nav> buttons — copy those classes exactly
// (`flex-1 flex flex-col items-center gap-1 py-2 text-[11px] font-semibold`
// + `h-6 w-6` icon + `text-teal-700`/`text-gray-400` active/inactive) so the
// two bars are the same height BY CONSTRUCTION, not by a hand-tuned
// min-height that could drift out of sync with the real content. Safe-area
// treatment mirrors the default bar's bare `env(safe-area-inset-bottom)`
// (no `max(...)` floor) for the same reason — matching structure top to
// bottom, not just a height number.

export interface WorkflowTab {
  key:    string;
  label:  string;
  count?: number;
  icon:   React.ComponentType<{ className?: string }>;
}

interface WorkflowTabBarProps {
  tabs:      WorkflowTab[];
  activeKey: string;
  onChange:  (key: string) => void;
}

export function WorkflowTabBar({ tabs, activeKey, onChange }: WorkflowTabBarProps): React.JSX.Element {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex bg-white border-t border-gray-200"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const Icon = tab.icon;
        // Badge shows only when there's something to count — a "0" badge
        // is noise, not information.
        const showBadge = tab.count !== undefined && tab.count > 0;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className="relative flex-1 flex flex-col items-center gap-1 py-2 text-[11px] font-semibold"
          >
            <span className="relative flex items-center justify-center">
              <Icon className={cn("h-6 w-6", active ? "text-teal-700" : "text-gray-400")} />
              {showBadge && (
                <span
                  className={cn(
                    "absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-[3px] rounded-full flex items-center justify-center text-[9px] font-bold text-white tabular-nums leading-none",
                    // One-teal (§1): only the ACTIVE tab's badge is teal —
                    // an inactive tab's badge stays neutral gray, same as
                    // its icon/label.
                    active ? "bg-teal-600" : "bg-gray-400"
                  )}
                >
                  {tab.count! > 99 ? "99+" : tab.count}
                </span>
              )}
            </span>
            <span className={cn("whitespace-nowrap", active ? "text-teal-700" : "text-gray-400")}>
              {tab.label}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-1/2 -translate-x-1/2 bottom-0 h-[3px] w-8 rounded-full bg-teal-600",
                active ? "opacity-100" : "opacity-0"
              )}
            />
          </button>
        );
      })}
    </nav>
  );
}
