"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  ChevronDown,
  Search,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { CustomerMissingSheet } from "@/components/shared/customer-missing-sheet";
import { CancelOrderDialog } from "@/components/support/cancel-order-dialog";
import { ShipToOverrideModal } from "@/components/support/ship-to-override-modal";
import { CarriedOverBadge } from "@/components/shared/carried-over-badge";
import { OrderDetailPanel } from "@/components/shared/order-detail-panel";
import type { SlotNavItem } from "@/components/support/support-page-content";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SupportOrder {
  id: number;
  obdNumber: string;
  obdEmailDate: string | null;
  smu: string | null;
  workflowStage: string;
  dispatchStatus: string | null;
  customerMissing: boolean;
  shipToCustomerId: string;
  shipToCustomerName: string | null;
  customerId: number | null;
  customer: {
    customerName: string;
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
}

interface SupportOrdersTableProps {
  orders: SupportOrder[];
  section: string;
  onDispatch: (orderId: number) => Promise<void>;
  onHold: (orderId: number) => Promise<void>;
  onRelease: (orderId: number) => Promise<void>;
  onCancel: (orderId: number, reason: string, note?: string) => Promise<void>;
  onAssignSlot: (orderId: number, slotId: number) => Promise<void>;
  onBulkDispatch: (orderIds: number[]) => Promise<void>;
  onBulkHold: (orderIds: number[]) => Promise<void>;
  loading: boolean;
  slots: SlotNavItem[];
  date: string;
  onOrdersChanged: () => void;
  isHistoryView: boolean;
}

// ── CSS Grid constant ─────────────────────────────────────────────────────────

const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "32px 1fr 2fr 0.7fr 0.4fr 0.5fr 0.9fr 0.6fr 1fr",
  gap: "0 10px",
  alignItems: "center",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type RowType = "physically_dispatched" | "tinting" | "resolved" | "pending";

function getRowType(order: SupportOrder): RowType {
  if (order.workflowStage === "dispatched") return "physically_dispatched";
  if (["tinting_in_progress", "tint_assigned"].includes(order.workflowStage)) return "tinting";
  if (order.dispatchStatus === "dispatch") return "resolved";
  return "pending";
}

function getAgePill(order: SupportOrder) {
  const ref = order.obdEmailDate ?? order.createdAt;
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

function getSmuGroup(order: SupportOrder): string {
  return order.smu || "Unknown SMU";
}

type GroupBy = "smu" | "route" | "none";

interface OrderGroup {
  groupName: string;
  orders: SupportOrder[];
}

function groupOrders(orders: SupportOrder[], groupBy: GroupBy): OrderGroup[] {
  if (groupBy === "none") return [{ groupName: "All Orders", orders }];
  const map = new Map<string, SupportOrder[]>();
  for (const o of orders) {
    let key: string;
    if (groupBy === "smu") key = getSmuGroup(o);
    else key = o.customer?.area?.primaryRoute?.name ?? "Unassigned";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(o);
  }
  return Array.from(map.entries()).map(([groupName, orders]) => ({ groupName, orders }));
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

function getPriLabel(val: string): string {
  if (val === "1") return "P1";
  if (val === "2") return "P2";
  if (val === "4") return "P3";
  return "FIFO";
}

// ── Pill slot select styling ─────────────────────────────────────────────────

const PILL_SLOT_CLS = "text-[11px] h-6 pl-2 pr-5 max-w-[150px] whitespace-nowrap truncate border border-gray-200 rounded-xl bg-white text-gray-500 font-medium appearance-none cursor-pointer focus:outline-none focus:border-indigo-200 bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_4px_center] bg-no-repeat";

// ── Popover type ─────────────────────────────────────────────────────────────

type PopoverState = { type: "dispatch" | "priority"; orderId: number } | null;

// ── Component ─────────────────────────────────────────────────────────────────

export function SupportOrdersTable({
  orders,
  section,
  onDispatch,
  onHold,
  onRelease,
  onCancel,
  onAssignSlot,
  onBulkDispatch,
  onBulkHold,
  loading,
  slots,
  date,
  onOrdersChanged,
  isHistoryView,
}: SupportOrdersTableProps) {
  const [search, setSearch] = useState("");
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

  const cardRef = useRef<HTMLDivElement>(null);

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
    setSearch("");
    setLocalEdits(new Map());
    setDetailOrder(null);
    setCollapsedGroups(new Set());
    setOpenPopover(null);
  }, [section]);

  // ── Filtered orders ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) =>
        o.obdNumber.toLowerCase().includes(q) ||
        (o.shipToCustomerName ?? "").toLowerCase().includes(q) ||
        (o.customer?.customerName ?? "").toLowerCase().includes(q) ||
        (o.customer?.area?.primaryRoute?.name ?? "").toLowerCase().includes(q),
    );
  }, [orders, search]);

  const groups = useMemo(() => groupOrders(filtered, groupBy), [filtered, groupBy]);

  const selectableIds = useMemo(
    () => filtered.filter((o) => { const rt = getRowType(o); return rt !== "tinting" && rt !== "physically_dispatched"; }).map((o) => o.id),
    [filtered],
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

  async function handleSubmitSelected() {
    setBulkLoading(true);
    try {
      const dispatchIds: number[] = [];
      const holdIds: number[] = [];
      const slotChanges: { orderId: number; slotId: number }[] = [];

      Array.from(localEdits.entries()).forEach(([orderId, edits]) => {
        if (edits.ds === "dispatch") dispatchIds.push(orderId);
        else if (edits.ds === "hold") holdIds.push(orderId);
        if (edits.slot) slotChanges.push({ orderId, slotId: parseInt(edits.slot, 10) });
      });

      Array.from(selected).forEach((id) => { if (!localEdits.has(id)) dispatchIds.push(id); });

      for (const { orderId, slotId } of slotChanges) await onAssignSlot(orderId, slotId);
      if (dispatchIds.length > 0) await onBulkDispatch(dispatchIds);
      if (holdIds.length > 0) await onBulkHold(holdIds);

      setSelected(new Set());
      setLocalEdits(new Map());
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
  function handleExport() {
    const header = "OBD,Customer,Route,Vol,Status,Priority\n";
    const rows = filtered.map((o) => {
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
  const showStickyBar = !isHistoryView && (selected.size > 0 || changedIds.size > 0);
  const selectedOrders = useMemo(() => filtered.filter((o) => selected.has(o.id)), [filtered, selected]);
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
        {!isHistoryView ? (
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {allSelected ? "Deselect All" : "Select All"}
          </button>
        ) : (
          <div />
        )}
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
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-[160px] pl-7 pr-2 text-[11.5px] border border-gray-200 rounded bg-white placeholder:text-gray-300 focus:outline-none focus:border-gray-300"
            />
          </div>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto pb-14">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState message="No orders" />
        ) : (
          <div className="px-5">
            {/* Column headers */}
            <div style={GRID} className="py-1.5 px-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100 sticky top-0 bg-white z-10">
              <div>{!isHistoryView && <Checkbox checked={allSelected} onCheckedChange={() => toggleAll()} />}</div>
              <div>OBD / Date</div>
              <div>Customer</div>
              <div>Route / Type</div>
              <div className="text-right pr-1">VOL (L)</div>
              <div className="text-center">Age</div>
              <div>Dispatch</div>
              <div>Priority</div>
              <div>Slot</div>
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
                  onToggleOne={toggleOne}
                  onSetEdit={setEdit}
                  onDsChange={handleDsChange}
                  onSetDetail={setDetailOrder}
                  onSetPopover={setOpenPopover}
                  onMissing={setMissingSheet}
                  onShipOverride={setShipOverride}
                />
              );
            })}
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
          "fixed bottom-0 left-14 right-0 z-50 transform transition-transform duration-200",
          showStickyBar ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between px-5 py-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-700">{selected.size} selected</span>
              {selected.size > 0 && (
                <span className="text-[10px] text-gray-400">
                  {stickyQty} qty · {stickyCustomerCount} customer{stickyCustomerCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setSelected(new Set()); setLocalEdits(new Map()); }}
                className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void handleSubmitSelected()}
                disabled={bulkLoading}
                className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 flex items-center gap-1.5 disabled:opacity-50 transition-colors"
              >
                {bulkLoading && <Loader2 size={12} className="animate-spin" />}
                Submit {selected.size} Orders
              </button>
            </div>
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
  openPopover, isHistoryView,
  onToggleOne, onSetEdit, onDsChange, onSetDetail, onSetPopover, onMissing, onShipOverride,
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
  onToggleOne: (id: number) => void;
  onSetEdit: (id: number, field: "ds" | "pri" | "slot", value: string) => void;
  onDsChange: (order: SupportOrder, value: string) => void;
  onSetDetail: (order: SupportOrder | null) => void;
  onSetPopover: (v: PopoverState) => void;
  onMissing: (v: { open: boolean; shipToCustomerId: string | null; shipToCustomerName: string | null }) => void;
  onShipOverride: (v: { open: boolean; orderId: number | null; obdNumber: string | null; currentOverride: string | null }) => void;
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
          {!isHistoryView && groupSelectableIds.length > 0 && (
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
          onToggleOne={onToggleOne}
          onSetEdit={onSetEdit}
          onDsChange={onDsChange}
          onSetDetail={onSetDetail}
          onSetPopover={onSetPopover}
          onMissing={onMissing}
          onShipOverride={onShipOverride}
        />
      ))}
    </>
  );
}

// ── OrderRow ──────────────────────────────────────────────────────────────────

function OrderRow({
  order, selected, detailOrder, localEdits, changedIds, rowLoading, slots,
  openPopover, isHistoryView,
  onToggleOne, onSetEdit, onDsChange, onSetDetail, onSetPopover, onMissing, onShipOverride,
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
  onToggleOne: (id: number) => void;
  onSetEdit: (id: number, field: "ds" | "pri" | "slot", value: string) => void;
  onDsChange: (order: SupportOrder, value: string) => void;
  onSetDetail: (order: SupportOrder | null) => void;
  onSetPopover: (v: PopoverState) => void;
  onMissing: (v: { open: boolean; shipToCustomerId: string | null; shipToCustomerName: string | null }) => void;
  onShipOverride: (v: { open: boolean; orderId: number | null; obdNumber: string | null; currentOverride: string | null }) => void;
}) {
  const rt = getRowType(order);
  const isPhysicallyDispatched = rt === "physically_dispatched";
  const isTinting = rt === "tinting";
  const isResolved = rt === "resolved";
  const isNonInteractive = isPhysicallyDispatched || isTinting;

  const isChanged = changedIds.has(order.id);
  const isDetailActive = detailOrder?.id === order.id;
  const isRowBusy = rowLoading.has(order.id);
  const age = getAgePill(order);
  const delType = order.customer?.dispatchDeliveryType?.name ?? order.customer?.area?.deliveryType?.name ?? null;

  const editDs   = localEdits.get(order.id)?.ds;
  const editPri  = localEdits.get(order.id)?.pri;
  const editSlot = localEdits.get(order.id)?.slot;
  const currentDs   = editDs ?? order.dispatchStatus ?? "";
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
        "px-1 border-b border-gray-50/80 transition-colors cursor-pointer",
        isPhysicallyDispatched ? "opacity-[0.35] py-1.5" : isResolved ? "py-1.5" : "py-2",
        isChanged && !isNonInteractive && "bg-indigo-50/20",
        isDetailActive && "bg-indigo-50 border-l-[3px] border-l-indigo-500",
        !isNonInteractive && !isChanged && !isDetailActive && "hover:bg-gray-50/50",
      )}
      onClick={handleRowClick}
    >
      {/* Checkbox */}
      <div data-checkbox>
        {isNonInteractive || isHistoryView ? (
          <div className="w-4" />
        ) : (
          <Checkbox checked={selected.has(order.id)} onCheckedChange={() => onToggleOne(order.id)} />
        )}
      </div>

      {/* OBD / Date */}
      <div>
        <div className="flex items-center gap-1 flex-wrap">
          <p className={cn("font-mono font-semibold text-xs tabular-nums", isResolved ? "text-gray-500" : "text-gray-800")}>
            {order.obdNumber}
          </p>
          <CarriedOverBadge daysOverdue={order.daysOverdue ?? 0} />
        </div>
        <p className={cn("text-[10px]", isResolved ? "text-gray-300" : "text-gray-400")}>
          {formatDate(order.obdEmailDate)}
        </p>
      </div>

      {/* Customer */}
      <div>
        <div className="flex items-center gap-1 min-w-0">
          <p className={cn("text-xs font-medium truncate", isResolved ? "text-gray-500" : "text-gray-700")}>
            {order.customer?.customerName ?? order.shipToCustomerName ?? "—"}
          </p>
          {order.customerMissing && !isPhysicallyDispatched && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMissing({ open: true, shipToCustomerId: order.shipToCustomerId, shipToCustomerName: order.shipToCustomerName }); }}
              className="text-[9px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded transition-colors flex-shrink-0"
            >
              ⚠ Missing
            </button>
          )}
          {order.querySnapshot?.hasTinting && !isPhysicallyDispatched && (
            <span className="text-[10px] text-purple-500 flex-shrink-0">🎨</span>
          )}
        </div>
        <p className={cn("text-[10px]", isResolved ? "text-gray-300" : "text-gray-400")}>
          {order.shipToCustomerId}
        </p>
      </div>

      {/* Route / Type — plain text */}
      <div>
        <p className={cn("text-xs", isResolved ? "text-gray-400" : "text-gray-600")}>
          {order.customer?.area?.primaryRoute?.name ?? "—"}
        </p>
        {delType && (
          <span className={cn("text-[10px]", isResolved ? "text-gray-300" : "text-gray-400")}>
            {delType}
          </span>
        )}
      </div>

      {/* Vol */}
      <div className="text-right pr-1">
        <span className={cn("font-mono font-semibold text-xs tabular-nums", isResolved ? "text-gray-400" : "text-gray-700")}>
          {order.importVolume != null ? Math.round(order.importVolume) : "—"}
        </span>
      </div>

      {/* Age */}
      <div className="text-center">
        {isPhysicallyDispatched ? (
          <span className="text-[10px] text-gray-300">—</span>
        ) : (
          <span className={cn("text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full inline-block", age.cls, age.pulse && "animate-pulse")}>
            {age.label}
          </span>
        )}
      </div>

      {/* ── Dispatch badge ─────────────────────────────────────────────── */}
      <div className="relative" data-popover>
        {isRowBusy ? (
          <Loader2 size={14} className="animate-spin text-gray-400" />
        ) : isPhysicallyDispatched ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-600 cursor-default">
            <span className="w-[5px] h-[5px] rounded-full inline-block bg-emerald-500" />
            Dispatched
          </span>
        ) : isTinting ? (
          <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase px-2.5 py-1 rounded-[5px] border bg-purple-100 text-purple-700 border-purple-200">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            TINTING
          </span>
        ) : isHistoryView ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-0.5 rounded-full border cursor-default",
              currentDs === "dispatch" ? "bg-emerald-50 border-emerald-200 text-emerald-600" :
              currentDs === "hold"     ? "bg-amber-50 border-amber-200 text-amber-600" :
                                         "bg-gray-100 border-gray-200 text-gray-400",
            )}
          >
            <span className={cn(
              "w-[5px] h-[5px] rounded-full inline-block",
              currentDs === "dispatch" ? "bg-emerald-500" :
              currentDs === "hold"     ? "bg-amber-500" :
                                         "bg-gray-300",
            )} />
            {currentDs === "dispatch" ? "Dispatch" : currentDs === "hold" ? "Hold" : "—"}
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
                className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1 z-30 min-w-[100px]"
                onClick={(e) => e.stopPropagation()}
              >
                {currentDs && (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50"
                    onClick={() => { onDsChange(order, ""); onSetPopover(null); }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300" /> Unset
                  </div>
                )}
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50"
                  onClick={() => { onDsChange(order, "dispatch"); onSetPopover(null); }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Dispatch
                </div>
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-700 rounded cursor-pointer hover:bg-gray-50"
                  onClick={() => { onDsChange(order, "hold"); onSetPopover(null); }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Hold
                </div>
                {!isResolved && (
                  <>
                    <div className="border-t border-gray-100 my-1" />
                    <div
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-500 rounded cursor-pointer hover:bg-red-50"
                      onClick={() => { onDsChange(order, "cancel"); onSetPopover(null); }}
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

      {/* ── Priority badge ─────────────────────────────────────────────── */}
      <div className="relative" data-popover>
        {isPhysicallyDispatched || isTinting ? (
          <span className="text-[10px] text-gray-300">—</span>
        ) : isResolved && (currentPri === "3" || currentPri === "0" || Number(currentPri) >= 3) ? (
          <span className="text-[10px] text-gray-400">FIFO</span>
        ) : isHistoryView ? (
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

      {/* ── Slot ───────────────────────────────────────────────────────── */}
      <div>
        {isPhysicallyDispatched || isTinting ? (
          <span className="text-[10px] text-gray-300">—</span>
        ) : isResolved || isHistoryView ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400">{order.slot?.name ?? "—"}</span>
            {hasCascade && (
              <span className="text-[10px] text-gray-300 ml-0.5">↻ {abbreviateSlotName(order.originalSlot!.name)}</span>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            <select
              value={currentSlot}
              onChange={(e) => { e.stopPropagation(); onSetEdit(order.id, "slot", e.target.value); }}
              onClick={(e) => e.stopPropagation()}
              className={PILL_SLOT_CLS}
            >
              <option value="">—</option>
              {slots.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
            {hasCascade && (
              <div className="text-[10px] text-gray-400 mt-px leading-none">↻ {order.originalSlot!.name}</div>
            )}
          </div>
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
