"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Star, X } from "lucide-react";
import { toast } from "sonner";
import {
  FINDING_REASON_OPTIONS,
  findingReasonLabel,
  type FindingReason,
} from "@/lib/picking/findings-reasons";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import { AgeBadge, CardShelf, CARD_SHADOW_V2, RouteDot } from "./card-atoms";
import { usePickerBoard } from "./picking-mobile-shell";
import { NO_BILL_SWIPE_ATTR, useBillPager } from "./use-bill-pager";
import type { CombinedPickResult, PickingQueueRow } from "@/lib/picking/types";
import type { PickerRosterEntry } from "@/lib/picking/picker-roster";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";

// Which of the two BILL lists a detail session pages through. Deliberately NOT
// PickerTabKey: the Combined tab (2026-08-07) is not a bill list — a bill
// opened from one of its pills is opened from PENDING, and the swipe pager
// walks the pending bills exactly as it does from the Pending tab.
type DetailListKey = "pending" | "done";

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
/**
 * The pick_findings row for one line, as GET /api/picking/order/[orderId]
 * returns it — or null when nothing has been recorded.
 *
 * ⚠ `recordedById` is THE state discriminator, and the whole amber→red ladder
 * hangs off it:
 *   recordedById === null → the picker recorded it, awaiting a supervisor  (AMBER)
 *   recordedById !== null → a supervisor confirmed it                       (RED)
 * Never infer the state from qtyFound or reason.
 */
interface LineFinding {
  qtyFound:     number;
  reason:       string;
  remarks:      string | null;
  reportedById: number | null;
  reportedAt:   string | null;
  recordedById: number | null;
  recordedAt:   string | null;
}

interface LineItem {
  id: number;
  name: string | null;
  sku: string;
  pack: string | null;
  /** Qty ORDERED on this line (import_raw_line_items.unitQty). */
  qty: number;
  finding: LineFinding | null;
}

/**
 * One rendered Combined row — the server's CombinedSkuRow re-totalled for the
 * bills that are currently switched ON.
 *
 * `lineIds` is the flat set the tick circle reads; `byOrder` is the same ids
 * grouped by bill, which is the shape the tick STORE needs (it is keyed per
 * bill). Both are derived together so they can never disagree about which
 * lines a row covers.
 */
interface CombinedRowView {
  sku:     string;
  name:    string | null;
  pack:    string | null;
  qty:     number;
  litres:  number;
  lineIds: number[];
  byOrder: { orderId: number; lineItemIds: number[] }[];
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

// ── Multi-bill tick access (Combined view, 2026-08-07) ─────────────────────
// The Combined list shows ONE row per SAP code, summed across several bills,
// so a single tick belongs to line items in several bills at once. These three
// helpers are the multi-bill face of the SAME store above — same key, same
// shape, same pruning. There is no second store and there must never be one:
// a tick made in Combined and the same tick seen on that bill's own detail
// screen are the same note about the same physical goods.

/** Union of the ticked line ids across several bills. ONE store read. */
function readTicksForOrders(orderIds: readonly number[]): Set<number> {
  const store = readTickStore();
  const out = new Set<number>();
  for (const orderId of orderIds) {
    for (const id of store[String(orderId)]?.ids ?? []) out.add(id);
  }
  return out;
}

interface TickUpdate {
  orderId: number;
  add?:    number[];
  remove?: number[];
}

/**
 * Apply add/remove sets across SEVERAL bills in ONE read → merge → write.
 *
 * ⚠️ MERGES, NEVER REPLACES. writeTicks() above takes a bill's WHOLE set and
 * overwrites it, which is right for the single-bill screen (it holds every
 * line of that bill on screen) and catastrophic here: a Combined row knows
 * only its own SKU's line ids, so writing those as the bill's set would erase
 * every tick the picker had made on that bill's other lines. Each entry is
 * read, unioned/differenced, and written back.
 *
 * One read + one write rather than a loop of writeTicks() calls: N bills used
 * to mean N JSON parses, N prunes and N serialisations for a single tap, and —
 * worse — N chances for a partial write to leave the bills disagreeing.
 * Pruning still happens exactly once, inside writeTickStore.
 */
function writeManyTicks(updates: readonly TickUpdate[]): void {
  if (updates.length === 0) return;
  const store = readTickStore();
  const now = Date.now();
  for (const update of updates) {
    const key = String(update.orderId);
    const next = new Set(store[key]?.ids ?? []);
    for (const id of update.add ?? []) next.add(id);
    for (const id of update.remove ?? []) next.delete(id);
    // Empty set removes the entry outright — same rule as writeTicks, so
    // unticking everything through Combined leaves no residue either.
    if (next.size === 0) delete store[key];
    else store[key] = { t: now, ids: Array.from(next) };
  }
  writeTickStore(store);
}

/** Drop several bills' notes at once — the Mark-all-done counterpart of
 *  clearTicks(). Same "the bill is finished, the notes served their purpose"
 *  rule, applied only to bills the server actually accepted. */
function clearTicksForOrders(orderIds: readonly number[]): void {
  if (orderIds.length === 0) return;
  const store = readTickStore();
  for (const orderId of orderIds) delete store[String(orderId)];
  writeTickStore(store);
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
  const [detailListKey, setDetailListKey] = useState<DetailListKey>("pending");
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

  // ── Shortfall recording (2026-08-07) ─────────────────────────────────────
  // Fidelity source: docs/mockups/picking/picking-shortfall-design.html,
  // screen 1. Recording is a MODE, not a permanent row control: the triangle in
  // the header arms it, and only then does tapping a line body open the popup.
  // Off by default on every fresh open, so the screen he sees when he opens a
  // bill is exactly the screen he has today.
  const [recordMode, setRecordMode] = useState(false);
  // The line whose popup is open (null = closed). Holds the LineItem itself,
  // not just an id, so the popup can render pack/sku/desc/ordered without
  // re-finding it — and so it survives a background list update mid-edit.
  const [findingTarget, setFindingTarget] = useState<LineItem | null>(null);
  // Popup form. qty is a STRING while editing — a number state would fight the
  // input on an empty field (the picker clearing it to retype).
  const [findingQty, setFindingQty] = useState("");
  const [findingReason, setFindingReason] = useState<FindingReason>(FINDING_REASON_OPTIONS[0].value);
  const [findingRemarks, setFindingRemarks] = useState("");
  const [savingFinding, setSavingFinding] = useState(false);
  // Bumped to force the line-items effect to re-run without changing bill —
  // used after a 409, where the server knows something this screen does not.
  const [lineItemsReloadKey, setLineItemsReloadKey] = useState(0);

  // ── Combined tab state (2026-08-07) ──────────────────────────────────────
  // The merged list itself, fetched from GET /api/picking/combined. It is NOT
  // derived from `pending` on the client: the line items behind these rows are
  // not in the queue payload at all (PickingQueueRow carries order-level
  // aggregates only), so the merge has to happen server-side. What IS derived
  // from `pending` is WHEN to refetch — see the effect below.
  const [combined, setCombined] = useState<CombinedPickResult | null>(null);
  const [combinedLoading, setCombinedLoading] = useState(false);
  const [combinedError, setCombinedError] = useState<string | null>(null);
  // Bills the picker has toggled OFF for this visit. Deliberately EPHEMERAL and
  // deliberately NOT persisted: it resets to empty every time the tab is opened
  // (the effect below), because "which bills am I fetching for right now" is a
  // question about the next ten minutes, not a setting. A bill is never removed
  // from his board by this — only from the current merge.
  const [disabledBillIds, setDisabledBillIds] = useState<Set<number>>(new Set());
  // Its OWN pack filter, separate from the detail screen's activePackFilter —
  // sharing one would make opening a bill silently re-filter the Combined list
  // underneath, and vice versa.
  const [combinedPackFilter, setCombinedPackFilter] = useState<string>("ALL");
  // The ticked line ids across ALL of his pending bills, mirrored from the same
  // device store the single-bill screen writes (readTicksForOrders). Held as
  // state so a tap re-renders; the store is the durable copy.
  const [combinedTicked, setCombinedTicked] = useState<Set<number>>(new Set());
  // In-flight guard for Mark all done — the batch equivalent of `marking`. Same
  // job: stop a double-tap firing the whole sequence twice.
  const [markingAll, setMarkingAll] = useState(false);

  const isCombined = activeTab === "combined";

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
  //
  // ⚠️ STILL EXACTLY ONE MARKER INSTANCE after the Combined tab landed
  // (2026-08-07), and there must never be a second. Combined is refreshed by
  // THIS poll: the marker moves → refetchQueue() → `pending` changes → the
  // combined effect below re-runs. A second usePickingMarker for the combined
  // list would double the probe traffic and fire two refetches per change for
  // no new information (CLAUDE_PICKING.md §10). markingAll joins the pause for
  // the same reason `marking` is there — the ground must not move under a
  // batch that is halfway through writing.
  usePickingMarker({
    scope: "openPending",
    pickerId: activePickerId ?? undefined,
    onChange: refetchQueue,
    paused: detailOpen || marking || markingAll,
  });

  // Reset the per-visit view state every time Combined is opened. "All bills
  // on" and "All packs" is the state he expects to find; carrying a toggle
  // across visits would silently hide a bill he never chose to hide THIS time.
  useEffect(() => {
    if (!isCombined) return;
    setDisabledBillIds(new Set());
    setCombinedPackFilter("ALL");
  }, [isCombined]);

  // WHICH bills are pending, as a stable primitive. This — not the array
  // identity — is what the combined fetch keys on, so a refetch that returns
  // the same bills does NOT re-run it, while a bill genuinely arriving or
  // leaving does. That is the whole live-refresh mechanism for this tab: no
  // second marker, no polling of its own, no popup and nothing asked of the
  // picker.
  const pendingKey = useMemo(() => pending.map((r) => r.orderId).join(","), [pending]);

  useEffect(() => {
    if (!isCombined) return;
    if (activePickerId === null) {
      setCombined(null);
      return;
    }
    let cancelled = false;
    setCombinedLoading(true);
    setCombinedError(null);
    async function load() {
      try {
        // pickerId is the ADMIN-PREVIEW path only — the route ignores it for a
        // real picker and uses his own session id, so this can never widen the
        // scope (see that route's comment). Nothing here sends order ids.
        const res = await fetch(`/api/picking/combined?pickerId=${activePickerId}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as CombinedPickResult;
        if (cancelled) return;
        setCombined(json);
        // Re-read his notes for exactly these bills, synchronously with the
        // data they belong to — same reasoning as switchDetailTo's tick read:
        // never render one set of rows against another set's ticks.
        setCombinedTicked(readTicksForOrders(json.bills.map((b) => b.orderId)));
      } catch (err) {
        // Keep the last good list on failure, exactly like refetchQueue —
        // a network blip on a screen he is working from must not blank it.
        if (!cancelled) {
          setCombinedError(err instanceof Error ? err.message : "Failed to load the combined list");
        }
      } finally {
        if (!cancelled) setCombinedLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isCombined, activePickerId, pendingKey]);

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
    // lineItemsReloadKey lets a 409 force a re-read of the SAME bill — the
    // server has state this screen does not (a supervisor confirmed the line
    // while it sat open), and re-fetching is how the row learns about it.
  }, [detailOrderId, lineItemsReloadKey]);

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
  //
  // ⚠ IT NOW CARRIES TWO FLAGS (2026-08-07). The record popup is this face's
  // FIRST nested overlay — CLAUDE_PICKING.md §5.4 predicted exactly this
  // ("if it ever gets one, the two shapes converge") and this is the
  // convergence: the handler below gained the supervisor board's
  // close-the-sheet-and-re-push branch. Without it, a back-press with the popup
  // open would close the whole BILL and drop him back to the list, losing the
  // line he was recording.
  const navStateRef = useRef({ detailOpen: false, findingOpen: false });
  useEffect(() => {
    navStateRef.current = { detailOpen, findingOpen: findingTarget !== null };
  }, [detailOpen, findingTarget]);

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
      // Topmost layer FIRST: the record popup floating over an open bill.
      // Close just the popup and re-push, so the ONE detail entry this face
      // relies on stays available for the NEXT back-press to close the bill.
      // Byte-for-byte the guard picking-board-mobile.tsx makes for its nested
      // picker sheet.
      if (navStateRef.current.findingOpen && navStateRef.current.detailOpen) {
        setFindingTarget(null);
        pushScreen();
        return;
      }
      if (navStateRef.current.detailOpen) closeDetail();
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
  function switchDetailTo(orderId: number, listKey: DetailListKey): void {
    setDetailOrderId(orderId);
    setDetailListKey(listKey);
    setDetailOpen(true);
    setActivePackFilter("ALL");
    setTickedLineIds(readTicks(orderId));
    // The popup belongs to ONE line of ONE bill — paging away must close it,
    // or it would sit over the next bill still holding the previous bill's
    // line. `recordMode` deliberately does NOT reset here: it is a screen-level
    // mode, and a picker working through several short bills should not have to
    // re-arm it on every swipe. It resets on a fresh open (openDetail).
    setFindingTarget(null);
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

  function openDetail(orderId: number, listKey: DetailListKey): void {
    switchDetailTo(orderId, listKey);
    // Recording is OFF on every fresh open — the bill he opens looks exactly
    // like the bill he opens today, and arming the mode is always a deliberate
    // tap. (Not reset in switchDetailTo, so it survives a swipe between bills.)
    setRecordMode(false);
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

  // ⚠ THREE TAB KEYS, TWO BILL LISTS. `listKey` is the ONE place that mapping
  // is made, and every card-list call site below reads it — the card list is
  // not rendered at all on Combined, so "not done ⇒ pending" is exact rather
  // than a fallback. Before the third key existed this file carried four
  // separate `activeTab === "pending" ? … : …` ternaries, each of which would
  // have silently treated Combined as Done.
  const listKey: DetailListKey = activeTab === "done" ? "done" : "pending";
  const listRows = listKey === "done" ? done : pending;

  // ── Combined derivations ─────────────────────────────────────────────────
  // Everything below recomputes from (server payload × which bills are on), so
  // toggling a bill needs NO refetch — the contributions carry per-bill qty and
  // volume precisely so the totals can be rebuilt on the device.
  const enabledBillIds = useMemo(() => {
    const ids = new Set<number>();
    for (const bill of combined?.bills ?? []) {
      if (!disabledBillIds.has(bill.orderId)) ids.add(bill.orderId);
    }
    return ids;
  }, [combined, disabledBillIds]);

  const combinedRows = useMemo<CombinedRowView[]>(() => {
    const out: CombinedRowView[] = [];
    for (const row of combined?.rows ?? []) {
      const live = row.contributions.filter((c) => enabledBillIds.has(c.orderId));
      // A code that only existed on switched-off bills leaves the list
      // entirely — showing it at qty 0 would read as "nothing to fetch".
      if (live.length === 0) continue;

      let qty = 0;
      let litres = 0;
      const lineIds: number[] = [];
      const byOrderMap = new Map<number, number[]>();
      for (const c of live) {
        qty += c.qty;
        litres += c.litres;
        lineIds.push(c.lineItemId);
        const bucket = byOrderMap.get(c.orderId);
        if (bucket) bucket.push(c.lineItemId);
        else byOrderMap.set(c.orderId, [c.lineItemId]);
      }
      out.push({
        sku: row.sku,
        name: row.name,
        pack: row.pack,
        qty,
        litres: Math.round(litres * 100) / 100,
        lineIds,
        // Array.from around the Map iterator (CORE §3, target < ES2015).
        byOrder: Array.from(byOrderMap, ([orderId, lineItemIds]) => ({ orderId, lineItemIds })),
      });
    }
    return out;
  }, [combined, enabledBillIds]);

  // Same shape and same NO_PACK_KEY convention as the detail screen's chip row
  // — the strip is reused as-is, only its source list differs.
  const combinedPackKeys = useMemo(() => {
    const set = new Set<string>();
    for (const row of combinedRows) set.add(row.pack ?? NO_PACK_KEY);
    const keys = Array.from(set);
    const real = keys.filter((k) => k !== NO_PACK_KEY).sort((a, b) => a.localeCompare(b));
    return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
  }, [combinedRows]);

  const filteredCombinedRows = useMemo(() => {
    if (combinedPackFilter === "ALL") return combinedRows;
    return combinedRows.filter((r) => (r.pack ?? NO_PACK_KEY) === combinedPackFilter);
  }, [combinedRows, combinedPackFilter]);

  // BINARY, never tri-state: a merged row counts as ticked only when EVERY one
  // of its live line ids is ticked, and one tap flips all of them together. A
  // half-ticked look would be a third state to interpret on a screen whose
  // whole job is "have I picked this or not".
  const isRowTicked = useCallback(
    (row: CombinedRowView): boolean =>
      row.lineIds.length > 0 && row.lineIds.every((id) => combinedTicked.has(id)),
    [combinedTicked],
  );

  // Counted against the FULL merged list, never filteredCombinedRows — the
  // pack chips are a view filter and his progress does not change when he
  // narrows the view. Same rule as the detail screen's tickedCount.
  const combinedTickedCount = useMemo(
    () => combinedRows.filter((r) => isRowTicked(r)).length,
    [combinedRows, isRowTicked],
  );

  const combinedSummary = useMemo(() => {
    let litres = 0;
    for (const row of combinedRows) litres += row.litres;
    return { orders: enabledBillIds.size, litres, products: combinedRows.length };
  }, [combinedRows, enabledBillIds]);

  function toggleBill(orderId: number): void {
    setDisabledBillIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  // One tap → every contributing line id, in every contributing bill, flipped
  // together through the ONE merged write (writeManyTicks). Reads nothing to
  // decide anything else: like every other tick on this face it gates nothing.
  function toggleCombinedTick(row: CombinedRowView): void {
    const ticked = isRowTicked(row);
    writeManyTicks(
      row.byOrder.map(({ orderId, lineItemIds }) =>
        ticked ? { orderId, remove: lineItemIds } : { orderId, add: lineItemIds },
      ),
    );
    const next = new Set(combinedTicked);
    for (const id of row.lineIds) {
      if (ticked) next.delete(id);
      else next.add(id);
    }
    setCombinedTicked(next);
  }

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

  /**
   * Mark all done — the Combined tab's CTA.
   *
   * ⚠ It calls the EXISTING single-bill POST /api/picking/done once per bill,
   * SEQUENTIALLY. No batch endpoint was added and none should be: that route
   * already owns the stage guard, the pickerId-ownership check and the
   * two-write order (pick_assignments first, then the stage), and a batch
   * variant would be a second copy of all three. Sequential, never
   * Promise.all and never prisma.$transaction (CORE §3) — each bill's pair of
   * writes must complete before the next begins, exactly as
   * /api/picking/assign does across a batch.
   *
   * Per-bill failures do NOT stop the run: a 409 (the bill moved out from
   * under him — already advanced, or reassigned) is an outcome, not an error,
   * and the bills already written stay written. One toast summarises the whole
   * pass rather than N toasts stacking on a phone.
   *
   * ALWAYS ENABLED regardless of ticks — `markingAll` is the only thing that
   * disables it, precisely like the single-bill CTA's `marking`.
   */
  const handleMarkAllDone = useCallback(async () => {
    if (activePickerId === null || markingAll) return;
    const targets = (combined?.bills ?? []).filter((b) => enabledBillIds.has(b.orderId));
    if (targets.length === 0) return;

    setMarkingAll(true);
    const doneIds: number[] = [];
    let conflicts = 0;
    let failures = 0;
    try {
      for (const bill of targets) {
        try {
          const res = await fetch("/api/picking/done", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // The server-resolved picker, never a client-invented identity —
            // and the route re-verifies it against the bill's real
            // pick_assignments row regardless.
            body: JSON.stringify({ orderId: bill.orderId, pickerId: activePickerId }),
          });
          if (res.ok) doneIds.push(bill.orderId);
          else if (res.status === 409) conflicts += 1;
          else failures += 1;
        } catch {
          failures += 1;
        }
      }

      // Their notes have served their purpose — but only for bills the server
      // actually accepted. A 409'd bill keeps its ticks: it is still somewhere,
      // and wiping notes on work that did not complete is the one thing this
      // store must never do.
      clearTicksForOrders(doneIds);
      if (doneIds.length > 0) {
        setCombinedTicked((prev) => {
          const cleared = new Set(prev);
          const doneSet = new Set(doneIds);
          for (const row of combined?.rows ?? []) {
            for (const c of row.contributions) {
              if (doneSet.has(c.orderId)) cleared.delete(c.lineItemId);
            }
          }
          return cleared;
        });
      }

      const parts: string[] = [];
      if (doneIds.length > 0) {
        parts.push(`${doneIds.length} bill${doneIds.length === 1 ? "" : "s"} marked done`);
      }
      if (conflicts > 0) parts.push(`${conflicts} already changed`);
      if (failures > 0) parts.push(`${failures} failed`);
      const message = parts.join(" · ");
      if (failures > 0) toast.error(message);
      else if (doneIds.length > 0) toast.success(message);
      else toast(message);

      // Back to the board the way the single Mark Done does — WITHOUT a
      // history pop. That CTA pops because opening a bill pushed an entry;
      // this one lives on a TAB, which pushes nothing, so a back() here would
      // navigate off /picking entirely. The refetch is the return: `pending`
      // empties, and this tab re-renders as the list he is already looking at.
      await refetchQueue();
    } finally {
      setMarkingAll(false);
    }
  }, [activePickerId, markingAll, combined, enabledBillIds, refetchQueue]);

  // ── Record popup ─────────────────────────────────────────────────────────
  /**
   * Open the popup for one line, pre-filled.
   *
   * Qty found starts at the qty ORDERED (the mockup's `openModal(el.dataset.qty)`
   * — screen 1), not at 0: the overwhelmingly common edit is "one less than
   * ordered", and starting from the full number means one keystroke, not a
   * whole re-type. An existing finding pre-fills from what was recorded instead.
   */
  function openFindingFor(li: LineItem): void {
    setFindingTarget(li);
    setFindingQty(String(li.finding?.qtyFound ?? li.qty));
    const existing = li.finding?.reason;
    setFindingReason(
      FINDING_REASON_OPTIONS.find((o) => o.value === existing)?.value ?? FINDING_REASON_OPTIONS[0].value,
    );
    setFindingRemarks(li.finding?.remarks ?? "");
  }

  // Parsed once — drives both the Save-disabled state and the POST body, so the
  // button can never be enabled for a value the request would reject.
  const findingQtyNum = Number(findingQty);
  const findingQtyValid =
    findingTarget !== null &&
    findingQty.trim() !== "" &&
    Number.isInteger(findingQtyNum) &&
    findingQtyNum >= 0 &&
    findingQtyNum <= findingTarget.qty;

  /**
   * Save the record. Optional, additive, and completely detached from Mark
   * done — nothing here touches `marking`, the CTA, or the ticks.
   *
   * On success the returned row is merged into the OPEN bill's lineItems in
   * place (no refetch): the row re-tints instantly and the screen never
   * flickers through a loading state mid-shift.
   */
  const handleSaveFinding = useCallback(async () => {
    if (findingTarget === null || detailRow === null || savingFinding) return;
    if (!findingQtyValid) return;
    const target = findingTarget;
    setSavingFinding(true);
    try {
      const res = await fetch("/api/picking/findings/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId:       detailRow.orderId,
          rawLineItemId: target.id,
          qtyFound:      findingQtyNum,
          reason:        findingReason,
          remarks:       findingRemarks,
          // Ignored by the server for a real picker (his session id always
          // wins); honoured only for the admin view-as preview.
          pickerId:      activePickerId ?? undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        finding?: LineFinding;
        error?: string;
      };
      if (!res.ok) {
        if (res.status === 409) {
          // Either a supervisor confirmed this line while the popup sat open,
          // or the bill moved out from under him. Same wording and shape the
          // rest of this module uses for a 409, plus a re-read so the row shows
          // whatever is actually true now.
          toast("Already changed — refreshed.");
          setFindingTarget(null);
          setLineItemsReloadKey((k) => k + 1);
        } else {
          toast.error(json.error ?? `Request failed (${res.status})`);
        }
        return;
      }
      const saved = json.finding ?? null;
      if (saved !== null) {
        setLineItems((prev) =>
          prev === null ? prev : prev.map((li) => (li.id === target.id ? { ...li, finding: saved } : li)),
        );
      }
      toast.success(`${target.sku} — found ${findingQtyNum} of ${target.qty}`);
      setFindingTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSavingFinding(false);
    }
  }, [
    findingTarget, detailRow, savingFinding, findingQtyValid,
    findingQtyNum, findingReason, findingRemarks, activePickerId,
  ]);

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
      {/* One header for all three tabs — the SAME teal band, no back arrow:
          Combined is a peer tab, not a drill-in, so it must not borrow the
          detail screen's chevron. Only the title and the optional subtitle
          change. */}
      <ModuleMobileHeader
        title={isCombined ? "Combined" : "My Picks"}
        subtitle={
          isCombined
            ? `${combinedSummary.orders} order${combinedSummary.orders === 1 ? "" : "s"} · ${formatLitres(
                combinedSummary.litres,
              )} L · ${combinedSummary.products} product${combinedSummary.products === 1 ? "" : "s"}`
            : undefined
        }
        avatarInitials={userInitials}
        onAvatarClick={openYou}
        onMenuClick={openMenu}
        showSearch={false}
      />

      {isCombined ? (
        /* ── COMBINED — every pending bill as ONE flat list ─────────────────
           Deliberately NOT the card list: no per-bill grouping, no family or
           section headers, no per-row "which bill" breakdown. One row per SAP
           code with one total quantity is the entire point — he walks the
           shelves once, not once per bill. The row itself is the single-bill
           detail row, unchanged (pack tile · SKU · name · qty · tick), so the
           two screens read identically. */
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Bill pills — which bills are feeding this list. The NAME opens
              that bill's own detail screen (unchanged, pending list, full
              swipe pager); the icon toggles it out of the merge for THIS
              visit only. Nothing here removes a bill from his board. */}
          {(combined?.bills.length ?? 0) > 0 && (
            <div
              className="shrink-0 flex items-center gap-1.5 overflow-x-auto bg-white border-b border-gray-200 px-3.5 py-2.5 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              {(combined?.bills ?? []).map((bill) => {
                const on = enabledBillIds.has(bill.orderId);
                return (
                  <span
                    key={bill.orderId}
                    className={
                      "shrink-0 flex items-center rounded-full border text-[12.5px] " +
                      (on ? "bg-white border-gray-200" : "bg-gray-50 border-dashed border-gray-300")
                    }
                  >
                    <button
                      type="button"
                      onClick={() => openDetail(bill.orderId, "pending")}
                      className={
                        "max-w-[132px] truncate py-2 pl-3 pr-1 text-left font-medium " +
                        (on ? "text-gray-700" : "text-gray-400")
                      }
                    >
                      {bill.dealerName}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleBill(bill.orderId)}
                      aria-label={on ? `Leave out ${bill.dealerName}` : `Add back ${bill.dealerName}`}
                      aria-pressed={on}
                      className="flex min-w-[32px] items-center justify-center self-stretch pr-2 text-gray-400"
                    >
                      {on ? <X size={13} /> : <Plus size={13} />}
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Pack filter — the detail screen's strip, reused as-is: same
              markup, same styling, same >= 2 distinct packs rule (a list with
              one pack has nothing to filter between). Its own state, so
              filtering here and inside an open bill never interfere.
              No NO_BILL_SWIPE needed — the bill-swipe pager lives on the
              detail overlay, and this strip is on the list view. */}
          {combinedPackKeys.length >= 2 && (
            <div className="shrink-0 bg-white border-b border-gray-200 px-3.5 py-2.5 flex items-center gap-1.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => setCombinedPackFilter("ALL")}
                className={
                  "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
                  (combinedPackFilter === "ALL"
                    ? "bg-[#2a323c] border-[#2a323c] text-white font-semibold"
                    : "bg-white border-gray-200 text-gray-700")
                }
              >
                All
              </button>
              {combinedPackKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCombinedPackFilter(key)}
                  className={
                    "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
                    (combinedPackFilter === key
                      ? "bg-[#2a323c] border-[#2a323c] text-white font-semibold"
                      : "bg-white border-gray-200 text-gray-700")
                  }
                >
                  {key === NO_PACK_KEY ? "No pack" : key}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto overscroll-contain px-3.5 pt-3 pb-3">
            {combined === null && combinedLoading && (
              <p className="text-[13px] text-gray-400 text-center py-10">Loading&hellip;</p>
            )}
            {combined === null && !combinedLoading && combinedError !== null && (
              <p className="text-[13px] text-red-600 text-center py-10">
                Couldn&apos;t load the combined list: {combinedError}
              </p>
            )}
            {/* Empty state — the SAME words the Pending tab uses. */}
            {combined !== null && combined.bills.length === 0 && (
              <p className="text-[13px] text-gray-400 text-center py-16">Nothing pending.</p>
            )}
            {combined !== null && combined.bills.length > 0 && filteredCombinedRows.length === 0 && (
              <p className="text-[13px] text-gray-400 text-center py-10">
                {combinedRows.length === 0 ? "No bills selected." : "No lines match."}
              </p>
            )}
            {filteredCombinedRows.map((row) => {
              const ticked = isRowTicked(row);
              return (
                <div
                  key={row.sku}
                  className="flex bg-white rounded-[14px] overflow-hidden mb-2"
                  style={{ boxShadow: SOFT_CARD_SHADOW }}
                >
                  <div className="w-14 shrink-0 bg-[#f8fafa] border-r border-gray-200 flex items-center justify-center px-1 py-2.5">
                    <span
                      className="text-[13px] font-bold text-center"
                      style={{ color: row.pack !== null ? "#3d4650" : "#9ca3af" }}
                    >
                      {row.pack ?? "—"}
                    </span>
                  </div>
                  <div className={"flex-1 min-w-0 px-3 py-2.5 transition-opacity " + (ticked ? "opacity-55" : "")}>
                    <div className="font-mono text-[17px] font-bold text-gray-900 truncate">{row.sku}</div>
                    <div className="text-[12px] text-gray-500 truncate mt-0.5">{row.name ?? "—"}</div>
                  </div>
                  {/* ONE total. No per-bill breakdown text under it — the pills
                      above say which bills are in play, and a "2 + 1 + 3" line
                      on every row is arithmetic he did not ask for. */}
                  <div className="shrink-0 flex items-center justify-center px-3.5">
                    <span className="text-[26px] font-extrabold text-gray-900">{row.qty}</span>
                  </div>
                  {/* Same slate circle as the single-bill screen, and the same
                      contract: his private note, gating nothing. One tap
                      writes through to EVERY contributing bill's entry. */}
                  <button
                    type="button"
                    onClick={() => toggleCombinedTick(row)}
                    aria-label={ticked ? "Remove tick from product" : "Tick product"}
                    aria-pressed={ticked}
                    className="w-11 shrink-0 flex items-center justify-center"
                  >
                    <span
                      className={
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center " +
                        (ticked ? "bg-[#6b7480] border-[#6b7480]" : "bg-white border-gray-300")
                      }
                    >
                      {ticked && (
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
            })}
          </div>

          {/* Footer. paddingBottom reserves the shell's fixed bottom bar —
              the bar IS visible on this tab (unlike the detail screen, which
              hides it), so MOBILE_NAV_CLEARANCE is imported, never retyped as
              a bare 76px (CLAUDE_PICKING.md §7).
              ⚠ NO `border-t` HERE, DELIBERATELY (2026-08-07). WorkflowTabBar
              already draws `border-t border-gray-200` on the SAME white
              background (CLAUDE_UI.md §59.3 — its classes are copied from the
              default nav by construction). A matching hairline on this strip
              made two identical rules 76px apart with white between them, and
              the bottom of the screen read as two stacked toolbars instead of
              one. The bar's own rule is now the single divider inside one
              continuous white strip; the tonal step against the #f9fafb list
              above is this plate's top edge, the same way the pills and pack
              strips sit on the page background. Do not re-add it. */}
          {combined !== null && combined.bills.length > 0 && (
            <div
              className="shrink-0 bg-white px-3.5 pt-2"
              style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}
            >
              <div className="mb-1.5 text-center text-[11.5px] text-gray-400 tabular-nums">
                {combinedTickedCount} of {combinedRows.length} ticked
              </div>
              {/* ⚠ NEVER GATED ON THE TICKS — `markingAll` is the in-flight
                  double-tap guard and the only thing that can disable this.
                  Ticking nothing and tapping Mark all done is a normal day,
                  exactly as on the single-bill screen. Do not add a check.
                  NO drop shadow here, unlike the single-bill Mark done CTA
                  (2026-08-07). That shadow is CLAUDE_UI.md §55's FLOATING
                  pill token — right on the detail screen, which hides the bar
                  so the pill really does float, and wrong on this tab, where
                  the button is seated in a plate directly above the tab bar
                  and the shadow bled teal across the bar's top border. Same
                  button, same size, same colour — it just stops pretending to
                  hover. */}
              <button
                type="button"
                onClick={() => void handleMarkAllDone()}
                disabled={markingAll}
                className="w-full h-12 rounded-full bg-teal-600 active:bg-teal-700 text-white text-[14.5px] font-bold disabled:opacity-60"
              >
                {markingAll ? "Marking done…" : "Mark all done"}
              </button>
            </div>
          )}
        </div>
      ) : (
      /* Card list. Four rows (2026-07-29): caption + flags · name · where ·
          families. Still NO checkbox, NO elapsed pill, NO avatar, NO footer —
          those are supervisor concerns. Reserves 76px for the shell's fixed
          bottom bar (components/shared/mobile-shell.tsx), same convention as
          picking-board-mobile.tsx. */
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[76px] bg-white border-b border-gray-200 px-4 py-2.5">
        {listRows.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-16">
            {listKey === "pending" ? "Nothing pending." : "Nothing marked done yet today."}
          </p>
        ) : (
          listRows.map((row) => (
            <button
              key={row.orderId}
              type="button"
              onClick={() => openDetail(row.orderId, listKey)}
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
                  listKey === "done" && formatPickedTime(row.pickedAt) !== null ? (
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
      )}

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
          {/* Triangle — arms recording mode. Amber (#fbbf24 on #78350f), the
              mockup's exact pair, and the ONE amber control on a teal header:
              it is deliberately not teal, because teal here belongs to Mark
              done (CLAUDE_UI §1's one-teal rule) and this must not read as the
              primary action. The ring when armed is the mockup's
              `.triangle-btn.on` box-shadow. 38px, matching the mockup, which
              also clears the 44px-ish tap floor the rest of this screen uses.
              Only on a bill he can still act on — a Done bill has nothing to
              record against, the same condition that hides the Mark done CTA. */}
          {detailRow && !detailRow.isDone && (
            <button
              type="button"
              onClick={() => setRecordMode((v) => !v)}
              aria-label={recordMode ? "Stop recording shortages" : "Record a shortage"}
              aria-pressed={recordMode}
              className={
                "w-[38px] h-[38px] rounded-[10px] bg-[#fbbf24] text-[#78350f] flex items-center justify-center shrink-0 active:opacity-80 " +
                (recordMode ? "ring-[3px] ring-[rgba(146,64,14,0.4)]" : "")
              }
            >
              <AlertTriangle size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* Recording banner — the mockup's `.record-banner`, sitting between the
            teal header and the content, and OUTSIDE pager.contentRef on
            purpose: recording mode is a screen-level state, so the banner must
            not slide away and back every time he swipes to the next bill. */}
        {recordMode && (
          <div className="shrink-0 flex items-center justify-between gap-3 bg-[#fffbeb] border-b border-[#fde68a] px-4 py-2.5">
            <span className="text-[12px] font-semibold text-[#92400e]">
              Recording mode — tap any line to record what you found
            </span>
            <button
              type="button"
              onClick={() => setRecordMode(false)}
              className="text-[12px] font-semibold text-[#78350f] underline shrink-0"
            >
              Done
            </button>
          </div>
        )}

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
                // ⚠ recordedById is the ONLY discriminator — see LineFinding.
                const confirmed = li.finding !== null && li.finding.recordedById !== null;
                const pending   = li.finding !== null && li.finding.recordedById === null;
                // Tappable when the mode is armed, OR when something is already
                // recorded — the mockup's "always tappable" rule for a flagged
                // row, which is also how he corrects a number he mistyped.
                const rowTappable = recordMode || li.finding !== null;
                return (
                <div
                  key={li.id}
                  onClick={rowTappable ? () => openFindingFor(li) : undefined}
                  // border-2 on EVERY state, transparent when neutral — the
                  // mockup's own trick, and the reason a row does not change
                  // height the instant it gets recorded.
                  className={
                    "flex rounded-[14px] overflow-hidden mb-2 border-2 " +
                    (confirmed
                      ? "bg-[#fef2f2] border-[#fca5a5] "
                      : pending
                        ? "bg-[#fffbeb] border-[#fcd34d] "
                        : "bg-white border-transparent ") +
                    (rowTappable ? "cursor-pointer active:opacity-90" : "")
                  }
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
                  <div className={"flex-1 min-w-0 px-3 py-2.5 transition-opacity " + (isTicked && li.finding === null ? "opacity-55" : "")}>
                    <div className="font-mono text-[17px] font-bold text-gray-900 truncate">{li.sku}</div>
                    <div className="text-[12px] text-gray-500 truncate mt-0.5">{li.name ?? "—"}</div>
                    {/* The recorded note — the mockup's .line-short-note /
                        .line-flag-note. Carries BOTH numbers ("found 1 of 2")
                        so the row reads on its own without the popup. */}
                    {li.finding !== null && (
                      <div
                        className="text-[12px] font-semibold mt-1"
                        style={{ color: confirmed ? "#b91c1c" : "#92400e" }}
                      >
                        {confirmed ? "✓ Confirmed: " : "Recorded: "}
                        found {li.finding.qtyFound} of {li.qty} ·{" "}
                        {findingReasonLabel(li.finding.reason)}
                        {!confirmed && " · tap to edit"}
                      </div>
                    )}
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
                  {/* ⚠ THE CIRCLE IS SHARED BY TWO FEATURES and shows the
                      STRONGER one. With no finding it is the private tick,
                      exactly as before. Once something is recorded, the circle
                      becomes the finding's state mark (amber "!" pending, red
                      "⚠" confirmed) and its tap opens the popup instead —
                      the mockup's own treatment. His private tick for that line
                      is NOT cleared, only hidden: remove the finding and the
                      tick reappears exactly as he left it. */}
                  {li.finding !== null ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openFindingFor(li);
                      }}
                      aria-label={confirmed ? "Confirmed shortage — view" : "Recorded shortage — edit"}
                      className="w-11 shrink-0 flex items-center justify-center"
                    >
                      <span
                        className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-white text-[12px] font-bold"
                        style={{ background: confirmed ? "#dc2626" : "#f59e0b" }}
                      >
                        {confirmed ? "⚠" : "!"}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLineTick(li.id);
                      }}
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
                  )}
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

        {/* ── RECORD POPUP ────────────────────────────────────────────────
            The mockup's `.modal-backdrop` + `.modal`: centred card, 320px,
            rgba(0,0,0,.45) scrim. Sits INSIDE the detail overlay but outside
            the sliding wrapper, so a swipe can never drag it.
            z-[65] matches picking-board-mobile.tsx's SHEET_GEOMETRY.scrimZ —
            chosen to clear mobile-shell's OWN stack (nav z-40, scrim z-50,
            sheets z-[60]), not just this screen's z-[35].
            A backdrop tap cancels, like every other sheet in this app; a tap
            inside the card must not fall through to it.
            ⚠ {...NO_BILL_SWIPE} IS LOAD-BEARING. This popup renders INSIDE the
            element carrying pager.touchHandlers, so without the opt-out a
            horizontal drag inside the remarks textarea (or across the card at
            all) would be claimed by the bill pager and page to the next bill
            mid-edit — the exact bug the pack-filter strip hit on 2026-07-30
            (CLAUDE_PICKING.md §5.3). */}
        {findingTarget !== null && (
          <div
            {...NO_BILL_SWIPE}
            className="fixed inset-0 z-[65] bg-black/45 flex items-center justify-center px-6"
            onClick={() => {
              if (!savingFinding) setFindingTarget(null);
            }}
          >
            <div
              className="w-full max-w-[320px] rounded-2xl bg-white p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[12px] text-gray-400">{findingTarget.pack ?? "—"}</div>
              <div className="font-mono text-[15px] font-bold text-gray-900 mt-0.5">
                {findingTarget.sku}
              </div>
              <div className="text-[12px] text-gray-400 mb-4">{findingTarget.name ?? "—"}</div>

              <span className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-1">
                Qty ordered
              </span>
              <div className="text-[14px] font-semibold text-gray-700 mb-3 tabular-nums">
                {findingTarget.qty}
              </div>

              <label
                htmlFor="finding-qty"
                className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-1"
              >
                Qty found
              </label>
              {/* text-[16px] — the iOS zoom guard this app applies to every
                  mobile input (CLAUDE_UI §59.1). The mockup's 14px would make
                  Safari zoom the whole screen on focus. */}
              <input
                id="finding-qty"
                type="number"
                inputMode="numeric"
                min={0}
                max={findingTarget.qty}
                value={findingQty}
                onChange={(e) => setFindingQty(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-[16px] text-gray-900 mb-1 tabular-nums"
              />
              {/* Quiet, inline, and only when wrong — never a blocking alert. */}
              <div className="h-[16px] mb-2">
                {!findingQtyValid && findingQty.trim() !== "" && (
                  <span className="text-[11px] font-medium text-red-600">
                    Enter a whole number from 0 to {findingTarget.qty}
                  </span>
                )}
              </div>

              <label
                htmlFor="finding-reason"
                className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-1"
              >
                Reason
              </label>
              {/* Options come from lib/picking/findings-reasons.ts — the same
                  list the server validates against, so the dropdown can never
                  offer a value the API would 400. */}
              <select
                id="finding-reason"
                value={findingReason}
                onChange={(e) => setFindingReason(e.target.value as FindingReason)}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-[16px] text-gray-900 mb-3 bg-white"
              >
                {FINDING_REASON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <label
                htmlFor="finding-remarks"
                className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-gray-500 mb-1"
              >
                Remarks (optional)
              </label>
              <textarea
                id="finding-remarks"
                rows={2}
                value={findingRemarks}
                onChange={(e) => setFindingRemarks(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-[16px] text-gray-900 mb-4 resize-none"
              />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFindingTarget(null)}
                  disabled={savingFinding}
                  className="flex-1 h-11 rounded-[10px] border border-gray-300 bg-white text-[13px] font-semibold text-gray-600 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveFinding()}
                  disabled={savingFinding || !findingQtyValid}
                  className="flex-1 h-11 rounded-[10px] bg-teal-600 active:bg-teal-700 text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  {savingFinding ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
