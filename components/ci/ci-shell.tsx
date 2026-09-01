"use client";

import { useCallback, useState } from "react";
import { FilePlus2, Send } from "lucide-react";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { CiNewReturn } from "./new-return";
import { CiSubmittedBoard } from "./submitted-board";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import type { WorkflowTab } from "@/components/shared/workflow-tab-bar";
import type { NavItemConfig } from "@/lib/permissions";

// CI's mobile shell — the same Direction-A shape Picking and MRN use
// (components/picking/picking-mobile-shell.tsx is the reference implementation
// named in CLAUDE_UI.md §59.4; components/mrn/mrn-shell.tsx is the closer copy).
//
// ⚠ WHY THERE IS NO app/ci/layout.tsx, AND WHY THERE CANNOT BE ONE.
// RoleLayoutClient carries `workflowTabs` / `activeTabKey` / `onTabChange` /
// `hideBar`, and every one of those is owned by CLIENT state here: which tab is
// showing, and whether a bill has taken the viewport. A server layout.tsx cannot
// supply them, and a layout rendering a bare RoleLayoutClient would permanently
// lock the supervisor to the default Home/Menu/You bar.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 HOW THE TAB BAR IS MOUNTED, AND HOW IT DISAPPEARS
// ═══════════════════════════════════════════════════════════════════════════
//
// The two module tabs are NOT a bar this file renders. They are handed to
// RoleLayoutClient as `workflowTabs`, which passes them down to MobileShell,
// which REPLACES its default Home/Menu/You bar with them. That is the same
// mechanism /picking and /mrn use — there is exactly one bottom bar on screen at
// any time, and a module either fills it or gets the default.
//
// Inside a bill the mockup shows the tab bar GONE, replaced by a single Next
// pill. That is `hideBar`: `CiNewReturn` reports UP through `onInsideBill` when
// a bill opens, and this shell flips the slot. The pill itself is rendered by
// the bill screen, inside its own fixed overlay, so the two can never both be
// on screen.
//
// ⚠ `workflowTabs={[]}` would NOT hide the bar — an empty array falls through to
// the default bar (CLAUDE_UI.md §59.2's landmine). Hiding needs `hideBar`.

const CI_TAB_KEYS = ["new", "submitted"] as const;
export type CiTabKey = (typeof CI_TAB_KEYS)[number];

/** Runtime narrowing for the tab-bar callback, which hands back a bare string.
 *  An unrecognised key is IGNORED rather than written into state as a lie —
 *  the same discipline components/mrn/mrn-shell.tsx's isMrnTabKey follows. */
function isCiTabKey(value: string): value is CiTabKey {
  return (CI_TAB_KEYS as readonly string[]).includes(value);
}

export function CiShell({
  role,
  userName,
  userInitials,
  navItems,
}: {
  role: RoleSidebarRole;
  userName: string;
  userInitials: string;
  navItems: NavItemConfig[];
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<CiTabKey>("new");
  const [insideBill, setInsideBill] = useState(false);
  // Bumped after a submit so the Submitted board refetches. A counter, not a
  // boolean, so two submits in a row both trigger a reload.
  const [refreshKey, setRefreshKey] = useState(0);
  // 🔴 FROM THE BOARD'S OWN FETCH, NEVER A GUESSED INCREMENT. An optimistic
  // "+1" drifts the moment a submit fails after the bump, or two phones submit
  // at once. undefined until the board has loaded, and WorkflowTabBar renders no
  // badge for undefined — an honest blank beats a confident 0.
  const [withBillingCount, setWithBillingCount] = useState<number | undefined>(undefined);

  // Stable, so the child effects do not re-fire on every render of this shell —
  // an unstable callback in those dependency lists would loop.
  //
  // ⚠ SHARED BY BOTH TABS. A bill on New and a CI on Submitted both take the
  // whole viewport, and only one tab is mounted at a time, so one flag serves
  // both. Switching tabs unmounts the other, which resets it.
  const handleInsideBill = useCallback((inside: boolean) => {
    setInsideBill(inside);
  }, []);

  const handleSubmitted = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  /** "Done" on the success screen — land him on Submitted, where the CI he just
   *  raised is sitting with billing. */
  const handleFinished = useCallback(() => {
    setActiveTab("submitted");
    setRefreshKey((k) => k + 1);
  }, []);

  const handleCounts = useCallback((withBilling: number) => {
    setWithBillingCount(withBilling);
  }, []);

  // Icons: lucide FilePlus2 → Send. The vocabulary the picking and MRN
  // supervisor boards already taught this user — start something new, then hand
  // it on.
  //
  // 🔴 "New" PASSES NO COUNT — there is nothing to count, it is an action.
  // "Submitted" carries what billing still holds, and that number comes from the
  // BOARD'S OWN FETCH (see withBillingCount above), never an increment.
  // undefined until it loads, and WorkflowTabBar renders no badge for undefined.
  const workflowTabs: WorkflowTab[] = [
    { key: "new", label: "New", icon: FilePlus2 },
    { key: "submitted", label: "Submitted", icon: Send, count: withBillingCount },
  ];

  return (
    <RoleLayoutClient
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
      workflowTabs={workflowTabs}
      activeTabKey={activeTab}
      onTabChange={(key) => {
        if (isCiTabKey(key)) setActiveTab(key);
      }}
      // The mockup's "tab bar disappears inside a bill".
      hideBar={insideBill}
    >
      {activeTab === "new" ? (
        <CiNewReturn
          userInitials={userInitials}
          onInsideBill={handleInsideBill}
          onSubmitted={handleSubmitted}
          onFinished={handleFinished}
        />
      ) : (
        <CiSubmittedBoard
          userInitials={userInitials}
          refreshKey={refreshKey}
          onCounts={handleCounts}
          // Same hideBar contract as a bill: opening a CI takes the viewport,
          // so the two module tabs go with it (step 7e).
          onInsideCi={handleInsideBill}
        />
      )}
    </RoleLayoutClient>
  );
}

