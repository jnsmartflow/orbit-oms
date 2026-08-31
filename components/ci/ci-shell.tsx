"use client";

import { useCallback, useState } from "react";
import { FilePlus2, Send } from "lucide-react";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { CiNewReturn } from "./new-return";
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

  // Stable, so CiNewReturn's effect does not re-fire on every render of this
  // shell — an unstable callback in that dependency list would loop.
  const handleInsideBill = useCallback((inside: boolean) => {
    setInsideBill(inside);
  }, []);

  // Icons: lucide FilePlus2 → Send. The vocabulary the picking and MRN
  // supervisor boards already taught this user — start something new, then hand
  // it on.
  //
  // 🔴 NEITHER TAB PASSES A COUNT. WorkflowTabBar renders no badge when `count`
  // is undefined, and step 4a has no board fetch to count from. A count on
  // "Submitted" arrives with the board in 4b — a badge showing 0 because nothing
  // has been fetched is worse than no badge.
  const workflowTabs: WorkflowTab[] = [
    { key: "new", label: "New", icon: FilePlus2 },
    { key: "submitted", label: "Submitted", icon: Send },
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
        <CiNewReturn userInitials={userInitials} onInsideBill={handleInsideBill} />
      ) : (
        <SubmittedPlaceholder />
      )}
    </RoleLayoutClient>
  );
}

/** Step 4b builds the real Submitted board (the "With billing" / "Finished"
 *  bands off GET /api/ci/board?face=supervisor, which already exists). This
 *  placeholder keeps the tab honest rather than rendering a blank screen. */
function SubmittedPlaceholder(): React.JSX.Element {
  return (
    <div className="min-h-full bg-[#F4F6F7] px-5 py-10">
      <p className="text-[15px] font-semibold text-gray-900">Submitted</p>
      <p className="text-[13px] text-gray-500 mt-2 leading-relaxed">
        The list of returns you have handed to billing, and the ones billing has finished, is
        step 4b. Its feed — <span className="font-mono text-[12px]">GET /api/ci/board?face=supervisor</span>{" "}
        — is already built.
      </p>
    </div>
  );
}
