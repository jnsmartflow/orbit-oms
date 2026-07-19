"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Inbox, ClipboardCheck, CheckCircle2 } from "lucide-react";
import { getTodayIST } from "@/lib/dates";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import type { WorkflowTab } from "@/components/shared/workflow-tab-bar";
import type { NavItemConfig } from "@/lib/permissions";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickingQueueResult } from "@/lib/picking/queue";

// Stage 3/4 (2026-07-19) — Direction A. `workflowTabs`/`activeTabKey`/
// `onTabChange` (the Stage-2 slot on MobileShell) must reach
// `<RoleLayoutClient>`, which app/picking/page.tsx (a server component)
// renders ABOVE PickingBoardMobile in the tree — so the tab state and the
// queue fetch that drives its live counts can't stay owned inside
// PickingBoardMobile itself (a descendant) the way they were pre-Stage-3.
// This wrapper is the new single source of truth for both: it owns
// `data`/`loading`/`error`/`activeTab`/`refetchQueue`, computes the three
// tab counts, and renders RoleLayoutClient with the slot filled in. Every
// consumer of `refetchQueue()` (assign/undo/approve, still inside
// PickingBoardMobile) now updates the SAME `data` the bottom-bar counts read
// — one fetch, no drift between the cards and the tab counts.
//
// Only mounts the fetch/tab machinery when `!showPickerFace` — i.e. only
// when PickingBoardMobile (the supervisor board) is actually the thing that
// will render on mobile. The picker face (PickerMyPicksBoard) and the
// desktop queue are both untouched: `workflowTabs` stays undefined for them,
// so MobileShell keeps rendering its default Home/Menu/You bar exactly as
// before (Stage 2's default-safe branch) — this mirrors PickingBoardMobile's
// own pre-Stage-3 behaviour, which only ever fetched when it was the branch
// actually being mounted.

interface PickingBoardContextValue {
  data:         PickingQueueResult | null;
  loading:      boolean;
  error:        string | null;
  activeTab:    "assign" | "check" | "checked";
  refetchQueue: () => Promise<void>;
  // Detail-interactions Build A (2026-07-19) — lifted from PickingBoardMobile
  // for the same reason activeTab/data were lifted in Stage 3: RoleLayoutClient's
  // hideBar slot needs this one level up, at SupervisorPickingShell, which
  // only a descendant (PickingBoardMobile, where every open/close call site
  // lives) knows when to flip. PickingBoardMobile now reads AND writes this
  // through context instead of owning local state for it.
  detailOpen:    boolean;
  setDetailOpen: (open: boolean) => void;
}

const PickingBoardContext = createContext<PickingBoardContextValue | null>(null);

export function usePickingBoard(): PickingBoardContextValue {
  const ctx = useContext(PickingBoardContext);
  if (!ctx) {
    throw new Error("usePickingBoard must be used within a PickingMobileShell (supervisor board only)");
  }
  return ctx;
}

interface PickingMobileShellProps {
  role:            RoleSidebarRole;
  userName:        string;
  userInitials:    string;
  navItems:        NavItemConfig[];
  showPickerFace:  boolean;
  children:        React.ReactNode;
}

export function PickingMobileShell({
  role, userName, userInitials, navItems, showPickerFace, children,
}: PickingMobileShellProps): React.JSX.Element {
  // Picker face (or a future non-supervisor mobile face): no workflow tabs,
  // no queue fetch here — RoleLayoutClient renders with its default bar.
  if (showPickerFace) {
    return (
      <RoleLayoutClient role={role} userName={userName} userInitials={userInitials} navItems={navItems}>
        {children}
      </RoleLayoutClient>
    );
  }
  return (
    <SupervisorPickingShell role={role} userName={userName} userInitials={userInitials} navItems={navItems}>
      {children}
    </SupervisorPickingShell>
  );
}

function SupervisorPickingShell({
  role, userName, userInitials, navItems, children,
}: Omit<PickingMobileShellProps, "showPickerFace">): React.JSX.Element {
  // Lifted verbatim from PickingBoardMobile's pre-Stage-3 fetch (same shape,
  // same endpoint, same date-driven pattern as picking-queue.tsx's desktop
  // sibling) — only the OWNER moved.
  const [selectedDate] = useState<string>(() => getTodayIST());
  const [data, setData] = useState<PickingQueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"assign" | "check" | "checked">("assign");
  // Detail-interactions Build A — see PickingBoardContextValue's comment.
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchQueue = useCallback(async (): Promise<PickingQueueResult> => {
    const res = await fetch(`/api/picking/queue?date=${selectedDate}`);
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`);
    }
    return res.json();
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await fetchQueue();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load picking queue");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchQueue]);

  const refetchQueue = useCallback(async () => {
    try {
      const json = await fetchQueue();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh picking queue");
    }
  }, [fetchQueue]);

  // Tab counts — same filter semantics as PickingBoardMobile's own
  // waitingRows/assignedRows/doneRows/checkedRows memos (§ that file), just
  // re-derived here from the same shared `data` for the bottom-bar labels.
  // Cheap (a few array scans over the day's queue), not a second fetch.
  //
  // Stage 4/4 — icons added, third tab's LABEL renamed "Checked" -> "Done"
  // (visual only). The KEY stays "checked" — PickingBoardMobile's activeTab
  // union, its `activeTab === "checked"` branch, and PickingMobileShell's
  // own onTabChange cast all still key off this exact string; renaming it
  // would silently break tab switching for zero visible reason.
  const workflowTabs = useMemo<WorkflowTab[]>(() => {
    const rows: PickingQueueRow[] = data?.rows ?? [];
    const waitingCount = rows.filter((r) => !r.isAssigned && !r.isDone && !r.isChecked).length;
    const assignedCount = rows.filter((r) => r.isAssigned).length;
    const doneCount = rows.filter((r) => r.isDone).length;
    const checkedCount = rows.filter((r) => r.isChecked).length;
    return [
      { key: "assign", label: "Assign", count: waitingCount, icon: Inbox },
      { key: "check", label: "Check", count: assignedCount + doneCount, icon: ClipboardCheck },
      { key: "checked", label: "Done", count: checkedCount, icon: CheckCircle2 },
    ];
  }, [data]);

  const contextValue = useMemo<PickingBoardContextValue>(
    () => ({ data, loading, error, activeTab, refetchQueue, detailOpen, setDetailOpen }),
    [data, loading, error, activeTab, refetchQueue, detailOpen],
  );

  return (
    <RoleLayoutClient
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
      workflowTabs={workflowTabs}
      activeTabKey={activeTab}
      onTabChange={(key) => setActiveTab(key as "assign" | "check" | "checked")}
      hideBar={detailOpen}
    >
      <PickingBoardContext.Provider value={contextValue}>
        {children}
      </PickingBoardContext.Provider>
    </RoleLayoutClient>
  );
}
