"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Package, CheckCircle2, Layers } from "lucide-react";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import type { WorkflowTab } from "@/components/shared/workflow-tab-bar";
import type { NavItemConfig } from "@/lib/permissions";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickingQueueResult } from "@/lib/picking/queue";
import { splitPickerRows } from "@/lib/picking/picker-split";
import { usePickingMarker, type MarkerResync } from "@/lib/hooks/use-picking-marker";

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

// ── Picker face (2026-07-29) ────────────────────────────────────────────────
// The picker's Pending/Done strip moved to the shared bottom bar, the same
// Direction-A move the supervisor board made on 2026-07-19 — so its tab state
// had to move up here too, for the identical reason: RoleLayoutClient carries
// the `workflowTabs` slot and renders ABOVE the board in the tree.
//
// Deliberately SMALLER than PickingBoardContextValue above. This face fetches
// nothing client-side (app/picking/page.tsx resolves its rows server-side and
// passes them as props), so there is no data/loading/error/refetch to share —
// only which tab is showing, plus whether a bill is open.
//
// THREE tabs since 2026-08-07 — "combined" landed between the two originals.
// It is a VIEW of `pending`, not a fourth list: nothing is added to this
// context for it, because the board derives it from the same `pending` array
// the shell already owns and refreshes (which is also why it needs no second
// live-sync marker — CLAUDE_PICKING.md §10).
export type PickerTabKey = "pending" | "combined" | "done";

// ⚠️ THE RUNTIME GUARD THAT `tsc` CANNOT REPLACE. WorkflowTab.key is a bare
// `string` (components/shared/workflow-tab-bar.tsx), so onTabChange hands back
// a string, and this used to be resolved with `key as PickerTabKey` — a cast
// the compiler accepts unconditionally, which means a tab key that is NOT in
// the union above would have been written into state silently and every
// `activeTab === …` comparison downstream would then fall through to whatever
// its else-branch happens to be. Widening the union from two keys to three is
// exactly the change that would have exposed it. Narrow, never cast.
const PICKER_TAB_KEYS: readonly PickerTabKey[] = ["pending", "combined", "done"];

function isPickerTabKey(key: string): key is PickerTabKey {
  return (PICKER_TAB_KEYS as readonly string[]).includes(key);
}

interface PickerBoardContextValue {
  // Read-only in the board: its two writers were the TopBarTabs deleted with
  // the strip, and the bottom bar is the only writer now.
  activeTab: PickerTabKey;
  // The picker's two lists, split from `rows` by the ONE shared rule
  // (lib/picking/picker-split.ts). Owned here rather than passed as props from
  // the server page, because this face now refetches its own rows.
  pending: PickingQueueRow[];
  done:    PickingQueueRow[];
  // The ONE refresh path for this face. Called by the 15s marker and by Mark
  // Done. See PickerPickingShell for why it is a fetch and not router.refresh().
  //
  // `fromMarker` (2026-08-10) — pass true ONLY from the marker's own onChange.
  // Every other caller omits it and gets a marker resync, which is what stops a
  // second full rebuild ~15s after each Mark done. Optional with a safe default,
  // so the three existing call sites in the board are untouched.
  refetchQueue: (opts?: { fromMarker?: boolean }) => Promise<void>;
  /**
   * Where the board registers its marker's `resync` handle (2026-08-10).
   *
   * ⚠ This face's marker is mounted in the BOARD, not here — its `paused` reads
   * `marking`/`markingAll`, which are board-local state — so the shell cannot
   * call usePickingMarker itself without lifting those two flags, a larger
   * refactor than this step warrants. A ref through context is the minimal
   * bridge: the board registers, the shell CALLS. The resync call itself still
   * lives in exactly one place (refetchQueue), which is the point.
   */
  markerResyncRef: React.MutableRefObject<MarkerResync | null>;
  // Lifted from the board 2026-07-29 for the SAME reason detailOpen was lifted
  // to SupervisorPickingShell: RoleLayoutClient carries the `hideBar` slot and
  // renders ABOVE the board, so the shell has to know when a bill is open.
  // Read AND written by the board (every open/close call site lives there).
  detailOpen:    boolean;
  setDetailOpen: (open: boolean) => void;
}

const PickerBoardContext = createContext<PickerBoardContextValue | null>(null);

export function usePickerBoard(): PickerBoardContextValue {
  const ctx = useContext(PickerBoardContext);
  if (!ctx) {
    throw new Error("usePickerBoard must be used within a PickingMobileShell (picker face only)");
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
  // Picker-face seed data (2026-07-29). The server page resolves this picker's
  // rows and hands them over for FIRST PAINT only; from then on the shell
  // refetches them itself. Already narrowed to him server-side, so this is a
  // handful of rows in the RSC payload, not the whole board.
  pickerRows?:     PickingQueueRow[];
  pickerViewerId?: number | null;
  children:        React.ReactNode;
}

export function PickingMobileShell({
  role, userName, userInitials, navItems, showPickerFace, canSeePushTest,
  pickerRows, pickerViewerId, children,
}: PickingMobileShellProps): React.JSX.Element {
  // Picker face: its OWN two-tab bottom bar (Pending/Done) since 2026-07-29 —
  // it no longer falls through to the default Home/Menu/You nav. Menu and You
  // did not disappear; they demoted to the face's own header, exactly as the
  // supervisor board's did (CLAUDE_UI.md §59.5).
  const shell = showPickerFace ? (
    <PickerPickingShell
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
      initialRows={pickerRows ?? []}
      viewerId={pickerViewerId ?? null}
    >
      {children}
    </PickerPickingShell>
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

interface PickerPickingShellProps {
  role:         RoleSidebarRole;
  userName:     string;
  userInitials: string;
  navItems:     NavItemConfig[];
  initialRows:  PickingQueueRow[];
  viewerId:     number | null;
  children:     React.ReactNode;
}

/**
 * The picker face's shell — owns the active tab, the rows, and the refetch.
 *
 * ⚠️ WHY THIS FACE FETCHES INSTEAD OF CALLING router.refresh() (2026-07-29).
 * It used router.refresh(), and the refresh was silently thrown away. Next's
 * router action queue gives navigations priority: an ACTION_RESTORE — what the
 * history pop that closes a bill becomes — marks any pending action
 * `discarded = true` so its result is never applied
 * (node_modules/next/dist/shared/lib/router/action-queue.js:121-127), and only
 * a discarded SERVER ACTION gets the needsRefresh rescue. Mark Done therefore
 * left the bill in Pending until the 15s marker fired a second, uncontested
 * refresh. TWO attempts to fix that by timing failed, because the ordering is
 * the scheduler's, not ours. A plain fetch + setState never enters that queue
 * and cannot be discarded — which is why the supervisor board, doing the
 * identical history pop on Approve, never had this bug. Do not "simplify" this
 * back to router.refresh(): no build or type-check catches it, only a phone.
 *
 * Rows are SEEDED from the server render (initialRows) so first paint is
 * unchanged, then the phone owns them. Both sides split with the same
 * splitPickerRows() (lib/picking/picker-split.ts) — one rule, one place, so
 * server and client can never disagree about which tab a bill belongs to.
 *
 * Two tabs match the DATA — the stages are pick_assigned / pick_done /
 * pick_checked, so "pending" and "done" is the whole picture of STATE. The
 * third tab (2026-08-07) is NOT a third state: "combined" is a second VIEW of
 * pending, permanent, always present for every picker, and always mirroring
 * whatever `pending` currently holds. It adds no list here — the board derives
 * it from the same array, which is what keeps it live for free.
 *
 * Icons reuse the supervisor board's vocabulary (§ the workflowTabs memo
 * below in this file): Package = goods being fetched right now, CheckCircle2
 * = finished. Layers = the same bills stacked into one list. Inbox is
 * deliberately NOT reused — it means "waiting to be assigned", which is a
 * supervisor concept the picker never sees.
 *
 * Badge on Pending only. Done deliberately passes no `count`, so
 * WorkflowTabBar's `showBadge` is false and it renders none: a picker's
 * finished pile is a receipt, not work still requiring him — the same
 * reasoning that keeps isChecked out of the supervisor's Done badge.
 *
 * `hideBar` while a bill is open (2026-07-29) — the same thing the supervisor
 * shell does. Without it the bar (z-40) floats OVER the detail overlay
 * (z-[35]), so a tab tap silently swapped the list underneath a bill that
 * stayed on screen. The Mark Done CTA keeps its MOBILE_NAV_CLEARANCE padding:
 * over-reserving costs a little dead space at the bottom of a screen that has
 * room, while under-reserving would put the CTA back under the bar the moment
 * anything here changes.
 */
function PickerPickingShell({
  role, userName, userInitials, navItems, initialRows, viewerId, children,
}: PickerPickingShellProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<PickerTabKey>("pending");
  const [detailOpen, setDetailOpen] = useState(false);
  // Seeded from the server render — first paint is byte-identical to before
  // this face started fetching. The phone takes over only for UPDATES.
  const [rows, setRows] = useState<PickingQueueRow[]>(initialRows);

  // Narrowed server-side by pickerId: ~8 KB of his own bills instead of ~202 KB
  // of the whole board, and no other picker's work reaches this device. Silent
  // on failure, exactly like the supervisor's refetchQueue below — keep the
  // last good rows, never blank the board on a network blip; the next marker
  // tick or the next action retries.
  // Registered by the board's marker (see PickerBoardContextValue).
  const markerResyncRef = useRef<MarkerResync | null>(null);

  // ⚠ THE ONE PLACE THE DUPLICATE-RELOAD FIX LIVES for this face (2026-08-10),
  // mirroring SupervisorPickingShell below. Mark done — single and bulk — calls
  // this and nothing else, so telling the marker "already fresh" belongs here
  // rather than at each Mark-done call site.
  const refetchQueue = useCallback(async (opts?: { fromMarker?: boolean }) => {
    if (viewerId === null) return;
    try {
      const res = await fetch(`/api/picking/queue?scope=openPending&pickerId=${viewerId}`);
      if (!res.ok) return;
      const json = (await res.json()) as PickingQueueResult;
      setRows(json.rows);
      // Skipped when the marker itself asked for this — it has already
      // re-baselined, so a resync would be a pointless extra probe.
      if (!opts?.fromMarker) await markerResyncRef.current?.();
    } catch {
      // silent — keep last good data, retry on the next trigger
    }
  }, [viewerId]);

  // THE one split, shared with app/picking/page.tsx. The clock is passed in
  // (never read inside), and the IST derivation there is host-independent —
  // which matters now that this runs on a phone in Asia/Kolkata as well as on
  // Vercel in UTC. Order is the server's PICKING_SPINE; this only filters.
  const { pending, done } = useMemo(
    () => splitPickerRows(rows, viewerId, new Date()),
    [rows, viewerId],
  );

  // Badge on Pending ONLY — `combined` and `done` both deliberately pass no
  // count, so WorkflowTabBar's `showBadge` is false and neither renders one.
  // Done: a picker's finished pile is a receipt, not work still requiring him.
  // Combined: it is the SAME work as Pending seen a different way, so a second
  // badge counting the same bills would double-report the day's load — and a
  // product count there would compete with the number that means "bills left".
  const workflowTabs = useMemo<WorkflowTab[]>(
    () => [
      { key: "pending", label: "Pending", count: pending.length, icon: Package },
      { key: "combined", label: "Combined", icon: Layers },
      { key: "done", label: "Done", icon: CheckCircle2 },
    ],
    [pending.length],
  );

  const contextValue = useMemo<PickerBoardContextValue>(
    // markerResyncRef is a stable ref object — it never changes identity, so it
    // adds nothing to this memo's deps.
    () => ({ activeTab, pending, done, refetchQueue, detailOpen, setDetailOpen, markerResyncRef }),
    [activeTab, pending, done, refetchQueue, detailOpen],
  );

  return (
    <RoleLayoutClient
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
      workflowTabs={workflowTabs}
      activeTabKey={activeTab}
      // Narrowed, never cast — see isPickerTabKey above. An unrecognised key
      // is ignored rather than written into state as a lie.
      onTabChange={(key) => {
        if (isPickerTabKey(key)) setActiveTab(key);
      }}
      hideBar={detailOpen}
    >
      <PickerBoardContext.Provider value={contextValue}>
        {children}
      </PickerBoardContext.Provider>
    </RoleLayoutClient>
  );
}

function SupervisorPickingShell({
  role, userName, userInitials, navItems, children,
}: Omit<
  PickingMobileShellProps,
  "showPickerFace" | "canSeePushTest" | "pickerRows" | "pickerViewerId"
>): React.JSX.Element {
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
  // This is now the ONLY board that fetches this endpoint from a browser. The
  // desktop table that used to send its own `?scope=rolling&date=<D>` was
  // archived 2026-07-28 (archive/2026-07-picking-desktop/); the picker face
  // gets the same openPending rows server-side via app/picking/page.tsx:143.
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

  // Handle to the marker's resync (2026-08-10). Held in a ref because
  // refetchQueue is defined ABOVE the usePickingMarker call that produces it —
  // the marker needs refetchQueue as its onChange, so the two cannot both be
  // plain values in dependency order.
  const markerResyncRef = useRef<MarkerResync | null>(null);

  // A REFRESH of already-loaded data — deliberately silent on failure: keep the
  // last good board (the error SCREEN is owned only by the initial load() above)
  // and never toggle `loading` (no spinner, no flicker). This is what makes it
  // safe for the 15s background poll to drive, and is also strictly better for
  // the foreground assign/undo/approve callers — a bill already persisted, so a
  // failed follow-up refresh must not wipe the board. The next marker tick or
  // user action recovers the data.
  //
  // ⚠ THE ONE PLACE THE DUPLICATE-RELOAD FIX LIVES (2026-08-10). Every write
  // action in PickingBoardMobile calls this and nothing else, so telling the
  // marker "already fresh" belongs HERE — not scattered across the seven action
  // call sites, where the next new action would silently forget it.
  //
  // `fromMarker` distinguishes the two callers. The marker's own onChange passes
  // true (it has just re-baselined itself — resyncing would be a pointless extra
  // probe); every user action leaves it at the default false and resyncs, which
  // stops the marker firing a second full rebuild ~15s later for a change the
  // supervisor is already looking at. Optional with a safe default, so the
  // context type below stays `() => Promise<void>` and the board is untouched.
  const refetchQueue = useCallback(async (opts?: { fromMarker?: boolean }) => {
    try {
      const json = await fetchQueue();
      setData(json);
      if (!opts?.fromMarker) await markerResyncRef.current?.();
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
  const markerResync = usePickingMarker({
    scope: "openPending",
    onChange: () => {
      void refetchQueue({ fromMarker: true });
    },
    paused: detailOpen || overlayBusy,
  });

  useEffect(() => {
    markerResyncRef.current = markerResync;
  }, [markerResync]);

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
