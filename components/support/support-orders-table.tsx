"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  ChevronDown,
  Search,
  Download,
  RotateCcw,
  Mail,
} from "lucide-react";
import { DispatchSlotPicker } from "@/components/support/dispatch-slot-picker";
import type { DispatchSlotValue, DispatchWindow } from "@/components/support/dispatch-slot-picker";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { CustomerMissingSheet } from "@/components/shared/customer-missing-sheet";
import { CancelOrderDialog } from "@/components/support/cancel-order-dialog";
import { ShipToOverrideModal } from "@/components/support/ship-to-override-modal";
import { ShipToOverrideCell } from "@/components/support/ship-to-override-cell";
import { CarriedOverBadge } from "@/components/shared/carried-over-badge";
import { OrderDetailPanel } from "@/components/shared/order-detail-panel";
import type { SlotNavItem } from "@/components/support/support-page-content";
import { SUPPORT_GRID_COLUMNS, formatArticleTag, getPriLabel, VolCell, CustomerCell, groupOrders } from "@/components/support/shared/table-cells";
import type { GroupBy, OrderGroup } from "@/components/support/shared/table-cells";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SupportOrder {
  id: number;
  obdNumber: string;
  obdEmailDate: string | null;
  orderDateTime: string | null;
  smu: string | null;
  workflowStage: string;
  dispatchStatus: string | null;
  customerMissing: boolean;
  mailMatched?: boolean;
  shipToCustomerId: string | null;
  shipToCustomerName: string | null;
  customerId: number | null;
  materialType?: string | null;
  shipToOverrideCustomerId?: number | null;
  shipToOverrideCustomer?: { id: number; customerName: string; area?: { name: string | null } | null } | null;
  customer: {
    customerName: string;
    customerCode: string;
    dispatchDeliveryType: { name: string } | null;
    area: {
      name: string;
      primaryRoute: { name: string } | null;
      deliveryType: { name: string } | null;
    } | null;
  } | null;
  slotId: number | null;
  slot: { name: string } | null;
  originalSlotId: number | null;
  originalSlot: { name: string } | null;
  priorityLevel: number;
  querySnapshot: {
    hasTinting: boolean;
    totalUnitQty: number;
    articleTag: string | null;
  } | null;
  splits: { id: number; status: string; dispatchStatus: string | null }[];
  importVolume: number | null;
  createdAt: string;
  updatedAt: string;
  isCarriedOver?: boolean;
  daysOverdue?: number;
  isDone?: boolean;
  arrivalSlotId?: number | null;
  heldAt?: string | null;
  dispatchTargetDate?: string | null;
  dispatchWindowId?: number | null;
  footprintType?: "arrival" | "hold" | "dispatch" | "cancel";
  dispatchWindow?: { windowTime: string; label: string | null } | null;
}

interface SupportOrdersTableProps {
  orders: SupportOrder[];
  section: string;
  onDispatch: (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => Promise<void>;
  onShipToOverride: (orderId: number, customerId: number | null) => Promise<void>;
  onPresetSlot: (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => Promise<void>;
  onHold: (orderId: number) => Promise<void>;
  onRelease: (orderId: number) => Promise<void>;
  onCancel: (orderId: number, reason: string, note?: string) => Promise<void>;
  onAssignSlot: (orderId: number, slotId: number) => Promise<void>;
  onBulkDispatch: (orderIds: number[], target: { dispatchTargetDate: string; dispatchWindowId: number }) => Promise<void>;
  onBulkHold: (orderIds: number[]) => Promise<void>;
  dispatchWindows: DispatchWindow[];
  loading: boolean;
  slots: SlotNavItem[];
  date: string;
  onOrdersChanged: () => void;
  isHistoryView: boolean;
  activeSlotId: number | null;
}

// ── CSS Grid constant ─────────────────────────────────────────────────────────

const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: SUPPORT_GRID_COLUMNS,
  gap: "0 0",
  alignItems: "center",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type RowType = "physically_dispatched" | "tinting" | "resolved" | "pending";

function getRowType(order: SupportOrder): RowType {
  if (order.workflowStage === "dispatched") return "physically_dispatched";
  if (["pending_tint_assignment", "tinting_in_progress", "tint_assigned"].includes(order.workflowStage)) return "tinting";
  if (order.dispatchStatus === "dispatch") return "resolved";
  return "pending";
}

function getAgePill(order: SupportOrder) {
  const ref = order.orderDateTime ?? order.obdEmailDate ?? order.createdAt;
  if (!ref) return { label: "—", cls: "bg-gray-100 text-[#8e91a7]", pulse: false };
  const diffMs = Date.now() - new Date(ref).getTime();
  const hours = diffMs / 3600000;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return { label: days >= 1 ? `${days}d` : `${Math.floor(hours)}h`, cls: "bg-red-100 text-red-700", pulse: false };
  }
  if (hours >= 1) return { label: `${Math.floor(hours)}h`, cls: "bg-amber-100 text-amber-700", pulse: false };
  return { label: `${Math.floor(hours * 60)}m`, cls: "bg-green-100 text-green-700", pulse: false };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const day = d.getDate();
  const mon = d.toLocaleString("en", { month: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} · ${hh}:${mm}`;
}

function abbreviateSlotName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("next") && lower.includes("morning")) return "NDM";
  if (lower.includes("morning")) return "Morn";
  if (lower.includes("afternoon")) return "Aftn";
  if (lower.includes("evening")) return "Eve";
  return name;
}

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDispatchSlot(order: SupportOrder): string | null {
  const dt = order.dispatchTargetDate;
  const wt = order.dispatchWindow?.windowTime;
  if (!dt || !wt) return null;
  const iso = dt.includes("T") ? dt.split("T")[0] : dt;
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${MONTHS_SHORT[parseInt(m, 10) - 1]} · ${wt}`;
}

function formatSavingSlot(date: string): string {
  const [, m, d] = date.split("-");
  return `${parseInt(d, 10)} ${MONTHS_SHORT[parseInt(m, 10) - 1]}`;
}

function formatBulkSlot(slot: { date: string; windowTime: string }): string {
  const [, m, d] = slot.date.split("-");
  return `${parseInt(d, 10)} ${MONTHS_SHORT[parseInt(m, 10) - 1]} · ${slot.windowTime}`;
}

// ── Pill slot select styling ─────────────────────────────────────────────────

const PILL_SLOT_CLS = "text-[11px] h-6 pl-2 pr-5 max-w-[150px] whitespace-nowrap truncate border border-gray-200 rounded-xl bg-white text-gray-500 font-medium appearance-none cursor-pointer focus:outline-none focus:border-teal-200 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_4px_center] bg-no-repeat";

// ── Popover type ─────────────────────────────────────────────────────────────

type PopoverState = { type: "dispatch" | "priority"; orderId: number } | null;

// ── Component ─────────────────────────────────────────────────────────────────

export function SupportOrdersTable({
  orders,
  section,
  onDispatch,
  onShipToOverride,
  onPresetSlot,
  onHold,
  onRelease,
  onCancel,
  onAssignSlot,
  onBulkDispatch,
  onBulkHold,
  dispatchWindows,
  loading,
  slots,
  date,
  onOrdersChanged,
  isHistoryView,
  activeSlotId,
}: SupportOrdersTableProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rowLoading, setRowLoading] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; orderId: number | null; obdNumber: string | null }>({
    open: false, orderId: null, obdNumber: null,
  });
  const [missingSheet, setMissingSheet] = useState<{ open: boolean; shipToCustomerId: string | null; shipToCustomerName: string | null }>({
    open: false, shipToCustomerId: null, shipToCustomerName: null,
  });
  const [shipOverride, setShipOverride] = useState<{ open: boolean; orderId: number | null; obdNumber: string | null; currentOverride: string | null }>({
    open: false, orderId: null, obdNumber: null, currentOverride: null,
  });
  const [groupBy, setGroupBy] = useState<GroupBy>("smu");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [detailOrder, setDetailOrder] = useState<SupportOrder | null>(null);
  const [localEdits, setLocalEdits] = useState<Map<number, { ds?: string; pri?: string; slot?: string }>>(new Map());
  const [openPopover, setOpenPopover] = useState<PopoverState>(null);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [dispatchSlot, setDispatchSlot] = useState<DispatchSlotValue | null>(null);
  const [dispatchPickerTrigger, setDispatchPickerTrigger] = useState<{ id: number; gen: number } | null>(null);
  const [dispatchIntentIds, setDispatchIntentIds] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<"dispatch" | "hold" | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const bulkStatusRef = useRef<HTMLDivElement>(null);

  const changedIds = useMemo(() => {
    const s = new Set<number>();
    localEdits.forEach((_, k) => s.add(k));
    return s;
  }, [localEdits]);

  // Close popover on outside click
  useEffect(() => {
    if (!openPopover) return;
    const handler = () => setOpenPopover(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openPopover]);

  // Reset state on section change
  useEffect(() => {
    setSelected(new Set());
    setLocalEdits(new Map());
    setDetailOrder(null);
    setCollapsedGroups(new Set());
    setOpenPopover(null);
    setDoneExpanded(false);
    setDispatchSlot(null);
    setDispatchPickerTrigger(null);
    setDispatchIntentIds(new Set());
    setBulkStatus(null);
    setBulkStatusOpen(false);
  }, [section]);

  // Close bulk-status popover on outside click
  useEffect(() => {
    if (!bulkStatusOpen) return;
    function handler(e: MouseEvent) {
      if (bulkStatusRef.current && !bulkStatusRef.current.contains(e.target as Node)) {
        setBulkStatusOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [bulkStatusOpen]);

  // "T" shortcut — toggle done section open/closed (mirrors Mail Orders global toggle)
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "t" || e.key === "T") setDoneExpanded((v) => !v);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // ── Orders ───────────────────────────────────────────────────────────────
  // `orders` arrives here already filtered (View/SMU/Delivery Type/Priority)
  // and searched by the page — no local search/filter box on this toolbar.
  const doneOrders = useMemo(() => {
    const done = orders.filter((o) => o.isDone);
    if (activeSlotId === null) return done;
    // dispatch footprint rows bypass slot filter — they appear in done regardless of active slot
    return done.filter((o) => o.footprintType === "dispatch" || (o.arrivalSlotId ?? o.originalSlotId) === activeSlotId);
  }, [orders, activeSlotId]);
  const pendingOrders = useMemo(() => orders.filter((o) => !o.isDone), [orders]);
  const groups = useMemo(() => groupOrders(pendingOrders, groupBy), [pendingOrders, groupBy]);

  const selectableIds = useMemo(
    () => pendingOrders.filter((o) => { const rt = getRowType(o); return rt !== "tinting" && rt !== "physically_dispatched"; }).map((o) => o.id),
    [pendingOrders],
  );

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableIds));
  }

  function toggleOne(id: number) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleGroup(name: string) {
    setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  }

  function setEdit(orderId: number, field: "ds" | "pri" | "slot", value: string) {
    setLocalEdits((prev) => {
      const next = new Map(prev);
      next.set(orderId, { ...(next.get(orderId) ?? {}), [field]: value });
      return next;
    });
  }

  const withRowLoading = useCallback(async (orderId: number, fn: () => Promise<void>) => {
    setRowLoading((prev) => new Set(prev).add(orderId));
    try { await fn(); } finally {
      setRowLoading((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
      setLocalEdits((prev) => { const next = new Map(prev); next.delete(orderId); return next; });
    }
  }, []);

  const handleUndoDispatch = useCallback(async (orderId: number) => {
    try {
      await withRowLoading(orderId, async () => {
        const res = await fetch(`/api/support/orders/${orderId}/undo-dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error ?? "Undo failed");
        }
        toast.success("Order returned to pending");
        onOrdersChanged();
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Undo failed");
    }
  }, [withRowLoading, onOrdersChanged]);

  const handleUndoCancel = useCallback(async (orderId: number) => {
    try {
      await withRowLoading(orderId, async () => {
        const res = await fetch(`/api/support/orders/${orderId}/undo-cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error ?? "Undo failed");
        }
        toast.success("Cancellation undone — order returned to pending");
        onOrdersChanged();
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Undo failed");
    }
  }, [withRowLoading, onOrdersChanged]);

  // Count pending-dispatch candidates: selected orders with no local edit that are still pending.
  // Filtering by pendingOrders ensures already-closed rows are never counted even if selected.
  const pendingDispatchCount = useMemo(() => {
    let count = 0;
    const pendingIds = new Set(pendingOrders.map((o) => o.id));
    localEdits.forEach((edits) => { if (edits.ds === "dispatch") count++; });
    selected.forEach((id) => { if (!localEdits.has(id) && pendingIds.has(id)) count++; });
    return count;
  }, [localEdits, selected, pendingOrders]);

  // Per-row immediate dispatch: removes orderId from selected BEFORE the API call
  // so that a concurrent sticky-bar Submit cannot re-fire on the same order.
  const handleRequestDispatchPickerOpen = useCallback((orderId: number) => {
    setDispatchPickerTrigger((prev) => ({ id: orderId, gen: prev?.id === orderId ? prev.gen + 1 : 1 }));
  }, []);

  const handleSetDispatchIntent = useCallback((orderId: number) => {
    setDispatchIntentIds((prev) => { const next = new Set(prev); next.add(orderId); return next; });
  }, []);

  const handleClearDispatchIntent = useCallback((orderId: number) => {
    setDispatchIntentIds((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
  }, []);

  const handleSingleDispatch = useCallback(async (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => {
    setSelected((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
    setDispatchPickerTrigger(null);
    setDispatchIntentIds((prev) => { const next = new Set(prev); next.delete(orderId); return next; });
    try {
      await withRowLoading(orderId, async () => {
        await onDispatch(orderId, target);
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Dispatch failed");
    }
  }, [withRowLoading, onDispatch]);

  const handleSinglePresetSlot = useCallback(async (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => {
    try {
      await withRowLoading(orderId, async () => {
        await onPresetSlot(orderId, target);
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Pre-set slot failed");
    }
  }, [withRowLoading, onPresetSlot]);

  async function handleSubmitSelected() {
    setBulkLoading(true);
    try {
      // Per-row arrival slot reassignments (independent of bulk action)
      const slotChanges: { orderId: number; slotId: number }[] = [];
      Array.from(localEdits.entries()).forEach(([orderId, edits]) => {
        if (edits.slot) slotChanges.push({ orderId, slotId: parseInt(edits.slot, 10) });
      });
      for (const { orderId, slotId } of slotChanges) await onAssignSlot(orderId, slotId);

      // Bulk action: apply bulkStatus to all selected rows
      const ids = Array.from(selected);
      if (bulkStatus === "dispatch" && dispatchSlot) {
        await onBulkDispatch(ids, { dispatchTargetDate: dispatchSlot.date, dispatchWindowId: dispatchSlot.dispatchWindowId });
      } else if (bulkStatus === "hold") {
        await onBulkHold(ids);
      }

      setSelected(new Set());
      setLocalEdits(new Map());
      setDispatchSlot(null);
      setBulkStatus(null);
      setBulkStatusOpen(false);
    } finally {
      setBulkLoading(false);
    }
  }

  function handleDsChange(order: SupportOrder, value: string) {
    if (value === "cancel") {
      setCancelDialog({ open: true, orderId: order.id, obdNumber: order.obdNumber });
      return;
    }
    setEdit(order.id, "ds", value);
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────
  // Exports exactly what's visible — `orders` is already filtered+searched by the page.
  function handleExport() {
    const header = "OBD,Customer,Route,Vol,Status,Priority\n";
    const rows = orders.map((o) => {
      const cust = o.customer?.customerName ?? o.shipToCustomerName ?? "";
      const route = o.customer?.area?.primaryRoute?.name ?? "";
      const vol = o.importVolume != null ? o.importVolume.toFixed(1) : "";
      const status = getRowType(o);
      const pri = o.priorityLevel <= 1 ? "P1" : o.priorityLevel === 2 ? "P2" : "FIFO";
      return `${o.obdNumber},"${cust}","${route}",${vol},${status},${pri}`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `support-orders-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Sticky bar derived ─────────────────────────────────────────────────────
  const showStickyBar = selected.size > 0 || changedIds.size > 0;
  const selectedOrders = useMemo(() => orders.filter((o) => selected.has(o.id)), [orders, selected]);
  const stickyQty = selectedOrders.reduce((s, o) => s + (o.querySnapshot?.totalUnitQty ?? 0), 0);
  const stickyCustomerCount = new Set(selectedOrders.map((o) => o.shipToCustomerId)).size;

  function groupCountText(groupOrders: SupportOrder[]): string {
    let pending = 0, dispatched = 0, tinting = 0;
    for (const o of groupOrders) {
      const rt = getRowType(o);
      if (rt === "resolved" || rt === "physically_dispatched") dispatched++;
      else if (rt === "tinting") tinting++;
      else pending++;
    }
    const parts: string[] = [];
    if (pending > 0) parts.push(`${pending} pending`);
    if (dispatched > 0) parts.push(`${dispatched} dispatched`);
    if (tinting > 0) parts.push(`${tinting} tinting`);
    return parts.join(" · ");
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full relative" ref={cardRef}>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-1.5 border-b border-gray-50 flex-shrink-0">
        <button
          type="button"
          onClick={toggleAll}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            Group by
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="h-[26px] px-1.5 pr-5 text-[11px] border border-gray-200 rounded bg-white text-gray-700 focus:outline-none focus:border-gray-300 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:14px] bg-[right_2px_center] bg-no-repeat"
            >
              <option value="none">None</option>
              <option value="smu">SMU</option>
              <option value="route">Route</option>
            </select>
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-1 border border-gray-200 rounded bg-white transition-colors"
          >
            <Download size={12} />
            Export
          </button>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto pb-14">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState message="No orders" />
        ) : (
          <div className="px-5">
            {/* Column headers */}
            <div style={GRID} className="py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100 sticky top-0 bg-white z-10">
              <div className="px-3.5 text-center"><Checkbox checked={allSelected} onCheckedChange={() => toggleAll()} /></div>
              <div className="px-3.5">OBD</div>
              <div className="px-3.5">Customer</div>
              <div className="px-3.5">Ship-to</div>
              <div className="px-3.5 text-center">Age</div>
              <div className="px-3.5">Route</div>
              <div className="px-3.5 text-right">Vol</div>
              <div className="px-3.5 whitespace-nowrap">Article</div>
              <div className="px-3.5">Status</div>
              <div className="px-3.5">Slot</div>
              <div className="px-3.5">Priority</div>
            </div>

            {/* Rows */}
            {groups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.groupName);
              const showGroupHeader = groupBy !== "none";
              return (
                <GroupRows
                  key={group.groupName}
                  group={group}
                  isCollapsed={isCollapsed}
                  showGroupHeader={showGroupHeader}
                  onToggleGroup={() => toggleGroup(group.groupName)}
                  onToggleGroupSelect={(ids, selectAll) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (selectAll) ids.forEach((id) => next.add(id));
                      else ids.forEach((id) => next.delete(id));
                      return next;
                    });
                  }}
                  countText={groupCountText(group.orders)}
                  selected={selected}
                  detailOrder={detailOrder}
                  localEdits={localEdits}
                  changedIds={changedIds}
                  rowLoading={rowLoading}
                  slots={slots}
                  openPopover={openPopover}
                  isHistoryView={isHistoryView}
                  dispatchWindows={dispatchWindows}
                  onSingleDispatch={handleSingleDispatch}
                  onShipToOverride={onShipToOverride}
                  onPresetSlot={handleSinglePresetSlot}
                  dispatchPickerTrigger={dispatchPickerTrigger}
                  onRequestDispatchPickerOpen={handleRequestDispatchPickerOpen}
                  dispatchIntentIds={dispatchIntentIds}
                  onSetDispatchIntent={handleSetDispatchIntent}
                  onClearDispatchIntent={handleClearDispatchIntent}
                  onToggleOne={toggleOne}
                  onSetEdit={setEdit}
                  onDsChange={handleDsChange}
                  onSetDetail={setDetailOrder}
                  onSetPopover={setOpenPopover}
                  onMissing={setMissingSheet}
                  onShipOverride={setShipOverride}
                  bulkStatus={bulkStatus}
                />
              );
            })}

            {/* ── Done section ─────────────────────────────────────── */}
            {doneOrders.length > 0 && (
              <>
                <div
                  className="flex items-center gap-2 py-2.5 px-1 cursor-pointer bg-gray-50 border-b border-gray-100 select-none"
                  onClick={() => setDoneExpanded((v) => !v)}
                >
                  <span className={cn(
                    "text-[10px] text-green-700 inline-block transition-transform duration-150",
                    doneExpanded && "rotate-90",
                  )}>▸</span>
                  <span className="text-[11px] font-semibold text-green-700">{doneOrders.length} done</span>
                  <span className="text-[10px] text-gray-400 ml-auto">press T to toggle</span>
                </div>
                {doneExpanded && doneOrders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    selected={selected}
                    detailOrder={detailOrder}
                    localEdits={localEdits}
                    changedIds={changedIds}
                    rowLoading={rowLoading}
                    slots={slots}
                    openPopover={openPopover}
                    isHistoryView={isHistoryView}
                    isDoneRow={true}
                    onUndoDispatch={handleUndoDispatch}
                    onUndoCancel={handleUndoCancel}
                    onShipToOverride={onShipToOverride}
                    onToggleOne={toggleOne}
                    onSetEdit={setEdit}
                    onDsChange={handleDsChange}
                    onSetDetail={setDetailOrder}
                    onSetPopover={setOpenPopover}
                    onMissing={setMissingSheet}
                    onShipOverride={setShipOverride}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Detail Panel ─────────────────────────────────────────────────── */}
      <OrderDetailPanel
        orderId={detailOrder?.id ?? null}
        onClose={() => setDetailOrder(null)}
        isHistoryView={isHistoryView}
      />

      {/* ── Sticky Bottom Bar ─────────────────────────────────────────────── */}
      <div
        className={cn(
          "fixed bottom-0 left-[72px] right-0 z-50 transform transition-transform duration-200",
          showStickyBar ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="bg-white" style={{ borderTop: "1px solid rgba(17,24,39,0.06)", boxShadow: "0 -1px 1px rgba(17,24,39,0.04), 0 -8px 24px rgba(17,24,39,0.06)" }}>
          <div className="flex items-center gap-3 pl-5 pr-[22px] py-3" style={{ minHeight: "56px" }}>
            {/* Selection summary */}
            <span className="text-xs font-medium text-gray-700">{selected.size} selected</span>
            {selected.size > 0 && (
              <span className="text-[10px] text-gray-400">
                {stickyQty} qty · {stickyCustomerCount} customer{stickyCustomerCount !== 1 ? "s" : ""}
              </span>
            )}

            <div className="flex-1" />

            {/* Status chooser */}
            <div className="relative" ref={bulkStatusRef}>
              <button
                type="button"
                onClick={() => setBulkStatusOpen((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs border rounded-lg px-3 py-1.5 cursor-pointer transition-colors",
                  bulkStatus === "dispatch" ? "border-green-200 bg-green-50 text-green-700" :
                  bulkStatus === "hold"     ? "border-amber-200 bg-amber-50 text-amber-700" :
                                              "border-gray-200 bg-white text-gray-500",
                )}
              >
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  bulkStatus === "dispatch" ? "bg-green-500" :
                  bulkStatus === "hold"     ? "bg-amber-500" :
                                              "bg-gray-300",
                )} />
                {bulkStatus === "dispatch" ? "Dispatch" : bulkStatus === "hold" ? "Hold" : "set status"}
                <ChevronDown size={11} className="ml-0.5 opacity-60" />
              </button>
              {bulkStatusOpen && (
                <div className="absolute bottom-full mb-1.5 left-0 bg-white border border-gray-200 rounded-[10px] shadow-[0_-8px_24px_rgba(0,0,0,0.10)] p-1.5 z-30 w-36">
                  <div
                    className="flex items-center gap-2 px-2.5 py-2 text-xs text-gray-700 rounded-[7px] cursor-pointer hover:bg-gray-50"
                    onClick={() => {
                      setLocalEdits((prev) => {
                        const next = new Map(prev);
                        selected.forEach((id) => {
                          const edit = next.get(id);
                          if (!edit || edit.ds === undefined) return;
                          const { pri, slot } = edit;
                          if (pri !== undefined || slot !== undefined) next.set(id, { pri, slot });
                          else next.delete(id);
                        });
                        return next;
                      });
                      setBulkStatus("dispatch"); setBulkStatusOpen(false);
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" /> Dispatch
                  </div>
                  <div
                    className="flex items-center gap-2 px-2.5 py-2 text-xs text-gray-700 rounded-[7px] cursor-pointer hover:bg-gray-50"
                    onClick={() => {
                      setLocalEdits((prev) => {
                        const next = new Map(prev);
                        selected.forEach((id) => {
                          const edit = next.get(id);
                          if (!edit || edit.ds === undefined) return;
                          const { pri, slot } = edit;
                          if (pri !== undefined || slot !== undefined) next.set(id, { pri, slot });
                          else next.delete(id);
                        });
                        return next;
                      });
                      setBulkStatus("hold"); setBulkStatusOpen(false); setDispatchSlot(null);
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" /> Hold
                  </div>
                </div>
              )}
            </div>

            {/* Dispatch Slot */}
            {bulkStatus === "dispatch" && dispatchSlot ? (
              <button
                type="button"
                onClick={() => setDispatchSlot(null)}
                className="inline-flex items-center gap-1.5 text-xs border border-green-200 bg-green-50 text-green-700 rounded-lg px-3 py-1.5"
              >
                <span>{formatBulkSlot(dispatchSlot)}</span>
                <span className="text-green-400 hover:text-green-700 leading-none">×</span>
              </button>
            ) : bulkStatus === "dispatch" ? (
              <DispatchSlotPicker
                value={null}
                onChange={setDispatchSlot}
                windows={dispatchWindows}
                popoverDir="up"
              />
            ) : (
              <span className="inline-flex items-center text-xs border border-dashed border-gray-200 rounded-lg px-3 py-1.5 text-gray-300 select-none">
                {bulkStatus === "hold" ? "—" : "— pick status first"}
              </span>
            )}

            {/* Divider */}
            <div className="w-px h-[22px] bg-gray-200 mx-1 flex-shrink-0" />

            {/* Clear */}
            <button
              type="button"
              onClick={() => { setSelected(new Set()); setLocalEdits(new Map()); setDispatchSlot(null); setBulkStatus(null); setBulkStatusOpen(false); }}
              className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 transition-colors"
            >
              Clear
            </button>

            {/* Submit */}
            <button
              type="button"
              onClick={() => void handleSubmitSelected()}
              disabled={bulkLoading || bulkStatus === null || (bulkStatus === "dispatch" && !dispatchSlot)}
              className="px-4 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 flex items-center gap-1.5 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {bulkLoading && <Loader2 size={12} className="animate-spin" />}
              Submit {selected.size} Orders
            </button>
          </div>
        </div>
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      <CancelOrderDialog
        open={cancelDialog.open}
        onOpenChange={(v) => setCancelDialog((p) => ({ ...p, open: v }))}
        orderId={cancelDialog.orderId}
        obdNumber={cancelDialog.obdNumber}
        onConfirm={onCancel}
      />
      <CustomerMissingSheet
        open={missingSheet.open}
        onOpenChange={(v) => setMissingSheet((p) => ({ ...p, open: v }))}
        shipToCustomerId={missingSheet.shipToCustomerId}
        shipToCustomerName={missingSheet.shipToCustomerName}
        onResolved={() => { setMissingSheet({ open: false, shipToCustomerId: null, shipToCustomerName: null }); onOrdersChanged(); }}
      />
      <ShipToOverrideModal
        open={shipOverride.open}
        onOpenChange={(v) => setShipOverride((p) => ({ ...p, open: v }))}
        orderId={shipOverride.orderId}
        obdNumber={shipOverride.obdNumber}
        currentOverride={shipOverride.currentOverride}
        onSave={async () => {
          setLocalEdits((prev) => { const next = new Map(prev); return next; });
        }}
      />
    </div>
  );
}

// ── GroupRows ─────────────────────────────────────────────────────────────────

function GroupRows({
  group, isCollapsed, showGroupHeader, onToggleGroup, onToggleGroupSelect, countText,
  selected, detailOrder, localEdits, changedIds, rowLoading, slots,
  openPopover, isHistoryView, dispatchWindows, onSingleDispatch, onShipToOverride, onPresetSlot,
  dispatchPickerTrigger, onRequestDispatchPickerOpen,
  dispatchIntentIds, onSetDispatchIntent, onClearDispatchIntent,
  onToggleOne, onSetEdit, onDsChange, onSetDetail, onSetPopover, onMissing, onShipOverride,
  bulkStatus,
}: {
  group: OrderGroup;
  isCollapsed: boolean;
  showGroupHeader: boolean;
  onToggleGroup: () => void;
  onToggleGroupSelect: (ids: number[], selectAll: boolean) => void;
  countText: string;
  selected: Set<number>;
  detailOrder: SupportOrder | null;
  localEdits: Map<number, { ds?: string; pri?: string; slot?: string }>;
  changedIds: Set<number>;
  rowLoading: Set<number>;
  slots: SlotNavItem[];
  openPopover: PopoverState;
  isHistoryView: boolean;
  dispatchWindows: DispatchWindow[];
  onSingleDispatch: (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => Promise<void>;
  onShipToOverride: (orderId: number, customerId: number | null) => Promise<void>;
  onPresetSlot: (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => Promise<void>;
  dispatchPickerTrigger: { id: number; gen: number } | null;
  onRequestDispatchPickerOpen: (orderId: number) => void;
  dispatchIntentIds: Set<number>;
  onSetDispatchIntent: (orderId: number) => void;
  onClearDispatchIntent: (orderId: number) => void;
  onToggleOne: (id: number) => void;
  onSetEdit: (id: number, field: "ds" | "pri" | "slot", value: string) => void;
  onDsChange: (order: SupportOrder, value: string) => void;
  onSetDetail: (order: SupportOrder | null) => void;
  onSetPopover: (v: PopoverState) => void;
  onMissing: (v: { open: boolean; shipToCustomerId: string | null; shipToCustomerName: string | null }) => void;
  onShipOverride: (v: { open: boolean; orderId: number | null; obdNumber: string | null; currentOverride: string | null }) => void;
  bulkStatus?: "dispatch" | "hold" | null;
}) {
  const groupSelectableIds = useMemo(
    () => group.orders.filter((o) => { const rt = getRowType(o); return rt !== "tinting" && rt !== "physically_dispatched"; }).map((o) => o.id),
    [group.orders],
  );
  const groupSelectedCount = groupSelectableIds.filter((id) => selected.has(id)).length;
  const groupAllSelected = groupSelectableIds.length > 0 && groupSelectedCount === groupSelectableIds.length;
  const groupIndeterminate = groupSelectedCount > 0 && !groupAllSelected;

  return (
    <>
      {showGroupHeader && (
        <div
          className="flex items-center gap-2 py-2 px-1 cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={onToggleGroup}
        >
          {groupSelectableIds.length > 0 && (
            <div data-checkbox onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={groupAllSelected}
                indeterminate={groupIndeterminate}
                onCheckedChange={() => onToggleGroupSelect(groupSelectableIds, !groupAllSelected)}
              />
            </div>
          )}
          <ChevronDown size={14} className={cn("text-gray-400 transition-transform", isCollapsed && "-rotate-90")} />
          <span className="text-xs font-medium text-gray-700">{group.groupName}</span>
          <span className="text-[11px] text-gray-400">{countText}</span>
        </div>
      )}
      {!isCollapsed && group.orders.map((order) => (
        <OrderRow
          key={order.id}
          order={order}
          selected={selected}
          detailOrder={detailOrder}
          localEdits={localEdits}
          changedIds={changedIds}
          rowLoading={rowLoading}
          slots={slots}
          openPopover={openPopover}
          isHistoryView={isHistoryView}
          dispatchWindows={dispatchWindows}
          onSingleDispatch={onSingleDispatch}
          onShipToOverride={onShipToOverride}
          onPresetSlot={onPresetSlot}
          dispatchPickerTrigger={dispatchPickerTrigger}
          onRequestDispatchPickerOpen={onRequestDispatchPickerOpen}
          dispatchIntentIds={dispatchIntentIds}
          onSetDispatchIntent={onSetDispatchIntent}
          onClearDispatchIntent={onClearDispatchIntent}
          onToggleOne={onToggleOne}
          onSetEdit={onSetEdit}
          onDsChange={onDsChange}
          onSetDetail={onSetDetail}
          onSetPopover={onSetPopover}
          onMissing={onMissing}
          onShipOverride={onShipOverride}
          bulkStatus={bulkStatus}
        />
      ))}
    </>
  );
}

// ── OrderRow ──────────────────────────────────────────────────────────────────

function OrderRow({
  order, selected, detailOrder, localEdits, changedIds, rowLoading, slots,
  openPopover, isHistoryView, isDoneRow, onUndoDispatch, onUndoCancel,
  dispatchWindows, onSingleDispatch, onShipToOverride, onPresetSlot,
  dispatchPickerTrigger, onRequestDispatchPickerOpen,
  dispatchIntentIds, onSetDispatchIntent, onClearDispatchIntent,
  onToggleOne, onSetEdit, onDsChange, onSetDetail, onSetPopover, onMissing, onShipOverride,
  bulkStatus,
}: {
  order: SupportOrder;
  selected: Set<number>;
  detailOrder: SupportOrder | null;
  localEdits: Map<number, { ds?: string; pri?: string; slot?: string }>;
  changedIds: Set<number>;
  rowLoading: Set<number>;
  slots: SlotNavItem[];
  openPopover: PopoverState;
  isHistoryView: boolean;
  isDoneRow?: boolean;
  onUndoDispatch?: (orderId: number) => Promise<void>;
  onUndoCancel?: (orderId: number) => Promise<void>;
  dispatchWindows?: DispatchWindow[];
  onSingleDispatch?: (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => Promise<void>;
  onShipToOverride: (orderId: number, customerId: number | null) => Promise<void>;
  onPresetSlot?: (orderId: number, target: { dispatchTargetDate: string; dispatchWindowId: number }) => Promise<void>;
  dispatchPickerTrigger?: { id: number; gen: number } | null;
  onRequestDispatchPickerOpen?: (orderId: number) => void;
  dispatchIntentIds?: Set<number>;
  onSetDispatchIntent?: (orderId: number) => void;
  onClearDispatchIntent?: (orderId: number) => void;
  onToggleOne: (id: number) => void;
  onSetEdit: (id: number, field: "ds" | "pri" | "slot", value: string) => void;
  onDsChange: (order: SupportOrder, value: string) => void;
  onSetDetail: (order: SupportOrder | null) => void;
  onSetPopover: (v: PopoverState) => void;
  onMissing: (v: { open: boolean; shipToCustomerId: string | null; shipToCustomerName: string | null }) => void;
  onShipOverride: (v: { open: boolean; orderId: number | null; obdNumber: string | null; currentOverride: string | null }) => void;
  bulkStatus?: "dispatch" | "hold" | null;
}) {
  const rt = getRowType(order);
  const isPhysicallyDispatched = rt === "physically_dispatched";
  const isTinting = rt === "tinting";
  const isResolved = rt === "resolved";
  const isNonInteractive = isPhysicallyDispatched || isTinting;
  const isReadOnly = !!isDoneRow;

  const isChanged = changedIds.has(order.id);
  const isDetailActive = detailOrder?.id === order.id;
  const isRowBusy = rowLoading.has(order.id);
  const age = getAgePill(order);
  const delType = order.customer?.dispatchDeliveryType?.name ?? order.customer?.area?.deliveryType?.name ?? null;

  const editDs   = localEdits.get(order.id)?.ds;
  const editPri  = localEdits.get(order.id)?.pri;
  const editSlot = localEdits.get(order.id)?.slot;

  const [savingSlot, setSavingSlot] = useState<{ date: string; windowTime: string } | null>(null);
  const prevRowBusy = useRef(false);
  useEffect(() => {
    if (prevRowBusy.current && !isRowBusy) setSavingSlot(null);
    prevRowBusy.current = isRowBusy;
  }, [isRowBusy]);

  const hasDispatchIntent = !isDoneRow && (dispatchIntentIds?.has(order.id) ?? false);
  const isSelected = !isDoneRow && selected.has(order.id);
  const currentDs   = editDs ?? (
    isSelected && bulkStatus ? bulkStatus
    : hasDispatchIntent || savingSlot !== null ? "dispatch"
    : (order.dispatchStatus ?? "")
  );
  const currentPri  = editPri ?? String(order.priorityLevel);
  const currentSlot = editSlot ?? (order.slotId ? String(order.slotId) : "");

  const hasCascade = order.slotId !== null && order.originalSlotId !== null && order.slotId !== order.originalSlotId && order.originalSlot !== null;

  const isDispatchPopoverOpen = openPopover?.type === "dispatch" && openPopover.orderId === order.id;
  const isPriorityPopoverOpen = openPopover?.type === "priority" && openPopover.orderId === order.id;

  function handleRowClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("select") || target.closest("button") || target.closest("input") || target.closest("[data-checkbox]") || target.closest("[data-popover]")) return;
    onSetDetail(order);
  }

  return (
    <div
      style={GRID}
      className={cn(
        "border-b border-gray-50/80 transition-colors cursor-pointer",
        isPhysicallyDispatched && !isDoneRow ? "opacity-[0.35] py-1.5" : isResolved ? "py-1.5" : "py-2",
        isChanged && !isNonInteractive && "bg-teal-50/20",
        isDetailActive && "bg-teal-50 border-l-[3px] border-l-teal-600",
        !isNonInteractive && !isChanged && !isDetailActive && "hover:bg-gray-50/50",
      )}
      onClick={handleRowClick}
    >
      {/* Checkbox */}
      <div data-checkbox className="px-3.5 text-center">
        {isNonInteractive || isReadOnly ? (
          <div className="w-4" />
        ) : (
          <Checkbox checked={selected.has(order.id)} onCheckedChange={() => onToggleOne(order.id)} />
        )}
      </div>

      {/* OBD / Date */}
      <div className="px-3.5">
        <div className="flex items-center gap-1 flex-wrap">
          <p className={cn("font-mono font-semibold text-xs tabular-nums", isResolved ? "text-gray-500" : "text-gray-800")}>
            {order.obdNumber}
          </p>
          <CarriedOverBadge daysOverdue={order.daysOverdue ?? 0} />
        </div>
        <div className={cn("flex items-center gap-0.5 text-[10px]", isResolved ? "text-gray-300" : "text-gray-400")}>
          <span>{formatDate(order.orderDateTime ?? order.obdEmailDate)}</span>
          {order.mailMatched && (
            <span title="Time from mail order" className="shrink-0 flex items-center">
              <Mail size={10} />
            </span>
          )}
        </div>
      </div>

      {/* Customer */}
      <div className="min-w-0 px-3.5">
        <CustomerCell
          customerName={order.customer?.customerName}
          fallbackName={order.shipToCustomerName}
          shipToCustomerId={order.shipToCustomerId}
          customerMissing={order.customerMissing}
          hasTinting={order.querySnapshot?.hasTinting}
          muted={isResolved}
          showBadges={!isPhysicallyDispatched}
          onMissing={onMissing}
        />
      </div>

      {/* Ship-to Override */}
      <div className="min-w-0 px-3.5" title={order.shipToOverrideCustomer?.customerName ?? undefined}>
        <ShipToOverrideCell
          orderId={order.id}
          current={
            order.shipToOverrideCustomer
              ? { id: order.shipToOverrideCustomer.id, customerName: order.shipToOverrideCustomer.customerName }
              : null
          }
          onSave={onShipToOverride}
        />
      </div>

      {/* Age */}
      <div className="px-3.5 text-center">
        {isPhysicallyDispatched ? (
          <span className="text-[10px] text-gray-300">—</span>
        ) : (
          <span className={cn("text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full inline-block", age.cls, age.pulse && "animate-pulse")}>
            {age.label}
          </span>
        )}
      </div>

      {/* Route / Type — plain text */}
      <div className="min-w-0 px-3.5">
        <p className={cn("text-xs truncate", isResolved ? "text-gray-400" : "text-gray-600")}>
          {order.customer?.area?.primaryRoute?.name ?? "—"}
        </p>
        {delType && (
          <span className={cn("text-[10px] truncate block", isResolved ? "text-gray-300" : "text-gray-400")}>
            {delType}
          </span>
        )}
      </div>

      {/* Vol — volume + materialType stacked sub-line */}
      <div className="px-3.5 text-right">
        <VolCell importVolume={order.importVolume} materialType={order.materialType} muted={isResolved} />
      </div>

      {/* Article — abbreviated pack breakdown, display-only */}
      <div className="min-w-0 px-3.5">
        <p
          className={cn("text-xs whitespace-nowrap truncate", isResolved ? "text-gray-400" : "text-gray-600")}
          title={order.querySnapshot?.articleTag ?? undefined}
        >
          {order.querySnapshot?.articleTag != null ? formatArticleTag(order.querySnapshot.articleTag) : "—"}
        </p>
      </div>

      {/* ── Status badge (col 7) ───────────────────────────────────────── */}
      <div className="relative px-3.5" data-popover>
        {isPhysicallyDispatched ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-600 cursor-default">
            <span className="w-[5px] h-[5px] rounded-full inline-block bg-emerald-500" />
            Dispatched
          </span>
        ) : isTinting ? (
          <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase px-2.5 py-1 rounded-[5px] border bg-purple-100 text-purple-700 border-purple-200">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            {order.workflowStage === "pending_tint_assignment" ? "Tint · Pending" :
             order.workflowStage === "tinting_in_progress"    ? "Tint · Mixing"  :
                                                                "Tint · Assigned"}
          </span>
        ) : isDoneRow ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full border cursor-default",
              order.footprintType === "cancel"   ? "bg-red-50 border-red-200 text-red-600" :
              order.footprintType === "dispatch" ? "bg-green-50 border-green-200 text-green-700" :
              order.footprintType === "hold"     ? "bg-amber-50 border-amber-200 text-amber-700" :
                                                   "bg-gray-100 border-gray-200 text-gray-400",
            )}
          >
            <span className={cn(
              "w-[5px] h-[5px] rounded-full inline-block",
              order.footprintType === "cancel"   ? "bg-red-500" :
              order.footprintType === "dispatch" ? "bg-green-500" :
              order.footprintType === "hold"     ? "bg-amber-500" :
                                                   "bg-gray-300",
            )} />
            {order.footprintType === "cancel"   ? "Cancelled" :
             order.footprintType === "dispatch" ? "Dispatch" :
             order.footprintType === "hold"     ? "Hold" : "Done"}
          </span>
        ) : (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full border cursor-pointer",
                currentDs === "dispatch" ? "bg-emerald-50 border-emerald-200 text-emerald-600" :
                currentDs === "hold"     ? "bg-amber-50 border-amber-200 text-amber-600" :
                                           "bg-gray-100 border-gray-200 text-gray-400",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onSetPopover(isDispatchPopoverOpen ? null : { type: "dispatch", orderId: order.id });
              }}
            >
              <span className={cn(
                "w-[5px] h-[5px] rounded-full inline-block",
                currentDs === "dispatch" ? "bg-emerald-500" :
                currentDs === "hold"     ? "bg-amber-500" :
                                           "bg-gray-300",
              )} />
              {currentDs === "dispatch" ? "Dispatch" : currentDs === "hold" ? "Hold" : "—"}
            </span>
            {isDispatchPopoverOpen && (
              <div
                className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1 z-30 min-w-[120px]"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50"
                  onClick={() => { onSetDispatchIntent?.(order.id); onSetPopover(null); onRequestDispatchPickerOpen?.(order.id); }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" /> Dispatch
                </div>
                {currentDs && (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50"
                    onClick={() => { onClearDispatchIntent?.(order.id); onDsChange(order, ""); onSetPopover(null); }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300" /> Unset
                  </div>
                )}
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50"
                  onClick={() => { onClearDispatchIntent?.(order.id); onDsChange(order, "hold"); onSetPopover(null); }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Hold
                </div>
                {!isResolved && (
                  <>
                    <div className="border-t border-gray-100 my-1" />
                    <div
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-500 rounded cursor-pointer hover:bg-red-50"
                      onClick={() => { onClearDispatchIntent?.(order.id); onDsChange(order, "cancel"); onSetPopover(null); }}
                    >
                      Cancel
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Dispatch Slot (col 8) ──────────────────────────────────────── */}
      <div className="px-3.5">
        {isPhysicallyDispatched ? (
          <span className="text-[10px] text-gray-300">—</span>
        ) : isTinting ? (
          <DispatchSlotPicker
            value={
              order.dispatchTargetDate != null && order.dispatchWindowId != null
                ? {
                    date: order.dispatchTargetDate.includes("T")
                      ? order.dispatchTargetDate.split("T")[0]
                      : order.dispatchTargetDate,
                    dispatchWindowId: order.dispatchWindowId,
                    windowTime: order.dispatchWindow?.windowTime ?? "",
                  }
                : null
            }
            onChange={(v) => {
              if (!v || !onPresetSlot) return;
              void onPresetSlot(order.id, { dispatchTargetDate: v.date, dispatchWindowId: v.dispatchWindowId });
            }}
            windows={dispatchWindows ?? []}
            disabled={isRowBusy}
          />
        ) : savingSlot ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px]">
              <span className="text-gray-900 font-medium">{formatSavingSlot(savingSlot.date)}</span>
              <span className="text-gray-500"> · {savingSlot.windowTime}</span>
            </span>
            <Loader2 size={11} className="animate-spin text-gray-300 flex-shrink-0" />
          </div>
        ) : isDoneRow ? (
          <div className="flex items-center gap-1">
            {(() => {
              const slotLabel = formatDispatchSlot(order);
              if (slotLabel) {
                const [datePart, timePart] = slotLabel.split(" · ");
                return (
                  <span className="text-[11px]">
                    <span className="text-gray-900 font-medium">{datePart}</span>
                    <span className="text-gray-500"> · {timePart}</span>
                  </span>
                );
              }
              return <span className="text-[11px] text-gray-300">—</span>;
            })()}
            {onUndoDispatch && order.dispatchStatus !== "hold" && order.footprintType !== "cancel" && (
              <button
                type="button"
                title="Undo dispatch — return to pending"
                disabled={isRowBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!window.confirm("Return this order to the pending queue? It will be removed from Done.")) return;
                  void onUndoDispatch(order.id);
                }}
                className="ml-1 p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-40 transition-colors rounded"
              >
                <RotateCcw size={11} />
              </button>
            )}
            {onUndoCancel && order.footprintType === "cancel" && (
              <button
                type="button"
                title="Undo cancel — return to pending"
                disabled={isRowBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!window.confirm("Return this order to the pending queue? The cancellation will be undone.")) return;
                  void onUndoCancel(order.id);
                }}
                className="ml-1 p-0.5 text-gray-300 hover:text-gray-500 disabled:opacity-40 transition-colors rounded"
              >
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        ) : currentDs === "hold" ? (
          <span className="text-[10px] text-gray-300">—</span>
        ) : (
          <DispatchSlotPicker
            value={
              order.dispatchTargetDate != null && order.dispatchWindowId != null
                ? {
                    date: order.dispatchTargetDate.includes("T")
                      ? order.dispatchTargetDate.split("T")[0]
                      : order.dispatchTargetDate,
                    dispatchWindowId: order.dispatchWindowId,
                    windowTime: order.dispatchWindow?.windowTime ?? "",
                  }
                : null
            }
            onChange={(v) => {
              if (!v || !onSingleDispatch) return;
              setSavingSlot({ date: v.date, windowTime: v.windowTime });
              void onSingleDispatch(order.id, { dispatchTargetDate: v.date, dispatchWindowId: v.dispatchWindowId });
            }}
            windows={dispatchWindows ?? []}
            forceOpenGen={dispatchPickerTrigger?.id === order.id ? dispatchPickerTrigger.gen : undefined}
          />
        )}
      </div>

      {/* ── Priority badge (col 10) ─────────────────────────────────────── */}
      <div className="relative px-3.5" data-popover>
        {isPhysicallyDispatched || isTinting ? (
          <span className="text-[10px] text-gray-300">—</span>
        ) : isResolved && (currentPri === "3" || currentPri === "0" || Number(currentPri) >= 3) ? (
          <span className="text-[10px] text-gray-400">FIFO</span>
        ) : isReadOnly ? (
          <span className={cn(
            "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full border cursor-default",
            currentPri === "1" ? "bg-red-50 border-red-200 text-red-600" :
            currentPri === "2" ? "bg-amber-50 border-amber-200 text-amber-600" :
                                 "bg-gray-50 border-gray-200 text-gray-500",
          )}>
            {getPriLabel(currentPri)}
          </span>
        ) : (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full border cursor-pointer",
                currentPri === "1" ? "bg-red-50 border-red-200 text-red-600" :
                currentPri === "2" ? "bg-amber-50 border-amber-200 text-amber-600" :
                                     "bg-gray-50 border-gray-200 text-gray-500",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onSetPopover(isPriorityPopoverOpen ? null : { type: "priority", orderId: order.id });
              }}
            >
              {getPriLabel(currentPri)}
            </span>
            {isPriorityPopoverOpen && (
              <div
                className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1 z-30 min-w-[80px]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50" onClick={() => { onSetEdit(order.id, "pri", "3"); onSetPopover(null); }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> FIFO
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50" onClick={() => { onSetEdit(order.id, "pri", "1"); onSetPopover(null); }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> P1
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50" onClick={() => { onSetEdit(order.id, "pri", "2"); onSetPopover(null); }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> P2
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50" onClick={() => { onSetEdit(order.id, "pri", "4"); onSetPopover(null); }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> P3
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
        <Search className="h-5 w-5 text-gray-300" />
      </div>
      <p className="text-[13px] font-semibold text-gray-400">{message}</p>
    </div>
  );
}
