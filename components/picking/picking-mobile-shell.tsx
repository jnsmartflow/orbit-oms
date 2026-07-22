"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Inbox, Package, CheckCircle2 } from "lucide-react";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import type { WorkflowTab } from "@/components/shared/workflow-tab-bar";
import type { NavItemConfig } from "@/lib/permissions";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickingQueueResult } from "@/lib/picking/queue";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";

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
  // Tab keys renamed 2026-07-20 ("check"→"picking", "checked"→"done") as part
  // of the one-state-per-tab re-slot. Unlike the 2026-07-19 rename that
  // CLAUDE_PICKING.md §5.1 warns about (label changed, key deliberately did
  // NOT), this one moves BOTH together — because the old keys had become
  // actively inverted: post-re-slot, "check" would hold pick_assigned (no
  // checking) while "checked" holds the actual needs-check work. This union
  // is what makes the rename safe: tsc flags every stale comparison in
  // PickingBoardMobile. Nothing persists these keys (plain useState below, no
  // localStorage, no URL param, and WorkflowTab.key is a bare string), so
  // there is no stored value to migrate.
  activeTab:    "assign" | "picking" | "done";
  refetchQueue: () => Promise<void>;
  // Detail-interactions Build A (2026-07-19) — lifted from PickingBoardMobile
  // for the same reason activeTab/data were lifted in Stage 3: RoleLayoutClient's
  // hideBar slot needs this one level up, at SupervisorPickingShell, which
  // only a descendant (PickingBoardMobile, where every open/close call site
  // lives) knows when to flip. PickingBoardMobile now reads AND writes this
  // through context instead of owning local state for it.
  detailOpen:    boolean;
  setDetailOpen: (open: boolean) => void;
  // Mid-action signal the board reports UP so the live-sync poll (owned here in
  // the shell) can pause onChange while a picker sheet / release-confirm floats
  // over the LIST view — the one mid-action state detailOpen does NOT already
  // cover (a sheet over the detail screen is already covered by detailOpen).
  // Same lift-to-shell pattern as detailOpen above.
  setOverlayBusy: (busy: boolean) => void;
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
  canSeePushTest:  boolean;
  children:        React.ReactNode;
}

export function PickingMobileShell({
  role, userName, userInitials, navItems, showPickerFace, canSeePushTest, children,
}: PickingMobileShellProps): React.JSX.Element {
  // Picker face (or a future non-supervisor mobile face): no workflow tabs,
  // no queue fetch here — RoleLayoutClient renders with its default bar.
  const shell = showPickerFace ? (
    <RoleLayoutClient role={role} userName={userName} userInitials={userInitials} navItems={navItems}>
      {children}
    </RoleLayoutClient>
  ) : (
    <SupervisorPickingShell role={role} userName={userName} userInitials={userInitials} navItems={navItems}>
      {children}
    </SupervisorPickingShell>
  );

  return (
    <>
      {shell}
      {/* ⚠️ TEMPORARY SCAFFOLDING — REMOVE after the push-notification rollout.
          Admin-only, mobile-only link to the /picking/push-test proof page. The
          installed iOS home-screen app has no address bar and always launches at
          manifest start_url "/", so this is the only way to reach push-test from
          inside the installed app. Fixed (out of flow — disturbs no layout),
          bottom-left above the nav clearance. Gray, NOT teal (one-teal rule). */}
      {canSeePushTest && (
        <a
          href="/picking/push-test"
          className="fixed left-3 z-40 block md:hidden rounded bg-white/90 px-2 py-1 text-[11px] text-gray-400 underline shadow-sm"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)" }}
        >
          Push test (temporary)
        </a>
      )}
    </>
  );
}

function SupervisorPickingShell({
  role, userName, userInitials, navItems, children,
}: Omit<PickingMobileShellProps, "showPickerFace" | "canSeePushTest">): React.JSX.Element {
  // Lifted verbatim from PickingBoardMobile's pre-Stage-3 fetch (same shape,
  // same endpoint, same date-driven pattern as picking-queue.tsx's desktop
  // sibling) — only the OWNER moved.
  const [data, setData] = useState<PickingQueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"assign" | "picking" | "done">("assign");
  // Detail-interactions Build A — see PickingBoardContextValue's comment.
  const [detailOpen, setDetailOpen] = useState(false);
  // Reported up by the board (picker sheet / release confirm over the LIST) —
  // see PickingBoardContextValue.setOverlayBusy. Feeds the live-sync pause.
  const [overlayBusy, setOverlayBusy] = useState(false);

  // scope=openPending (2026-07-20 date-zones redesign) — pending and
  // in-progress bills across ALL dates, plus today's checked band. Replaces
  // the previous `?date=<today>` call, which fenced the WHOLE board to one
  // day and hid carry-over work. Deliberately sends NO `date` param: the
  // route 400s on the contradictory combination rather than ignoring it.
  // Desktop (picking-queue.tsx) still sends `?date=` and no scope, so it
  // keeps the unchanged 'single' path.
  const fetchQueue = useCallback(async (): Promise<PickingQueueResult> => {
    const res = await fetch(`/api/picking/queue?scope=openPending`);
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`);
    }
    return res.json();
  }, []);

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

  // A REFRESH of already-loaded data — deliberately silent on failure: keep the
  // last good board (the error SCREEN is owned only by the initial load() above)
  // and never toggle `loading` (no spinner, no flicker). This is what makes it
  // safe for the 15s background poll to drive, and is also strictly better for
  // the foreground assign/undo/approve callers — a bill already persisted, so a
  // failed follow-up refresh must not wipe the board. The next marker tick or
  // user action recovers the data.
  const refetchQueue = useCallback(async () => {
    try {
      const json = await fetchQueue();
      setData(json);
    } catch {
      // silent — keep last good data, retry on the next trigger
    }
  }, [fetchQueue]);

  // Live sync (2026-07-22) — poll the cheap marker every 15s; on a real change,
  // do the ONE full refetch (refetchQueue above). scope MUST match fetchQueue's
  // ("openPending") so the marker watches the same rows buildPickingWhere() does
  // server-side. Paused while the user is mid-action: detailOpen (detail /
  // line-tick / Approve screen) OR overlayBusy (picker sheet / release confirm
  // floating over the list) — a background refetch must never move the ground
  // under an in-progress assignment or approval.
  usePickingMarker({
    scope: "openPending",
    onChange: refetchQueue,
    paused: detailOpen || overlayBusy,
  });

  // Tab counts — same filter semantics as PickingBoardMobile's own
  // waitingRows/assignedRows/doneRows/checkedRows memos (§ that file), just
  // re-derived here from the same shared `data` for the bottom-bar labels.
  // Cheap (a few array scans over the day's queue), not a second fetch.
  //
  // BADGE RE-CUT (2026-07-20) — each badge now counts exactly ONE state, the
  // whole point of the tab re-slot. Previously the middle tab showed
  // `assignedCount + doneCount`, a mixed number that told the supervisor
  // nothing actionable ("is that bills being picked, or bills waiting on me?").
  //
  //   Assign  = waiting, DUE ZONE ONLY (pending_picking, dispatch date <=
  //             today or absent). Narrowed 2026-07-20 (step 5a): an
  //             "upcoming" bill is visible on the Assign tab but LOCKED —
  //             it cannot be selected or assigned — so counting it would
  //             promise the supervisor work he is not allowed to do. Same
  //             principle that keeps isChecked out of the Done badge below.
  //   Picking = assigned       (pick_assigned)    — out on the floor now
  //   Done    = done ONLY      (pick_done)        — waiting on YOUR check
  //
  // ⚠ `isChecked` is deliberately absent from every badge. A checked bill is
  // settled history; folding it into the Done badge would inflate the one
  // number that is supposed to mean "work still requiring you". The Done tab
  // still RENDERS checked bills (its lower band) — it just doesn't count them.
  // Icons: Inbox (incoming work) → Package (goods being fetched) → CheckCircle2
  // (finished). ClipboardCheck was dropped from the middle tab on 2026-07-20:
  // a low-literacy floor user reads the icon before the word, and a
  // clipboard-with-tick on the "Picking" tab said "check" — the exact state
  // that tab no longer holds.
  const workflowTabs = useMemo<WorkflowTab[]>(() => {
    const rows: PickingQueueRow[] = data?.rows ?? [];
    const waitingDueCount = rows.filter(
      (r) => !r.isAssigned && !r.isDone && !r.isChecked && r.zone === "due",
    ).length;
    const assignedCount = rows.filter((r) => r.isAssigned).length;
    const doneCount = rows.filter((r) => r.isDone).length;
    return [
      { key: "assign", label: "Assign", count: waitingDueCount, icon: Inbox },
      { key: "picking", label: "Picking", count: assignedCount, icon: Package },
      { key: "done", label: "Done", count: doneCount, icon: CheckCircle2 },
    ];
  }, [data]);

  const contextValue = useMemo<PickingBoardContextValue>(
    () => ({ data, loading, error, activeTab, refetchQueue, detailOpen, setDetailOpen, setOverlayBusy }),
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
      onTabChange={(key) => setActiveTab(key as "assign" | "picking" | "done")}
      hideBar={detailOpen}
    >
      <PickingBoardContext.Provider value={contextValue}>
        {children}
      </PickingBoardContext.Provider>
    </RoleLayoutClient>
  );
}
