"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMobileShell } from "./mobile-shell-context";
import { WorkflowTabBar, type WorkflowTab } from "./workflow-tab-bar";
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
  navItems: NavItemConfig[];
  // Stage 2/4 (2026-07-19) — OPTIONAL "supply your own tabs" slot. Absent (or
  // an empty array) on every current caller, so every existing page keeps
  // rendering the exact default Home/Menu/You bar below, unchanged. When a
  // future page supplies `workflowTabs`, its own module-native tab bar takes
  // the nav's place instead — the Menu/You SHEETS (mobile-shell-context.tsx)
  // stay mounted and reachable regardless, via useMobileShell(), from
  // wherever that page's own header chooses to trigger them. No page is
  // wired to this yet (discovery 2026-07-19 "picking-shell-fork" §3/§4).
  workflowTabs?: WorkflowTab[];
  activeTabKey?: string;
  onTabChange?: (key: string) => void;
  // Detail-interactions Build A (2026-07-19) — OPTIONAL, checked BEFORE
  // hasWorkflowTabs. Absent (or false) on every current caller except
  // Picking's own detail screen, so every existing page + Picking's own list
  // view are unaffected. Deliberately a real named prop, not a
  // `workflowTabs={[]}` shortcut — an empty array already means something
  // else (falls through to the DEFAULT bar, per hasWorkflowTabs below), so
  // reusing it for "hidden" would silently break that fallback semantic.
  hideBar?: boolean;
}

// Stage 1/4 (2026-07-19): the Menu sheet, You sheet, sign-out confirm, and
// scrim used to render from here too, driven by state local to this
// component. That state + rendering now live in MobileShellProvider
// (mobile-shell-context.tsx), mounted once around the role-shelled subtree
// in role-layout-client.tsx, so a future non-bottom-bar trigger (e.g. a
// module-native header) can open the same sheets via useMobileShell()
// without re-mounting a second copy of them. This component is now just the
// three fixed anchors — same markup, classes, and behaviour as before.
export function MobileShell({ navItems, workflowTabs, activeTabKey, onTabChange, hideBar }: MobileShellProps) {
  const pathname = usePathname();
  const { openMenu, openYou, closeAll } = useMobileShell();

  const homeHref = navItems[0]?.href ?? "/";
  const isHomeActive = pathname === homeHref;

  // Stage 2/4: default-safe branch. `workflowTabs` is undefined on every
  // current caller (no page passes it yet), so this is always false today —
  // the nav below renders exactly as it did before this stage.
  const hasWorkflowTabs = workflowTabs !== undefined && workflowTabs.length > 0;

  return (
    <div className="block md:hidden">
      {hideBar ? null : hasWorkflowTabs ? (
        <WorkflowTabBar
          tabs={workflowTabs}
          activeKey={activeTabKey ?? workflowTabs[0].key}
          onChange={onTabChange ?? (() => {})}
        />
      ) : (
        /* Bottom tab bar — 3 fixed anchors, identical for every role */
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
      )}
    </div>
  );
}
