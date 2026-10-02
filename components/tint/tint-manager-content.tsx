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
import { AlertCircle, FileBarChart, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

import { UniversalHeader } from "@/components/universal-header";
import { CustomerMissingSheet } from "@/components/shared/customer-missing-sheet";
import { RemoveObdModal } from "@/components/tint/RemoveObdModal";
import { HideObdModal } from "@/components/tint/HideObdModal";
import { SkipHistoryModal } from "@/components/tint/SkipHistoryModal";
import { PauseHistoryModal } from "@/components/tint/PauseHistoryModal";
import { ManualTintEntryModal } from "@/components/tint/manual-tint-entry-modal";
import { ManualTintRevertModal } from "@/components/tint/manual-tint-revert-modal";

import { BoardRail } from "@/components/tint/manager/board-rail";
import { BaseTiPanel } from "@/components/tint/manager/base-ti-panel";
import { BoardTable } from "@/components/tint/manager/board-table";
import { BoardTabs, type BoardTab } from "@/components/tint/manager/board-tabs";
import { BoardPickDeleteTab, TINT_PICK_DELETE_BASE } from "@/components/tint/manager/board-pick-delete-tab";
// Billing's blocking popup, REUSED with the tint base (2026-10-01, step 8).
import { BillingPickDeletePopup } from "@/components/billing/billing-pick-delete-popup";
import { currentIstMonth } from "@/lib/billing/telephonic-so";
import { BoardTiTab } from "@/components/tint/manager/board-ti-tab";
// BoardAssignBar (board-assign-bar.tsx) is RETIRED, not deleted (CORE §3): the
// bottom bar replaced it in tabs build step 6.
import { BoardBottomBar, type BarMode } from "@/components/tint/manager/board-bottom-bar";
import { BoardStopCancelDialog, type StopCancelBill } from "@/components/tint/manager/board-stop-cancel-dialog";
import { BoardShopDeliveryDialog, type ShopDeliveryBill } from "@/components/tint/manager/board-shop-delivery-dialog";
import { BoardHoldTab } from "@/components/tint/manager/board-hold-tab";
import { BoardCiTab } from "@/components/tint/manager/board-ci-tab";
import type { FloorBoardRow, FloorCancelledRow } from "@/lib/floor/types";
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

  // Ticks, resolved in the layout (TintManagerAccessProvider). The Reports pill
  // reads canReports; the bar, its menus and the Slot cell read the action ticks.
  const access = useTintManagerAccess();
  const { canReports } = access;

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
  const [headerFilters, setHeaderFilters] = useState<Record<string, string[]>>({
    deliveryType: [], priority: [], type: [],
  });
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
      const res = await fetch("/api/tint/manager/orders");
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

  const delTypes  = useMemo(() => new Set(headerFilters.deliveryType ?? []), [headerFilters]);
  const priority  = (headerFilters.priority ?? [])[0] ?? null;
  const rowType   = (headerFilters.type ?? [])[0] ?? null;
  const q         = searchQuery.trim().toLowerCase();

  const rail = useMemo(() => {
    return buildRail(payload).filter((o) => {
      if (delTypes.size > 0 && !delTypes.has(o.deliveryTypeName ?? "")) return false;
      if (priority === "urgent" && !(o.priorityLevel <= 2)) return false;
      if (priority === "normal" && !(o.priorityLevel > 2)) return false;
      // A pending order is always a whole order — the "split" filter cannot match
      // anything on the rail, so it empties it rather than silently ignoring.
      if (rowType === "split") return false;
      if (!q) return true;
      return (
        o.obdNumber.toLowerCase().includes(q) ||
        (o.customer?.customerName ?? "").toLowerCase().includes(q) ||
        (o.soNumber ?? "").toLowerCase().includes(q) ||
        (o.route ?? "").toLowerCase().includes(q)
      );
    });
  }, [payload, delTypes, priority, rowType, q]);

  const groups = useMemo(() => {
    const all = buildGroups(payload);
    if (delTypes.size === 0 && !priority && !rowType && !q) return all;
    return all
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => {
          const dt = r.order?.deliveryTypeName ?? r.split?.deliveryTypeName ?? r.completed?.deliveryTypeName ?? "";
          if (delTypes.size > 0 && !delTypes.has(dt)) return false;
          if (priority === "urgent" && !r.isUrgent) return false;
          if (priority === "normal" && r.isUrgent) return false;
          if (rowType === "split" && r.type !== "split") return false;
          if (rowType === "whole" && r.type !== "order") return false;
          if (!q) return true;
          return (
            r.obdNumber.toLowerCase().includes(q) ||
            r.siteName.toLowerCase().includes(q) ||
            (r.soNumber ?? "").toLowerCase().includes(q) ||
            (r.route ?? "").toLowerCase().includes(q) ||
            r.operatorName.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.rows.length > 0);
  }, [payload, delTypes, priority, rowType, q]);

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
    setRailSel((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; });
  }, []);
  const toggleRow = useCallback((r: BoardRow) => {
    setRailSel(new Set());
    setHoldSel(new Set());
    setBaseSel(new Set());
    setSelection((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; });
  }, []);
  const clearAllSelection = useCallback(() => {
    setSelection(new Set());
    setRailSel(new Set());
    setHoldSel(new Set());
    setBaseSel(new Set());
    setBarMenuOpen(false);
    setBarOpAnchor(null);
  }, []);

  // ── What the bar acts on ─────────────────────────────────────────────────
  const barMode: BarMode | null =
    railSel.size > 0 ? "rail" : selection.size > 0 ? "table" : holdSel.size > 0 ? "hold" : baseSel.size > 0 ? "base" : null;
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
      }));
    }
    return [];
  }, [barMode, selectedRail, selectedRows, holdRows, holdSel, baseRows, baseSel]);

  const toggleBase = useCallback((r: FloorBoardRow) => {
    setSelection(new Set());
    setRailSel(new Set());
    setHoldSel(new Set());
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
    if (panelKey.startsWith("hold-")) return (holdRows ?? []).map((h) => ({ key: `hold-${h.orderId}` }));
    if (panelKey.startsWith("base-")) return (baseRows ?? []).map((r) => ({ key: `base-${r.orderId}` }));
    return groups.flatMap((g) => g.rows.map((r) => ({ key: r.key })));
  }, [panelKey, rail, holdRows, baseRows, groups]);
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
    panelKey !== null || selection.size > 0 || railSel.size > 0 || holdSel.size > 0 || baseSel.size > 0 ||
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
        if (barOpAnchor !== null) { setBarOpAnchor(null); return; }
        if (barMenuOpen) { setBarMenuOpen(false); return; }
        if (offFloor !== null || stopCancelBill !== null || shopDeliveryBills !== null) {
          if (dialogBusy) return;
          setOffFloor(null); setStopCancelBill(null); setShopDeliveryBills(null);
          return;
        }
        if (panelKey !== null) { setPanelKey(null); return; }
        if (selection.size > 0 || railSel.size > 0 || holdSel.size > 0 || baseSel.size > 0) { clearAllSelection(); return; }
        return;
      }
      // M — Add OBD to Tint. Ignored while typing, and while the panel is open
      // (the panel is a focus context of its own).
      if ((e.key === "m" || e.key === "M") && !typing && panelKey === null) {
        e.preventDefault();
        setPullModalOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelKey, selection, railSel, holdSel, baseSel, barOpAnchor, barMenuOpen, offFloor, stopCancelBill, shopDeliveryBills, dialogBusy, clearAllSelection]);

  // ── Hold + CI lists (step 7) — read when the person can see the tab, and
  // again after every board reload (payload changes), so the tab counts track
  // the board. Read-only; the marker widening is build step 9.
  const fetchHold = useCallback(async () => {
    if (!access.canViewHoldTab) return;
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
      const res = await fetch("/api/tint/manager/cancelled", { cache: "no-store" });
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
      const res = await fetch("/api/tint/manager/base", { cache: "no-store" });
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
      if (Array.isArray(body.decided)) setPickDecidedCount(body.decided.length);
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
      const res = await fetch("/api/tint/manager/base-pending");
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
    action: "hold" | "unhold" | "hand" | "unhand" | "change-slot",
    orderIds: number[],
    opts: { slot?: DispatchSlotValue; keepSelection?: boolean } = {},
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
        hold: "on hold", unhold: "released from hold", hand: "marked Hand", unhand: "Hand cleared", "change-slot": "slot set",
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

  const stats = useMemo(() => {
    const flat = groups.flatMap((g) => g.rows);
    return [
      { label: "pending",     value: rail.length },
      { label: "assigned",    value: flat.filter((r) => r.status === "assigned").length },
      { label: "in progress", value: flat.filter((r) => r.status === "tinting_in_progress").length },
      { label: "paused",      value: flat.filter((r) => r.status === "paused").length },
      { label: "done today",  value: flat.filter((r) => r.status === "tinting_done").length },
    ];
  }, [rail, groups]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="h-[52px] bg-white border-b border-gray-200" />
        <div className="h-[40px] bg-white border-b border-gray-200" />
        <div className="flex" style={{ height: "calc(100vh - 92px)" }}>
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

      <UniversalHeader
        showImport={canImportOBDs}
        stats={stats}
        /* ⚠ NO `segments` / `activeSegment` / `onSegmentChange`. The operator
           workload pills are gone on purpose: the table's per-operator sections
           replace them, and they show the actual jobs rather than a count. This
           is the ONLY prop change vs the Kanban header — everything else below is
           wired exactly as it was. */
        filterGroups={[
          { label: "Delivery Type", key: "deliveryType", options: [{ value: "Local", label: "Local" }, { value: "Upcountry", label: "UPC" }, { value: "IGT", label: "IGT" }, { value: "Cross Depot", label: "Cross" }] },
          { label: "Priority", key: "priority", options: [{ value: "urgent", label: "Urgent" }, { value: "normal", label: "Normal" }] },
          { label: "Type", key: "type", options: [{ value: "split", label: "Split" }, { value: "whole", label: "Whole" }] },
        ]}
        activeFilters={headerFilters}
        onFilterChange={setHeaderFilters}
        showDatePicker={false}
        searchPlaceholder="Search OBD, SO, site, route…"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        rightExtra={
          <div className="flex items-center gap-1">
            {missingCustomers.length > 0 && (
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
            {/* Any report tick (REPORT_PAGE_KEYS), couriered by the layout. Links
                to the bare hub, which opens the first report this person may see. */}
            {canReports && (
              <a
                href="/reports"
                className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white text-gray-700 border border-gray-200 rounded-full px-2.5 py-0.5 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                title="Open Reports (Tint Summary holds the full completion history; this board shows today only)"
              >
                <FileBarChart size={12} />
                Reports
              </a>
            )}
            <button
              type="button"
              onClick={() => setPullModalOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white text-gray-700 border border-gray-200 rounded-full px-2.5 py-0.5 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              title="Add OBD to Tint (M)"
            >
              <Plus size={12} />
              Add to Tint
            </button>
          </div>
        }
        shortcuts={[
          { key: "M",   label: "Add OBD to Tint" },
          { key: "Esc", label: "Close panel / clear selection" },
          { key: "▲▼",  label: "Re-sequence (hover an Assigned row)" },
        ]}
      />

      <ConnectionStrip connected={feedLive ? liveSync.connected : connected} lastSyncedAt={lastSyncedAt} />

      {/* The legacy 15 s marker — mounted ONLY while the Tint feed is not live
          (tint step 4). Same props as the page passed before the feed. */}
      {!feedLive && (
        <LegacyTintManagerSync
          paused={panelKey !== null || selection.size > 0 || railSel.size > 0 || holdSel.size > 0 || baseSel.size > 0}
          onProbe={setConnected}
          onChange={() => { void fetchBoard(); }}
        />
      )}

      {/* ── Body shell: 344px rail + one flat table ──────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        <BoardRail
          rail={rail}
          selected={railSel}
          onToggle={toggleRail}
          onOpenPanel={(o) => setPanelKey(`pending-${o.id}`)}
        />

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
            counts={{
              tinting: groups.reduce((n, g) => n + g.rows.length, 0),
              ti:      basePending.length,
              ...(holdRows !== null ? { hold: holdRows.length } : {}),
              ...(cancelledRows !== null ? { ci: cancelledRows.length } : {}),
              ...(pickDecidedCount !== null ? { pick: pickDecidedCount } : {}),
              ...(baseRows !== null ? { base: baseRows.length } : {}),
            }}
          />
          {activeTab === "tinting" && (
            <BoardTable
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
              pending={basePending}
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
                setBaseDrill(o);
                // Open the first line still owing a TI, so the common case (one
                // pending line) is a single click rather than two.
                setBaseLine(o.lines.find((l) => !l.hasTiEntry) ?? null);
              }}
              onBack={() => { setBaseDrill(null); setBaseLine(null); }}
              onPickLine={(l) => setBaseLine(l)}
              onUndo={(o) => { void handleBaseUndo(o); }}
            />
          )}
          {activeTab === "hold" && (
            <BoardHoldTab
              rows={holdRows}
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
              rows={cancelledRows}
              error={cancelledError}
              canRestore={access.canCancel}
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
              rows={baseRows}
              error={baseError}
              selected={baseSel}
              onToggle={toggleBase}
              onOpen={(r) => setPanelKey(`base-${r.orderId}`)}
              windows={windows}
              canSlot={access.canSlot}
              slotBusy={writeBusy}
              onSetSlot={(r, v) => { void postTintAction("change-slot", [r.orderId], { slot: v, keepSelection: true }); }}
              barUp={barMode !== null}
            />
          )}

          {barMode !== null && (
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
