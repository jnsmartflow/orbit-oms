"use client";

import { cn } from "@/lib/utils";

// Stage 2/4 (2026-07-19) — a generic "supply your own tabs" bottom bar, for
// modules that want workflow tabs (Assign/Check/Checked-style) in place of
// the default Home/Menu/You bar. Not yet used by any page — mobile-shell.tsx
// only renders this when a caller explicitly passes a non-empty `workflowTabs`
// prop, which no page does today (discovery 2026-07-19
// "picking-shell-fork" §4 reusability note: the label+count+underline
// treatment here is adapted from picking-board-mobile.tsx's TopBarTab —
// copied, not imported, since that file is untouched this stage — restyled
// for the bar's white background instead of TopBarTab's teal one).
//
// HEIGHT — must occupy the same footprint as mobile-shell.tsx's default
// <nav> (~58px content + safe-area, per MOBILE_NAV_CLEARANCE's own comment)
// so that constant stays a valid "at least this much" reservation for every
// consumer app-wide, regardless of which bar is actually mounted. `min-h-
// [58px]` pins that explicitly rather than relying on this bar's own
// (different) content — icon+label vs label+count — to happen to match by
// coincidence. Safe-area treatment mirrors the default bar's bare
// `env(safe-area-inset-bottom)` (no `max(...)` floor) for the same reason:
// two different formulas would make the two bars' real-device heights
// diverge even if their base content height matched.

export interface WorkflowTab {
  key:    string;
  label:  string;
  count?: number;
}

interface WorkflowTabBarProps {
  tabs:      WorkflowTab[];
  activeKey: string;
  onChange:  (key: string) => void;
}

export function WorkflowTabBar({ tabs, activeKey, onChange }: WorkflowTabBarProps): React.JSX.Element {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex min-h-[58px] bg-white border-t border-gray-200"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className="relative flex-1 flex flex-col items-center justify-center gap-0.5"
          >
            <span className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "text-[13.5px] whitespace-nowrap",
                  active ? "text-teal-700 font-bold" : "text-gray-500 font-medium"
                )}
              >
                {tab.label}
              </span>
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "text-[11.5px] font-semibold tabular-nums whitespace-nowrap",
                    active ? "text-teal-600" : "text-gray-400"
                  )}
                >
                  {tab.count}
                </span>
              )}
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
