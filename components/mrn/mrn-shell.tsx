"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Inbox, Package, CheckCircle2 } from "lucide-react";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { BillingBoard } from "./billing-board";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import type { WorkflowTab } from "@/components/shared/workflow-tab-bar";
import type { NavItemConfig } from "@/lib/permissions";
import type { MrnSupervisorBoard, MrnSupervisorTab } from "@/lib/mrn/types";

// MRN's mobile shell — the same Direction-A shape Picking uses
// (components/picking/picking-mobile-shell.tsx, the reference implementation
// named in CLAUDE_UI.md §59.4). Two shells in one file, exactly as Picking
// keeps its supervisor and picker faces together.
//
// ⚠ WHY THERE IS NO app/mrn/layout.tsx, AND WHY THERE CANNOT BE ONE.
// RoleLayoutClient carries `workflowTabs` / `activeTabKey` / `onTabChange` /
// `hideBar`, and every one of those is owned by CLIENT state here: which tab is
// showing, the fetch whose result drives the tab counts, and whether a detail
// screen has taken the viewport. A server layout.tsx cannot supply them, and a
// layout rendering a bare RoleLayoutClient would permanently lock the
// supervisor to the default Home/Menu/You bar. /floor gets away with a layout
// only because it is desktop-only and supplies none of the four.
//
// The branch is on primaryRole, never on viewport. There is no `md:` switch —
// Picking removed its width switch in July 2026 and MRN never had one.

// ── Supervisor board context ────────────────────────────────────────────────

interface MrnBoardContextValue {
  data: MrnSupervisorBoard | null;
  loading: boolean;
  error: string | null;
  activeTab: MrnSupervisorTab;
  /**
   * The ONE refresh path for this face.
   *
   * 🔴 A CLIENT FETCH + setState. NEVER router.refresh() — not here, not in
   * step 9, not "just for the detail screen". Next gives navigations priority
   * in its router action queue: an ACTION_RESTORE (what the history pop closing
   * a detail screen becomes) marks any pending action discarded, so its result
   * is never applied, and only a discarded SERVER ACTION gets the needsRefresh
   * rescue. Picking's picker face shipped exactly that bug — a Mark Done whose
   * refresh was silently thrown away — and TWO separate attempts to fix it by
   * timing shipped green and stayed broken on production, because the ordering
   * is the scheduler's and not ours. Neither tsc nor next build catches it;
   * only a phone does. CORE §3 owns this rule.
   */
  refetchBoard: () => Promise<void>;
  /**
   * Lifted to the shell NOW even though nothing sets it yet.
   *
   * RoleLayoutClient's `hideBar` slot needs this one level above the board, and
   * only a descendant (step 9's detail screen, where every open/close call site
   * will live) knows when to flip it. Retrofitting it later means restructuring
   * this context and every consumer — the same lift Picking had to do after the
   * fact for both of its faces.
   */
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
}

const MrnBoardContext = createContext<MrnBoardContextValue | null>(null);

export function useMrnBoard(): MrnBoardContextValue {
  const ctx = useContext(MrnBoardContext);
  if (!ctx) {
    throw new Error("useMrnBoard must be used within MrnShell (supervisor face only)");
  }
  return ctx;
}

// ⚠️ NARROW, NEVER CAST. WorkflowTab.key is a bare `string`, so onTabChange
// hands back a string. A `key as MrnSupervisorTab` cast is accepted by the
// compiler unconditionally, which means an unrecognised key would be written
// into state silently and every `activeTab === …` comparison downstream would
// fall through to whatever its else-branch happens to be. Picking's picker face
// carries this exact warning after hitting it when its union widened from two
// keys to three (components/picking/picking-mobile-shell.tsx).
const MRN_TAB_KEYS: readonly MrnSupervisorTab[] = ["toCheck", "checking", "done"];

function isMrnTabKey(key: string): key is MrnSupervisorTab {
  return (MRN_TAB_KEYS as readonly string[]).includes(key);
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** What this role may DO on MRN. Resolved server-side in app/mrn/page.tsx.
 *  ⚠ For HIDING controls only — never for authorisation. Every route re-checks
 *  the same permission server-side, and the ROUTE is the authority. */
export interface MrnPerms {
  canEdit: boolean;
  canExport: boolean;
  canDelete: boolean;
}

interface MrnShellProps {
  perms: MrnPerms;
  role: RoleSidebarRole;
  userName: string;
  userInitials: string;
  navItems: NavItemConfig[];
  /** primaryRole === "floor_supervisor", resolved server-side in app/mrn/page.tsx. */
  showSupervisorFace: boolean;
}

export function MrnShell({
  perms,
  role,
  userName,
  userInitials,
  navItems,
  showSupervisorFace,
}: MrnShellProps): React.JSX.Element {
  return showSupervisorFace ? (
    <MrnSupervisorShell
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
    />
  ) : (
    <MrnBillingShell
      perms={perms}
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
    />
  );
}

// ── Supervisor face ─────────────────────────────────────────────────────────

interface FaceProps {
  role: RoleSidebarRole;
  userName: string;
  userInitials: string;
  navItems: NavItemConfig[];
}

/**
 * The supervisor's phone shell — owns the active tab, the board fetch, and the
 * detail flag, and fills all four of RoleLayoutClient's optional slots.
 *
 * ONE fetch of /api/mrn/board?face=supervisor drives BOTH the list and the tab
 * counts, so the cards and the badges can never drift. That is deliberate on
 * both sides: lib/mrn/queries.ts returns all three tabs in a single payload for
 * exactly this reason (the invariant CLAUDE_PICKING.md §5.1 is built on), and
 * this shell is the consumer that makes it pay.
 */
function MrnSupervisorShell({
  role,
  userName,
  userInitials,
  navItems,
}: FaceProps): React.JSX.Element {
  const [data, setData] = useState<MrnSupervisorBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MrnSupervisorTab>("toCheck");
  const [detailOpen, setDetailOpen] = useState(false);

  // Sends NO `date` — the route 400s on `date` with face=supervisor rather than
  // ignoring it, because the three tabs span all dates (design §11 OQ-6).
  const fetchBoard = useCallback(async (): Promise<MrnSupervisorBoard> => {
    const res = await fetch("/api/mrn/board?face=supervisor");
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
        const json = await fetchBoard();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load MRN board");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchBoard]);

  // A REFRESH of already-loaded data — silent on failure and never toggling
  // `loading`, so there is no spinner and no flicker. The error SCREEN belongs
  // solely to the initial load above; a refresh that fails keeps the last good
  // board rather than blanking it on a network blip. This is what will make it
  // safe for step 9's marker poll to drive.
  //
  // 🔴 A FETCH, NOT router.refresh(). See MrnBoardContextValue.refetchBoard.
  const refetchBoard = useCallback(async () => {
    try {
      setData(await fetchBoard());
    } catch {
      // silent — keep last good data, retry on the next trigger
    }
  }, [fetchBoard]);

  // Tabs: To check · Checking · Done, keys matching the labels and reusing
  // MrnSupervisorTab so the UI and the API can never disagree about a key.
  //
  // Icons are lucide Inbox → Package → CheckCircle2, which is BOTH what
  // docs/mockups/mrn/02-supervisor-mobile.html draws (its three inline SVGs are
  // those three icons verbatim) and the vocabulary the picking supervisor board
  // already taught this user: incoming work → goods being handled → finished.
  //
  // 🔴 DONE PASSES NO COUNT, DELIBERATELY. WorkflowTabBar renders no badge when
  // `count` is undefined, and a finished pile is a receipt, not work still owed
  // — the same rule as the picker's Done tab, and what the mockup's own note
  // states. Do not "fix" the missing badge later.
  const workflowTabs = useMemo<WorkflowTab[]>(
    () => [
      { key: "toCheck", label: "To check", count: data?.toCheck.length ?? 0, icon: Inbox },
      { key: "checking", label: "Checking", count: data?.checking.length ?? 0, icon: Package },
      { key: "done", label: "Done", icon: CheckCircle2 },
    ],
    [data],
  );

  const contextValue = useMemo<MrnBoardContextValue>(
    () => ({ data, loading, error, activeTab, refetchBoard, detailOpen, setDetailOpen }),
    [data, loading, error, activeTab, refetchBoard, detailOpen],
  );

  return (
    <RoleLayoutClient
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
      workflowTabs={workflowTabs}
      activeTabKey={activeTab}
      // Narrowed, never cast — see isMrnTabKey. An unrecognised key is ignored
      // rather than written into state as a lie.
      onTabChange={(key) => {
        if (isMrnTabKey(key)) setActiveTab(key);
      }}
      // Nothing flips this yet; step 9's detail screen will. Wired now so the
      // slot is already threaded when it does.
      hideBar={detailOpen}
    >
      <MrnBoardContext.Provider value={contextValue}>
        <MrnSupervisorPlaceholder />
      </MrnBoardContext.Provider>
    </RoleLayoutClient>
  );
}

/**
 * PLACEHOLDER — deliberately thin. Step 9 builds the real supervisor board.
 *
 * It exists to prove the whole circuit end to end: auth and the canView gate,
 * the role branch, the API payload, the three tabs, the counts, and that
 * useMrnBoard() reaches a descendant. No cards, no sheets, no detail screen —
 * those are step 9 and must not be started here.
 */
function MrnSupervisorPlaceholder(): React.JSX.Element {
  // Read from the shared provider rather than prop-drilled — the handlers stay
  // with the CALLER, which is why ModuleMobileHeader never calls
  // useMobileShell() itself (CLAUDE_UI.md §59.7).
  const { openMenu, openYou, userInitials } = useMobileShell();
  const { data, loading, error, activeTab } = useMrnBoard();

  const rows = data ? data[activeTab] : [];

  return (
    // fixed inset-0 escapes RoleLayoutClient's non-scrolling ancestor chain, so
    // the header pins and only the region below it scrolls — the frame
    // ModuleMobileHeader documents itself as expecting.
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f9fafb]">
      <ModuleMobileHeader
        title="MRN"
        avatarInitials={userInitials}
        onAvatarClick={openYou}
        onMenuClick={openMenu}
        // No search on the board — the same choice the picker face makes. The
        // icon is omitted with no gap left behind.
        showSearch={false}
      />

      {/* Only this scrolls. Bottom padding reserves room for the fixed
          WorkflowTabBar — MOBILE_NAV_CLEARANCE is imported, never retyped as
          76px: that literal was hand-copied three times before the constant
          existed and produced a render-behind-the-nav bug each time. */}
      <div
        className="flex-1 overflow-y-auto px-3.5 pt-3"
        style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}
      >
        {loading ? (
          <p className="text-[13px] text-gray-500">Loading…</p>
        ) : error ? (
          <p className="text-[13px] text-red-600">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-gray-500">Nothing in this tab.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-700"
              >
                <span className="font-semibold tabular-nums">{row.mrnNumber}</span>
                <span className="text-gray-400"> · </span>
                <span>Sr {row.srNo}</span>
                <span className="text-gray-400"> · </span>
                <span>{row.receivedFrom}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-[12px] leading-relaxed text-gray-400">
          Placeholder. Step 9 builds the real supervisor board — cards, the
          detail screen, and line confirm.
        </p>
      </div>
    </div>
  );
}

// ── Billing face ────────────────────────────────────────────────────────────

/**
 * Billing's desktop shell — RoleLayoutClient with NO workflowTabs, so the
 * default Home/Menu/You bar stands and the desktop sidebar renders as normal.
 *
 * ⚠ `workflowTabs={[]}` would NOT hide the bar — an empty array falls through
 * to the default bar (CLAUDE_UI.md §59.2's landmine). Hiding needs the explicit
 * `hideBar` prop. Neither is passed here: this face wants the default bar.
 *
 * Billing gets no live sync at all, by explicit owner decision (design §5) —
 * which is also why /api/mrn/marker is supervisor-only. Nothing here polls.
 */
function MrnBillingShell({
  perms,
  role,
  userName,
  userInitials,
  navItems,
}: FaceProps & { perms: MrnPerms }): React.JSX.Element {
  return (
    <RoleLayoutClient
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
    >
      <BillingBoard perms={perms} />
    </RoleLayoutClient>
  );
}

