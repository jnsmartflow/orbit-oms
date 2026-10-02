"use client";

// Tint Manager — the board. Rebuilt 2026-09-05 to the locked mockup
// docs/mockups/tint-manager/tint-manager-FINAL_2.html.
//
// WHAT REPLACED WHAT
//   was: a 4-column Kanban (Pending / Assigned / In Progress / Completed) with a
//        card-vs-table view toggle, plus a per-column split card.
//   now: a 344px "Needs assignment" rail + ONE flat table grouped one section
//        per operator, so every job of a person's — running, queued, paused,
//        finished today — sits under their own name.
//
// STRUCTURE, borrowed from Floor (components/floor/): a composition root that
// owns state and every write, with dumb children under components/tint/manager/.
// The shaping rule (grouping, per-type Seq ranks) lives in ./manager/rows.ts as
// pure functions, so it can be reasoned about without mounting anything.
//
// ⚠ THE HEADER STAYS <UniversalHeader />. Floor is the ONE named exception to
// CORE §3's "no custom headers" rule (CLAUDE_UI §6), and this screen deliberately
// does not become a second one. The only prop removed is the operator-workload
// segment group — the table's per-operator sections now do that job, and better,
// because they show the work instead of counting it.
//
// RETIRED, NOT DELETED (CORE §3 — never delete a file):
//   components/tint/tint-table-view.tsx      — the old Kanban table
//   components/shared/order-detail-panel.tsx — the old panel; this was its only
//                                              live importer
//   components/tint/split-builder-modal.tsx  — Create Split is out of scope for
//                                              this screen by decision
// All three keep compiling; they simply lose their import. tint-table-view.tsx
// still imports TintOrder / SplitCard / CompletedAssignment FROM THIS FILE, so
// the three types are re-exported below even though this file no longer declares
// them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useCanImportObds } from "@/lib/hooks/use-can-import-obds";
import { toast } from "sonner";
import { AlertCircle, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

import { UniversalHeader } from "@/components/universal-header";
// Billing's tab-row controls (mail-orders-page.tsx billingHeaderSlot), the SAME
// components — Filter with its count badge, and the ⌨ popover in "row" style.
import { HeaderFilter, type FilterGroup } from "@/components/header-filter";
import { HeaderDateStepper } from "@/components/header-date-stepper";
import { HeaderShortcuts, type ShortcutItem } from "@/components/header-shortcuts";
import { CustomerMissingSheet } from "@/components/shared/customer-missing-sheet";
import { RemoveObdModal } from "@/components/tint/RemoveObdModal";
import { HideObdModal } from "@/components/tint/HideObdModal";
import { SkipHistoryModal } from "@/components/tint/SkipHistoryModal";
import { PauseHistoryModal } from "@/components/tint/PauseHistoryModal";
import { ManualTintEntryModal } from "@/components/tint/manual-tint-entry-modal";
import { ManualTintRevertModal } from "@/components/tint/manual-tint-revert-modal";

import { BoardRail } from "@/components/tint/manager/board-rail";
import { BaseTiPanel } from "@/components/tint/manager/base-ti-panel";
// The Tint tab is BoardTintTab since 2026-10-02 (summary · operator board ·
// Now & next); its rows are board-table.tsx's TintBoardRow, so BoardTable itself
// is no longer mounted (kept — CORE §3, nothing is deleted).
import { BoardTintTab } from "@/components/tint/manager/board-tint-tab";
import { BoardTabs, type BoardTab } from "@/components/tint/manager/board-tabs";
import { BoardPickDeleteTab, TINT_PICK_DELETE_BASE } from "@/components/tint/manager/board-pick-delete-tab";
// Billing's blocking popup, REUSED with the tint base (2026-10-01, step 8).
import { BillingPickDeletePopup } from "@/components/billing/billing-pick-delete-popup";
import { currentIstMonth } from "@/lib/billing/telephonic-so";
import { BoardTiTab } from "@/components/tint/manager/board-ti-tab";
// BoardAssignBar (board-assign-bar.tsx) is RETIRED, not deleted (CORE §3): the
// bottom bar replaced it in tabs build step 6.
import { BoardBottomBar, BoardTiBottomBar, type BarMode } from "@/components/tint/manager/board-bottom-bar";
import { BoardTiBulkDialog } from "@/components/tint/manager/board-ti-bulk-dialog";
import { owedLines, packList } from "@/components/tint/manager/board-ti-tab";
import type { WhiteShotDose } from "@/lib/tint/white-shots";
import { BoardStopCancelDialog, type StopCancelBill } from "@/components/tint/manager/board-stop-cancel-dialog";
import { BoardShopDeliveryDialog, type ShopDeliveryBill } from "@/components/tint/manager/board-shop-delivery-dialog";
import { BoardHoldTab } from "@/components/tint/manager/board-hold-tab";
import { BoardCiTab } from "@/components/tint/manager/board-ci-tab";
import type { FloorBoardRow, FloorCancelledRow } from "@/lib/floor/types";
import type { PickDeleteDecidedRow } from "@/lib/billing/pick-delete-types";
import { parseSearch } from "@/lib/floor/search";
import { obdHighlight, type TintFindRow as FindRow } from "@/lib/tint/search";
import { SearchDropdown, type SearchResultRow } from "@/components/tint/manager/search-dropdown";
import { buildSearchSources, matchSources, type SearchItem } from "@/components/tint/manager/search-sources";
import { BoardBaseTab } from "@/components/tint/manager/board-base-tab";
import { slotValueOf } from "@/components/tint/manager/board-slot-cell";
import { OffFloorDialog, type CiReasonOption, type OffFloorFormBill, type OffFloorTab } from "@/components/floor/off-floor-dialog";
import type { DispatchSlotValue, DispatchWindow } from "@/components/floor/dispatch-slot-picker";
import { formatLitres } from "@/components/floor/status-pill";
import { countArticles } from "@/lib/floor/format";
import { BoardDetailPanel, type PanelBill, type PanelTarget, type TintPanelActions } from "@/components/tint/manager/board-detail-panel";
import { useTintManagerAccess } from "@/components/tint/manager/tint-manager-access-provider";
import { ConnectionStrip, OperatorMenu } from "@/components/tint/manager/board-bits";
import { LegacyTintManagerSync } from "@/components/tint/manager/use-tint-manager-sync";
import { boardOrderIds, useTintManagerLive } from "@/components/tint/manager/use-tint-manager-live";
import { useMissingCustomersPoll } from "@/components/tint/manager/use-missing-customers-poll";
import { buildGroups, buildRail, queueSignature } from "@/components/tint/manager/rows";
import type {
  BasePendingLine,
  BasePendingOrder,
  BoardRow,
  Operator,
  TintBoardPayload,
  TintHoldRow,
  TintOrder,
} from "@/components/tint/manager/types";

// Re-exported for components/tint/tint-table-view.tsx, which is retired but
// still type-checked and still imports these three from this module.
export type {
  TintOrder,
  SplitCard,
  CompletedAssignment,
} from "@/components/tint/manager/types";

const EMPTY_PAYLOAD: TintBoardPayload = {
  orders: [], activeSplits: [], completedSplits: [], completedAssignments: [],
};

export function TintManagerContent() {
  const { data: session } = useSession();

  // Ticks, resolved in the layout (TintManagerAccessProvider). The bar, its
  // menus and the Slot cell read the action ticks. (The Reports pill that read
  // canReports left the header 2026-10-02 — the sidebar keeps Reports.)
  const access = useTintManagerAccess();

  // Import button: the Import OBDs tick, the same rule the import route enforces.
  const canImportOBDs = useCanImportObds();

  // Remove OBD — the tint_cancel tick (tint_manager canEdit AND tint_cancel
  // canEdit), the same rule /api/tint/manager/orders/[id]/remove enforces since
  // tabs build step 2. The old job-title check (admin / tint_manager role) is
  // retired: it drew no button for a tick-holder without the title (Prakash) and
  // a button for a title-holder without the tick.
  const canRemoveObd = access.canCancel;

  // Hide OBD is ADMIN ONLY — narrower than Remove. Server re-enforces.
  const canHideObd = (() => {
    const primary = session?.user?.role ?? "";
    const all     = session?.user?.roles ?? (primary ? [primary] : []);
    return primary === "admin" || all.includes("admin");
  })();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [payload, setPayload]     = useState<TintBoardPayload>(EMPTY_PAYLOAD);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [connected, setConnected] = useState(true);

  // ── Header filters + search ───────────────────────────────────────────────
  // 2026-10-02 (header like Billing): Delivery Type + one "Urgent only" chip;
  // the Split/Whole "Type" group is gone (no split since 2026-06-26). The Filter
  // and ⌨ popovers are CONTROLLED here so this page's one Esc owner closes them.
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({
    deliveryType: [], urgent: [],
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Selection / panel / modals ────────────────────────────────────────────
  // THREE DISJOINT SELECTIONS (tabs build step 6, owner decision 3): table rows
  // (keys), rail cards (order ids) and Hold-tab rows (order ids, step 7).
  // Selecting in one clears the other two — see the three toggles below — so
  // the bottom bar always acts on exactly one kind of thing.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [railSel, setRailSel] = useState<Set<number>>(new Set());
  const [holdSel, setHoldSel] = useState<Set<number>>(new Set());
  // The Base tab's selection (2026-10-01, Base tab 4B) — the fourth, disjoint.
  const [baseSel, setBaseSel] = useState<Set<number>>(new Set());
  // The TI tab's selection (2026-10-02, bulk TI) — the fifth, disjoint; keyed by
  // tintAssignmentId. Plus the open white-shot confirm, and the bulk Undo Base.
  const [tiSel, setTiSel] = useState<Set<number>>(new Set());
  const [tiBulkDose, setTiBulkDose] = useState<WhiteShotDose | null>(null);
  const [tiUndoBusy, setTiUndoBusy] = useState(false);
  // The Tint tab's focused operator (2026-10-02) — a VIEW filter on the
  // Operators card / Now & next, never a selection. Esc clears it last.
  const [focusedOperatorId, setFocusedOperatorId] = useState<number | null>(null);
  // ── HISTORY (2026-10-02, round 2 step 3) ────────────────────────────────────
  // A past IST day "YYYY-MM-DD", or null = live. Held in STATE, as Floor holds
  // its History day (floor-page.tsx viewMode + histDate) — no URL param. Every
  // board read goes through `dated()`, so the marker / write reload paths that
  // call fetchBoard serve the right day without being rewired.
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  const historyDateRef = useRef<string | null>(null);
  historyDateRef.current = historyDate;
  const dated = useCallback((path: string) => {
    const d = historyDateRef.current;
    return d ? `${path}${path.includes("?") ? "&" : "?"}date=${d}` : path;
  }, []);
  // The bar's ··· More menu and its operator menu (anchored to the primary).
  const [barMenuOpen, setBarMenuOpen] = useState(false);
  const [barOpAnchor, setBarOpAnchor] = useState<HTMLElement | null>(null);
  // Dialogs opened from the bar. dialogBusy refuses Esc mid-request.
  const [offFloor, setOffFloor] = useState<{ bills: OffFloorFormBill[]; tab: OffFloorTab } | null>(null);
  const [ciReasons, setCiReasons] = useState<CiReasonOption[] | null>(null);
  const [ciReasonsError, setCiReasonsError] = useState<string | null>(null);
  const [stopCancelBill, setStopCancelBill] = useState<StopCancelBill | null>(null);
  // The bar's "Shop delivery" confirm (owner 2026-10-01). "Change ship-to" left
  // the bar the same day — it lives only in the detail panel now.
  const [shopDeliveryBills, setShopDeliveryBills] = useState<ShopDeliveryBill[] | null>(null);
  // Hold + CI tab lists (step 7). null = not loaded yet.
  const [holdRows, setHoldRows] = useState<TintHoldRow[] | null>(null);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [cancelledRows, setCancelledRows] = useState<FloorCancelledRow[] | null>(null);
  // Base tab rows (GET /api/tint/manager/base — Floor's board, narrowed). null = not loaded yet.
  const [baseRows, setBaseRows] = useState<FloorBoardRow[] | null>(null);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [cancelledError, setCancelledError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  // The Pick delete tab's badge — its own decided-row count for the month shown
  // (null until the tab has loaded once). Step 8.
  const [pickDecidedCount, setPickDecidedCount] = useState<number | null>(null);
  // The decided rows behind that badge — the header search's Delete source
  // (2026-10-02). Same fetch, kept instead of counted and thrown away.
  const [pickDecidedRows, setPickDecidedRows] = useState<PickDeleteDecidedRow[] | null>(null);
  // Bumped after every board reload so an open panel re-reads its bill.
  const [panelReload, setPanelReload] = useState(0);
  const [dialogBusy, setDialogBusy] = useState(false);
  // Active dispatch windows for the Slot picker (bar + table cell).
  const [windows, setWindows] = useState<DispatchWindow[]>([]);
  const [panelKey, setPanelKey]   = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [reorderBusy, setReorderBusy] = useState<Set<string>>(new Set());
  // The rail's operator menu is open (reported up by BoardRail) — a live-feed hold.
  const [railMenuOpen, setRailMenuOpen] = useState(false);

  const [removeModalOrder, setRemoveModalOrder] = useState<TintOrder | null>(null);
  const [hideModalOrder,   setHideModalOrder]   = useState<TintOrder | null>(null);
  const [skipHistoryFor,   setSkipHistoryFor]   = useState<{ orderId: number; obdNumber: string; customerName: string | null } | null>(null);
  const [pauseHistoryFor,  setPauseHistoryFor]  = useState<{ orderId: number; obdNumber: string; customerName: string | null } | null>(null);
  const [pullModalOpen,    setPullModalOpen]    = useState(false);
  const [revertOrder,      setRevertOrder]      = useState<{ id: number; obdNumber: string } | null>(null);

  // ── Missing-customer sheet + the Assign interceptor ───────────────────────
  const [missingCustomers, setMissingCustomers] = useState<{
    orderId: number; obdNumber: string; shipToCustomerId: string | null;
    shipToCustomerName: string | null; smu: string | null; orderType: string;
    obdEmailDate: string | null;
  }[]>([]);
  const [missingBadgeOpen, setMissingBadgeOpen] = useState(false);
  const missingBadgeRef = useRef<HTMLButtonElement>(null);
  const [missingSheetOpen,    setMissingSheetOpen]    = useState(false);
  const [missingSheetOrder,   setMissingSheetOrder]   = useState<TintOrder | null>(null);
  const [missingSheetWarning, setMissingSheetWarning] = useState<string | undefined>(undefined);
  // The Assign that was interrupted, remembered so it can be re-fired the moment
  // the customer resolves. Carries the OPERATOR too, which the old Kanban did not
  // — it only remembered the order and re-opened a modal for the manager to pick
  // again. Here the operator was already chosen in the rail popover, so replaying
  // it is what "resume where you left off" actually means.
  const [pendingAssign, setPendingAssign] = useState<{ orderId: number; operatorId: number } | null>(null);
  /**
   * The same remembered-intent slot as `pendingAssign` above, for the Base —
   * No Tint bypass. Kept as a SEPARATE state rather than widened into
   * `pendingAssign` so the Assign chain — its effect, its cancel clause and its
   * replay — stays byte-identical; the two intents are mutually exclusive in
   * practice (one sheet, one order) but nothing here depends on that.
   */
  const [pendingBypass, setPendingBypass] = useState<{ orderId: number } | null>(null);
  const sheetResolvedRef = useRef(false);

  // ── The tab bar above the table pane (2026-10-01, tabs build step 5) ─────
  // Tinting · TI · Hold · CI · Pick delete. The rail stays on the left for all.
  const [activeTab, setActiveTab] = useState<BoardTab>("tinting");

  // ── Base — No Tint · Tinter Issue pending ─────────────────────────────────
  // Bills a bypass sent out with their TI still owed, plus the drilldown state.
  // They live on the TI TAB since 2026-10-01 (they used to sit under the rail):
  // `baseDrill` non-null shows that bill's lines in the TI tab; `baseLine`
  // non-null shows the TI form for that line beside them.
  const [basePending, setBasePending] = useState<BasePendingOrder[]>([]);
  const [baseDrill,   setBaseDrill]   = useState<BasePendingOrder | null>(null);
  const [baseLine,    setBaseLine]    = useState<BasePendingLine | null>(null);
  const [baseUndoBusyId, setBaseUndoBusyId] = useState<number | null>(null);

  // ── Fetching ──────────────────────────────────────────────────────────────

  /** Returns the payload it just stored, so a caller can diff before/after. */
  const fetchBoard = useCallback(async (): Promise<TintBoardPayload | null> => {
    setPanelReload((n) => n + 1);
    try {
      const res = await fetch(dated("/api/tint/manager/orders"));
      if (!res.ok) return null;
      const data = (await res.json()) as TintBoardPayload;
      const next: TintBoardPayload = {
        orders:               data.orders ?? [],
        activeSplits:         data.activeSplits ?? [],
        completedSplits:      data.completedSplits ?? [],
        completedAssignments: data.completedAssignments ?? [],
      };
      setPayload(next);
      setLastSyncedAt(new Date());
      return next;
    } catch {
      return null; // leave the board on its last good data
    }
  }, []);

  const fetchMissingCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/tint/manager/missing-customers");
      if (!res.ok) return;
      const data = await res.json() as { orders: typeof missingCustomers };
      setMissingCustomers(data.orders ?? []);
    } catch { /* silent — the badge just stays as it was */ }
  }, []);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        const [boardRes, opsRes] = await Promise.all([
          fetch("/api/tint/manager/orders"),
          fetch("/api/tint/manager/operators"),
        ]);
        const board = (await boardRes.json()) as TintBoardPayload;
        const ops   = (await opsRes.json()) as { operators: Operator[] };
        setPayload({
          orders:               board.orders ?? [],
          activeSplits:         board.activeSplits ?? [],
          completedSplits:      board.completedSplits ?? [],
          completedAssignments: board.completedAssignments ?? [],
        });
        setOperators(ops.operators ?? []);
        setLastSyncedAt(new Date());
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, []);

  // Missing-customers side list: mount + on becoming visible + every 5 min
  // while visible — no longer on every marker change (plan §C2, 2026-09-30).
  // The page's own writes below still refetch it directly, as before.
  useMissingCustomersPoll(fetchMissingCustomers);

  // ── Derived board ─────────────────────────────────────────────────────────

  const delTypes   = useMemo(() => new Set(headerFilters.deliveryType ?? []), [headerFilters]);
  const urgentOnly = (headerFilters.urgent ?? []).includes("urgent");
  // (The box no longer filters the rail / Tint tab as you type — since
  // 2026-10-02 it runs on Enter into a results dropdown; see "Header search".)
  /** The header filters, ONE predicate for every tab (2026-10-02): a row passes
   *  when its delivery type is ticked (or none is) and, with "Urgent only", its
   *  priority is urgent — the board's own rule, priorityLevel ≤ 2 (rows.ts). */
  const passesFilters = useCallback(
    (deliveryType: string | null | undefined, priorityLevel: number | null | undefined) =>
      (delTypes.size === 0 || delTypes.has(deliveryType ?? "")) &&
      (!urgentOnly || (priorityLevel != null && priorityLevel <= 2)),
    [delTypes, urgentOnly],
  );

  const rail = useMemo(() => {
    return buildRail(payload).filter((o) => {
      return passesFilters(o.deliveryTypeName, o.priorityLevel);
    });
  }, [payload, passesFilters]);

  const groups = useMemo(() => {
    const all = buildGroups(payload);
    if (delTypes.size === 0 && !urgentOnly) return all;
    return all
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => {
          const dt = r.order?.deliveryTypeName ?? r.split?.deliveryTypeName ?? r.completed?.deliveryTypeName ?? "";
          if (delTypes.size > 0 && !delTypes.has(dt)) return false;
          if (urgentOnly && !r.isUrgent) return false;
          return true;
        }),
      }))
      .filter((g) => g.rows.length > 0);
  }, [payload, delTypes, urgentOnly]);

  // Every other tab's rows through the SAME filters (2026-10-02). Display +
  // badges + Prev/Next walk read these; selections and writes keep the full lists.
  const baseRowsShown = useMemo(
    () => (baseRows === null ? null : baseRows.filter((r) => passesFilters(r.deliveryType, r.priorityLevel))),
    [baseRows, passesFilters],
  );
  const holdRowsShown = useMemo(
    () => (holdRows === null ? null : holdRows.filter((r) => passesFilters(r.deliveryType, r.priorityLevel))),
    [holdRows, passesFilters],
  );
  const cancelledRowsShown = useMemo(
    () => (cancelledRows === null ? null : cancelledRows.filter((r) => passesFilters(r.deliveryType, r.priorityLevel))),
    [cancelledRows, passesFilters],
  );
  const basePendingShown = useMemo(
    () => basePending.filter((o) => passesFilters(o.deliveryTypeName, o.priorityLevel)),
    [basePending, passesFilters],
  );

  const rowsByKey = useMemo(() => {
    const m = new Map<string, BoardRow>();
    for (const g of groups) for (const r of g.rows) m.set(r.key, r);
    return m;
  }, [groups]);

  // Selection is a Set of row KEYS, so it survives a re-sort by construction
  // (it keys on identity, not position) — same reasoning as lib/floor/selection.ts.
  // Rows that vanish from the board (assigned away, finished) drop out here.
  const selectedRows = useMemo(
    () => Array.from(selection).map((k) => rowsByKey.get(k)).filter((r): r is BoardRow => !!r && r.selectable),
    [selection, rowsByKey],
  );

  useEffect(() => {
    if (selection.size === 0) return;
    const live = Array.from(selection).filter((k) => rowsByKey.get(k)?.selectable);
    if (live.length !== selection.size) setSelection(new Set(live));
  }, [rowsByKey, selection]);

  // Rail selection prunes the same way: a bill assigned away, held, removed or
  // filtered out drops out of the selection.
  const selectedRail = useMemo(() => rail.filter((o) => railSel.has(o.id)), [rail, railSel]);
  useEffect(() => {
    if (railSel.size === 0) return;
    if (selectedRail.length !== railSel.size) setRailSel(new Set(selectedRail.map((o) => o.id)));
  }, [railSel, selectedRail]);

  // ── The three toggles — selecting in one clears the other two ────────────
  const toggleRail = useCallback((o: TintOrder) => {
    setSelection(new Set());
    setHoldSel(new Set());
    setBaseSel(new Set());
    setTiSel(new Set());
    setRailSel((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; });
  }, []);
  const toggleRow = useCallback((r: BoardRow) => {
    setRailSel(new Set());
    setHoldSel(new Set());
    setBaseSel(new Set());
    setTiSel(new Set());
    setSelection((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; });
  }, []);
  const clearAllSelection = useCallback(() => {
    setSelection(new Set());
    setRailSel(new Set());
    setHoldSel(new Set());
    setBaseSel(new Set());
    setTiSel(new Set());
    setBarMenuOpen(false);
    setBarOpAnchor(null);
  }, []);

  // ── What the bar acts on ─────────────────────────────────────────────────
  const barMode: BarMode | null =
    railSel.size > 0 ? "rail" : selection.size > 0 ? "table" : holdSel.size > 0 ? "hold" : baseSel.size > 0 ? "base"
    : tiSel.size > 0 ? "ti" : null;
  /** One shape for every selected bill, whichever side it came from. */
  const barBills = useMemo(() => {
    if (barMode === "rail") {
      return selectedRail.map((o) => ({
        orderId: o.id, obdNumber: o.obdNumber,
        site: o.shipToOverrideName ?? o.customer?.customerName ?? o.shipToCustomerName ?? "—",
        original: o.shipToOverrideName ? (o.customer?.customerName ?? o.shipToCustomerName ?? null) : null,
        litres: o.querySnapshot?.totalVolume ?? null,
        articleTag: o.articleTag ?? o.querySnapshot?.articleTag ?? null,
        route: o.route ?? null,
        slotDate: o.dispatchTargetDate ?? null, slotWindowId: o.dispatchWindowId ?? null, slotWindowTime: o.dispatchWindowTime ?? null,
        isHeld: o.dispatchStatus === "hold", isHand: o.handAt != null,
        status: "pending" as string, operatorName: "", isBase: false,
        isUrgent: o.priorityLevel <= 2, // the rail card's ⚡ rule
      }));
    }
    if (barMode === "table") {
      return selectedRows.map((r) => ({
        orderId: r.orderId, obdNumber: r.obdNumber,
        site: r.siteName, original: r.originalSiteName,
        litres: r.volumeLitres, articleTag: r.articleTag, route: r.route,
        slotDate: r.slotDate, slotWindowId: r.slotWindowId, slotWindowTime: r.slotWindowTime,
        isHeld: r.isHeld, isHand: r.isHand,
        status: r.status as string, operatorName: r.operatorName, isBase: false,
        isUrgent: r.isUrgent,
      }));
    }
    if (barMode === "hold") {
      return (holdRows ?? []).filter((h) => holdSel.has(h.orderId)).map((h) => ({
        orderId: h.orderId, obdNumber: h.obdNumber,
        site: h.dealerName, original: h.originalSiteName,
        litres: h.volumeLitres, articleTag: h.articleTag, route: h.route,
        slotDate: h.dispatchTargetDate, slotWindowId: h.dispatchWindowId, slotWindowTime: h.dispatchWindowTime,
        isHeld: true, isHand: h.isHand,
        // The STAGE, so the bar knows a tint-room bill needs Stop & cancel.
        status: h.workflowStage, operatorName: h.operatorName ?? "",
        // A held BASE bill (non-tint) — the bar hides the tint-only items.
        isBase: !h.isTint,
        isUrgent: false, // the Hold tab offers no Urgent
      }));
    }
    if (barMode === "base") {
      return (baseRows ?? []).filter((r) => baseSel.has(r.orderId)).map((r) => ({
        orderId: r.orderId, obdNumber: r.obdNumber,
        site: r.dealerName,
        original: r.isShipToOverride ? r.customerName : null,
        litres: r.volumeLitres, articleTag: r.articleTag, route: r.route,
        slotDate: r.dispatchTargetDate, slotWindowId: r.windowId, slotWindowTime: r.windowTime,
        isHeld: false, isHand: r.isHand,
        status: "base" as string, operatorName: "", isBase: true,
        isUrgent: r.priorityLevel === 1, // Floor's ⚡ rule (floor-table.tsx)
      }));
    }
    return [];
  }, [barMode, selectedRail, selectedRows, holdRows, holdSel, baseRows, baseSel]);

  const toggleBase = useCallback((r: FloorBoardRow) => {
    setSelection(new Set());
    setRailSel(new Set());
    setHoldSel(new Set());
    setTiSel(new Set());
    setBaseSel((s) => { const n = new Set(s); if (n.has(r.orderId)) n.delete(r.orderId); else n.add(r.orderId); return n; });
  }, []);
  // Base selection prunes like the others: a bill that left Floor's board (or
  // its trip day passed) leaves the list.
  useEffect(() => {
    if (baseSel.size === 0 || baseRows === null) return;
    const live = Array.from(baseSel).filter((id) => baseRows.some((r) => r.orderId === id));
    if (live.length !== baseSel.size) setBaseSel(new Set(live));
  }, [baseRows, baseSel]);

  const toggleHold = useCallback((h: TintHoldRow) => {
    setSelection(new Set());
    setRailSel(new Set());
    setBaseSel(new Set());
    setTiSel(new Set());
    setHoldSel((s) => { const n = new Set(s); if (n.has(h.orderId)) n.delete(h.orderId); else n.add(h.orderId); return n; });
  }, []);
  // Hold selection prunes like the others: a released bill leaves the list.
  useEffect(() => {
    if (holdSel.size === 0 || holdRows === null) return;
    const live = Array.from(holdSel).filter((id) => holdRows.some((h) => h.orderId === id));
    if (live.length !== holdSel.size) setHoldSel(new Set(live));
  }, [holdRows, holdSel]);
  const barIds = useMemo(() => barBills.map((b) => b.orderId), [barBills]);
  const barSlot: DispatchSlotValue | null = useMemo(() => {
    if (barBills.length === 0) return null;
    const first = barBills[0];
    const same = barBills.every((b) => b.slotDate === first.slotDate && b.slotWindowId === first.slotWindowId);
    return same ? slotValueOf(first.slotDate, first.slotWindowId, first.slotWindowTime) : null;
  }, [barBills]);

  // ── Panel walk ────────────────────────────────────────────────────────────

  // Prev/Next walks THE LIST THE PANEL WAS OPENED FROM (step 7): the rail, the
  // table, or the Hold tab — never across them.
  const walk = useMemo<Array<{ key: string }>>(() => {
    if (panelKey === null) return [];
    if (panelKey.startsWith("pending-")) return rail.map((o) => ({ key: `pending-${o.id}` }));
    // The FILTERED lists (2026-10-02) — Prev/Next walks what the tab shows.
    if (panelKey.startsWith("hold-")) return (holdRowsShown ?? []).map((h) => ({ key: `hold-${h.orderId}` }));
    if (panelKey.startsWith("base-")) return (baseRowsShown ?? []).map((r) => ({ key: `base-${r.orderId}` }));
    return groups.flatMap((g) => g.rows.map((r) => ({ key: r.key })));
  }, [panelKey, rail, holdRowsShown, baseRowsShown, groups]);
  const panelIndex = panelKey === null ? -1 : walk.findIndex((w) => w.key === panelKey);

  const panelTarget: PanelTarget | null = useMemo(() => {
    if (panelKey === null) return null;
    if (panelKey.startsWith("pending-")) {
      const id = Number(panelKey.slice("pending-".length));
      const o = rail.find((x) => x.id === id);
      return o ? { kind: "pending", order: o } : null;
    }
    if (panelKey.startsWith("hold-")) {
      const id = Number(panelKey.slice("hold-".length));
      const h = (holdRows ?? []).find((x) => x.orderId === id);
      return h ? { kind: "hold", hold: h } : null;
    }
    if (panelKey.startsWith("base-")) {
      const id = Number(panelKey.slice("base-".length));
      const b = (baseRows ?? []).find((x) => x.orderId === id);
      return b ? { kind: "base", row: b } : null;
    }
    const r = rowsByKey.get(panelKey);
    return r ? { kind: "row", row: r } : null;
  }, [panelKey, rail, holdRows, baseRows, rowsByKey]);

  // The panel's target vanished under it (finished, reassigned away, filtered
  // out). Close rather than showing a stale ghost.
  useEffect(() => {
    if (panelKey !== null && panelTarget === null) setPanelKey(null);
  }, [panelKey, panelTarget]);

  useEffect(() => { setPanelError(null); }, [panelKey]);

  // ── Live sync ─────────────────────────────────────────────────────────────
  // Two paths, one switch (tint step 4, 2026-09-30 — use-tint-manager-live.ts):
  //   feed live → one glance, ONE board reload per hit, held while `holdLive`
  //               and applied once on release;
  //   not live  → <LegacyTintManagerSync> at the foot of the page: the 15 s
  //               marker exactly as before, paused while the panel is open or a
  //               selection is up (FLOOR §5).
  // The feed holds for MORE than the marker did: a re-sequence or any write in
  // flight, and every modal / sheet / popover this page opens.
  const holdLive =
    historyDate !== null ||
    panelKey !== null || selection.size > 0 || railSel.size > 0 || holdSel.size > 0 || baseSel.size > 0 ||
    tiSel.size > 0 || tiBulkDose !== null || tiUndoBusy ||
    barMenuOpen || barOpAnchor !== null || offFloor !== null || stopCancelBill !== null || restoringId !== null ||
    reorderBusy.size > 0 || writeBusy || railMenuOpen ||
    baseUndoBusyId !== null || missingBadgeOpen || missingSheetOpen || pullModalOpen ||
    revertOrder !== null || removeModalOrder !== null || hideModalOrder !== null ||
    skipHistoryFor !== null || pauseHistoryFor !== null;
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const missingRef = useRef(missingCustomers);
  missingRef.current = missingCustomers;
  const panelOrderId =
    panelTarget === null ? null
    : panelTarget.kind === "pending" ? panelTarget.order.id
    : panelTarget.kind === "hold" ? panelTarget.hold.orderId
    : panelTarget.row.orderId; // "row" and "base" both carry row.orderId

  // "Changed — Reload" (feed only): the open bill changed elsewhere → a quiet
  // board read; the strip shows only if that bill really differs. Never swaps
  // the data under the panel by itself.
  const [panelFresh, setPanelFresh] = useState<TintBoardPayload | null>(null);
  useEffect(() => { setPanelFresh(null); }, [panelKey, payload]);
  const panelKeyRef = useRef(panelKey);
  panelKeyRef.current = panelKey;
  const checkPanelChanged = useCallback(async () => {
    const key = panelKeyRef.current;
    if (key === null) return;
    try {
      const res = await fetch("/api/tint/manager/orders", { cache: "no-store" });
      if (!res.ok || panelKeyRef.current !== key) return;
      const data = (await res.json()) as TintBoardPayload;
      const fresh: TintBoardPayload = {
        orders:               data.orders ?? [],
        activeSplits:         data.activeSplits ?? [],
        completedSplits:      data.completedSplits ?? [],
        completedAssignments: data.completedAssignments ?? [],
      };
      if (panelSnapshot(fresh, key) !== panelSnapshot(payloadRef.current, key)) setPanelFresh(fresh);
    } catch { /* no strip — the next change tries again */ }
  }, []);

  const liveSync = useTintManagerLive({
    hold:          holdLive,
    boardIds:      () => boardOrderIds(payloadRef.current),
    missingIds:    () => missingRef.current.map((m) => m.orderId),
    panelOrderId,
    fetchBoard,
    fetchMissing:  fetchMissingCustomers,
    onPanelBillChanged: () => { void checkPanelChanged(); },
  });
  const feedLive = liveSync.live;

  // ── THE single window-level Esc owner for this screen ──────────────────────
  // One listener, one branch per keypress. Never add a second under
  // components/tint/manager/ — two window-level listeners race in registration
  // order, which is the bug FLOOR §4.6 exists to prevent.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "Escape") {
        // Guard order, exactly one branch per keypress (FLOOR §4.6's spec):
        //   slot popover open → nothing (the picker dismisses on click-outside;
        //     it carries data-slot-popover="open" for exactly this)
        //   focus in a field → nothing
        //   a menu / dialog from the bar → close it (never mid-request)
        //   panel open → close it · selection → clear all three
        if (document.querySelector('[data-slot-popover="open"]')) return;
        if (typing) return;
        // The tab row's Filter / ⌨ popovers (2026-10-02) — controlled here.
        // The search dropdown (2026-10-02) — focus in the box is the header's
        // Escape (clear + blur); this rung covers an open list with focus elsewhere.
        if (searchRunRef.current !== null) { closeSearchRef.current(); return; }
        if (filterOpen) { setFilterOpen(false); return; }
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (barOpAnchor !== null) { setBarOpAnchor(null); return; }
        if (barMenuOpen) { setBarMenuOpen(false); return; }
        if (offFloor !== null || stopCancelBill !== null || shopDeliveryBills !== null || tiBulkDose !== null) {
          if (dialogBusy) return;
          setOffFloor(null); setStopCancelBill(null); setShopDeliveryBills(null); setTiBulkDose(null);
          return;
        }
        if (panelKey !== null) { setPanelKey(null); return; }
        if (selection.size > 0 || railSel.size > 0 || holdSel.size > 0 || baseSel.size > 0 || tiSel.size > 0) { clearAllSelection(); return; }
        // Last rung (2026-10-02): the Tint tab's focused operator → back to all.
        if (focusedOperatorId !== null) { setFocusedOperatorId(null); return; }
        return;
      }
      // M — Add OBD to Tint. Ignored while typing, and while the panel is open
      // (the panel is a focus context of its own).
      if ((e.key === "m" || e.key === "M") && !typing && panelKey === null && historyDateRef.current === null) {
        e.preventDefault();
        setPullModalOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelKey, selection, railSel, holdSel, baseSel, tiSel, barOpAnchor, barMenuOpen, offFloor, stopCancelBill, shopDeliveryBills, tiBulkDose, dialogBusy, clearAllSelection, focusedOperatorId, filterOpen, shortcutsOpen]);

  // ── Hold + CI lists (step 7) — read when the person can see the tab, and
  // again after every board reload (payload changes), so the tab counts track
  // the board. Read-only; the marker widening is build step 9.
  const fetchHold = useCallback(async () => {
    // Hold has no history — nothing to read on a past day.
    if (!access.canViewHoldTab || historyDateRef.current !== null) return;
    try {
      const res = await fetch("/api/tint/manager/hold", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { rows?: TintHoldRow[]; error?: string };
      if (!res.ok || !Array.isArray(body.rows)) { setHoldError(body.error ?? `Hold list HTTP ${res.status}`); return; }
      setHoldError(null);
      setHoldRows(body.rows);
    } catch { setHoldError("Could not load the Hold list."); }
  }, [access.canViewHoldTab]);
  const fetchCancelled = useCallback(async () => {
    if (!access.canViewCiTab) return;
    try {
      const res = await fetch(dated("/api/tint/manager/cancelled"), { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { rows?: FloorCancelledRow[]; error?: string };
      if (!res.ok || !Array.isArray(body.rows)) { setCancelledError(body.error ?? `CI list HTTP ${res.status}`); return; }
      setCancelledError(null);
      setCancelledRows(body.rows);
    } catch { setCancelledError("Could not load the CI list."); }
  }, [access.canViewCiTab]);
  // The Base tab (2026-10-01, Base tab 4B) — on tint_manager canView alone (owner
  // §I-4), which this page already requires. Reloads with the Hold / CI lists
  // below: on load, after this page's writes, and on every marker change (the
  // marker's Base arms 6–8, d788a2d1) — under the same pause rule.
  const fetchBase = useCallback(async () => {
    try {
      const res = await fetch(dated("/api/tint/manager/base"), { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { rows?: FloorBoardRow[]; error?: string };
      if (!res.ok || !Array.isArray(body.rows)) { setBaseError(body.error ?? `Base list HTTP ${res.status}`); return; }
      setBaseError(null);
      setBaseRows(body.rows);
    } catch { setBaseError("Could not load the Base list."); }
  }, []);
  // ── Tab badges + list refresh (step 9) ───────────────────────────────────
  // Every board reload — on page load, after this page's own writes, and on a
  // MARKER CHANGE (LegacyTintManagerSync → fetchBoard; the marker's arms 4–5 and
  // its four tab stamps since step 9) — re-reads the Hold and CI lists, and the
  // TI and Pick-delete counts in the effect further down. So every badge shows
  // without opening its tab, and an open tab moves when its source moves. The
  // marker's pause rule (panel open / a selection up) holds all of it: no
  // marker change is delivered while paused, so nothing reloads.
  // `sideReload` is the signal an open Pick-delete tab reloads on.
  const [sideReload, setSideReload] = useState(0);
  useEffect(() => {
    void fetchHold();
    void fetchCancelled();
    void fetchBase();
    setSideReload((n) => n + 1);
  }, [payload, fetchHold, fetchCancelled, fetchBase]);

  // The Pick delete badge from page load (step 9 — it used to appear only once
  // the tab had been opened): the decided rows of the current IST month, the
  // same count the tab shows for its default month.
  const fetchPickCount = useCallback(async () => {
    if (!access.canViewPickDelete) return;
    try {
      const month = currentIstMonth(new Date());
      const res = await fetch(`${TINT_PICK_DELETE_BASE}/list?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { decided?: unknown[] };
      if (Array.isArray(body.decided)) {
        setPickDecidedCount(body.decided.length);
        setPickDecidedRows(body.decided as PickDeleteDecidedRow[]);
      }
    } catch { /* the badge keeps its last number */ }
  }, [access.canViewPickDelete]);

  // Active dispatch windows, once — the Slot picker (bar + table cell).
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const res = await fetch("/api/tint/manager/dispatch-windows", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { windows?: DispatchWindow[] };
        if (!gone) setWindows(body.windows ?? []);
      } catch { /* the picker stays disabled with no windows */ }
    })();
    return () => { gone = true; };
  }, []);

  // A tab switch drops the table / hold selection (the rows are not on screen);
  // the rail's stays — the rail is on every tab.
  useEffect(() => {
    setSelection(new Set());
    setHoldSel(new Set());
    setBaseSel(new Set());
    setTiSel(new Set());
    setBarMenuOpen(false);
    setBarOpAnchor(null);
  }, [activeTab]);

  // Close the missing-customer popover on outside click
  useEffect(() => {
    if (!missingBadgeOpen) return;
    const handler = (e: MouseEvent) => {
      if (missingBadgeRef.current && !missingBadgeRef.current.parentElement?.contains(e.target as Node)) {
        setMissingBadgeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [missingBadgeOpen]);

  /**
   * Refetch the TI-pending list, and keep any open drilldown in step with it.
   *
   * Returns the fresh list so a caller that must decide "was that the last
   * line?" can read the answer directly instead of racing its own state.
   */
  const fetchBasePending = useCallback(async (): Promise<BasePendingOrder[]> => {
    try {
      const res = await fetch(dated("/api/tint/manager/base-pending"));
      if (!res.ok) return [];
      const body = (await res.json()) as { orders?: BasePendingOrder[] };
      const list = body.orders ?? [];
      setBasePending(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // TI list (and its badge) + the Pick delete badge: on load and on every board
  // reload, like Hold / CI above (step 9 — base-pending used to be read on mount
  // and after this page's own actions only).
  useEffect(() => {
    void fetchBasePending();
    void fetchPickCount();
  }, [payload, fetchBasePending, fetchPickCount]);

  /**
   * A line's TI just saved. Advance to the next line still owing one on this
   * bill; when none is left the bill has dropped out of base-pending entirely,
   * so close the drilldown and return the rail to normal.
   *
   * The decision is made from the SERVER's fresh list, never from local state —
   * the route is the thing that decides what is still owed (coverage keyed on
   * tintAssignmentId), and a client guess could strand a line or close early.
   */
  const handleBaseLineSaved = useCallback(async () => {
    const list = await fetchBasePending();
    const stillOwed = baseDrill
      ? list.find((o) => o.tintAssignmentId === baseDrill.tintAssignmentId) ?? null
      : null;
    if (!stillOwed) {
      setBaseLine(null);
      setBaseDrill(null);
      toast.success("Tinter Issue complete — bill closed");
      return;
    }
    setBaseDrill(stillOwed);
    const next = stillOwed.lines.find((l) => !l.hasTiEntry) ?? null;
    setBaseLine(next);
    if (next) toast.success("Saved — next line");
  }, [fetchBasePending, baseDrill]);

  /**
   * Undo a bypass — put the bill back on the tint rail.
   *
   * The button is always offered; the SERVER decides whether it is allowed. Its
   * four refusals (not a bypass / paperwork started / already picked / moved on
   * Floor) each carry a message written to be read by the manager, so they are
   * surfaced verbatim rather than replaced with a generic failure — "can't
   * undo" without a reason is what makes someone retry, then call.
   */
  const handleBaseUndo = useCallback(async (order: BasePendingOrder) => {
    setBaseUndoBusyId(order.orderId);
    try {
      const res = await fetch("/api/tint/manager/base-bypass/undo", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId: order.orderId }),
      });
      if (!res.ok) {
        // The route answers { ok:false, errorCode, message }; `error` is the
        // shape the 401/403 arms use. Read both so no refusal renders blank.
        const b = (await res.json().catch(() => ({}))) as { message?: unknown; error?: unknown };
        const msg = typeof b.message === "string" ? b.message
                  : typeof b.error === "string"   ? b.error
                  : `Undo failed (HTTP ${res.status})`;
        toast.error(msg);
        return;
      }
      toast.success(`${order.obdNumber} back on the tint rail`);
      // Close the drilldown if it was showing the bill that just went away.
      if (baseDrill?.orderId === order.orderId) {
        setBaseDrill(null);
        setBaseLine(null);
      }
      // Both lists move: the bill leaves base-pending and rejoins the rail.
      await fetchBasePending();
      await fetchBoard();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Undo failed");
    } finally {
      setBaseUndoBusyId(null);
    }
  }, [baseDrill, fetchBasePending, fetchBoard]);

  // ── TI tab bulk (2026-10-02) ───────────────────────────────────────────────
  const toggleTi = useCallback((o: BasePendingOrder) => {
    setSelection(new Set());
    setRailSel(new Set());
    setHoldSel(new Set());
    setBaseSel(new Set());
    // A "TI done" row is read-only — never selectable.
    if (o.tiDoneAt) return;
    setTiSel((s) => { const n = new Set(s); if (n.has(o.tintAssignmentId)) n.delete(o.tintAssignmentId); else n.add(o.tintAssignmentId); return n; });
  }, []);
  const selectedTi = useMemo(() => basePending.filter((o) => tiSel.has(o.tintAssignmentId)), [basePending, tiSel]);
  // TI selection prunes like the others: a closed or undone bill leaves the list.
  useEffect(() => {
    if (tiSel.size === 0) return;
    const live = Array.from(tiSel).filter((id) => basePending.some((o) => o.tintAssignmentId === id));
    if (live.length !== tiSel.size) setTiSel(new Set(live));
  }, [basePending, tiSel]);

  /** "↶ Undo Base" on every selected TI bill — the SAME route and refusals as
   *  the row's Undo (POST /api/tint/manager/base-bypass/undo), one bill at a
   *  time, then ONE toast naming every refused bill in the server's words. */
  const handleBulkUndoBase = useCallback(async () => {
    const bills = selectedTi;
    if (bills.length === 0) return;
    setTiUndoBusy(true);
    const refused: string[] = [];
    let undone = 0;
    for (const o of bills) {
      try {
        const res = await fetch("/api/tint/manager/base-bypass/undo", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ orderId: o.orderId }),
        });
        if (res.ok) { undone++; continue; }
        const b = (await res.json().catch(() => ({}))) as { message?: unknown; error?: unknown };
        const msg = typeof b.message === "string" ? b.message
                  : typeof b.error === "string"   ? b.error
                  : `Undo failed (HTTP ${res.status})`;
        refused.push(`${o.obdNumber}: ${msg}`);
      } catch (e) {
        refused.push(`${o.obdNumber}: ${e instanceof Error ? e.message : "Undo failed"}`);
      }
    }
    const head = `${undone} ${undone === 1 ? "bill" : "bills"} back on the tint rail` + (refused.length > 0 ? ` · ${refused.length} refused` : "");
    const opts = refused.length > 0 ? { description: refused.join("\n"), duration: 10000 } : undefined;
    if (undone === 0 && refused.length > 0) toast.error(head, opts);
    else if (refused.length > 0) toast.warning(head, opts);
    else toast.success(head);
    setTiSel(new Set());
    await fetchBasePending();
    await fetchBoard();
    setTiUndoBusy(false);
  }, [selectedTi, fetchBasePending, fetchBoard]);

  // ── Writes ────────────────────────────────────────────────────────────────

  /** POST one assign. Returns null on success, else the server's own message. */
  const postAssign = useCallback(async (orderId: number, operatorId: number): Promise<string | null> => {
    try {
      const res = await fetch("/api/tint/manager/assign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId, assignedToId: operatorId }),
      });
      if (res.ok) return null;
      // The route's 400s carry a message written to be shown verbatim (the
      // customer-missing backstop and the new stage guard both do).
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return typeof body.error === "string" ? body.error : `Assign failed (HTTP ${res.status})`;
    } catch (err) {
      return err instanceof Error ? err.message : "Assign failed";
    }
  }, []);

  /**
   * Assign from the rail, WITH the customer-missing interceptor.
   *
   * Behaviour preserved from the old Kanban (tint-manager-content.tsx ~2305-2338):
   * a customerMissing order never reaches the assign call — it opens
   * CustomerMissingSheet with an amber warning instead, and the intent is
   * remembered so the assign re-fires by itself once the flag flips false. The
   * server refuses it too (a 400 from assign/route.ts), so this is the
   * affordance, not the rule.
   */
  const handleAssign = useCallback(async (order: TintOrder, operatorId: number) => {
    if (order.customerMissing) {
      setPendingAssign({ orderId: order.id, operatorId });
      sheetResolvedRef.current = false;
      setMissingSheetWarning("Resolve customer details first before assigning.");
      setMissingSheetOrder(order);
      setMissingSheetOpen(true);
      return;
    }
    setWriteBusy(true);
    setPanelError(null);
    const err = await postAssign(order.id, operatorId);
    setWriteBusy(false);
    if (err) {
      setPanelError(err);
      toast.error(err);
      return;
    }
    const opName = operators.find((o) => o.id === operatorId)?.name ?? "operator";
    toast.success(`${order.obdNumber} assigned to ${opName}`);
    setPanelKey(null);
    await fetchBoard();
    void fetchMissingCustomers();
  }, [postAssign, operators, fetchBoard, fetchMissingCustomers]);

  /**
   * "Base — No Tint" — close a pending bill that needs no tinting at all.
   *
   * Same write/toast/refresh shape as handleAssign above, and the SAME
   * customer-missing interceptor: a customerMissing bill never reaches the
   * bypass call — it opens CustomerMissingSheet with an amber warning instead,
   * and the intent is remembered so the bypass re-fires by itself once the flag
   * flips false. The server refuses it too (a 400 from base-bypass/route.ts),
   * so this is the affordance, not the rule.
   *
   * ⚠ The check is on the ORDER we already hold, before the fetch — exactly as
   * handleAssign does it. Neither path reads the server's rejection to decide
   * whether to open the sheet; the 400 is the backstop for a direct API call.
   *
   * The bypass is offered only from the two PENDING surfaces (rail card +
   * detail panel's pending branch); the route 400s on anything past
   * pending_tint_assignment.
   */
  const handleBaseBypass = useCallback(async (order: TintOrder) => {
    if (order.customerMissing) {
      setPendingBypass({ orderId: order.id });
      sheetResolvedRef.current = false;
      setMissingSheetWarning("Resolve customer details first before marking it Base — No Tint.");
      setMissingSheetOrder(order);
      setMissingSheetOpen(true);
      return;
    }
    setWriteBusy(true);
    setPanelError(null);
    let err: string | null = null;
    try {
      const res = await fetch("/api/tint/manager/base-bypass", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId: order.id }),
      });
      if (!res.ok) {
        // The route's 400s and its "placeholder worker missing" 500 all carry a
        // message written to be shown verbatim.
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        err = typeof body.error === "string"
          ? body.error
          : `Base — No Tint failed (HTTP ${res.status})`;
      }
    } catch (e) {
      err = e instanceof Error ? e.message : "Base — No Tint failed";
    }
    setWriteBusy(false);
    if (err) {
      setPanelError(err);
      toast.error(err);
      return;
    }
    toast.success(`${order.obdNumber} closed as Base — No Tint`);
    setPanelKey(null);
    await fetchBoard();
    void fetchMissingCustomers();
  }, [fetchBoard, fetchMissingCustomers]);

  // The chain: once the sheet resolves and the refreshed order is no longer
  // customerMissing, replay the interrupted assign.
  useEffect(() => {
    if (!pendingAssign) return;
    const fresh = payload.orders.find((o) => o.id === pendingAssign.orderId);
    if (!fresh) { setPendingAssign(null); return; }  // gone from the board
    if (fresh.customerMissing) return;                // still missing — keep waiting
    const { operatorId } = pendingAssign;
    setPendingAssign(null);
    void handleAssign(fresh, operatorId);
  }, [payload, pendingAssign, handleAssign]);

  // The same chain for Base — No Tint: once the sheet resolves and the
  // refreshed order is no longer customerMissing, replay the interrupted
  // BYPASS — never handleAssign, which would silently hand the bill to an
  // operator the manager never chose.
  useEffect(() => {
    if (!pendingBypass) return;
    const fresh = payload.orders.find((o) => o.id === pendingBypass.orderId);
    if (!fresh) { setPendingBypass(null); return; }  // gone from the board
    if (fresh.customerMissing) return;                // still missing — keep waiting
    setPendingBypass(null);
    void handleBaseBypass(fresh);
  }, [payload, pendingBypass, handleBaseBypass]);

  /** Single re-assign of a whole order, from the panel. Waiting rows only. */
  const handleReassignOrder = useCallback(async (row: BoardRow, operatorId: number) => {
    setWriteBusy(true);
    setPanelError(null);
    const err = await postAssign(row.orderId, operatorId);
    setWriteBusy(false);
    if (err) { setPanelError(err); toast.error(err); return; }
    const opName = operators.find((o) => o.id === operatorId)?.name ?? "operator";
    toast.success(`${row.obdNumber} moved to ${opName}`);
    await fetchBoard();
  }, [postAssign, operators, fetchBoard]);

  /** Splits re-assign through their OWN endpoint, never the whole-order one. */
  const handleReassignSplit = useCallback(async (row: BoardRow, operatorId: number) => {
    setWriteBusy(true);
    setPanelError(null);
    try {
      const res = await fetch("/api/tint/manager/splits/reassign", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ splitId: row.id, assignedToId: operatorId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        const msg = typeof body.error === "string" ? body.error : `Re-assign failed (HTTP ${res.status})`;
        setPanelError(msg);
        toast.error(msg);
        return;
      }
      const opName = operators.find((o) => o.id === operatorId)?.name ?? "operator";
      toast.success(`Split #${row.splitNumber} moved to ${opName}`);
      await fetchBoard();
    } finally {
      setWriteBusy(false);
    }
  }, [operators, fetchBoard]);

  /**
   * Send back to Pending — cancel the assignment, return the bill to the rail.
   *
   * Branches by row type onto the two endpoints that already existed for this
   * and had been left with no caller by the board rebuild:
   *   whole order → POST /api/tint/manager/cancel-assignment { orderId }
   *   split       → POST /api/tint/manager/splits/cancel      { splitId }
   *
   * Offered on `assigned` rows only, which is the ROUTES' own rule rather than a
   * UI preference: cancel-assignment requires `workflowStage === "tint_assigned"`
   * (400 otherwise) and splits/cancel rejects `tinting_in_progress` /
   * `tinting_done` (409). Neither admits anything Re-assign does not.
   *
   * ⚠ The response IS read. The old Kanban's equivalent fired the POST and never
   * looked at the answer — a rejected cancel logged to console and looked like
   * success, the same swallow FLOOR §6(b) documents. A failure here surfaces in
   * the panel and as a toast.
   */
  const handleSendBack = useCallback(async (row: BoardRow) => {
    setWriteBusy(true);
    setPanelError(null);
    try {
      const isSplit = row.type === "split";
      const res = await fetch(
        isSplit ? "/api/tint/manager/splits/cancel" : "/api/tint/manager/cancel-assignment",
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(isSplit ? { splitId: row.id } : { orderId: row.orderId }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        const msg = typeof body.error === "string"
          ? body.error
          : `Could not send back (HTTP ${res.status})`;
        setPanelError(msg);
        toast.error(msg);
        return;
      }
      toast.success(
        isSplit
          ? `Split #${row.splitNumber} cancelled — ${row.obdNumber} is back on the rail`
          : `${row.obdNumber} sent back to Pending`,
      );
      // The row leaves the table for the rail, so its key changes (order-N →
      // pending-N) and the panel's target is gone. Close, matching what Assign
      // and Remove OBD already do — there is no "next item" to step to when the
      // thing you acted on moved to the other side of the screen.
      setPanelKey(null);
      await fetchBoard();
    } finally {
      setWriteBusy(false);
    }
  }, [fetchBoard]);

  /**
   * Bulk re-assign — N SEQUENTIAL awaits over the single-assign route.
   *
   * There is no bulk endpoint, and there deliberately is no Promise.all and no
   * $transaction: Vercel serverless against the Supabase pooler is the reason
   * (CORE §3).
   *
   * Partial-failure contract copied from Floor (CLAUDE_FLOOR §4.1/§4.2): collect
   * `failed[]`, treat "nothing was written" as the 422 case with a hard error,
   * and NAME the ones that failed when some succeeded. A write that skipped
   * silently must never look like success — that is the exact bug FLOOR §6(b)
   * documents.
   *
   * A customerMissing row goes into failed[] with a clear reason. It is not
   * silently skipped, and it does not abort the batch: the other rows are still
   * the manager's to move.
   */
  const handleBulkReassign = useCallback(async (operatorId: number) => {
    const rows = selectedRows;
    if (rows.length === 0) return;
    setWriteBusy(true);

    const failed: Array<{ obd: string; reason: string }> = [];
    let ok = 0;

    for (const row of rows) {
      if (row.order?.customerMissing) {
        failed.push({ obd: row.obdNumber, reason: "customer master data missing — resolve it first" });
        continue;
      }
      if (row.operatorId === operatorId) {
        failed.push({ obd: row.obdNumber, reason: "already with that operator" });
        continue;
      }
      const err = await postAssign(row.orderId, operatorId);
      if (err) failed.push({ obd: row.obdNumber, reason: err });
      else ok++;
    }

    setWriteBusy(false);
    const opName = operators.find((o) => o.id === operatorId)?.name ?? "operator";

    if (ok === 0) {
      // The 422 case: nothing was written.
      toast.error(`Nothing was re-assigned — all ${failed.length} failed`, {
        description: failed.map((f) => `${f.obd}: ${f.reason}`).join("\n"),
        duration: 10000,
      });
    } else if (failed.length > 0) {
      toast.warning(`${ok} moved to ${opName} · ${failed.length} failed`, {
        description: failed.map((f) => `${f.obd}: ${f.reason}`).join("\n"),
        duration: 10000,
      });
    } else {
      toast.success(`${ok} ${ok === 1 ? "job" : "jobs"} moved to ${opName}`);
    }

    setSelection(new Set());
    await fetchBoard();
    void fetchMissingCustomers();
  }, [selectedRows, postAssign, operators, fetchBoard, fetchMissingCustomers]);

  // ── Bottom-bar writes (tabs build step 6) ────────────────────────────────

  /**
   * One Tint Manager action over N bills — POST /api/tint/manager/actions
   * (hold / unhold / hand / unhand / change-slot; the shared applyBillAction).
   * The route answers Floor's { done, failed, skipped? } with 422 when nothing
   * landed; failures are NAMED, never swallowed (FLOOR §6(b)).
   */
  const postTintAction = useCallback(async (
    action: "hold" | "unhold" | "hand" | "unhand" | "change-slot" | "mark-urgent",
    orderIds: number[],
    opts: { slot?: DispatchSlotValue; keepSelection?: boolean; urgent?: boolean } = {},
  ) => {
    if (orderIds.length === 0) return;
    setWriteBusy(true);
    try {
      const res = await fetch("/api/tint/manager/actions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          action,
          orderIds,
          ...(opts.slot ? { dispatchTargetDate: opts.slot.date, dispatchWindowId: opts.slot.dispatchWindowId } : {}),
          ...(typeof opts.urgent === "boolean" ? { urgent: opts.urgent } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; done?: number[]; failed?: Array<{ orderId: number; error: string }>; skipped?: number[];
      };
      if (!Array.isArray(body.done)) {
        toast.error(body.error ?? `Could not save — HTTP ${res.status}`);
        return;
      }
      const words: Record<typeof action, string> = {
        hold: "on hold", unhold: "released from hold", hand: "marked Hand", unhand: "Hand cleared", "change-slot": "due date set",
        "mark-urgent": opts.urgent === false ? "urgent cleared" : "marked urgent",
      };
      const failed = body.failed ?? [];
      const obdOf = (id: number) => barBills.find((b) => b.orderId === id)?.obdNumber ?? `#${id}`;
      if (body.done.length === 0 && failed.length > 0) {
        toast.error(`Nothing changed — ${failed.length} refused`, {
          description: failed.map((f) => `${obdOf(f.orderId)}: ${f.error}`).join("\n"), duration: 10000,
        });
      } else if (failed.length > 0) {
        toast.warning(`${body.done.length} ${words[action]} · ${failed.length} refused`, {
          description: failed.map((f) => `${obdOf(f.orderId)}: ${f.error}`).join("\n"), duration: 10000,
        });
      } else if (body.done.length > 0) {
        toast.success(`${body.done.length} ${body.done.length === 1 ? "bill" : "bills"} ${words[action]}`);
      } else {
        toast.info("Already as asked — nothing to change");
      }
      if (!opts.keepSelection && body.done.length > 0) clearAllSelection();
      await fetchBoard();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setWriteBusy(false);
    }
  }, [barBills, clearAllSelection, fetchBoard]);

  /**
   * Assign the selected RAIL bills to one operator.
   *
   * ONE bill → handleAssign, which keeps the customer-missing interceptor in
   * front (CLAUDE_TINT §1.5): the sheet opens and the assign re-fires once the
   * customer resolves. SEVERAL → sequential awaits over the same route, the bulk
   * re-assign contract (failed[] named, nothing-written is a hard error); a
   * customer-missing bill lands in failed[] with "select it alone" rather than
   * opening N sheets.
   */
  const handleRailAssign = useCallback(async (operatorId: number) => {
    const bills = selectedRail;
    if (bills.length === 0) return;
    if (bills.length === 1) {
      clearAllSelection();
      await handleAssign(bills[0], operatorId);
      return;
    }
    setWriteBusy(true);
    const failed: Array<{ obd: string; reason: string }> = [];
    let ok = 0;
    for (const o of bills) {
      if (o.customerMissing) {
        failed.push({ obd: o.obdNumber, reason: "customer master data missing — select it alone to resolve" });
        continue;
      }
      const err = await postAssign(o.id, operatorId);
      if (err) failed.push({ obd: o.obdNumber, reason: err });
      else ok++;
    }
    setWriteBusy(false);
    const opName = operators.find((x) => x.id === operatorId)?.name ?? "operator";
    if (ok === 0) {
      toast.error(`Nothing was assigned — all ${failed.length} failed`, {
        description: failed.map((f) => `${f.obd}: ${f.reason}`).join("\n"), duration: 10000,
      });
    } else if (failed.length > 0) {
      toast.warning(`${ok} assigned to ${opName} · ${failed.length} failed`, {
        description: failed.map((f) => `${f.obd}: ${f.reason}`).join("\n"), duration: 10000,
      });
    } else {
      toast.success(`${ok} bills assigned to ${opName}`);
    }
    clearAllSelection();
    await fetchBoard();
    void fetchMissingCustomers();
  }, [selectedRail, clearAllSelection, handleAssign, postAssign, operators, fetchBoard, fetchMissingCustomers]);

  /** "Base — No Tint" on the selected rail bills — handleBaseBypass per bill,
   *  sequential awaits, so each keeps its own customer-missing interceptor. */
  const handleRailBase = useCallback(async () => {
    const bills = selectedRail;
    clearAllSelection();
    for (const o of bills) {
      await handleBaseBypass(o);
    }
  }, [selectedRail, clearAllSelection, handleBaseBypass]);

  /** Send back the selected TABLE jobs (assigned only — the bar disables it
   *  otherwise) — handleSendBack per row, sequential awaits. */
  const handleBarSendBack = useCallback(async () => {
    const rows = selectedRows.filter((r) => r.status === "assigned");
    clearAllSelection();
    for (const r of rows) {
      await handleSendBack(r);
    }
  }, [selectedRows, clearAllSelection, handleSendBack]);

  /** Open the Cancel or Raise CI form on the bar's bills, on the Tint Manager's
   *  routes. The server decides each bill (refusals come back in the result
   *  view), so nothing is pre-refused here. */
  const openOffFloor = useCallback((tab: OffFloorTab, only?: PanelBill[]) => {
    setOffFloor({
      tab,
      bills: only
        ? only.map((b) => ({ orderId: b.orderId, obdNumber: b.obdNumber, dealerName: b.siteName, litres: b.litres, refusal: null }))
        : barBills.map((b) => ({
            orderId: b.orderId, obdNumber: b.obdNumber, dealerName: b.site, litres: b.litres, refusal: null,
          })),
    });
    if (tab === "ci" && ciReasons === null) {
      setCiReasonsError(null);
      void (async () => {
        try {
          const res = await fetch("/api/tint/manager/ci", { cache: "no-store" });
          const body = (await res.json().catch(() => ({}))) as { reasons?: CiReasonOption[]; error?: string };
          if (!res.ok || !Array.isArray(body.reasons)) {
            setCiReasonsError(body.error ?? `Could not load CI reasons — HTTP ${res.status}`);
            return;
          }
          setCiReasons(body.reasons);
        } catch {
          setCiReasonsError("Could not load CI reasons.");
        }
      })();
    }
  }, [barBills, ciReasons]);

  /** Restore one cancelled tint bill (CI tab) — POST /api/tint/manager/restore,
   *  the shared restore. The toast says WHERE it went, from the route's answer:
   *  never finished tinting → the tint rail; finished → Floor. */
  const handleRestore = useCallback(async (r: FloorCancelledRow) => {
    setRestoringId(r.orderId);
    try {
      const res = await fetch("/api/tint/manager/restore", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderIds: [r.orderId] }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; failed?: Array<{ orderId: number; error: string }>; restored?: Array<{ orderId: number; toStage: string }>;
      };
      const done = body.restored?.find((x) => x.orderId === r.orderId);
      if (!done) {
        toast.error(body.failed?.[0]?.error ?? body.error ?? `Restore failed — HTTP ${res.status}`);
        return;
      }
      toast.success(
        done.toStage === "pending_tint_assignment"
          ? `${r.obdNumber} back on the tint rail`
          : `${r.obdNumber} restored to Floor (tinting was already done)`,
      );
      await fetchBoard();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoringId(null);
    }
  }, [fetchBoard]);

  /** The panel's ship-to save — POST /api/tint/manager/ship-to (the shared
   *  setShipToOverride; a bill on a trip is refused with Billing's words). */
  const handleShipTo = useCallback(async (orderId: number, customerId: number | null): Promise<boolean> => {
    try {
      const res = await fetch("/api/tint/manager/ship-to", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orderId, customerId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; changed?: boolean };
      if (!res.ok) { toast.error(body.error ?? `Could not change the ship-to — HTTP ${res.status}`); return false; }
      toast.success(customerId === null ? "Back to its own site" : body.changed === false ? "Already shipping there" : "Ship-to changed");
      await fetchBoard();
      return true;
    } catch {
      toast.error("Could not reach the server — nothing was changed.");
      return false;
    }
  }, [fetchBoard]);

  /** Everything the detail panel can ask for — the page owns every write. */
  const panelActions: TintPanelActions = useMemo(() => ({
    onAssign:          (o, opId) => { void handleAssign(o, opId); },
    onBaseBypass:      (o) => { void handleBaseBypass(o); },
    onReassignOrder:   (r, opId) => { void handleReassignOrder(r, opId); },
    onReassignSplit:   (r, opId) => { void handleReassignSplit(r, opId); },
    onSendBack:        (r) => { void handleSendBack(r); },
    onRemove:          (o) => setRemoveModalOrder(o),
    onResolveMissing:  (o) => {
      sheetResolvedRef.current = false;
      setMissingSheetWarning(undefined);
      setMissingSheetOrder(o);
      setMissingSheetOpen(true);
    },
    onOpenPauseHistory: (orderId, obdNumber, siteName) => setPauseHistoryFor({ orderId, obdNumber, customerName: siteName }),
    onOpenSkipHistory:  (orderId, obdNumber, siteName) => setSkipHistoryFor({ orderId, obdNumber, customerName: siteName }),
    onSetSlot:     (orderId, v) => { void postTintAction("change-slot", [orderId], { slot: v, keepSelection: true }); },
    onHold:        (orderId) => { void postTintAction("hold", [orderId], { keepSelection: true }); },
    onReleaseHold: (orderId) => { void postTintAction("unhold", [orderId], { keepSelection: true }); },
    onHand:        (orderId, set) => { void postTintAction(set ? "hand" : "unhand", [orderId], { keepSelection: true }); },
    onShipTo:      handleShipTo,
    onCancel:      (b) => openOffFloor("cancel", [b]),
    onStopCancel:  (b) => setStopCancelBill({ orderId: b.orderId, obdNumber: b.obdNumber, siteName: b.siteName, operatorName: b.operatorName, status: b.status }),
    onRaiseCi:     (b) => openOffFloor("ci", [b]),
    onShopDelivery: (b) => setShopDeliveryBills([{ orderId: b.orderId, obdNumber: b.obdNumber }]),
  }), [handleAssign, handleBaseBypass, handleReassignOrder, handleReassignSplit, handleSendBack, postTintAction, handleShipTo, openOffFloor]);

  /**
   * Re-sequence one step inside one operator's queue.
   *
   * ⚠ THE ROUTE'S BOUNDARY NO-OP. PATCH /api/tint/manager/reorder answers
   * `200 { success: true }` and writes NOTHING when the row is already first or
   * last — so a 2xx alone does NOT mean anything moved. The queue signature is
   * captured before the call and compared against the refetched board after it;
   * only a real change is announced. The arrows are also disabled at the
   * boundaries, so hitting this path means the client's view was already stale.
   */
  const handleReorder = useCallback(async (row: BoardRow, direction: "up" | "down") => {
    if (reorderBusy.has(row.key)) return;
    setReorderBusy((s) => new Set(s).add(row.key));

    const before = queueSignature(groups, row.operatorId, row.type);
    try {
      const res = await fetch("/api/tint/manager/reorder", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: row.type, id: row.id, direction }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        toast.error(typeof body.error === "string" ? body.error : `Re-sequence failed (HTTP ${res.status})`);
        return;
      }
      const fresh = await fetchBoard();
      if (!fresh) { toast.error("Re-sequenced, but the board could not be refreshed"); return; }
      const after = queueSignature(buildGroups(fresh), row.operatorId, row.type);
      if (after === before) {
        // A silent no-op. Say nothing rather than claim a move that did not
        // happen — the row is already at the end it was pushed towards.
        return;
      }
      toast.success(`Re-sequenced ${row.operatorName.split(" ")[0]}'s queue`);
    } finally {
      setReorderBusy((s) => { const n = new Set(s); n.delete(row.key); return n; });
    }
  }, [groups, reorderBusy, fetchBoard]);

  // ── Header pieces ─────────────────────────────────────────────────────────

  // ── Header search (2026-10-02, round 2 step 2) ───────────────────────────
  // Floor's behaviour: runs on ENTER (not while typing), "/" focuses the box,
  // Escape clears and closes (both the header's). Results drop down under the
  // box, grouped by source in tab order, matched by ONE matcher —
  // lib/floor/search.ts through lib/tint/search.ts's views. The SOURCES are the
  // UNFILTERED lists (filters never hide a result) and are data-driven
  // (search-sources.tsx), so a history day can be swapped in later. The server
  // fallback, GET /api/tint/manager/find, is ALWAYS the last group, "Not on Tint
  // Manager", minus OBDs a client group already shows.
  const [searchRun, setSearchRun] = useState<string | null>(null);
  const [findRows, setFindRows] = useState<FindRow[] | null>(null);
  const [findLoading, setFindLoading] = useState(false);
  const [searchActiveKey, setSearchActiveKey] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ key: string; at: number } | null>(null);
  const findSeq = useRef(0);

  const searchSources = useMemo(() => buildSearchSources({
    rail:    buildRail(payload),
    groups:  buildGroups(payload),
    base:    baseRows,
    ti:      basePending,
    hold:    access.canViewHoldTab && historyDate === null ? holdRows : null,
    ci:      access.canViewCiTab ? cancelledRows : null,
    deleted: access.canViewPickDelete ? pickDecidedRows : null,
  }), [payload, baseRows, basePending, holdRows, cancelledRows, pickDecidedRows, access.canViewHoldTab, access.canViewCiTab, access.canViewPickDelete, historyDate]);

  // Entering / leaving history: drop every selection and the panel, leave the
  // Hold tab (no past), then read the chosen day (null → live, exactly as before).
  const historyFirst = useRef(true);
  useEffect(() => {
    if (historyFirst.current) { historyFirst.current = false; return; }
    clearAllSelection();
    setPanelKey(null);
    setFocusedOperatorId(null);
    setBaseDrill(null);
    setBaseLine(null);
    if (historyDate !== null) setActiveTab((t) => (t === "hold" ? "tinting" : t));
    void fetchBoard();
    // Only the day drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyDate]);

  /** The stepper's day as a Date (IST midnight); today when live. */
  const stepperDate = historyDate ? new Date(`${historyDate}T00:00:00+05:30`) : new Date();
  const onStepperChange = useCallback((d: Date) => {
    const istStr = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const picked = istStr(d);
    const today = istStr(new Date());
    // Today → live. A future day can't be picked (the stepper caps at today).
    setHistoryDate(picked >= today ? null : picked);
  }, []);
  const historyLabel = historyDate
    ? new Date(`${historyDate}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).replace(",", "")
    : null;

  const searchGroups = useMemo(() => {
    if (searchRun === null) return null;
    const parsed = parseSearch(searchRun);
    const client = matchSources(searchSources, parsed);
    const shown = new Set(client.flatMap((g) => g.rows.map((r) => r.obd)));
    const find: SearchItem[] = (findRows ?? [])
      .filter((f) => !shown.has(f.obdNumber))
      .map((f) => ({
        key: `find-${f.orderId}`, obd: f.obdNumber, highlight: obdHighlight(f.obdNumber, parsed),
        billTo: f.billTo, shipTo: f.shipTo,
        context: `${f.dateLabel} ${new Date(f.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}${f.smu ? ` · ${f.smu}` : ""}`,
        pill: <span className="inline-flex items-center rounded-[4px] bg-[#f3f4f6] px-2 py-[2px] text-[10px] font-semibold text-[#6b7280]">{f.stage}</span>,
        openable: false, views: [], target: null,
      }));
    return [...client, { key: "find", label: "Not on Tint Manager", rows: find }];
  }, [searchRun, searchSources, findRows]);
  const searchFlat = useMemo(() => (searchGroups ?? []).flatMap((g) => g.rows), [searchGroups]);

  // The active row follows the results: first row on a fresh run, kept while it still exists.
  useEffect(() => {
    if (searchFlat.length === 0) { if (searchActiveKey !== null) setSearchActiveKey(null); return; }
    if (!searchFlat.some((r) => r.key === searchActiveKey)) setSearchActiveKey(searchFlat[0].key);
  }, [searchFlat, searchActiveKey]);

  const closeSearch = useCallback(() => {
    findSeq.current++;
    setSearchRun(null);
    setFindRows(null);
    setFindLoading(false);
    setSearchActiveKey(null);
  }, []);
  // Refs for the page's window-level Escape chain (declared above this block).
  const searchRunRef = useRef(searchRun);
  searchRunRef.current = searchRun;
  const closeSearchRef = useRef(closeSearch);
  closeSearchRef.current = closeSearch;

  const runSearch = useCallback(() => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearchRun(q);
    setSearchActiveKey(null);
    setFindRows(null);
    setFindLoading(true);
    const seq = ++findSeq.current;
    void (async () => {
      try {
        const res = await fetch(`/api/tint/manager/find?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { rows?: FindRow[] };
        if (seq === findSeq.current) setFindRows(Array.isArray(body.rows) ? body.rows : []);
      } catch {
        if (seq === findSeq.current) setFindRows([]);
      } finally {
        if (seq === findSeq.current) setFindLoading(false);
      }
    })();
  }, [searchQuery]);

  /** Open a result: its tab (or its rail card), its panel where the tab has
   *  one, and a ~2s brand-50 flash on the row once it is on screen. */
  const openSearchResult = useCallback((row: SearchResultRow) => {
    const item = searchFlat.find((r) => r.key === row.key) as SearchItem | undefined;
    if (!item) return;
    if (!item.openable || item.target === null) {
      toast.info(`${item.obd} is not on the Tint Manager`, { description: typeof item.context === "string" ? item.context : undefined });
      return;
    }
    const t = item.target;
    closeSearch();
    if (t.clearFocus) setFocusedOperatorId(null);
    if (t.tab !== null) setActiveTab(t.tab);
    if (t.railId !== undefined) {
      setSelection(new Set());
      setHoldSel(new Set());
      setBaseSel(new Set());
      setTiSel(new Set());
      setRailSel(new Set([t.railId]));
    }
    if (t.panelKey) setPanelKey(t.panelKey);
    if (t.flashKey) setFlash({ key: t.flashKey, at: Date.now() });
  }, [searchFlat, closeSearch]);

  // The flash: once the tab has rendered, scroll the row into view and wash it
  // brand-50 for ~2s. A class on the element, not state on every row.
  useEffect(() => {
    if (!flash) return;
    let el: Element | null = null;
    const show = setTimeout(() => {
      el = document.querySelector(`[data-search-key="${CSS.escape(flash.key)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("!bg-brand-50");
    }, 150);
    const hide = setTimeout(() => el?.classList.remove("!bg-brand-50"), 2200);
    return () => { clearTimeout(show); clearTimeout(hide); el?.classList.remove("!bg-brand-50"); };
  }, [flash]);

  const onSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = searchQuery.trim();
      // Same query, results up → Enter opens the active row; otherwise it runs.
      if (searchRun !== null && q === searchRun && searchFlat.length > 0) {
        const row = searchFlat.find((r) => r.key === searchActiveKey) ?? searchFlat[0];
        openSearchResult(row);
      } else {
        runSearch();
      }
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && searchFlat.length > 0) {
      e.preventDefault();
      const i = Math.max(0, searchFlat.findIndex((r) => r.key === searchActiveKey));
      const next = e.key === "ArrowDown" ? Math.min(searchFlat.length - 1, i + 1) : Math.max(0, i - 1);
      setSearchActiveKey(searchFlat[next].key);
    }
  }, [searchQuery, searchRun, searchFlat, searchActiveKey, openSearchResult, runSearch]);

  const onSearchChange = useCallback((v: string) => {
    setSearchQuery(v);
    // Cleared (typing it empty, or the header's Escape) → close the dropdown.
    if (v.trim() === "") closeSearch();
  }, [closeSearch]);

  // The stats line left the header 2026-10-02 (the tab badges carry the counts).

  /** Filter groups. Delivery Type values are delivery_type_master.name exactly
   *  as the master holds them (read-only SELECT 2026-10-02: Local · Upcountry ·
   *  IGT · Cross) — the old "Cross Depot" value matched nothing. */
  const filterGroups: FilterGroup[] = [
    { label: "Delivery Type", key: "deliveryType", options: [
      { value: "Local", label: "Local" }, { value: "Upcountry", label: "UPC" },
      { value: "IGT", label: "IGT" }, { value: "Cross", label: "Cross" },
    ] },
    { label: "Priority", key: "urgent", options: [{ value: "urgent", label: "Urgent only" }] },
  ];
  const shortcuts: ShortcutItem[] = [
    { key: "M",   label: "Add OBD to Tint" },
    { key: "Esc", label: "Close panel / clear selection" },
    { key: "▲▼",  label: "Re-sequence (hover an Assigned row)" },
  ];


  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="h-[52px] bg-white border-b border-gray-200" />
        <div className="flex" style={{ height: "calc(100vh - 52px)" }}>
          <div className="w-[344px] border-r border-gray-200 p-2 flex flex-col gap-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-[130px] bg-gray-100 rounded-[10px] animate-pulse" />)}
          </div>
          <div className="flex-1 p-3 flex flex-col gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">

      {/* HEADER = BILLING'S (2026-10-02): the exact props the Billing face passes
          (mail-orders-page.tsx) — black primary Import, the wide search box with
          its "/" hint top-right, no clock, no ⌨ button, no Row 2, empty left.
          The stats line, the Reports pill and the clock are gone; Filter,
          + Add to Tint, the missing badge and ⌨ moved to the tab row below. */}
      <UniversalHeader
        showImport={canImportOBDs}
        importVariant="primary"
        suppressFilterBar
        showDatePicker={false}
        searchPlaceholder="Search orders…"
        searchValue={searchQuery}
        onSearchChange={onSearchChange}
        onSearchKeyDown={onSearchKeyDown}
        searchExpanded={searchGroups !== null}
        searchDropdown={searchGroups !== null ? (
          <SearchDropdown
            groups={searchGroups}
            activeKey={searchActiveKey}
            loadingFallback={findLoading}
            onPick={openSearchResult}
            onHover={setSearchActiveKey}
            onClose={closeSearch}
          />
        ) : undefined}
        searchLayout="wide-right"
        showClock={false}
        showShortcutsButton={false}
      />

      <ConnectionStrip connected={feedLive ? liveSync.connected : connected} lastSyncedAt={lastSyncedAt} />

      {/* The legacy 15 s marker — mounted ONLY while the Tint feed is not live
          (tint step 4). Same props as the page passed before the feed. */}
      {!feedLive && (
        <LegacyTintManagerSync
          paused={historyDate !== null || panelKey !== null || selection.size > 0 || railSel.size > 0 || holdSel.size > 0 || baseSel.size > 0 || tiSel.size > 0}
          onProbe={setConnected}
          onChange={() => { void fetchBoard(); }}
        />
      )}

      {/* ── Body shell: 344px rail + one flat table ──────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* The rail is a LIVE queue — hidden on a past day (history). */}
        {historyDate === null && (
          <BoardRail
            rail={rail}
            selected={railSel}
            onToggle={toggleRail}
            onOpenPanel={(o) => setPanelKey(`pending-${o.id}`)}
          />
        )}

        {/* The right pane: the TAB BAR, then the open tab's body (2026-10-01,
            tabs build step 5). The rail on the left never changes with the
            tab. The TI tab now owns the Tinter Issue drilldown and its form
            that used to take over the rail and this pane. */}
        {/* `relative` — the bottom bar is absolutely positioned against THIS
            pane (Floor's shell rule), so it opens along the table side only. */}
        <div className="relative flex-1 min-w-0 flex flex-col overflow-hidden">
          <BoardTabs
            active={activeTab}
            onChange={setActiveTab}
            disabledTabs={historyDate !== null ? ["hold"] : undefined}
            counts={{
              tinting: groups.reduce((n, g) => n + g.rows.length, 0),
              // Pending only — today's "TI done" rows (tiDoneAt) are not owed work.
              ti:      basePendingShown.filter((o) => !o.tiDoneAt).length,
              ...(holdRowsShown !== null ? { hold: holdRowsShown.length } : {}),
              ...(cancelledRowsShown !== null ? { ci: cancelledRowsShown.length } : {}),
              ...(pickDecidedCount !== null ? { pick: pickDecidedCount } : {}),
              ...(baseRowsShown !== null ? { base: baseRowsShown.length } : {}),
            }}
            rightSlot={
              <>
                {/* The "N missing" badge — moved from the header's Row 2, unchanged (live only). */}
                {historyDate === null && missingCustomers.length > 0 && (
                  <div className="relative">
                    <button
                      ref={missingBadgeRef}
                      onClick={() => setMissingBadgeOpen(!missingBadgeOpen)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5 cursor-pointer hover:bg-amber-100 transition-colors"
                    >
                      <AlertCircle size={12} />
                      {missingCustomers.length} missing
                    </button>
                    {missingBadgeOpen && (
                      <div className="absolute right-0 top-full mt-1 z-50 w-[300px] bg-white border border-gray-200 rounded-lg shadow-lg max-h-[320px] overflow-y-auto">
                        <div className="px-3 py-2 border-b border-gray-100">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Missing Customers</p>
                        </div>
                        {missingCustomers.map((mc) => (
                          <button
                            key={mc.orderId}
                            type="button"
                            onClick={() => {
                              setMissingSheetOrder({ shipToCustomerId: mc.shipToCustomerId, shipToCustomerName: mc.shipToCustomerName } as TintOrder);
                              setMissingSheetOpen(true);
                              setMissingBadgeOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-gray-600">{mc.obdNumber}</span>
                              <span className={cn(
                                "text-[9px] font-medium px-1.5 py-0.5 rounded border",
                                mc.orderType === "tint"
                                  ? "bg-tint-bg text-tint-600 border-tint-bd"
                                  : "bg-gray-50 text-gray-500 border-gray-200",
                              )}>
                                {mc.orderType === "tint" ? "Tint" : "Non-Tint"}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-900 font-medium mt-0.5 truncate">{mc.shipToCustomerName ?? "Unknown"}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{mc.smu === "Decorative Projects" ? "Deco Projects" : mc.smu}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* ONE CONTROL SET (2026-10-02): every control here is Billing's Filter
                    button's size — 24px tall, 5px radius, gray-200 border, 10px
                    text, 11px icons, 7px side padding — so the row reads as one set
                    centred on the tabs. The shared components are sized from
                    OUTSIDE by these wrappers (Tint Manager only); their own
                    defaults — and Floor / Billing — are untouched. The selectors
                    reach only each control's own trigger buttons: the stepper's
                    calendar and the popovers' chips render elsewhere / deeper. */}
                {/* The day — Floor's / Billing's HeaderDateStepper, plus its two
                    defaulted props: weekday labels and the warn tone on a past day. */}
                <div className="[&>div>button]:inline-flex [&>div>button]:h-[24px] [&>div>button]:items-center [&>div>button:first-child]:rounded-l-[5px] [&>div>button:last-child]:rounded-r-[5px] [&>div>button>svg]:h-[11px] [&>div>button>svg]:w-[11px]">
                  <HeaderDateStepper
                    currentDate={stepperDate}
                    onDateChange={onStepperChange}
                    pastLabel="weekday"
                    tone={historyDate !== null ? "warn" : "default"}
                  />
                </div>
                <div className="w-px h-4 bg-gray-200" />
                {/* Filter — the reference control; pinned to the set's 24px. */}
                <div className="[&>div>button]:h-[24px]">
                  <HeaderFilter
                    groups={filterGroups}
                    activeFilters={headerFilters}
                    onFilterChange={setHeaderFilters}
                    open={filterOpen}
                    onOpenChange={setFilterOpen}
                  />
                </div>
                {/* Billing's ⌨ popover in "row" style, as a 24px square; controlled
                    so the page's Esc closes it. */}
                <div className="[&>div>button]:h-[24px] [&>div>button]:w-[24px] [&>div>button]:justify-center [&>div>button]:px-0 [&>div>button>svg]:h-[11px] [&>div>button>svg]:w-[11px]">
                  <HeaderShortcuts shortcuts={shortcuts} variant="row" open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
                </div>
                {/* + Add to Tint — the row's primary: the black Import style
                    (ink-900, white) at the set's size, after a thin divider. */}
                {historyDate === null && (
                  <>
                    <div className="w-px h-4 bg-gray-200" />
                    <button
                      type="button"
                      onClick={() => setPullModalOpen(true)}
                      className="inline-flex h-[24px] items-center gap-[4px] rounded-[5px] border border-ink-900 bg-ink-900 px-[7px] text-[10px] font-medium text-white transition-colors hover:border-ink-700 hover:bg-ink-700"
                      title="Add OBD to Tint (M)"
                    >
                      <Plus size={11} />
                      Add to Tint
                    </button>
                  </>
                )}
              </>
            }
          />
          {/* History bar — the whole page is read-only on a past day. */}
          {historyDate !== null && (
            <div className="flex flex-shrink-0 items-center gap-3 border-b border-warn bg-warn-bg px-3.5 py-2 text-[12px] text-warn-text">
              <span>Viewing <b className="font-semibold">{historyLabel}</b> — read only.</span>
              <button
                type="button"
                onClick={() => setHistoryDate(null)}
                className="ml-auto rounded-md border border-warn bg-white px-2.5 py-1 text-[11.5px] font-semibold text-warn-text hover:bg-warn-bg"
              >
                Back to today
              </button>
            </div>
          )}
          {activeTab === "tinting" && (
            <BoardTintTab
              historyDate={historyDate}
              focusedOperatorId={focusedOperatorId}
              onFocusOperator={setFocusedOperatorId}
              groups={groups}
              selection={selection}
              busyKeys={reorderBusy}
              onToggleRow={toggleRow}
              onOpenRow={(r) => setPanelKey(r.key)}
              onReorder={(r, d) => { void handleReorder(r, d); }}
              windows={windows}
              canSlot={access.canSlot}
              slotBusy={writeBusy}
              onSetSlot={(r, v) => { void postTintAction("change-slot", [r.orderId], { slot: v, keepSelection: true }); }}
              barUp={barMode !== null}
            />
          )}
          {activeTab === "ti" && (
            <BoardTiTab
              history={historyDate !== null}
              pending={basePendingShown}
              drill={baseDrill}
              lineId={baseLine?.rawLineItemId ?? null}
              undoBusyId={baseUndoBusyId}
              panel={baseDrill && baseLine ? (
                <BaseTiPanel
                  key={`${baseDrill.tintAssignmentId}-${baseLine.rawLineItemId}`}
                  tintAssignmentId={baseDrill.tintAssignmentId}
                  siteId={baseDrill.siteId}
                  obdNumber={baseDrill.obdNumber}
                  siteName={baseDrill.siteName}
                  line={baseLine}
                  onSaved={() => { void handleBaseLineSaved(); }}
                />
              ) : null}
              onOpen={(o) => {
                setPanelKey(null);
                setTiSel(new Set());
                setBaseDrill(o);
                // Open the first line still owing a TI, so the common case (one
                // pending line) is a single click rather than two.
                setBaseLine(o.lines.find((l) => !l.hasTiEntry) ?? null);
              }}
              onBack={() => { setBaseDrill(null); setBaseLine(null); }}
              onPickLine={(l) => setBaseLine(l)}
              onUndo={(o) => { void handleBaseUndo(o); }}
              selected={tiSel}
              onToggle={toggleTi}
              barUp={barMode !== null}
            />
          )}
          {activeTab === "hold" && (
            <BoardHoldTab
              rows={holdRowsShown}
              error={holdError}
              selected={holdSel}
              onToggle={toggleHold}
              onOpen={(h) => setPanelKey(`hold-${h.orderId}`)}
              windows={windows}
              canSlot={access.canSlot}
              slotBusy={writeBusy}
              onSetSlot={(h, v) => { void postTintAction("change-slot", [h.orderId], { slot: v, keepSelection: true }); }}
              barUp={barMode !== null}
            />
          )}
          {activeTab === "ci" && (
            <BoardCiTab
              rows={cancelledRowsShown}
              error={cancelledError}
              canRestore={access.canCancel && historyDate === null}
              restoringId={restoringId}
              onRestore={(r) => { void handleRestore(r); }}
            />
          )}
          {/* Pick delete — the decision HISTORY (Billing's tab on the tint routes);
              the tab itself is gated on tint_pick_delete canView (board-tabs.tsx). */}
          {activeTab === "pick" && (
            <BoardPickDeleteTab canEdit={access.canPickDelete} onCount={setPickDecidedCount} reloadSignal={sideReload} />
          )}
          {activeTab === "base" && (
            <BoardBaseTab
              readOnly={historyDate !== null}
              rows={baseRowsShown}
              error={baseError}
              selected={baseSel}
              onToggle={toggleBase}
              onOpen={(r) => setPanelKey(`base-${r.orderId}`)}
              windows={windows}
              canSlot={access.canSlot && historyDate === null}
              slotBusy={writeBusy}
              onSetSlot={(r, v) => { void postTintAction("change-slot", [r.orderId], { slot: v, keepSelection: true }); }}
              barUp={barMode !== null}
            />
          )}

          {barMode === "ti" && (
            <BoardTiBottomBar
              count={selectedTi.length}
              linesOwed={selectedTi.reduce((n, o) => n + owedLines(o).length, 0)}
              packs={packList(selectedTi.flatMap((o) => owedLines(o).map((l) => l.packCode)))}
              busy={tiUndoBusy}
              onClear={clearAllSelection}
              onShot={(dose) => setTiBulkDose(dose)}
              onNewShade={() => {
                // Today's per-line TI panel, on the first selected bill.
                const o = selectedTi[0];
                if (!o) return;
                setTiSel(new Set());
                setBaseDrill(o);
                setBaseLine(o.lines.find((l) => !l.hasTiEntry) ?? null);
              }}
              onUndoBase={() => { void handleBulkUndoBase(); }}
            />
          )}
          {barMode !== null && barMode !== "ti" && (
            <BoardBottomBar
              mode={barMode}
              count={barBills.length}
              litres={formatLitres(barBills.reduce((n, b) => n + (b.litres ?? 0), 0))}
              articles={countArticles(barBills.map((b) => b.articleTag)).pieces}
              routes={new Set(barBills.map((b) => b.route ?? "\u0000unrouted")).size}
              facts={{
                allAssigned:   barMode === "table" && barBills.every((b) => b.status === "assigned"),
                // Every table row is a bill an operator holds (assigned, tinting
                // or paused) — Cancel refuses all three; Stop & cancel takes them.
                operatorHolds: barMode === "table" ||
                  (barMode === "hold" && barBills.some((b) => b.status === "tint_assigned" || b.status === "tinting_in_progress")),
                allHeld:       barBills.length > 0 && barBills.every((b) => b.isHeld),
                allHand:       barBills.length > 0 && barBills.every((b) => b.isHand),
                anyBase:       barBills.some((b) => b.isBase),
                allUrgent:     barBills.length > 0 && barBills.every((b) => b.isUrgent),
              }}
              busy={writeBusy}
              windows={windows}
              slotValue={barSlot}
              onSlot={(v) => { void postTintAction("change-slot", barIds, { slot: v, keepSelection: true }); }}
              onPrimary={(anchor) => {
                // Hold tab → Release = unhold (owner decision 9); else the operator menu.
                if (barMode === "hold") void postTintAction("unhold", barIds);
                else setBarOpAnchor(anchor);
              }}
              menuOpen={barMenuOpen}
              onMenuOpenChange={setBarMenuOpen}
              onClear={clearAllSelection}
              onSendBack={() => { void handleBarSendBack(); }}
              onHold={() => { void postTintAction("hold", barIds); }}
              onReleaseHold={() => { void postTintAction("unhold", barIds); }}
              onHand={(set) => { void postTintAction(set ? "hand" : "unhand", barIds); }}
              onUrgent={(set) => { void postTintAction("mark-urgent", barIds, { urgent: set }); }}
              onShopDelivery={() => {
                setShopDeliveryBills(barBills.map((b) => ({ orderId: b.orderId, obdNumber: b.obdNumber })));
              }}
              onCancel={() => openOffFloor("cancel")}
              onStopCancel={() => {
                const b = barBills[0];
                if (b) setStopCancelBill({ orderId: b.orderId, obdNumber: b.obdNumber, siteName: b.site, operatorName: b.operatorName, status: b.status });
              }}
              onRaiseCi={() => openOffFloor("ci")}
              onRemove={() => { const o = selectedRail[0]; if (o) setRemoveModalOrder(o); }}
            />
          )}
        </div>
      </div>

      {/* The bar's operator menu — portalled (OperatorMenu), anchored to the
          primary. Rail → Assign (+ "Base — No Tint"); table → Re-assign. */}
      {barOpAnchor !== null && (barMode === "rail" || barMode === "table") && (
        <OperatorMenu
          anchor={barOpAnchor}
          operators={operators}
          label={barMode === "rail" ? "Assign to" : "Re-assign to"}
          onClose={() => setBarOpAnchor(null)}
          onPick={(opId) => {
            setBarOpAnchor(null);
            if (barMode === "rail") void handleRailAssign(opId);
            else void handleBulkReassign(opId);
          }}
          extraAction={barMode === "rail" ? {
            label: "Base — No Tint",
            hint:  "No tinting needed — close the bill without an operator",
            onPick: () => { setBarOpAnchor(null); void handleRailBase(); },
          } : undefined}
        />
      )}

      {/* ── Pick delete — Billing's BLOCKING popup on the Tint Manager's groups
          (every bill SMU 74/77). Mounted only for tint_pick_delete canView AND
          canEdit holders, exactly as Billing mounts its own (view-only → never
          mounted, nothing polls). Outside Billing's marker provider it polls its
          own marker (pollMs, the board's 15 s cadence). While open it makes every
          other <body> child inert — rail, table, bottom bar, panel — and its
          capture-phase key guard stops each keydown before this page's window
          Esc listener, so the one Esc owner never fires behind it. */}
      {access.canViewPickDelete && access.canPickDelete && (
        <BillingPickDeletePopup base={TINT_PICK_DELETE_BASE} pollMs={15_000} />
      )}

      {offFloor && (
        <OffFloorDialog
          bills={offFloor.bills}
          reasons={ciReasons}
          reasonsError={ciReasonsError}
          endpoints={{ ci: "/api/tint/manager/ci", cancel: "/api/tint/manager/cancel" }}
          initialTab={offFloor.tab}
          tabs={[offFloor.tab]}
          onApplied={(doneIds) => {
            if (doneIds.length > 0) clearAllSelection();
            void fetchBoard();
          }}
          onBusyChange={setDialogBusy}
          onClose={() => setOffFloor(null)}
        />
      )}

      {stopCancelBill && (
        <BoardStopCancelDialog
          bill={stopCancelBill}
          onDone={() => { clearAllSelection(); void fetchBoard(); }}
          onBusyChange={setDialogBusy}
          onClose={() => setStopCancelBill(null)}
        />
      )}

      {tiBulkDose !== null && (
        <BoardTiBulkDialog
          bills={selectedTi}
          dose={tiBulkDose}
          onDone={() => { setTiSel(new Set()); void fetchBasePending(); }}
          onBusyChange={setDialogBusy}
          onClose={() => setTiBulkDose(null)}
        />
      )}

      {shopDeliveryBills && (
        <BoardShopDeliveryDialog
          bills={shopDeliveryBills}
          onDone={() => { clearAllSelection(); void fetchBoard(); }}
          onBusyChange={setDialogBusy}
          onClose={() => setShopDeliveryBills(null)}
        />
      )}

      {panelTarget && (
        <BoardDetailPanel
          readOnly={historyDate !== null}
          target={panelTarget}
          operators={operators}
          position={{ index: panelIndex, total: walk.length }}
          busy={writeBusy}
          error={panelError}
          canRemove={canRemoveObd}
          windows={windows}
          reloadSignal={panelReload}
          actions={panelActions}
          onClose={() => setPanelKey(null)}
          onPrev={() => { if (panelIndex > 0) setPanelKey(walk[panelIndex - 1].key); }}
          onNext={() => { if (panelIndex < walk.length - 1) setPanelKey(walk[panelIndex + 1].key); }}
          changedElsewhere={feedLive && panelFresh !== null}
          onReloadChanged={() => {
            if (panelFresh) { setPayload(panelFresh); setLastSyncedAt(new Date()); }
            setPanelFresh(null);
          }}
        />
      )}

      {/* ── Secondary actions kept reachable ─────────────────────────────────
          Hide OBD (admin) and Revert-from-tint act on a PENDING bill, so they
          live on the rail's context strip below the list rather than in a row
          menu the flat table does not have. Nothing became unreachable. */}
      {(canHideObd || rail.some((o) => o.manualTintEntry)) && rail.length > 0 && (
        <div className="border-t border-gray-200 bg-gray-50 px-3.5 py-2 flex items-center gap-3 text-[11px] text-gray-500">
          <span className="font-semibold text-gray-600">Pending bill actions:</span>
          {canHideObd && (
            <select
              className="border border-gray-200 rounded-md px-2 py-1 text-[11px] bg-white"
              value=""
              onChange={(e) => {
                const o = rail.find((x) => String(x.id) === e.target.value);
                if (o) setHideModalOrder(o);
                e.currentTarget.value = "";
              }}
            >
              <option value="">Hide an OBD…</option>
              {rail.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.obdNumber} · {o.customer?.customerName ?? o.shipToCustomerName ?? "—"}
                </option>
              ))}
            </select>
          )}
          {rail.some((o) => o.manualTintEntry) && (
            <select
              className="border border-gray-200 rounded-md px-2 py-1 text-[11px] bg-white"
              value=""
              onChange={(e) => {
                const o = rail.find((x) => String(x.id) === e.target.value);
                if (o) setRevertOrder({ id: o.id, obdNumber: o.obdNumber });
                e.currentTarget.value = "";
              }}
            >
              <option value="">Revert a manual tint entry…</option>
              {rail.filter((o) => o.manualTintEntry).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.obdNumber} · {o.customer?.customerName ?? o.shipToCustomerName ?? "—"}
                </option>
              ))}
            </select>
          )}
          <RotateCcw size={11} className="text-gray-300" />
        </div>
      )}

      {/* ── Modals, all single-instance ──────────────────────────────────── */}

      <CustomerMissingSheet
        open={missingSheetOpen}
        warningMessage={missingSheetWarning}
        onOpenChange={(next) => {
          // Cancel just drops the Assign intent — the amber strip already said
          // why, and the ⓘ on the rail card is the persistent reminder.
          if (!next && !sheetResolvedRef.current && pendingAssign) setPendingAssign(null);
          // Same for a cancelled Base — No Tint, on its own state so the Assign
          // clause above is untouched.
          if (!next && !sheetResolvedRef.current && pendingBypass) setPendingBypass(null);
          if (!next) setMissingSheetWarning(undefined);
          setMissingSheetOpen(next);
        }}
        shipToCustomerId={missingSheetOrder?.shipToCustomerId}
        shipToCustomerName={missingSheetOrder?.shipToCustomerName}
        onResolved={() => {
          sheetResolvedRef.current = true;
          setMissingSheetWarning(undefined);
          setMissingSheetOpen(false);
          void fetchBoard();
          void fetchMissingCustomers();
        }}
      />

      <ManualTintEntryModal
        open={pullModalOpen}
        onClose={() => setPullModalOpen(false)}
        onSuccess={() => { void fetchBoard(); }}
      />

      <ManualTintRevertModal
        open={revertOrder !== null}
        onClose={() => setRevertOrder(null)}
        orderId={revertOrder?.id ?? null}
        obdNumber={revertOrder?.obdNumber ?? null}
        onSuccess={() => { setRevertOrder(null); void fetchBoard(); }}
      />

      {removeModalOrder && (
        <RemoveObdModal
          open
          onClose={() => setRemoveModalOrder(null)}
          onRemoved={() => {
            setRemoveModalOrder(null);
            setPanelKey(null);
            void fetchBoard();
            void fetchMissingCustomers();
          }}
          order={{
            id:                 removeModalOrder.id,
            obdNumber:          removeModalOrder.obdNumber,
            orderDateTime:      removeModalOrder.orderDateTime,
            shipToCustomerName: removeModalOrder.customer?.customerName ?? removeModalOrder.shipToCustomerName,
            smu:                removeModalOrder.smu,
            articleTag:         removeModalOrder.articleTag ?? removeModalOrder.querySnapshot?.articleTag ?? null,
            totalVolume:        removeModalOrder.querySnapshot?.totalVolume ?? null,
            challan:            removeModalOrder.challan ?? null,
          }}
        />
      )}

      {hideModalOrder && (
        <HideObdModal
          open
          onClose={() => setHideModalOrder(null)}
          onHidden={() => { setHideModalOrder(null); void fetchBoard(); }}
          order={{
            id:        hideModalOrder.id,
            obdNumber: hideModalOrder.obdNumber,
            siteName:  hideModalOrder.customer?.customerName ?? hideModalOrder.shipToCustomerName,
          }}
        />
      )}

      {skipHistoryFor && (
        <SkipHistoryModal
          open
          orderId={skipHistoryFor.orderId}
          obdNumber={skipHistoryFor.obdNumber}
          customerName={skipHistoryFor.customerName}
          onClose={() => setSkipHistoryFor(null)}
        />
      )}

      {pauseHistoryFor && (
        <PauseHistoryModal
          open
          orderId={pauseHistoryFor.orderId}
          obdNumber={pauseHistoryFor.obdNumber}
          customerName={pauseHistoryFor.customerName}
          onClose={() => setPauseHistoryFor(null)}
        />
      )}
    </div>
  );
}

/**
 * What the detail panel shows for `key`, as a string to compare two board reads
 * ("pending-N" → that rail order; any other key → that table row; "gone" when it
 * left the board). Used only by the feed's "Changed — Reload" check.
 */
function panelSnapshot(p: TintBoardPayload, key: string): string {
  if (key.startsWith("pending-")) {
    const id = Number(key.slice("pending-".length));
    const o = p.orders.find((x) => x.id === id);
    return o ? JSON.stringify(o) : "gone";
  }
  for (const g of buildGroups(p)) {
    const r = g.rows.find((x) => x.key === key);
    if (r) return JSON.stringify(r);
  }
  return "gone";
}
