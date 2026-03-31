"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  ChevronDown,
  Search,
  Download,
  X,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { CustomerMissingSheet } from "@/components/shared/customer-missing-sheet";
import { CancelOrderDialog } from "@/components/support/cancel-order-dialog";
import { ShipToOverrideModal } from "@/components/support/ship-to-override-modal";
import type { SlotNavItem } from "@/components/support/support-page-content";

// ── Types ────────────────────────────────────────────────────────────────────

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
  priorityLevel: number;
  querySnapshot: {
    hasTinting: boolean;
    totalUnitQty: number;
    articleTag: string | null;
  } | null;
  splits: { id: number; status: string; dispatchStatus: string | null }[];
  createdAt: string;
  updatedAt: string;
}

interface SupportOrdersTableProps {
  orders: SupportOrder[];
  section: string;
  mainTab: "overdue" | "today" | "hold";
  slotName?: string;
  cutoffTime?: string;
  slotColor?: string;
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
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type RowStatus = "tinting" | "dispatched" | "hold" | "pending";

function getRowStatus(order: SupportOrder): RowStatus {
  if (["tinting_in_progress", "tint_assigned"].includes(order.workflowStage))
    return "tinting";
  if (order.dispatchStatus === "dispatch") return "dispatched";
  if (order.dispatchStatus === "hold") return "hold";
  return "pending";
}

function getAgePill(order: SupportOrder, isOverdue: boolean) {
  const ref = order.obdEmailDate ?? order.createdAt;
  if (!ref) return { label: "—", cls: "bg-gray-100 text-[#8e91a7]", pulse: false };
  const diffMs = Date.now() - new Date(ref).getTime();
  const hours = diffMs / 3600000;
  if (isOverdue || hours >= 24) {
    const days = Math.floor(hours / 24);
    return {
      label: days >= 1 ? `${days}d` : `${Math.floor(hours)}h`,
      cls: "bg-red-100 text-red-700",
      pulse: isOverdue,
    };
  }
  if (hours >= 1) {
    return { label: `${Math.floor(hours)}h`, cls: "bg-amber-100 text-amber-700", pulse: false };
  }
  return { label: `${Math.floor(hours * 60)}m`, cls: "bg-green-100 text-green-700", pulse: false };
}

function getSmuGroup(order: SupportOrder): string {
  return order.smu || "Unknown SMU";
}

type GroupBy = "smu" | "route" | "type" | "customer" | "none";

interface OrderGroup {
  groupName: string;
  orders: SupportOrder[];
}

function groupOrders(orders: SupportOrder[], groupBy: GroupBy): OrderGroup[] {
  if (groupBy === "none") return [{ groupName: "All Orders", orders }];

  const map = new Map<string, SupportOrder[]>();
  for (const o of orders) {
    let key: string;
    switch (groupBy) {
      case "smu":
        key = getSmuGroup(o);
        break;
      case "route":
        key = o.customer?.area?.primaryRoute?.name ?? "Unassigned";
        break;
      case "type":
        key =
          o.customer?.dispatchDeliveryType?.name ??
          o.customer?.area?.deliveryType?.name ??
          "Unknown";
        break;
      case "customer":
        key = o.customer?.customerName ?? o.shipToCustomerName ?? "Unknown";
        break;
    }
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(o);
  }

  return Array.from(map.entries()).map(([groupName, orders]) => ({
    groupName,
    orders,
  }));
}

function getDelTypePill(name: string | null | undefined) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes("local"))
    return { label: "Local", cls: "bg-green-100 text-green-700 border-green-200" };
  if (lower.includes("upcountry"))
    return { label: "Upcountry", cls: "bg-indigo-100 text-indigo-700 border-indigo-200" };
  return { label: name, cls: "bg-gray-100 text-[#5a5d74] border-gray-200" };
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

// ── Editable Select Styles ───────────────────────────────────────────────────

const SEL_BASE =
  "h-[30px] rounded-md border text-[11px] font-semibold px-2 pr-6 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#6366f1] transition-colors";

const SEL_CHEVRON =
  "bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%238e91a7%22%20stroke-width%3D%222.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_6px_center] bg-no-repeat";

function dsSelectCls(val: string): string {
  if (val === "dispatch")
    return `${SEL_BASE} ${SEL_CHEVRON} bg-green-50 text-green-700 border-green-300`;
  if (val === "hold")
    return `${SEL_BASE} ${SEL_CHEVRON} bg-red-50 text-red-700 border-red-300`;
  if (val === "cancel")
    return `${SEL_BASE} ${SEL_CHEVRON} bg-gray-100 text-[#5a5d74] border-gray-300`;
  return `${SEL_BASE} ${SEL_CHEVRON} bg-white text-[#5a5d74] border-[#ededf3]`;
}

function priSelectCls(val: string): string {
  if (val === "1")
    return `${SEL_BASE} ${SEL_CHEVRON} bg-red-50 text-red-700 border-red-300`;
  if (val === "2")
    return `${SEL_BASE} ${SEL_CHEVRON} bg-amber-50 text-amber-700 border-amber-300`;
  return `${SEL_BASE} ${SEL_CHEVRON} bg-white text-[#5a5d74] border-[#ededf3]`;
}

function slotSelectCls(val: string): string {
  if (val)
    return `${SEL_BASE} ${SEL_CHEVRON} text-[#6366f1] border-[#6366f1] bg-white`;
  return `${SEL_BASE} ${SEL_CHEVRON} bg-white text-[#5a5d74] border-[#ededf3]`;
}

// ── Status Tags ──────────────────────────────────────────────────────────────

function StatusTag({ status }: { status: "dispatched" | "tinting" | "held" }) {
  const cfg = {
    dispatched: { label: "DISPATCHED", dot: "bg-green-500", cls: "bg-green-100 text-green-700 border-green-200" },
    tinting: { label: "TINTING", dot: "bg-purple-500", cls: "bg-purple-100 text-purple-700 border-purple-200" },
    held: { label: "HELD", dot: "bg-amber-500", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  }[status];

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[9px] font-bold uppercase px-2.5 py-1 rounded-[5px] border", cfg.cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ── Column header styles ─────────────────────────────────────────────────────

const TH =
  "text-[10px] font-bold uppercase tracking-[.5px] py-2.5 px-3 text-left whitespace-nowrap";
const TH_EDITABLE = `${TH} text-[#6366f1]`;
const TH_NORMAL = `${TH} text-[#8e91a7]`;

// ── Component ────────────────────────────────────────────────────────────────

export function SupportOrdersTable({
  orders,
  section,
  mainTab,
  slotName,
  cutoffTime,
  slotColor,
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
}: SupportOrdersTableProps) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rowLoading, setRowLoading] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [cancelDialog, setCancelDialog] = useState<{
    open: boolean;
    orderId: number | null;
    obdNumber: string | null;
  }>({ open: false, orderId: null, obdNumber: null });
  const [missingSheet, setMissingSheet] = useState<{
    open: boolean;
    shipToCustomerId: string | null;
    shipToCustomerName: string | null;
  }>({ open: false, shipToCustomerId: null, shipToCustomerName: null });

  const [shipOverride, setShipOverride] = useState<{
    open: boolean;
    orderId: number | null;
    obdNumber: string | null;
    currentOverride: string | null;
  }>({ open: false, orderId: null, obdNumber: null, currentOverride: null });

  const [groupBy, setGroupBy] = useState<GroupBy>("smu");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [detailOrder, setDetailOrder] = useState<SupportOrder | null>(null);
  const [holdSubTab, setHoldSubTab] = useState<"all" | "today" | "1-2d" | "3d+">("all");
  const [overdueSubTab, setOverdueSubTab] = useState<"all" | "yesterday" | "2d+">("all");
  const [localEdits, setLocalEdits] = useState<
    Map<number, { ds?: string; pri?: string; slot?: string }>
  >(new Map());

  const cardRef = useRef<HTMLDivElement>(null);

  // Derived
  const changedIds = useMemo(() => {
    const s = new Set<number>();
    localEdits.forEach((_, k) => s.add(k));
    return s;
  }, [localEdits]);

  // Clear state on section change
  useEffect(() => {
    setSelected(new Set());
    setSearch("");
    setLocalEdits(new Map());
    setDetailOrder(null);
    setCollapsedGroups(new Set());
  }, [section]);

  // ── Filtered orders ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = orders;

    // Hold sub-tab filtering by hold duration
    if (mainTab === "hold" && holdSubTab !== "all") {
      const now = Date.now();
      list = list.filter((o) => {
        const holdHours = (now - new Date(o.updatedAt).getTime()) / 3600000;
        if (holdSubTab === "today") return holdHours < 24;
        if (holdSubTab === "1-2d") return holdHours >= 24 && holdHours < 72;
        return holdHours >= 72; // 3d+
      });
    }

    // Overdue sub-tab filtering by OBD date
    if (mainTab === "overdue" && overdueSubTab !== "all") {
      const today = new Date(date);
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      list = list.filter((o) => {
        if (!o.obdEmailDate) return overdueSubTab === "2d+";
        const obdDate = new Date(o.obdEmailDate);
        obdDate.setHours(0, 0, 0, 0);
        const daysDiff = Math.floor((today.getTime() - obdDate.getTime()) / 86400000);
        if (overdueSubTab === "yesterday") return daysDiff === 1;
        return daysDiff >= 2; // 2d+
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (o) =>
          o.obdNumber.toLowerCase().includes(q) ||
          (o.shipToCustomerName ?? "").toLowerCase().includes(q) ||
          (o.customer?.customerName ?? "").toLowerCase().includes(q) ||
          (o.customer?.area?.primaryRoute?.name ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [orders, search, mainTab, holdSubTab, overdueSubTab, date]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let pending = 0,
      done = 0,
      tinting = 0;
    for (const o of filtered) {
      const rs = getRowStatus(o);
      if (rs === "dispatched") done++;
      else if (rs === "tinting") tinting++;
      else pending++;
    }
    return { pending, done, tinting };
  }, [filtered]);

  // ── Grouping ───────────────────────────────────────────────────────────────
  const groups = useMemo(
    () => groupOrders(filtered, mainTab === "overdue" ? "none" : groupBy),
    [filtered, groupBy, mainTab],
  );

  // ── Selectable IDs (pending + hold only) ───────────────────────────────────
  const selectableIds = useMemo(
    () =>
      filtered
        .filter((o) => {
          const rs = getRowStatus(o);
          return rs !== "tinting" && rs !== "dispatched";
        })
        .map((o) => o.id),
    [filtered],
  );

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableIds));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(name: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // ── Local edit helpers ─────────────────────────────────────────────────────
  function setEdit(orderId: number, field: "ds" | "pri" | "slot", value: string) {
    setLocalEdits((prev) => {
      const next = new Map(prev);
      const existing = next.get(orderId) ?? {};
      next.set(orderId, { ...existing, [field]: value });
      return next;
    });
  }

  // ── Action wrappers ────────────────────────────────────────────────────────
  const withRowLoading = useCallback(
    async (orderId: number, fn: () => Promise<void>) => {
      setRowLoading((prev) => new Set(prev).add(orderId));
      try {
        await fn();
      } finally {
        setRowLoading((prev) => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
        setLocalEdits((prev) => {
          const next = new Map(prev);
          next.delete(orderId);
          return next;
        });
      }
    },
    [],
  );

  // ── Submit Selected ────────────────────────────────────────────────────────
  async function handleSubmitSelected() {
    setBulkLoading(true);
    try {
      const dispatchIds: number[] = [];
      const holdIds: number[] = [];
      const slotChanges: { orderId: number; slotId: number }[] = [];

      // Collect from localEdits (changed dropdowns)
      Array.from(localEdits.entries()).forEach(([orderId, edits]) => {
        if (edits.ds === "dispatch") dispatchIds.push(orderId);
        else if (edits.ds === "hold") holdIds.push(orderId);
        if (edits.slot) slotChanges.push({ orderId, slotId: parseInt(edits.slot, 10) });
      });

      // Collect checked rows with no explicit edit — default to dispatch
      Array.from(selected).forEach((id) => {
        if (!localEdits.has(id)) {
          dispatchIds.push(id);
        }
      });

      // Apply slot changes first (before dispatch/hold status changes)
      for (const { orderId, slotId } of slotChanges) {
        await onAssignSlot(orderId, slotId);
      }

      if (dispatchIds.length > 0) await onBulkDispatch(dispatchIds);
      if (holdIds.length > 0) await onBulkHold(holdIds);

      setSelected(new Set());
      setLocalEdits(new Map());
    } finally {
      setBulkLoading(false);
    }
  }

  // ── Bulk bar actions ───────────────────────────────────────────────────────
  async function handleBulkSetDispatch() {
    setBulkLoading(true);
    try {
      await onBulkDispatch(Array.from(selected));
      setSelected(new Set());
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkSetHold() {
    setBulkLoading(true);
    try {
      await onBulkHold(Array.from(selected));
      setSelected(new Set());
    } finally {
      setBulkLoading(false);
    }
  }

  // ── Dispatch status dropdown change ────────────────────────────────────────
  function handleDsChange(order: SupportOrder, value: string) {
    if (value === "cancel") {
      setCancelDialog({ open: true, orderId: order.id, obdNumber: order.obdNumber });
      return;
    }
    setEdit(order.id, "ds", value);
  }

  // ── Hold tab rendering ─────────────────────────────────────────────────────
  const isHold = mainTab === "hold";
  const isOverdue = mainTab === "overdue";

  // ── Group count text ───────────────────────────────────────────────────────
  function groupCountText(groupOrders: SupportOrder[]): string {
    let pending = 0, dispatched = 0, tinting = 0;
    for (const o of groupOrders) {
      const rs = getRowStatus(o);
      if (rs === "dispatched") dispatched++;
      else if (rs === "tinting") tinting++;
      else pending++;
    }
    const parts: string[] = [];
    if (pending > 0) parts.push(`${pending} pending`);
    if (dispatched > 0) parts.push(`${dispatched} dispatched`);
    if (tinting > 0) parts.push(`${tinting} tinting`);
    return parts.join(" · ");
  }

  // ── Export CSV ─────────────────────────────────────────────────────────────
  function handleExport() {
    const header = "OBD,Customer,Route,Qty,Status,Priority\n";
    const rows = filtered
      .map((o) => {
        const cust = o.customer?.customerName ?? o.shipToCustomerName ?? "";
        const route = o.customer?.area?.primaryRoute?.name ?? "";
        const qty = o.querySnapshot?.totalUnitQty ?? "";
        const status = getRowStatus(o);
        const pri = o.priorityLevel <= 1 ? "Urgent" : o.priorityLevel === 2 ? "High" : "FIFO";
        return `${o.obdNumber},"${cust}","${route}",${qty},${status},${pri}`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `support-orders-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Bulk release (hold tab) ──────────────────────────────────────────────
  async function handleBulkRelease() {
    setBulkLoading(true);
    try {
      for (const id of Array.from(selected)) {
        await onRelease(id);
      }
      setSelected(new Set());
    } finally {
      setBulkLoading(false);
    }
  }

  // ── Render: Hold Tab ───────────────────────────────────────────────────────
  if (isHold) {
    const holdSubTabs: { key: typeof holdSubTab; label: string }[] = [
      { key: "all", label: "All" },
      { key: "today", label: "Today" },
      { key: "1-2d", label: "1-2 Days" },
      { key: "3d+", label: "3+ Days" },
    ];

    return (
      <div className="flex flex-col h-full p-4 gap-4">
        {/* Sub-tabs */}
        <div className="flex items-end gap-0 border-b border-[#ededf3]">
          {holdSubTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setHoldSubTab(tab.key)}
              className={cn(
                "px-4 py-2 text-[12px] font-semibold border-b-[2.5px] -mb-px transition-colors",
                holdSubTab === tab.key
                  ? "text-amber-700 border-amber-500"
                  : "text-[#5a5d74] border-transparent hover:text-[#1c1e30]",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleBulkRelease}
            disabled={selected.size === 0 || bulkLoading}
            className="h-9 px-4 text-[12px] font-bold text-white bg-[#6366f1] rounded-lg disabled:opacity-40 flex items-center gap-2 transition-colors hover:bg-[#5558e6]"
          >
            {bulkLoading && <Loader2 size={13} className="animate-spin" />}
            Release Selected
          </button>
          <button
            type="button"
            onClick={toggleAll}
            className="h-9 px-4 text-[12px] font-semibold text-[#5a5d74] border border-[#ededf3] rounded-lg hover:bg-gray-50 transition-colors"
          >
            {allSelected ? "Deselect All" : "Select All"}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8e91a7]" />
              <input
                type="text"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-[200px] pl-8 pr-3 text-[11.5px] border border-[#ededf3] rounded-lg bg-white placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Table card */}
        <div className="bg-white rounded-xl border border-[#ededf3] overflow-hidden flex-1 flex flex-col">
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-[#8e91a7]" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState message="No orders on hold" />
            ) : (
              <table className="w-full border-collapse min-w-[900px]">
                <thead className="bg-[#f8f9fc] sticky top-0 z-10">
                  <tr>
                    <th className={cn(TH_NORMAL, "w-9")}><Checkbox checked={allSelected} onCheckedChange={() => toggleAll()} /></th>
                    <th className={TH_NORMAL}>OBD / Date</th>
                    <th className={TH_NORMAL}>Customer</th>
                    <th className={TH_NORMAL}>Route / Type</th>
                    <th className={cn(TH_NORMAL, "text-center")}>Qty</th>
                    <th className={TH_NORMAL}>Original Slot</th>
                    <th className={cn(TH_NORMAL, "text-center")}>On Hold</th>
                    <th className={TH_NORMAL}>Reason</th>
                    <th className={cn(TH_NORMAL, "text-center")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((order) => {
                    const isRowBusy = rowLoading.has(order.id);
                    const delType =
                      order.customer?.dispatchDeliveryType?.name ??
                      order.customer?.area?.deliveryType?.name ??
                      null;
                    const dtPill = getDelTypePill(delType);
                    const holdAge = getAgePill(order, false);

                    return (
                      <tr
                        key={order.id}
                        className="h-14 border-b border-[#ededf3] hover:bg-[#f8f9ff] transition-colors"
                      >
                        <td className="px-3"><Checkbox checked={selected.has(order.id)} onCheckedChange={() => toggleOne(order.id)} /></td>
                        <td className="px-3">
                          <p className="font-mono font-semibold text-[12px] text-[#312e81]">{order.obdNumber}</p>
                          <p className="font-mono text-[10.5px] text-[#8e91a7]">{formatDate(order.obdEmailDate)}</p>
                        </td>
                        <td className="px-3">
                          <p className="text-[12px] font-semibold text-[#1c1e30] truncate max-w-[160px]">
                            {order.customer?.customerName ?? order.shipToCustomerName ?? "—"}
                          </p>
                          <p className="font-mono text-[10.5px] text-[#c2c4d6]">SH-{order.shipToCustomerId}</p>
                        </td>
                        <td className="px-3">
                          <p className="text-[11.5px] text-[#1c1e30]">{order.customer?.area?.primaryRoute?.name ?? "—"}</p>
                          {dtPill && (
                            <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded border mt-0.5 inline-block", dtPill.cls)}>
                              {dtPill.label}
                            </span>
                          )}
                        </td>
                        <td className="px-3 text-center">
                          <span className="font-mono font-semibold text-[12px] text-[#1c1e30]">
                            {order.querySnapshot?.totalUnitQty ?? "—"}
                          </span>
                        </td>
                        <td className="px-3 text-[11.5px] text-[#5a5d74]">{order.slot?.name ?? "—"}</td>
                        <td className="px-3 text-center">
                          <span className={cn("text-[10px] font-mono font-bold px-2 py-0.5 rounded-full", holdAge.cls)}>
                            {holdAge.label}
                          </span>
                        </td>
                        <td className="px-3 text-[11px] italic text-[#8e91a7] max-w-[140px] truncate">—</td>
                        <td className="px-3 text-center">
                          {isRowBusy ? (
                            <Loader2 size={15} className="animate-spin text-[#8e91a7] mx-auto" />
                          ) : (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void withRowLoading(order.id, () => onRelease(order.id))}
                                className="text-[11px] font-semibold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 px-2.5 py-1 rounded-md transition-colors"
                              >
                                Release
                              </button>
                              <button
                                type="button"
                                onClick={() => setCancelDialog({ open: true, orderId: order.id, obdNumber: order.obdNumber })}
                                className="text-[11px] text-[#8e91a7] hover:text-red-500 hover:bg-red-50 border border-[#ededf3] px-1.5 py-1 rounded-md transition-colors"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

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
          onResolved={() => {
            setMissingSheet({ open: false, shipToCustomerId: null, shipToCustomerName: null });
            onOrdersChanged();
          }}
        />
      </div>
    );
  }

  // ── Render: Today + Overdue Tabs ───────────────────────────────────────────
  const hasSubmittable = selected.size > 0 || changedIds.size > 0;

  const overdueSubTabs: { key: typeof overdueSubTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "yesterday", label: "Yesterday" },
    { key: "2d+", label: "2+ Days" },
  ];

  return (
    <div className="flex flex-col h-full p-4 gap-4 relative">
      {/* ── Overdue Sub-tabs ───────────────────────────────────────────── */}
      {isOverdue && (
        <div className="flex items-end gap-0 border-b border-[#ededf3]">
          {overdueSubTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setOverdueSubTab(tab.key)}
              className={cn(
                "px-4 py-2 text-[12px] font-semibold border-b-[2.5px] -mb-px transition-colors",
                overdueSubTab === tab.key
                  ? "text-red-700 border-red-500"
                  : "text-[#5a5d74] border-transparent hover:text-[#1c1e30]",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Action Bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Submit Selected */}
        <button
          type="button"
          onClick={handleSubmitSelected}
          disabled={!hasSubmittable || bulkLoading}
          className="relative h-9 px-4 text-[12px] font-bold text-white bg-[#6366f1] rounded-lg disabled:opacity-40 flex items-center gap-2 transition-colors hover:bg-[#5558e6]"
        >
          {bulkLoading && <Loader2 size={13} className="animate-spin" />}
          Submit Selected
          {changedIds.size > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {changedIds.size}
            </span>
          )}
        </button>

        {/* Select All */}
        <button
          type="button"
          onClick={toggleAll}
          className="h-9 px-4 text-[12px] font-semibold text-[#5a5d74] border border-[#ededf3] rounded-lg hover:bg-gray-50 transition-colors"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>

        {/* Separator */}
        <div className="w-px h-6 bg-[#ededf3]" />

        {/* Stat pills */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-[#5a5d74]">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            {stats.pending} pending
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-[#5a5d74]">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {stats.done} done
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-[#5a5d74]">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            {stats.tinting} tinting
          </span>
        </div>

        <div className="flex-1" />

        {/* Group by (not for overdue) */}
        {!isOverdue && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] text-[#8e91a7] font-semibold">Group by</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="h-8 px-2 text-[11px] border border-[#ededf3] rounded-lg bg-white text-[#5a5d74] focus:outline-none focus:border-[#6366f1]"
            >
              <option value="smu">SMU</option>
              <option value="route">Route</option>
              <option value="type">Del. Type</option>
              <option value="customer">Customer</option>
              <option value="none">None</option>
            </select>
          </div>
        )}

        {/* Separator */}
        <div className="w-px h-6 bg-[#ededf3]" />

        {/* Export */}
        <button
          type="button"
          onClick={handleExport}
          className="h-8 px-3 text-[11.5px] font-semibold text-[#5a5d74] border border-[#ededf3] rounded-lg hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
        >
          <Download size={13} />
          Export
        </button>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8e91a7]" />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-[200px] pl-8 pr-3 text-[11.5px] border border-[#ededf3] rounded-lg bg-white placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none"
          />
        </div>
      </div>

      {/* ── Table Card ──────────────────────────────────────────────────── */}
      <div
        ref={cardRef}
        className="bg-white rounded-xl border border-[#ededf3] overflow-hidden flex-1 flex flex-col relative"
      >
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-[#8e91a7]" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState message="No orders" />
          ) : (
            <table className="w-full border-collapse min-w-[1100px]">
              <thead className="bg-[#f8f9fc] sticky top-0 z-10">
                <tr>
                  <th className={cn(TH_NORMAL, "w-9")}>
                    <Checkbox checked={allSelected} onCheckedChange={() => toggleAll()} />
                  </th>
                  <th className={TH_NORMAL}>OBD / Date</th>
                  <th className={TH_NORMAL}>Customer</th>
                  <th className={TH_NORMAL}>Route / Type</th>
                  <th className={cn(TH_NORMAL, "text-center w-[80px]")}>Qty</th>
                  <th className={cn(TH_NORMAL, "text-center w-[60px]")}>Age</th>
                  <th className={cn(TH_EDITABLE, "w-[120px]")}>Dispatch ★</th>
                  <th className={cn(TH_EDITABLE, "w-[100px]")}>Priority ★</th>
                  <th className={cn(TH_EDITABLE, "w-[140px]")}>Ship Override ★</th>
                  <th className={cn(TH_EDITABLE, "w-[100px]")}>Slot ★</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const isCollapsed = collapsedGroups.has(group.groupName);
                  const showGroupHeader = groupBy !== "none" && !isOverdue;

                  return (
                    <GroupRows
                      key={group.groupName}
                      group={group}
                      isCollapsed={isCollapsed}
                      showGroupHeader={showGroupHeader}
                      onToggleGroup={() => toggleGroup(group.groupName)}
                      countText={groupCountText(group.orders)}
                      // Row rendering props
                      selected={selected}
                      detailOrder={detailOrder}
                      localEdits={localEdits}
                      changedIds={changedIds}
                      rowLoading={rowLoading}
                      isOverdue={isOverdue}
                      slots={slots}
                      onToggleOne={toggleOne}
                      onSetEdit={setEdit}
                      onDsChange={handleDsChange}
                      onSetDetail={setDetailOrder}
                      onMissing={setMissingSheet}
                      onShipOverride={setShipOverride}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Floating Bulk Bar ────────────────────────────────────────── */}
        <div
          className={cn(
            "absolute bottom-4 left-1/2 -translate-x-1/2 z-20 transition-all duration-200",
            selected.size >= 2
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-4 pointer-events-none",
          )}
        >
          <div className="flex items-center gap-3 bg-[#1c1e30] text-white rounded-xl px-5 py-3 shadow-lg">
            <span className="text-[12px] font-bold">
              {selected.size} Selected
            </span>
            <div className="w-px h-5 bg-white/20" />
            <button
              type="button"
              onClick={handleBulkSetDispatch}
              disabled={bulkLoading}
              className="text-[11px] font-semibold bg-[#6366f1] hover:bg-[#5558e6] px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
            >
              Set: Dispatch
            </button>
            <button
              type="button"
              onClick={handleBulkSetHold}
              disabled={bulkLoading}
              className="text-[11px] font-semibold bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
            >
              Set: Hold
            </button>
            <button
              type="button"
              onClick={() => {
                // Bulk cancel: open cancel dialog for first selected
                const firstId = Array.from(selected)[0];
                const order = filtered.find((o) => o.id === firstId);
                if (order) setCancelDialog({ open: true, orderId: order.id, obdNumber: order.obdNumber });
              }}
              disabled={bulkLoading}
              className="text-[11px] font-semibold border border-red-400/50 text-red-300 hover:bg-red-500/20 px-3 py-1.5 rounded-md disabled:opacity-50 transition-colors"
            >
              Set: Cancel
            </button>
            <div className="w-px h-5 bg-white/20" />
            {/* Bulk Priority */}
            <select
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                Array.from(selected).forEach((id) => setEdit(id, "pri", val));
                e.target.value = "";
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-7 px-2 text-[11px] font-semibold bg-white/10 text-white border border-white/20 rounded-md appearance-none cursor-pointer focus:outline-none"
            >
              <option value="" className="text-[#1c1e30]">Priority…</option>
              <option value="1" className="text-[#1c1e30]">Urgent</option>
              <option value="2" className="text-[#1c1e30]">High</option>
              <option value="3" className="text-[#1c1e30]">FIFO</option>
            </select>
            {/* Bulk Slot */}
            <select
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                Array.from(selected).forEach((id) => setEdit(id, "slot", val));
                e.target.value = "";
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-7 px-2 text-[11px] font-semibold bg-white/10 text-white border border-white/20 rounded-md appearance-none cursor-pointer focus:outline-none"
            >
              <option value="" className="text-[#1c1e30]">Slot…</option>
              {slots.map((s) => (
                <option key={s.id} value={String(s.id)} className="text-[#1c1e30]">
                  {s.name}
                </option>
              ))}
            </select>
            <div className="w-px h-5 bg-white/20" />
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-white/60 hover:text-white transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Detail Panel ──────────────────────────────────────────────── */}
      {detailOrder && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-30"
            onClick={() => setDetailOrder(null)}
          />
          <div className="fixed right-0 top-0 h-full w-[380px] bg-white border-l border-[#ededf3] shadow-xl z-40 flex flex-col overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#ededf3]">
              <span className="font-mono text-[13px] font-bold text-white bg-[#6366f1] px-3 py-1 rounded-md">
                {detailOrder.obdNumber}
              </span>
              <button
                type="button"
                onClick={() => setDetailOrder(null)}
                className="text-[#8e91a7] hover:text-[#1c1e30] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Order Details */}
            <div className="px-5 py-4">
              <h3 className="text-[10px] font-bold uppercase tracking-[.5px] text-[#8e91a7] mb-3">
                Order Details
              </h3>
              <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-[12px]">
                <DetailRow label="Customer" value={detailOrder.customer?.customerName ?? detailOrder.shipToCustomerName ?? "—"} />
                <DetailRow label="Ship-To ID" value={`SH-${detailOrder.shipToCustomerId}`} mono />
                <DetailRow label="Route" value={detailOrder.customer?.area?.primaryRoute?.name ?? "—"} />
                <DetailRow
                  label="Del. Type"
                  value={
                    detailOrder.customer?.dispatchDeliveryType?.name ??
                    detailOrder.customer?.area?.deliveryType?.name ??
                    "—"
                  }
                />
                <DetailRow label="Area" value={detailOrder.customer?.area?.name ?? "—"} />
                <DetailRow label="Qty" value={String(detailOrder.querySnapshot?.totalUnitQty ?? "—")} mono />
                <DetailRow label="Workflow" value={detailOrder.workflowStage} />
                <DetailRow label="Dispatch" value={detailOrder.dispatchStatus ?? "—"} />
                <DetailRow label="SMU" value={getSmuGroup(detailOrder)} />
                <DetailRow label="Tinting" value={detailOrder.querySnapshot?.hasTinting ? "Yes" : "No"} />
                <DetailRow label="Slot" value={detailOrder.slot?.name ?? "—"} />
                <DetailRow
                  label="Priority"
                  value={
                    detailOrder.priorityLevel <= 1
                      ? "Urgent"
                      : detailOrder.priorityLevel === 2
                        ? "High"
                        : "FIFO"
                  }
                />
                <DetailRow label="Created" value={formatDate(detailOrder.createdAt)} mono />
                <DetailRow label="OBD Date" value={formatDate(detailOrder.obdEmailDate)} mono />
              </div>
            </div>

            {/* Line Items */}
            <div className="px-5 py-4 border-t border-[#ededf3]">
              <h3 className="text-[10px] font-bold uppercase tracking-[.5px] text-[#8e91a7] mb-3">
                Line Items
              </h3>
              <p className="text-[11.5px] text-[#8e91a7] italic">
                {detailOrder.splits.length} split{detailOrder.splits.length !== 1 ? "s" : ""} —
                detail view coming soon
              </p>
            </div>

            {/* Audit History */}
            <div className="px-5 py-4 border-t border-[#ededf3]">
              <h3 className="text-[10px] font-bold uppercase tracking-[.5px] text-[#8e91a7] mb-3">
                Audit History
              </h3>
              <p className="text-[11.5px] text-[#8e91a7] italic">Coming soon</p>
            </div>
          </div>
        </>
      )}

      {/* ── Cancel dialog ─────────────────────────────────────────────── */}
      <CancelOrderDialog
        open={cancelDialog.open}
        onOpenChange={(v) => setCancelDialog((p) => ({ ...p, open: v }))}
        orderId={cancelDialog.orderId}
        obdNumber={cancelDialog.obdNumber}
        onConfirm={onCancel}
      />

      {/* ── Ship-To Override Modal ────────────────────────────────────── */}
      <ShipToOverrideModal
        open={shipOverride.open}
        onOpenChange={(v) => setShipOverride((p) => ({ ...p, open: v }))}
        orderId={shipOverride.orderId}
        obdNumber={shipOverride.obdNumber}
        currentOverride={shipOverride.currentOverride}
        onSave={async (orderId, override) => {
          setEdit(orderId, "ds", localEdits.get(orderId)?.ds ?? "");
          setLocalEdits((prev) => {
            const next = new Map(prev);
            const existing = next.get(orderId) ?? {};
            next.set(orderId, { ...existing });
            return next;
          });
        }}
      />

      {/* ── Customer Missing Sheet ────────────────────────────────────── */}
      <CustomerMissingSheet
        open={missingSheet.open}
        onOpenChange={(v) => setMissingSheet((p) => ({ ...p, open: v }))}
        shipToCustomerId={missingSheet.shipToCustomerId}
        shipToCustomerName={missingSheet.shipToCustomerName}
        onResolved={() => {
          setMissingSheet({ open: false, shipToCustomerId: null, shipToCustomerName: null });
          onOrdersChanged();
        }}
      />
    </div>
  );
}

// ── GroupRows sub-component ──────────────────────────────────────────────────

function GroupRows({
  group,
  isCollapsed,
  showGroupHeader,
  onToggleGroup,
  countText,
  selected,
  detailOrder,
  localEdits,
  changedIds,
  rowLoading,
  isOverdue,
  slots,
  onToggleOne,
  onSetEdit,
  onDsChange,
  onSetDetail,
  onMissing,
  onShipOverride,
}: {
  group: OrderGroup;
  isCollapsed: boolean;
  showGroupHeader: boolean;
  onToggleGroup: () => void;
  countText: string;
  selected: Set<number>;
  detailOrder: SupportOrder | null;
  localEdits: Map<number, { ds?: string; pri?: string; slot?: string }>;
  changedIds: Set<number>;
  rowLoading: Set<number>;
  isOverdue: boolean;
  slots: SlotNavItem[];
  onToggleOne: (id: number) => void;
  onSetEdit: (id: number, field: "ds" | "pri" | "slot", value: string) => void;
  onDsChange: (order: SupportOrder, value: string) => void;
  onSetDetail: (order: SupportOrder | null) => void;
  onMissing: (v: { open: boolean; shipToCustomerId: string | null; shipToCustomerName: string | null }) => void;
  onShipOverride: (v: { open: boolean; orderId: number | null; obdNumber: string | null; currentOverride: string | null }) => void;
}) {
  return (
    <>
      {showGroupHeader && (
        <tr
          className="bg-[#f8f9fc] hover:bg-[#f0f1f8] cursor-pointer transition-colors"
          onClick={onToggleGroup}
        >
          <td colSpan={10} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ChevronDown
                size={14}
                className={cn(
                  "text-[#8e91a7] transition-transform",
                  isCollapsed && "-rotate-90",
                )}
              />
              <span className="text-[12px] font-bold text-[#1c1e30]">
                {group.groupName}
              </span>
              <span className="text-[11px] text-[#8e91a7]">{countText}</span>
            </div>
          </td>
        </tr>
      )}
      {!isCollapsed &&
        group.orders.map((order) => (
          <OrderRow
            key={order.id}
            order={order}
            selected={selected}
            detailOrder={detailOrder}
            localEdits={localEdits}
            changedIds={changedIds}
            rowLoading={rowLoading}
            isOverdue={isOverdue}
            slots={slots}
            onToggleOne={onToggleOne}
            onSetEdit={onSetEdit}
            onDsChange={onDsChange}
            onSetDetail={onSetDetail}
            onMissing={onMissing}
            onShipOverride={onShipOverride}
          />
        ))}
    </>
  );
}

// ── OrderRow sub-component ───────────────────────────────────────────────────

function OrderRow({
  order,
  selected,
  detailOrder,
  localEdits,
  changedIds,
  rowLoading,
  isOverdue,
  slots,
  onToggleOne,
  onSetEdit,
  onDsChange,
  onSetDetail,
  onMissing,
  onShipOverride,
}: {
  order: SupportOrder;
  selected: Set<number>;
  detailOrder: SupportOrder | null;
  localEdits: Map<number, { ds?: string; pri?: string; slot?: string }>;
  changedIds: Set<number>;
  rowLoading: Set<number>;
  isOverdue: boolean;
  slots: SlotNavItem[];
  onToggleOne: (id: number) => void;
  onSetEdit: (id: number, field: "ds" | "pri" | "slot", value: string) => void;
  onDsChange: (order: SupportOrder, value: string) => void;
  onSetDetail: (order: SupportOrder | null) => void;
  onMissing: (v: { open: boolean; shipToCustomerId: string | null; shipToCustomerName: string | null }) => void;
  onShipOverride: (v: { open: boolean; orderId: number | null; obdNumber: string | null; currentOverride: string | null }) => void;
}) {
  const rs = getRowStatus(order);
  const isDimmed = rs === "dispatched" || rs === "tinting";
  const isChanged = changedIds.has(order.id);
  const isDetailActive = detailOrder?.id === order.id;
  const isRowBusy = rowLoading.has(order.id);
  const age = getAgePill(order, isOverdue);

  const delType =
    order.customer?.dispatchDeliveryType?.name ??
    order.customer?.area?.deliveryType?.name ??
    null;
  const dtPill = getDelTypePill(delType);

  // Current edit values (fall back to order state)
  const editDs = localEdits.get(order.id)?.ds;
  const editPri = localEdits.get(order.id)?.pri;
  const editSlot = localEdits.get(order.id)?.slot;

  const currentDs = editDs ?? (rs === "dispatched" ? "dispatch" : rs === "hold" ? "hold" : "");
  const currentPri = editPri ?? String(order.priorityLevel);
  const currentSlot = editSlot ?? (order.slotId ? String(order.slotId) : "");

  function handleRowClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (
      target.closest("select") ||
      target.closest("button") ||
      target.closest("input") ||
      target.closest("[data-checkbox]")
    ) return;
    onSetDetail(order);
  }

  return (
    <tr
      className={cn(
        "h-14 border-b border-[#ededf3] transition-colors cursor-pointer",
        isDimmed && "opacity-[0.45]",
        isChanged && !isDimmed && "bg-[rgba(99,102,241,0.03)]",
        isDetailActive && "bg-[#eef2ff] border-l-[3px] border-l-[#6366f1]",
        !isDimmed && !isChanged && !isDetailActive && "hover:bg-[#f8f9ff]",
      )}
      onClick={handleRowClick}
    >
      {/* Checkbox */}
      <td className="px-3" data-checkbox>
        {!isDimmed ? (
          <Checkbox
            checked={selected.has(order.id)}
            onCheckedChange={() => onToggleOne(order.id)}
          />
        ) : (
          <div className="w-4" />
        )}
      </td>

      {/* OBD / Date */}
      <td className="px-3">
        <p className="font-mono font-semibold text-[12px] text-[#312e81]">
          {order.obdNumber}
        </p>
        <p className={cn("font-mono text-[10.5px]", isOverdue ? "text-red-500" : "text-[#8e91a7]")}>
          {formatDate(order.obdEmailDate)}
        </p>
      </td>

      {/* Customer */}
      <td className="px-3">
        <div className="flex items-center gap-1.5">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[#1c1e30] truncate max-w-[160px]">
              {order.customer?.customerName ?? order.shipToCustomerName ?? "—"}
            </p>
            <p className="font-mono text-[10.5px] text-[#c2c4d6]">SH-{order.shipToCustomerId}</p>
          </div>
          {order.customerMissing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMissing({
                  open: true,
                  shipToCustomerId: order.shipToCustomerId,
                  shipToCustomerName: order.shipToCustomerName,
                });
              }}
              className="text-[9px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded transition-colors flex-shrink-0"
            >
              ⚠ Missing
            </button>
          )}
        </div>
      </td>

      {/* Route / Type */}
      <td className="px-3">
        <p className="text-[11.5px] text-[#1c1e30]">
          {order.customer?.area?.primaryRoute?.name ?? "—"}
        </p>
        {dtPill && (
          <span
            className={cn(
              "text-[9px] font-semibold px-1.5 py-0.5 rounded border mt-0.5 inline-block",
              dtPill.cls,
            )}
          >
            {dtPill.label}
          </span>
        )}
      </td>

      {/* Qty */}
      <td className="px-3 text-center">
        <span className="font-mono font-semibold text-[12px] text-[#1c1e30]">
          {order.querySnapshot?.totalUnitQty ?? "—"}
        </span>
        {order.querySnapshot && (
          <span
            className={cn(
              "ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded",
              order.querySnapshot.hasTinting
                ? "bg-purple-100 text-purple-700"
                : "bg-gray-100 text-[#8e91a7]",
            )}
          >
            {order.querySnapshot.hasTinting ? "TINT" : "NON"}
          </span>
        )}
      </td>

      {/* Age */}
      <td className="px-3 text-center">
        <span
          className={cn(
            "text-[10px] font-mono font-bold px-2 py-0.5 rounded-full inline-block",
            age.cls,
            age.pulse && "animate-pulse",
          )}
        >
          {age.label}
        </span>
      </td>

      {/* Dispatch ★ */}
      <td className="px-3">
        {isRowBusy ? (
          <Loader2 size={14} className="animate-spin text-[#8e91a7]" />
        ) : rs === "dispatched" ? (
          <StatusTag status="dispatched" />
        ) : rs === "tinting" ? (
          <StatusTag status="tinting" />
        ) : (
          <select
            value={currentDs}
            onChange={(e) => onDsChange(order, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className={dsSelectCls(currentDs)}
          >
            <option value="">—</option>
            <option value="dispatch">Dispatch</option>
            <option value="hold">Hold</option>
            <option value="cancel">Cancel</option>
          </select>
        )}
      </td>

      {/* Priority ★ */}
      <td className="px-3">
        {isDimmed ? (
          <span className="text-[11px] text-[#c2c4d6]">—</span>
        ) : (
          <select
            value={currentPri}
            onChange={(e) => {
              e.stopPropagation();
              onSetEdit(order.id, "pri", e.target.value);
            }}
            onClick={(e) => e.stopPropagation()}
            className={priSelectCls(currentPri)}
          >
            <option value="3">FIFO</option>
            <option value="1">Urgent</option>
            <option value="2">High</option>
          </select>
        )}
      </td>

      {/* Ship Override ★ */}
      <td className="px-3">
        {isDimmed ? (
          <span className="text-[11px] text-[#c2c4d6]">—</span>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[#8e91a7]">—</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShipOverride({
                  open: true,
                  orderId: order.id,
                  obdNumber: order.obdNumber,
                  currentOverride: null,
                });
              }}
              className="text-[#8e91a7] hover:text-[#6366f1] transition-colors p-0.5"
            >
              <Pencil size={11} />
            </button>
          </div>
        )}
      </td>

      {/* Slot ★ */}
      <td className="px-3">
        {isDimmed ? (
          <span className="text-[11px] text-[#c2c4d6]">—</span>
        ) : (
          <select
            value={currentSlot}
            onChange={(e) => {
              e.stopPropagation();
              onSetEdit(order.id, "slot", e.target.value);
            }}
            onClick={(e) => e.stopPropagation()}
            className={slotSelectCls(currentSlot)}
          >
            <option value="">—</option>
            {slots.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </td>
    </tr>
  );
}

// ── Detail Row helper ────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] text-[#8e91a7] mb-0.5">{label}</p>
      <p className={cn("text-[12px] text-[#1c1e30]", mono && "font-mono")}>
        {value}
      </p>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <div className="w-10 h-10 rounded-full bg-[#f5f6fa] flex items-center justify-center mb-3">
        <Search className="h-5 w-5 text-[#8e91a7]" />
      </div>
      <p className="text-[13px] font-semibold text-[#5a5d74]">{message}</p>
    </div>
  );
}
