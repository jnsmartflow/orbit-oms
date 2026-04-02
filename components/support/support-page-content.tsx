"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { SupportOrdersTable } from "@/components/support/support-orders-table";
import { CancelOrderDialog } from "@/components/support/cancel-order-dialog";
import type { SupportOrder } from "@/components/support/support-orders-table";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SlotNavItem {
  id: number;
  name: string;
  sortOrder: number;
  cutoffTime: string | null;
  deliveryTypeId: number | null;
  slotTime: string;
  isNextDay: boolean;
  pendingCount: number;
  dispatchedCount: number;
  tintingCount: number;
}

interface SlotsResponse {
  slots: SlotNavItem[];
  holdCount: number;
  date: string;
}

type MainTab = "all" | "hold";
type StatusFilter = "all" | "pending" | "dispatch" | "dispatched";

// ── Hold grid constant ──────────────────────────────────────────────────────

const HOLD_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "32px 1.1fr 1.8fr 1.1fr 0.5fr 0.7fr 1.2fr",
  gap: "0 10px",
  alignItems: "center",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function formatHoldDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const day = d.getDate();
  const mon = d.toLocaleString("en", { month: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} · ${hh}:${mm}`;
}

function getHoldDays(order: SupportOrder): number {
  const ref = order.updatedAt;
  if (!ref) return 0;
  const diffMs = Date.now() - new Date(ref).getTime();
  return Math.max(1, Math.floor(diffMs / 86400000));
}

// ── Slot-closed helper ──────────────────────────────────────────────────────

function isSlotClosed(slot: SlotNavItem, historyView: boolean): boolean {
  if (historyView) return false;
  if (slot.isNextDay) return false;
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const [h, m] = slot.slotTime.split(":").map(Number);
  const slotMinutes = h * 60 + m + 15; // 15-min grace
  const nowMinutes = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
  return nowMinutes > slotMinutes;
}

function pickDefaultSlot(slots: SlotNavItem[], historyView: boolean): SlotNavItem {
  const firstOpen = slots.find((s) => !isSlotClosed(s, historyView));
  return firstOpen ?? slots[slots.length - 1];
}

// ── Component ────────────────────────────────────────────────────────────────

export function SupportPageContent() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [slots, setSlots] = useState<SlotNavItem[]>([]);
  const [holdCount, setHoldCount] = useState(0);
  const [orders, setOrders] = useState<SupportOrder[]>([]);
  const [activeSection, setActiveSection] = useState("");
  const [activeSlotId, setActiveSlotId] = useState<number | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [allTabOrderCount, setAllTabOrderCount] = useState(0);
  const [holdCancelDialog, setHoldCancelDialog] = useState<{ open: boolean; orderId: number | null; obdNumber: string | null }>({
    open: false, orderId: null, obdNumber: null,
  });
  const [selectedHold, setSelectedHold] = useState<Set<number>>(new Set());
  const [holdBulkLoading, setHoldBulkLoading] = useState(false);

  // Re-fetch slots + orders when date changes; reset hold tab when switching to history
  useEffect(() => {
    if (!activeSection) return;
    const nowIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const histView = date < nowIST;
    (async () => {
      const data = await fetchSlots();
      if (histView && mainTab === "hold") {
        setMainTab("all");
        setStatusFilter("pending");
        setSelectedHold(new Set());
      }
      if (data?.slots.length) {
        const defaultSlot = pickDefaultSlot(data.slots, histView);
        const sec = `slot-${defaultSlot.id}`;
        setActiveSection(sec);
        setActiveSlotId(defaultSlot.id);
        await fetchOrders(sec, defaultSlot.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Track all-tab order count so it persists when switching to hold tab
  useEffect(() => {
    if (mainTab === "all") {
      setAllTabOrderCount(orders.length);
    }
  }, [orders.length, mainTab]);

  // ── Fetch slots ──────────────────────────────────────────────────────────
  const fetchSlots = useCallback(async () => {
    try {
      const res = await fetch(`/api/support/slots?date=${date}`);
      if (!res.ok) throw new Error("Failed to fetch slots");
      const data = (await res.json()) as SlotsResponse;
      setSlots(data.slots);
      setHoldCount(data.holdCount);
      return data;
    } catch {
      toast.error("Failed to load slots");
      return null;
    }
  }, [date]);

  // ── Fetch orders ─────────────────────────────────────────────────────────
  const fetchOrders = useCallback(
    async (section: string, slotId?: number) => {
      setOrders([]);
      setOrdersLoading(true);
      try {
        const qs = new URLSearchParams({ date });
        if (section === "hold") {
          qs.set("section", "hold");
        } else if (section.startsWith("slot-") && slotId) {
          qs.set("section", "slot");
          qs.set("slotId", String(slotId));
        } else {
          setOrders([]);
          setOrdersLoading(false);
          return;
        }
        const res = await fetch(`/api/support/orders?${qs.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch orders");
        const data = (await res.json()) as { orders: SupportOrder[] };
        setOrders(data.orders);
      } catch {
        toast.error("Failed to load orders");
        setOrders([]);
      } finally {
        setOrdersLoading(false);
      }
    },
    [date],
  );

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setSlotsLoading(true);
      const data = await fetchSlots();
      setSlotsLoading(false);
      if (data?.slots.length) {
        const nowIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        const histView = date < nowIST;
        const defaultSlot = pickDefaultSlot(data.slots, histView);
        const sec = `slot-${defaultSlot.id}`;
        setActiveSection(sec);
        setActiveSlotId(defaultSlot.id);
        await fetchOrders(sec, defaultSlot.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Section change ───────────────────────────────────────────────────────
  function handleSelectSection(section: string, slotId?: number) {
    setActiveSection(section);
    setActiveSlotId(slotId ?? null);
    setStatusFilter("all");
    void fetchOrders(section, slotId);
  }

  // ── Main tab change ──────────────────────────────────────────────────────
  function handleMainTabChange(tab: MainTab) {
    setMainTab(tab);
    setStatusFilter("all");
    setSelectedHold(new Set());
    if (tab === "all") {
      if (activeSlotId && slots.find((s) => s.id === activeSlotId)) {
        void fetchOrders(`slot-${activeSlotId}`, activeSlotId);
      } else if (slots.length > 0) {
        const first = slots[0];
        setActiveSection(`slot-${first.id}`);
        setActiveSlotId(first.id);
        void fetchOrders(`slot-${first.id}`, first.id);
      }
    } else if (tab === "hold") {
      setActiveSection("hold");
      void fetchOrders("hold");
    }
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    await fetchSlots();
    await fetchOrders(activeSection, activeSlotId ?? undefined);
  }, [fetchSlots, fetchOrders, activeSection, activeSlotId]);

  // ── Action handlers ──────────────────────────────────────────────────────
  const handleDispatch = useCallback(async (orderId: number) => {
    const res = await fetch(`/api/support/orders/${orderId}/dispatch`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Dispatch failed");
    }
    toast.success("Order dispatched");
    await refresh();
  }, [refresh]);

  const handleHold = useCallback(async (orderId: number) => {
    const res = await fetch(`/api/support/orders/${orderId}/hold`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Hold failed");
    }
    toast.success("Order placed on hold");
    await refresh();
  }, [refresh]);

  const handleRelease = useCallback(async (orderId: number) => {
    const res = await fetch(`/api/support/orders/${orderId}/release`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Release failed");
    }
    toast.success("Order released from hold");
    await refresh();
  }, [refresh]);

  const handleCancel = useCallback(async (orderId: number, reason: string, note?: string) => {
    const res = await fetch(`/api/support/orders/${orderId}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, note }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Cancel failed");
    }
    toast.success("Order cancelled");
    await refresh();
  }, [refresh]);

  const handleAssignSlot = useCallback(async (orderId: number, slotId: number) => {
    const res = await fetch(`/api/support/orders/${orderId}/assign-slot`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Assign slot failed");
    }
    toast.success("Slot assigned");
    await refresh();
  }, [refresh]);

  const handleBulkDispatch = useCallback(async (orderIds: number[]) => {
    const res = await fetch("/api/support/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds, action: "dispatch" }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Bulk dispatch failed");
    }
    const data = (await res.json().catch(() => ({}))) as { processed?: number; skipped?: number };
    toast.success(`${data.processed ?? 0} dispatched, ${data.skipped ?? 0} skipped`);
    await refresh();
  }, [refresh]);

  const handleBulkHold = useCallback(async (orderIds: number[]) => {
    const res = await fetch("/api/support/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds, action: "hold" }),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Bulk hold failed");
    }
    const data = (await res.json().catch(() => ({}))) as { processed?: number; skipped?: number };
    toast.success(`${data.processed ?? 0} placed on hold, ${data.skipped ?? 0} skipped`);
    await refresh();
  }, [refresh]);

  // ── Derived values ────────────────────────────────────────────────────────
  const headerPending    = slots.reduce((s, sl) => s + sl.pendingCount, 0);
  const headerDispatched = slots.reduce((s, sl) => s + sl.dispatchedCount, 0);
  const headerTinting    = slots.reduce((s, sl) => s + sl.tintingCount, 0);
  const headerTotal      = headerPending + headerDispatched + headerTinting;

  const statusCounts = useMemo(() => ({
    all:        orders.length,
    pending:    orders.filter((o) => !o.dispatchStatus).length,
    dispatch:   orders.filter((o) => o.dispatchStatus === "dispatch").length,
    dispatched: orders.filter((o) => o.workflowStage === "dispatched" || o.dispatchStatus === "dispatched").length,
  }), [orders]);

  const filteredOrders = useMemo(() => {
    if (statusFilter === "all")        return orders;
    if (statusFilter === "pending")    return orders.filter((o) => !o.dispatchStatus);
    if (statusFilter === "dispatch")   return orders.filter((o) => o.dispatchStatus === "dispatch");
    if (statusFilter === "dispatched") return orders.filter((o) => o.workflowStage === "dispatched" || o.dispatchStatus === "dispatched");
    return orders;
  }, [orders, statusFilter]);

  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const minDateIST = new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const isHistoryView = date < todayIST;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (slotsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-900">Support Queue</h1>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <CalendarDays size={13} />
            <input
              type="date"
              value={date}
              max={todayIST}
              min={minDateIST}
              onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
              className="bg-transparent text-[11px] text-gray-500 border-none outline-none cursor-pointer"
            />
            <button
              type="button"
              onClick={() => void refresh()}
              className="p-0.5 hover:bg-gray-100 rounded ml-0.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span><span className="text-gray-600 font-medium">{headerPending}</span> Pending</span>
          <span><span className="text-gray-600 font-medium">{headerDispatched}</span> Dispatched</span>
          <span><span className="text-gray-600 font-medium">{headerTinting}</span> Tinting</span>
          <span className="text-gray-200 mx-1">|</span>
          <span><span className="text-gray-600 font-medium">{headerTotal}</span> OBDs</span>
        </div>
      </div>

      {/* ── Read-only history banner ─────────────────────────────────────── */}
      {isHistoryView && (
        <div className="px-5 py-2 bg-gray-50 text-xs text-gray-500 border-b border-gray-100 flex items-center gap-2 flex-shrink-0">
          📋 Viewing {formatDateDDMMYYYY(date)} — Read Only
        </div>
      )}

      {/* ── Top Tabs: All | Hold ──────────────────────────────────────────── */}
      <div className="flex items-center gap-5 px-5 border-b border-gray-100 flex-shrink-0">
        {/* All tab */}
        <button
          type="button"
          onClick={() => handleMainTabChange("all")}
          className={cn(
            "relative py-2.5 text-xs font-medium transition-colors",
            mainTab === "all" ? "text-gray-900" : "text-gray-400 hover:text-gray-600",
          )}
        >
          All
          {allTabOrderCount > 0 && (
            <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full ml-1.5">
              {allTabOrderCount}
            </span>
          )}
          {mainTab === "all" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 rounded-t-sm" />
          )}
        </button>

        {/* Hold tab — hidden in history view */}
        {!isHistoryView && <button
          type="button"
          onClick={() => handleMainTabChange("hold")}
          className={cn(
            "relative py-2.5 text-xs font-medium transition-colors",
            mainTab === "hold" ? "text-gray-900" : "text-gray-400 hover:text-gray-600",
          )}
        >
          Hold
          {holdCount > 0 && (
            <span className="text-[10px] bg-amber-50 text-amber-500 px-1.5 py-0.5 rounded-full ml-1.5">
              {holdCount}
            </span>
          )}
          {mainTab === "hold" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 rounded-t-sm" />
          )}
        </button>}
      </div>

      {/* ── All Tab Content ───────────────────────────────────────────────── */}
      {mainTab === "all" && (
        <>
          {/* Status filter pills */}
          <div className="px-5 py-2 border-b border-gray-50 flex items-center gap-2 flex-shrink-0">
            {(["all", "pending", "dispatch", "dispatched"] as const).map((f) => {
              const isActive = statusFilter === f;
              const labels: Record<typeof f, string> = {
                all: "All", pending: "Pending", dispatch: "Dispatch", dispatched: "Dispatched",
              };
              const count = statusCounts[f];
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 border rounded-full text-xs font-medium cursor-pointer transition-colors",
                    isActive
                      ? "border-gray-900 text-gray-900 bg-white"
                      : "border-gray-200 text-gray-500 bg-white hover:bg-gray-50",
                  )}
                >
                  {f === "pending" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block flex-shrink-0" />
                  )}
                  {f === "dispatch" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block flex-shrink-0" />
                  )}
                  {f === "dispatched" && (
                    <svg className="w-3 h-3 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {labels[f]}
                  <span className={cn(
                    "text-[10px] font-semibold px-1.5 rounded-full",
                    isActive ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500",
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Slot bar — compact pills */}
          <div className="px-5 py-1.5 border-b border-gray-50 flex items-center gap-2 flex-shrink-0 overflow-x-auto">
            {slots.map((slot) => {
              const isDone = slot.pendingCount === 0 && slot.tintingCount === 0;
              const isActive = activeSlotId === slot.id;
              return (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => handleSelectSection(`slot-${slot.id}`, slot.id)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2.5 py-0.5 border rounded-md text-xs whitespace-nowrap h-7 flex-shrink-0 transition-colors",
                    isDone && !isActive && "bg-gray-50 border-gray-100 text-gray-400",
                    isActive && "border-gray-900 text-gray-900 font-medium",
                    !isDone && !isActive && "bg-white border-gray-200 text-gray-500 hover:border-gray-300",
                  )}
                >
                  {isDone && !isActive && (
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <span>{slot.name}</span>
                  {isActive && (
                    <>
                      <span className="text-[10px] text-gray-400 ml-0.5">{slot.pendingCount} pending</span>
                      <span className="text-[10px] text-gray-300">·</span>
                      <span className="text-[10px] text-gray-400">{slot.dispatchedCount} done</span>
                    </>
                  )}
                  {!isActive && !isDone && slot.pendingCount > 0 && (
                    <span className="text-[10px] text-gray-400 ml-0.5">{slot.pendingCount}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Orders table */}
          <div className="flex-1 overflow-hidden">
            <SupportOrdersTable
              orders={filteredOrders}
              section={activeSection}
              onDispatch={handleDispatch}
              onHold={handleHold}
              onRelease={handleRelease}
              onCancel={handleCancel}
              onAssignSlot={handleAssignSlot}
              onBulkDispatch={handleBulkDispatch}
              onBulkHold={handleBulkHold}
              loading={ordersLoading}
              slots={slots}
              date={date}
              onOrdersChanged={refresh}
              isHistoryView={isHistoryView}
            />
          </div>
        </>
      )}

      {/* ── Hold Tab Content ─────────────────────────────────────────────── */}
      {mainTab === "hold" && (
        <div className="flex-1 overflow-auto pb-14">
          <div className="px-5 py-4">
            {ordersLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-gray-300" />
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-gray-400 py-16 text-center">No orders on hold</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-500">
                    {orders.length} order{orders.length !== 1 ? "s" : ""} on hold — follow up to release
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedHold.size === orders.length) setSelectedHold(new Set());
                      else setSelectedHold(new Set(orders.map((o) => o.id)));
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {selectedHold.size === orders.length ? "Deselect All" : "Select All"}
                  </button>
                </div>

                {/* Column headers */}
                <div style={HOLD_GRID} className="py-1.5 px-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <div>
                    <Checkbox
                      checked={orders.length > 0 && selectedHold.size === orders.length}
                      onCheckedChange={() => {
                        if (selectedHold.size === orders.length) setSelectedHold(new Set());
                        else setSelectedHold(new Set(orders.map((o) => o.id)));
                      }}
                    />
                  </div>
                  <div>OBD / Date</div>
                  <div>Customer</div>
                  <div>Route / Type</div>
                  <div className="text-right">Vol</div>
                  <div>Hold Since</div>
                  <div></div>
                </div>

                {/* Hold rows */}
                {orders.map((order) => {
                  const holdDays = getHoldDays(order);
                  const holdBadgeCls = holdDays >= 2
                    ? "text-red-600 bg-red-50"
                    : "text-amber-600 bg-amber-50";
                  const delType = order.customer?.dispatchDeliveryType?.name ?? order.customer?.area?.deliveryType?.name ?? null;
                  const isSelected = selectedHold.has(order.id);

                  return (
                    <div
                      key={order.id}
                      style={HOLD_GRID}
                      className={cn(
                        "py-2.5 px-1 border-b border-gray-50/80 hover:bg-gray-50 transition-colors",
                        isSelected && "bg-teal-50/20",
                      )}
                    >
                      {/* Checkbox */}
                      <div>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => {
                            setSelectedHold((prev) => {
                              const next = new Set(prev);
                              if (next.has(order.id)) next.delete(order.id);
                              else next.add(order.id);
                              return next;
                            });
                          }}
                        />
                      </div>

                      {/* OBD / Date */}
                      <div>
                        <p className="text-xs font-medium text-gray-800 tabular-nums">{order.obdNumber}</p>
                        <p className="text-[10px] text-gray-400">{formatHoldDate(order.obdEmailDate)}</p>
                      </div>

                      {/* Customer */}
                      <div>
                        <p className="text-xs font-medium text-gray-700 truncate">
                          {order.customer?.customerName ?? order.shipToCustomerName ?? "—"}
                        </p>
                        <p className="text-[10px] text-gray-400">{order.shipToCustomerId}</p>
                      </div>

                      {/* Route / Type */}
                      <div>
                        <p className="text-xs text-gray-600">{order.customer?.area?.primaryRoute?.name ?? "—"}</p>
                        {delType && <span className="text-[10px] text-gray-400">{delType}</span>}
                      </div>

                      {/* Vol */}
                      <div className="text-right">
                        <span className="font-mono font-semibold text-xs text-gray-700 tabular-nums">
                          {order.querySnapshot?.totalUnitQty ?? "—"}
                        </span>
                      </div>

                      {/* Hold Since */}
                      <div>
                        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", holdBadgeCls)}>
                          {holdDays}d
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRelease(order.id)}
                          className="text-[11px] text-teal-600 hover:text-teal-700 font-medium"
                        >
                          Release
                        </button>
                        <button
                          type="button"
                          onClick={() => setHoldCancelDialog({ open: true, orderId: order.id, obdNumber: order.obdNumber })}
                          className="text-[11px] text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Sticky bar for bulk release */}
          <div
            className={cn(
              "fixed bottom-0 left-14 right-0 z-50 transform transition-transform duration-200",
              selectedHold.size > 0 ? "translate-y-0" : "translate-y-full",
            )}
          >
            <div className="bg-white border-t border-gray-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
              <div className="flex items-center justify-between px-5 py-2">
                <span className="text-xs font-medium text-gray-700">{selectedHold.size} selected</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedHold(new Set())}
                    className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={holdBulkLoading}
                    onClick={async () => {
                      setHoldBulkLoading(true);
                      try {
                        const ids = Array.from(selectedHold);
                        for (const id of ids) {
                          await handleRelease(id);
                        }
                        setSelectedHold(new Set());
                      } finally {
                        setHoldBulkLoading(false);
                      }
                    }}
                    className="px-4 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-md hover:bg-teal-700 flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    {holdBulkLoading && <Loader2 size={12} className="animate-spin" />}
                    Release {selectedHold.size} Order{selectedHold.size !== 1 ? "s" : ""}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Cancel dialog for hold tab */}
          <CancelOrderDialog
            open={holdCancelDialog.open}
            onOpenChange={(v) => setHoldCancelDialog((p) => ({ ...p, open: v }))}
            orderId={holdCancelDialog.orderId}
            obdNumber={holdCancelDialog.obdNumber}
            onConfirm={handleCancel}
          />
        </div>
      )}
    </div>
  );
}
