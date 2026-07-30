"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { toast } from "sonner";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { AgeBadge, CardShelf, CARD_SHADOW_V2, RouteDot } from "./card-atoms";
import { usePickerBoard } from "./picking-mobile-shell";
import { NO_BILL_SWIPE_ATTR, useBillPager } from "./use-bill-pager";
import type { PickerTabKey } from "./picking-mobile-shell";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickerRosterEntry } from "@/lib/picking/picker-roster";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";

// Card shell shadow — lifted verbatim from picking-board-mobile.tsx's
// SOFT_CARD_SHADOW, the fidelity source for this whole face
// (docs/mockups/picking/picker-my-bills.html is the approved design; the
// live component is the source of truth wherever the two would disagree).
const SOFT_CARD_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 3px 12px rgba(16,24,40,0.05)";

// Same sentinel/convention as picking-board-mobile.tsx's detail screen —
// kept out of the "ALL" bucket so a null-pack line stays isolable.
const NO_PACK_KEY = "__no_pack__";

// Spread onto an element that must keep its OWN horizontal drag instead of
// feeding the bill-swipe pager. Written as a spread of the exported attribute
// name rather than a hand-typed string, so a rename in use-bill-pager.ts can
// never silently orphan this call site into a no-op.
const NO_BILL_SWIPE: Record<string, string> = { [NO_BILL_SWIPE_ATTR]: "" };

// Real GET /api/picking/order/[orderId] response shape — see that route.
// Duplicated from picking-board-mobile.tsx rather than imported: that file
// is untouched this stage (per constraints), and this shape is small/stable.
interface LineItem {
  id: number;
  name: string | null;
  sku: string;
  pack: string | null;
  qty: number;
}

interface PickerMyPicksBoardProps {
  // `pending`/`done` are NOT props any more (2026-07-29) — they come from
  // PickerBoardContext, because the shell now owns the rows and refetches them
  // itself. Everything below is still passed down: it is identity and roster
  // data the server resolved, not list data.
  isAdmin: boolean;
  pickers: PickerRosterEntry[];
  activePickerId: number | null;
}

// Same locale/timezone/format as picking-board-mobile.tsx's
// formatAssignedTime — duplicated (see file-top note), not imported.
// Returns null when pickedAt is missing (the "Done" tab card omits the
// time rather than fabricating one) — matches this file's own convention
// for every other nullable-timestamp display.
function formatPickedTime(pickedAt: Date | string | null): string | null {
  if (pickedAt === null) return null;
  const d = new Date(pickedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
}

// Same rounding/formatting rule as picking-board-mobile.tsx's formatLitres —
// duplicated (see file-top note), not imported.
function formatLitres(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const isWhole = Number.isInteger(rounded);
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: isWhole ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

// ── Private line ticks — DEVICE-LOCAL, AND THAT IS THE WHOLE POINT ────────
// (2026-07-30) The picker can tick off lines as he fetches them. These are HIS
// NOTES, not a record of him:
//
//   • They gate NOTHING. Mark done is always enabled — see the CTA below.
//     There is deliberately no code path anywhere in this file that reads a
//     tick to decide anything. If one ever appears, the feature has changed
//     meaning and this comment is the thing that was violated.
//   • They NEVER leave the device. No API call carries them, no column stores
//     them, no supervisor screen can read them. The moment they are readable
//     by someone else they stop being notes and become a record of him.
//
// ⚠ DO NOT "improve" this by moving them server-side, by folding them into the
// POST /api/picking/done body, or by reusing them to pre-fill anything the
// supervisor sees. The supervisor's OWN ticks (picking-board-mobile.tsx's
// checkedLineIds) look identical on purpose and are a different feature: they
// gate its Approve button. Same look, deliberately separate plumbing — the
// supervisor's are in-memory component state that dies with the screen, these
// are persisted per bill so a swipe away and back does not lose his place.
//
// SHAPE — one JSON blob under one key: { [orderId]: { t: lastTouchedMs, ids:
// [lineItemId, …] }. Keyed by the line's STABLE id, never its position, so a
// refetch that reorders or re-filters the lines can never move a tick onto a
// different item. Entries are dropped when empty.
//
// PRUNING — applied on EVERY write, so the blob can never grow without bound:
// last-touched older than 7 days is dropped, then the 50 most recently touched
// bills are kept. 7 days is chosen against the real list rule: the picker's
// Pending tab is deliberately NOT date-fenced (lib/picking/picker-split.ts), so
// a bill left mid-shift is still his next morning and a 24h window would wipe
// his notes on exactly the bill he is still holding. 50 is a backstop, not the
// working limit — no picker holds anything near that many bills at once.
//
// Every access is wrapped: localStorage throws in private-mode Safari and on
// quota, and notes are never worth breaking the screen for. Failure is silent
// and the ticks simply behave as empty.
const TICKS_STORAGE_KEY = "orbit.picking.picker-line-ticks.v1";
const TICKS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TICKS_MAX_BILLS = 50;

interface TickEntry {
  /** Epoch ms this bill's ticks were last written — the pruning clock. */
  t: number;
  ids: number[];
}
type TickStore = Record<string, TickEntry>;

function readTickStore(): TickStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TICKS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Shape-check each entry rather than trusting the blob: it is user-device
    // storage, so a half-written or hand-edited value must degrade to "no
    // ticks", never to a crash inside the detail screen.
    const out: TickStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== "object") continue;
      const entry = value as { t?: unknown; ids?: unknown };
      if (typeof entry.t !== "number" || !Array.isArray(entry.ids)) continue;
      out[key] = { t: entry.t, ids: entry.ids.filter((n): n is number => typeof n === "number") };
    }
    return out;
  } catch {
    return {};
  }
}

/** Age prune, then most-recent cap. See the pruning note above. */
function pruneTickStore(store: TickStore, nowMs: number): TickStore {
  const fresh = Object.entries(store).filter(([, v]) => nowMs - v.t <= TICKS_MAX_AGE_MS);
  fresh.sort((a, b) => b[1].t - a[1].t);
  const out: TickStore = {};
  for (const [key, value] of fresh.slice(0, TICKS_MAX_BILLS)) out[key] = value;
  return out;
}

function writeTickStore(store: TickStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TICKS_STORAGE_KEY, JSON.stringify(pruneTickStore(store, Date.now())));
  } catch {
    // Silent — a note that could not be saved must never interrupt picking.
  }
}

function readTicks(orderId: number): Set<number> {
  return new Set(readTickStore()[String(orderId)]?.ids ?? []);
}

/** Persist this bill's ticks. An empty set REMOVES the entry — unticking
 *  everything leaves no residue to prune later. */
function writeTicks(orderId: number, ids: Set<number>): void {
  const store = readTickStore();
  if (ids.size === 0) delete store[String(orderId)];
  else store[String(orderId)] = { t: Date.now(), ids: Array.from(ids) };
  writeTickStore(store);
}

function clearTicks(orderId: number): void {
  writeTicks(orderId, new Set());
}

// The local TopBarTab copy that used to live here (a self-declared third
// copy of picking-board-mobile.tsx's original) was DELETED 2026-07-29: the
// Pending/Done strip moved to the shared bottom bar (WorkflowTabBar, driven
// by PickerPickingShell in picking-mobile-shell.tsx), the same Direction-A
// move the supervisor board made on 2026-07-19. CLAUDE_PICKING.md §5.4's
// note that this face "keeps a local TopBarTab copy" is now stale.

/**
 * The picker's own list. `pending`/`done` arrive already scoped server-side
 * (page.tsx filters lib/picking/queue.ts's rows by pickerId before this
 * component ever sees them) — this component does not widen that scope
 * itself, including for the Mark Done write below (POSTs the same
 * server-resolved `activePickerId`, never a client-invented identity).
 * Mark Done is fire-and-forget — toast, then back to the list via a history
 * pop, with the server refresh DEFERRED until that pop has committed; no
 * confirm sheet (the Done tab is the safety net).
 */
export function PickerMyPicksBoard({
  isAdmin, pickers, activePickerId,
}: PickerMyPicksBoardProps): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();

  // Menu/You handlers + the signed-in user's initials for the shared header.
  // The provider is already mounted globally by role-layout-client.tsx:46 —
  // this face reaches the SAME sheet instances the bottom bar used to open,
  // so no second copy of that markup is mounted.
  const { openMenu, openYou, userInitials } = useMobileShell();

  // Tab state now lives ONE level up, in PickerPickingShell — the bottom bar
  // that switches it is rendered by RoleLayoutClient, which sits ABOVE this
  // board in the tree (same reason the supervisor board's activeTab moved to
  // SupervisorPickingShell in Stage 3). `activeTab` is read-only here — this
  // face's only two writers were the TopBarTabs that came out with the strip.
  //
  // `detailOpen` moved up with it (2026-07-29) so the shell can pass hideBar:
  // the bar is z-40 and this face's detail overlay is z-[35], so it used to
  // float over an open bill and a tab tap swapped the list underneath it. Read
  // AND written here — every open/close call site is in this file — and it
  // still drives the marker pause below exactly as before.
  // `pending`/`done`/`refetchQueue` joined this context on 2026-07-29 when the
  // shell took ownership of the rows — see PickerPickingShell for why this face
  // fetches rather than calling router.refresh().
  const { activeTab, pending, done, refetchQueue, detailOpen, setDetailOpen } = usePickerBoard();

  // Detail overlay — always-mounted, translateX slide, same pattern as
  // picking-board-mobile.tsx's detail screen so the list underneath is never
  // torn down.
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  // WHICH list this bill was opened from — Pending or Done. Captured at open,
  // never re-derived from activeTab later: the swipe pager must walk the list
  // he actually opened from and must NEVER cross between the two (a Pending
  // bill and a Done bill are different work, and the Done tab is fenced to
  // today-IST while Pending is not). The supervisor's DetailListKey exists for
  // the same reason; here there is exactly one band per tab, so the tab key IS
  // the list key. Today the bottom bar is hidden while a bill is open
  // (hideBar), so activeTab cannot change mid-session anyway — this keeps the
  // pager correct if that ever stops being true.
  const [detailListKey, setDetailListKey] = useState<PickerTabKey>("pending");
  const [lineItems, setLineItems] = useState<LineItem[] | null>(null);
  const [lineItemsLoading, setLineItemsLoading] = useState(false);
  const [lineItemsError, setLineItemsError] = useState<string | null>(null);
  const [activePackFilter, setActivePackFilter] = useState<string>("ALL");
  // The OPEN bill's private ticks, mirrored from device storage. Held as state
  // so a tap re-renders; the storage blob is the durable copy. Loaded
  // synchronously in switchDetailTo (not in an effect keyed on detailOrderId)
  // so a swipe to a neighbour bill never renders one bill's lines against the
  // previous bill's ticks, not even for a frame.
  //
  // ⚠ Nothing below reads this to decide anything. It feeds the tick circles
  // and the counter, and nothing else. Mark done does not look at it.
  const [tickedLineIds, setTickedLineIds] = useState<Set<number>>(new Set());
  // In-flight guard — disables the CTA so a double-tap can't fire two
  // overlapping POSTs (the server's own PICK_ASSIGNED guard would 409 the
  // second one anyway, but this avoids firing it at all).
  const [marking, setMarking] = useState(false);

  // Live sync (2026-07-22) — poll the cheap marker every 15s; on a real change,
  // refetch this picker's rows. The marker GATE is what keeps that cheap: the
  // probe is ~84 bytes, the queue fetch behind it only fires when his board
  // actually moved, never on a bare timer.
  //
  // ⚠️ onChange was router.refresh() until 2026-07-29 and is now the shell's
  // refetchQueue — see PickerPickingShell's comment for why a refresh cannot be
  // trusted on this face (a history pop discards it).
  //
  // scope="openPending" — the SAME scope the rows are fetched with, on both the
  // server (app/picking/page.tsx) and the shell's refetch. pickerId=
  // activePickerId NARROWS the marker to THIS picker's rows, so his phone only
  // wakes when HIS bills change — assigned-to-him, his mark-done, a supervisor
  // approving his bill, or a bill leaving his set (unassign/reassign-away drops
  // the marker COUNT) — never on a board-wide edit that isn't his. Falls back to
  // board-wide (undefined) only when no picker is resolved, when the board is
  // empty anyway.
  //
  // paused = detailOpen || marking. detailOpen — NOT detailOrderId, which never
  // resets to null once a bill has been opened (closeDetail only flips
  // detailOpen), so it would pause forever after the first open — is the true
  // "detail visibly open" signal. A refresh while a bill is open could shift or
  // blank detailRow ([...pending,...done].find, below) if the bill left his
  // scope; deferring until he backs out avoids that. On unpause, if the marker
  // moved meanwhile, the hook fires onChange once.
  usePickingMarker({
    scope: "openPending",
    pickerId: activePickerId ?? undefined,
    onChange: refetchQueue,
    paused: detailOpen || marking,
  });

  useEffect(() => {
    if (detailOrderId === null) return;
    let cancelled = false;
    setLineItemsLoading(true);
    setLineItemsError(null);
    setLineItems(null);
    async function load() {
      try {
        const res = await fetch(`/api/picking/order/${detailOrderId}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { lines?: LineItem[] };
        if (!cancelled) setLineItems(json.lines ?? []);
      } catch (err) {
        if (!cancelled) setLineItemsError(err instanceof Error ? err.message : "Failed to load line items");
      } finally {
        if (!cancelled) setLineItemsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [detailOrderId]);

  // ── In-module back navigation (2026-07-29) ───────────────────────────────
  // Before this, a back press with a bill open was not intercepted at all: the
  // browser popped whatever preceded /picking and the picker lost the whole
  // board, not just the bill. Android back and iOS edge-swipe now close the
  // bill and stay here.
  //
  // Deliberately this face's OWN minimal version, not a shared hook. The
  // supervisor's authority (picking-board-mobile.tsx:1311-1330) carries a
  // nested-sheet branch — close the sheet, re-push, keep the detail entry
  // alive — and this face has no sheets. Sharing would mean growing a
  // "did the caller handle this pop?" callback purely to carry the
  // supervisor's sheet case into a common file. If this face ever gets its
  // own sheets, the two shapes converge and extraction becomes worth it.
  //
  // navStateRef mirrors detailOpen so the listener — registered once — reads
  // it live instead of through a stale closure (the same reason the
  // supervisor keeps its own navStateRef).
  const navStateRef = useRef(false);
  useEffect(() => {
    navStateRef.current = detailOpen;
  }, [detailOpen]);

  // Push one entry at the CURRENT url (pushState with no url arg navigates
  // nowhere), so a back from it is a pure in-app state change and never a real
  // page transition. Called ONLY by openDetail — one entry for the whole
  // detail session, exactly like the supervisor's pushScreen.
  function pushScreen(): void {
    if (typeof window === "undefined") return;
    window.history.pushState({ pickingScreen: "picker-detail" }, "");
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPop(): void {
      if (navStateRef.current) closeDetail();
      // Nothing open — let the pop fall through to the browser's real
      // previous entry, whatever that is.
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // setDetailOpen is a plain useState setter threaded through context, so its
    // identity is stable — this registers once for the life of the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setDetailOpen]);

  // Shared by BOTH the original open (openDetail) and paging to a neighbour
  // bill (the pager's onSwitch) — the same per-bill state must never carry from
  // one bill into the next either way. activePackFilter RESETS (it is a view
  // setting, meaningless on the next bill); the ticks are RE-READ for the bill
  // being opened, because they belong to that bill and must come back exactly
  // as he left them when he swipes away and returns. The line items themselves
  // are re-fetched by the detailOrderId-keyed effect above, which fires on a
  // swap exactly as it does on a fresh open. Re-setting detailOpen(true) on
  // every call is harmless (already true while paging) — same shape as the
  // supervisor's switchDetailTo.
  function switchDetailTo(orderId: number, listKey: PickerTabKey): void {
    setDetailOrderId(orderId);
    setDetailListKey(listKey);
    setDetailOpen(true);
    setActivePackFilter("ALL");
    setTickedLineIds(readTicks(orderId));
  }

  // Tap toggles. Write-through to device storage on every tap, so nothing is
  // lost if the phone sleeps or the tab is discarded mid-bill. Computed off the
  // current state OUTSIDE the setState updater — the updater stays pure, and
  // the storage write happens exactly once per tap.
  function toggleLineTick(lineId: number): void {
    const orderId = detailOrderId;
    if (orderId === null) return;
    const next = new Set(tickedLineIds);
    if (next.has(lineId)) next.delete(lineId);
    else next.add(lineId);
    setTickedLineIds(next);
    writeTicks(orderId, next);
  }

  function openDetail(orderId: number, listKey: PickerTabKey): void {
    switchDetailTo(orderId, listKey);
    // A fresh open from a card tap must always start at rest, in case a prior
    // session's gesture left the ref mid-transform. (`pager` is declared
    // below; this only ever runs from a tap, long after that render.)
    pager.resetTransform();
    // ONE history entry for the whole detail session — see pushScreen. The
    // pager deliberately pushes NOTHING, so swiping through six bills still
    // costs one entry and one back press lands on the list.
    pushScreen();
  }

  // The REAL close — reachable ONLY from the popstate handler above, so every
  // close path (header chevron, Mark Done success, Android back, iOS
  // edge-swipe) runs the identical logic. Never call this directly: call
  // window.history.back() and let the pop land here. Two close paths that
  // disagree is precisely the desync the supervisor board documents at
  // picking-board-mobile.tsx:1423-1428.
  function closeDetail(): void {
    setDetailOpen(false);
  }

  // (The deferred-refresh flag + edge effect that lived here between
  // 9941bedb and 2026-07-29 are GONE — they existed only to dodge the router
  // action queue, and this face no longer touches it. The knowledge they
  // carried now sits with the mechanism that replaced them, in
  // PickerPickingShell.)

  const rows = activeTab === "pending" ? pending : done;

  const detailRow: PickingQueueRow | null = useMemo(() => {
    if (detailOrderId === null) return null;
    return [...pending, ...done].find((r) => r.orderId === detailOrderId) ?? null;
  }, [pending, done, detailOrderId]);

  // ── Swipe between bills (2026-07-30) ─────────────────────────────────────
  // The list the pager walks, re-resolved EVERY render off the live
  // pending/done arrays — never a snapshot frozen at open time. This face's
  // rows are refetched by the 15s marker and by Mark Done, so a frozen array
  // would page to a bill that is no longer his.
  //
  // ⚠ IF THE OPEN BILL LEAVES THE LIST (a supervisor reassigns it away while
  // he is holding it) the hook's index goes to -1 and paging simply stops:
  // both arrows are unreachable/inert, and a swipe past the threshold snaps
  // back instead of committing. detailRow (above) resolves to null, so the
  // header shows "—" and the Mark done CTA is already gated off it — the
  // fetched line items stay on screen and the ONE close path still works. No
  // crash, no blank screen, and no silent jump to somebody else's bill.
  // (In practice the marker is PAUSED while a bill is open, so the rows are
  // frozen for the duration of a detail session — this is the guard for the
  // day that pause changes, not a routine path.)
  const activeDetailList = detailListKey === "pending" ? pending : done;
  const pager = useBillPager({
    list: activeDetailList,
    currentOrderId: detailOrderId,
    onSwitch: (orderId) => switchDetailTo(orderId, detailListKey),
  });

  // Fire-and-forget: toast, close via history, then await the refetch — no
  // confirm sheet. Same order the supervisor's Approve uses.
  // Sends the server-resolved activePickerId (never a client-invented
  // value); the API's own ownership check re-verifies it against the
  // order's real pick_assignments row regardless (see app/api/picking/
  // done/route.ts's file-top comment).
  const handleMarkDone = useCallback(async () => {
    if (detailRow === null || activePickerId === null || marking) return;
    setMarking(true);
    try {
      const res = await fetch("/api/picking/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: detailRow.orderId, pickerId: activePickerId }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        // 409 = the bill moved out from under him while this screen sat open.
        // POST /api/picking/done returns it for BOTH conflicts — the stage is
        // no longer PICK_ASSIGNED (route.ts:98, e.g. a double-tap whose first
        // call already landed) and the bill is assigned to someone else now
        // (route.ts:109, a supervisor reassigned it). Neither is a failure to
        // report as one: same wording and same refresh-and-move-on shape the
        // supervisor board uses for its own 409s (picking-board-mobile.tsx:
        // 1459/1503/1536), so the module says this one thing one way.
        if (res.status === 409) {
          toast("Already changed — refreshed.");
          // Close, then refetch — same order as the success path. Closing
          // matters here too: the bill is no longer his, so leaving the screen
          // open would show line items for a bill that has left his list
          // (detailRow resolves to null and the header blanks).
          window.history.back();
          await refetchQueue();
        } else {
          toast.error(json.error ?? `Request failed (${res.status})`);
        }
        return;
      }
      toast.success(`${detailRow.dealerName} marked done`);
      // The bill is finished, so his private notes on it have served their
      // purpose — drop them now rather than leaving them for the pruner. This
      // is the ONLY place Mark done touches the ticks, and it happens AFTER a
      // successful write: it reads nothing, gates nothing, and would behave
      // identically had he ticked every line or none.
      clearTicks(detailRow.orderId);
      setTickedLineIds(new Set());
      // Closes through history so the pushed entry is consumed and the ONE
      // popstate authority does the closing — never setDetailOpen directly.
      // Unconditional, like the supervisor's Approve (picking-board-mobile.tsx
      // :1547) and unlike its Assign: this CTA renders only inside the detail
      // screen, so an entry was always pushed. Nothing else can reach it.
      window.history.back();
      // Then refetch — the exact shape of the supervisor's Approve
      // (:1547-1548), which does this same pop and has never lagged. The pop
      // cannot discard a plain fetch the way it discarded router.refresh().
      await refetchQueue();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mark done failed");
    } finally {
      setMarking(false);
    }
    // `router` is deliberately absent — this callback never touches it. The
    // refresh is refetchQueue, owned by the shell.
  }, [detailRow, activePickerId, marking, refetchQueue]);

  const distinctPackKeys = useMemo(() => {
    if (!lineItems) return [];
    const set = new Set<string>();
    for (const li of lineItems) set.add(li.pack ?? NO_PACK_KEY);
    const keys = Array.from(set);
    const real = keys.filter((k) => k !== NO_PACK_KEY).sort((a, b) => a.localeCompare(b));
    return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
  }, [lineItems]);

  const filteredLineItems = useMemo(() => {
    if (!lineItems) return [];
    if (activePackFilter === "ALL") return lineItems;
    return lineItems.filter((li) => (li.pack ?? NO_PACK_KEY) === activePackFilter);
  }, [lineItems, activePackFilter]);

  // Counted against the FULL line set, never filteredLineItems — the pack chips
  // are a view filter and his progress through the bill does not change when he
  // narrows the view. Derived by intersecting with the lines actually present,
  // so a stored tick for a line that is no longer on the bill cannot inflate
  // the number. Purely informational: nothing branches on it.
  const tickedCount = useMemo(
    () => (lineItems ?? []).filter((li) => tickedLineIds.has(li.id)).length,
    [lineItems, tickedLineIds],
  );

  // Admin "view as" — re-runs the server component's scoped fetch for the
  // newly chosen picker via a query-param navigation. No client-side
  // fetch of another picker's data ever happens here.
  function handleViewAsChange(newPickerId: string): void {
    const params = new URLSearchParams();
    params.set("view", "picker");
    params.set("as", newPickerId);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f9fafb]">
      {/* Admin-only debug strip — deliberately outside the app's visual
          language (dark, dashed amber border, monospace) so it never reads
          as something a real picker would see. Matches
          docs/mockups/picking/picker-my-bills.html's debugstrip. */}
      {isAdmin && (
        <div className="flex-shrink-0 bg-gray-900 border-b-2 border-dashed border-amber-500 px-3.5 py-2 flex items-center gap-2">
          <span className="font-mono text-[9.5px] font-bold text-amber-500 uppercase tracking-wide whitespace-nowrap">
            ⚙ Admin — view as
          </span>
          <select
            value={activePickerId ?? ""}
            onChange={(e) => handleViewAsChange(e.target.value)}
            className="flex-1 min-w-0 bg-gray-800 text-white border border-gray-600 rounded-[6px] px-2 py-1 text-[12px] font-semibold font-mono"
          >
            {pickers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Shared Direction-A header (2026-07-29) — the same component the
          supervisor board uses (components/shared/module-mobile-header.tsx),
          so the two picking faces stop drifting. showSearch={false}: this
          face has no search, and the header leaves no gap where the icon
          would be. Replaces the hand-rolled teal block that carried the
          title, the viewer's name and the Pending/Done TopBarTab strip; the
          tabs are now the bottom bar (PickerPickingShell) and identity lives
          in the avatar → You sheet. */}
      <ModuleMobileHeader
        title="My Picks"
        avatarInitials={userInitials}
        onAvatarClick={openYou}
        onMenuClick={openMenu}
        showSearch={false}
      />

      {/* Card list. Four rows (2026-07-29): caption + flags · name · where ·
          families. Still NO checkbox, NO elapsed pill, NO avatar, NO footer —
          those are supervisor concerns. Reserves 76px for the shell's fixed
          bottom bar (components/shared/mobile-shell.tsx), same convention as
          picking-board-mobile.tsx. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[76px] bg-white border-b border-gray-200 px-4 py-2.5">
        {rows.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-16">
            {activeTab === "pending" ? "Nothing pending." : "Nothing marked done yet today."}
          </p>
        ) : (
          rows.map((row) => (
            <button
              key={row.orderId}
              type="button"
              onClick={() => openDetail(row.orderId, activeTab)}
              className="block w-full text-left mb-[11px] rounded-[20px] overflow-hidden border-[1.5px] bg-white border-[#eceef2] active:bg-gray-50"
              style={{ boxShadow: CARD_SHADOW_V2 }}
            >
              {/* Card body — the supervisor card's exact frame and rhythm
                  (px-4 pt-3.5 pb-3, caption mb-1.5, where-row mt-1.5). The
                  four deliberate divergences are marked below; everything else
                  is the same language, so a supervisor and a picker looking at
                  the same bill see the same card. */}
              <div className="px-4 pt-3.5 pb-3">
                {/* Caption row — bill number left, signals right. NO created
                    timestamp: the supervisor's caption carries `· 19 Jul, 4:05
                    PM` here, but a picker fetching goods has no use for when
                    the order was raised (DIVERGENCE 2).
                    Star BEFORE the age badge, matching the supervisor's
                    cluster order and its gap-[7px]. Both are INFORMATION, not
                    controls — no button language, no handler; the whole card
                    is the single tap target. */}
                <div className="flex items-center justify-between gap-2.5 mb-1.5">
                  <span
                    className="flex items-center gap-1.5 min-w-0 text-[11.5px] overflow-hidden whitespace-nowrap"
                    style={{ color: "#98a2b3" }}
                  >
                    <span className="font-mono shrink-0" style={{ color: "#98a0aa" }}>
                      {row.obdNumber}
                    </span>
                  </span>
                  <span className="flex items-center gap-[7px] shrink-0">
                    {row.isKeyCustomer && <Star size={14} className="text-amber-500 fill-amber-500" />}
                    <AgeBadge row={row} />
                  </span>
                </div>

                {/* Title row — customer name + the slot hero on its right, the
                    supervisor's rich-variant treatment (15px/600 tabular-nums
                    #475467). The name truncates; the slot never does. */}
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="text-[16px] font-semibold leading-[1.25] truncate min-w-0"
                    style={{ color: "#1d2939" }}
                  >
                    {row.dealerName}
                  </span>
                  {row.windowTime !== null && (
                    <span className="text-[15px] font-semibold tabular-nums shrink-0" style={{ color: "#475467" }}>
                      {row.windowTime}
                    </span>
                  )}
                </div>

                {/* Where row — dot · area · pack summary · volume. The pack
                    summary (articleTag) is DIVERGENCE 1: the supervisor card
                    dropped it in Option G, but it is what the picker actually
                    loads against, so it stays — inserted between area and
                    volume, sharing the truncating left span, with volume
                    shrink-0 so the litres are never the part that clips.
                    There is no picker-name slot on the right (DIVERGENCE 4):
                    on his own board, the picker IS the viewer. */}
                <div className="flex items-center justify-between gap-2.5 mt-1.5">
                  <span className="flex items-center gap-2 min-w-0">
                    <RouteDot deliveryType={row.deliveryType} />
                    <span className="text-[12px] font-medium truncate min-w-0" style={{ color: "#667085" }}>
                      {row.area ?? "—"}
                    </span>
                    {row.articleTag !== null && (
                      <>
                        <span className="shrink-0" style={{ color: "#d3d8de" }}>
                          &middot;
                        </span>
                        <span className="text-[12px] font-medium truncate min-w-0" style={{ color: "#667085" }}>
                          {row.articleTag}
                        </span>
                      </>
                    )}
                    {row.volumeLitres != null && (
                      <>
                        <span className="shrink-0" style={{ color: "#d3d8de" }}>
                          &middot;
                        </span>
                        <span className="flex items-baseline gap-[3px] shrink-0">
                          <span className="text-[12px] font-semibold tabular-nums" style={{ color: "#667085" }}>
                            {formatLitres(row.volumeLitres)}
                          </span>
                          <span className="text-[10.5px] font-medium" style={{ color: "#98a2b3" }}>
                            L
                          </span>
                        </span>
                      </>
                    )}
                  </span>
                </div>
              </div>

              {/* Shelf — the SHARED component (divider + grey band + chips +
                  fade). No arrow: the whole card opens detail here, so the
                  right slot carries the Done tab's receipt instead
                  (DIVERGENCE 3 — the timestamp moved out of the top-right
                  corner). Its typography mirrors the supervisor's own done
                  line, `✓ Checked by … · {time}`: 12px/600, label #8a929c,
                  time #a2aab4. Never fabricates a time — a row with no
                  pickedAt passes null and the slot stays empty. */}
              <CardShelf
                row={row}
                trailing={
                  activeTab === "done" && formatPickedTime(row.pickedAt) !== null ? (
                    <span
                      className="shrink-0 self-stretch flex items-center gap-1 pl-1.5 text-[12px] font-semibold whitespace-nowrap"
                      style={{ color: "#8a929c" }}
                    >
                      done
                      <span style={{ color: "#a2aab4" }}>{formatPickedTime(row.pickedAt)}</span>
                    </span>
                  ) : null
                }
              />
            </button>
          ))
        )}
      </div>

      {/* Detail screen — reuses the live board's detail-screen pattern: teal
          header, articleTag+volume stat strip, pack chips (only when ≥2
          distinct packs), pack-tile/SKU-hero/qty line items with a private
          tick per line, plus a Mark done CTA below (fire-and-forget, no
          confirm — see handleMarkDone). CTA only renders for pending
          (non-done) rows — a Done-tab bill's detail screen has no CTA. */}
      <div
        className={
          "fixed inset-0 z-[35] bg-[#f9fafb] flex flex-col transition-transform duration-200 ease-out " +
          (detailOpen ? "translate-x-0" : "translate-x-full")
        }
        {...pager.touchHandlers}
      >
        <div
          className="bg-teal-600 px-3.5 pb-3.5 flex items-center gap-2.5 shrink-0"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
        >
          {/* Routes through history so the chevron, a hardware back press and
              the Mark Done success path all close via the ONE popstate
              authority — see closeDetail's comment. */}
          <button
            type="button"
            onClick={() => window.history.back()}
            aria-label="Back"
            className="w-8 h-8 rounded-[9px] bg-white/15 flex items-center justify-center text-white shrink-0"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-extrabold text-white truncate">
              {detailRow?.dealerName ?? "—"}
            </div>
            <div className="text-[12px] text-white/75 truncate">
              {detailRow
                ? `${detailRow.obdNumber} · ${detailRow.area ?? "Unmatched"}${
                    detailRow.windowTime !== null ? ` · ${detailRow.windowTime}` : ""
                  }`
                : "—"}
            </div>
          </div>
        </div>

        {/* Everything below the teal header is wrapped in ONE ref'd container
            so the pager can translate it as a single unit. The header itself
            sits OUTSIDE and does not slide — its dealer-name/OBD text just
            updates at the swap instant, same as the stat strip and counter
            below it. Same structure as the supervisor's detail screen. */}
        <div ref={pager.contentRef} className="flex-1 min-h-0 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-3.5 py-3 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="text-[16px] font-extrabold text-gray-900 leading-snug">
              {detailRow?.articleTag ?? "—"}
            </div>
            {/* Tick progress — quiet, grey, informational, in the same slot the
                supervisor uses for its own "N / M checked" line. Carries the
                word "ticked" because the bill-position counter ("2 of 5") sits
                on the SAME pinned row: two bare "N of M" strings side by side
                would be read as one thing. Nothing branches on this number. */}
            {lineItems !== null && lineItems.length > 0 && (
              <div className="text-[11.5px] text-gray-400 tabular-nums mt-0.5">
                {tickedCount} of {lineItems.length} ticked
              </div>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <div className="text-[13px] font-semibold text-gray-500 whitespace-nowrap">
              {detailRow?.volumeLitres != null ? formatLitres(detailRow.volumeLitres) : "—"} L
            </div>
            {/* Bill-position counter — the supervisor's exact control
                (CLAUDE_PICKING.md §5.3 Option F): neutral gray, tap arrows,
                same "N of M" wording, HIDDEN when the list has one bill
                (nothing to page between). Teal stays reserved for the Mark
                done CTA — this is navigation, not a primary action. Both
                arrows call the same pager the swipe does, so an arrow tap and
                a swipe produce an identical slide. */}
            {pager.count > 1 && (
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={pager.goPrev}
                  disabled={pager.index <= 0}
                  aria-label="Previous bill"
                  className="w-11 h-11 flex items-center justify-center rounded-[9px] text-gray-500 active:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-[12.5px] font-medium text-gray-500 tabular-nums px-0.5 whitespace-nowrap">
                  {pager.index + 1} of {pager.count}
                </span>
                <button
                  type="button"
                  onClick={pager.goNext}
                  disabled={pager.index >= pager.count - 1}
                  aria-label="Next bill"
                  className="w-11 h-11 flex items-center justify-center rounded-[9px] text-gray-500 active:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Pack filter — unchanged in place and in styling (the supervisor's
            exact treatment), but OPTED OUT of the bill-swipe gesture as of
            2026-07-30. This strip scrolls horizontally, and a multi-pack bill
            routinely has more chips than fit on a 390px screen; once the swipe
            pager landed (dc32a476) its root-level handlers claimed the drag
            that used to scroll this row, so every chip past the right edge
            became unreachable — he would try to scroll to "1L" and get the
            next bill instead. {...NO_BILL_SWIPE} hands this strip's horizontal
            drag back to it. Swiping anywhere ELSE in the bill still pages.
            ⚠ Still gated on >= 2 distinct packs — an original-build rule
            (a114cff9), NOT this session's: a bill whose lines all share one
            pack has never shown this row, because there is nothing to filter
            between. */}
        {distinctPackKeys.length >= 2 && (
          <div
            {...NO_BILL_SWIPE}
            className="bg-white border-b border-gray-200 px-3.5 py-2.5 flex items-center gap-1.5 overflow-x-auto shrink-0"
          >
            <button
              type="button"
              onClick={() => setActivePackFilter("ALL")}
              className={
                "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
                (activePackFilter === "ALL"
                  ? "bg-[#2a323c] border-[#2a323c] text-white font-semibold"
                  : "bg-white border-gray-200 text-gray-700")
              }
            >
              All
            </button>
            {distinctPackKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setActivePackFilter(key)}
                className={
                  "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
                  (activePackFilter === key
                    ? "bg-[#2a323c] border-[#2a323c] text-white font-semibold"
                    : "bg-white border-gray-200 text-gray-700")
                }
              >
                {key === NO_PACK_KEY ? "No pack" : key}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3.5 pt-3 pb-8">
          {lineItemsLoading && (
            <p className="text-[13px] text-gray-400 text-center py-10">Loading line items&hellip;</p>
          )}
          {!lineItemsLoading && lineItemsError && (
            <p className="text-[13px] text-red-600 text-center py-10">
              Couldn&apos;t load line items: {lineItemsError}
            </p>
          )}
          {!lineItemsLoading && !lineItemsError && lineItems !== null && (
            lineItems.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-10">No line items found for this bill.</p>
            ) : filteredLineItems.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-10">No lines match.</p>
            ) : (
              filteredLineItems.map((li) => {
                const isTicked = tickedLineIds.has(li.id);
                return (
                <div
                  key={li.id}
                  className="flex bg-white rounded-[14px] overflow-hidden mb-2"
                  style={{ boxShadow: SOFT_CARD_SHADOW }}
                >
                  {/* PACK TILE — SLATE #3d4650, matching the supervisor's own
                      tile. It was teal-700 here until 2026-07-30, which broke
                      the one-teal rule (CLAUDE_UI §1) the supervisor had
                      already recoloured for: teal belongs to the Mark done CTA
                      alone on this screen. Muted em-dash when the pack is
                      missing — never an error/chip style. */}
                  <div className="w-14 shrink-0 bg-[#f8fafa] border-r border-gray-200 flex items-center justify-center px-1 py-2.5">
                    <span
                      className="text-[13px] font-bold text-center"
                      style={{ color: li.pack !== null ? "#3d4650" : "#9ca3af" }}
                    >
                      {li.pack ?? "—"}
                    </span>
                  </div>
                  {/* BODY — mutes once ticked so his eye skips the line. Same
                      quiet treatment as the supervisor's: no ring, no left
                      border, no strikethrough. */}
                  <div className={"flex-1 min-w-0 px-3 py-2.5 transition-opacity " + (isTicked ? "opacity-55" : "")}>
                    <div className="font-mono text-[17px] font-bold text-gray-900 truncate">{li.sku}</div>
                    <div className="text-[12px] text-gray-500 truncate mt-0.5">{li.name ?? "—"}</div>
                  </div>
                  <div className="shrink-0 flex items-center justify-center px-3.5">
                    <span className="text-[26px] font-extrabold text-gray-900">{li.qty}</span>
                  </div>
                  {/* TICK — his private note that he has fetched this line.
                      The supervisor's identical control is filled TEAL; this
                      one is filled SLATE (#6b7480) because teal on this screen
                      is reserved for Mark done (CLAUDE_UI §1) and a tick must
                      never compete with the one button that matters. 44px tap
                      zone, 20px/2px-border circle, no border on the column
                      itself (a tap zone, not a compartment).
                      Rendered on EVERY line of EVERY bill, unconditionally —
                      no stage gate, no "only when pending". Toggling is free
                      and reversible and costs nothing. */}
                  <button
                    type="button"
                    onClick={() => toggleLineTick(li.id)}
                    aria-label={isTicked ? "Remove tick from line" : "Tick line"}
                    aria-pressed={isTicked}
                    className="w-11 shrink-0 flex items-center justify-center"
                  >
                    <span
                      className={
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center " +
                        (isTicked ? "bg-[#6b7480] border-[#6b7480]" : "bg-white border-gray-300")
                      }
                    >
                      {isTicked && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M5 13l4 4L19 7"
                            stroke="white"
                            strokeWidth={3.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  </button>
                </div>
                );
              })
            )
          )}
        </div>

        {/* paddingBottom = the plain /po safe-area floor, NOT
            MOBILE_NAV_CLEARANCE (2026-07-29). It read MOBILE_NAV_CLEARANCE
            only because the shared bottom bar used to paint OVER this detail
            screen (bar z-40 above this screen's z-[35]); the shell now passes
            hideBar while a bill is open, so the bar is gone here and
            reserving its 76px left the button floating well above the true
            bottom edge. Same value, same reason, same commit-era as
            picking-board-mobile.tsx's four detail CTAs — CLAUDE_PICKING.md
            §5.3 is the owner of this rule.
            ⚠ This does NOT generalise to the LIST view: the bar IS visible
            there, so the list keeps pb-[76px], and MOBILE_NAV_CLEARANCE stays
            the single source for every bottom-pinned element that still sits
            under a live bar. */}
        {detailRow && !detailRow.isDone && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
          >
            {/* ⚠ NEVER GATED ON THE TICKS. `marking` is the in-flight
                double-tap guard and is the ONLY thing that can disable this
                button. There is no confirm dialog, no "you have 4 unticked
                lines" warning, no colour change and no nudge — ticking nothing
                and tapping Mark done is a normal day. The ticks are his notes;
                if they ever became a precondition they would be a rule about
                him instead. Do not add a check here. */}
            <button
              type="button"
              onClick={() => void handleMarkDone()}
              disabled={marking}
              className="w-full h-12 rounded-full bg-teal-600 active:bg-teal-700 text-white text-[14.5px] font-bold shadow-[0_8px_22px_rgba(13,148,136,0.42)] disabled:opacity-60"
            >
              {marking ? "Marking done…" : "Mark done"}
            </button>
          </div>
        )}
        </div>
        {/* ^ closes the sliding content wrapper (ref={pager.contentRef})
            opened just below the teal header. */}
      </div>
    </div>
  );
}
